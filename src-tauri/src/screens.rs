//! The Screens menu, as in ProPresenter: Audience (Enable ⌘1, Live ▸ the looks, Edit Looks… ⇧⌘1),
//! Stage (Enable ⌘2, Edit Layouts… ⌘4), Configure Screens… ⌥⌘1, and Start Capture and Capture
//! Settings…. The commands run in the operator window, which owns the setup and sends back the
//! checkmarks, the looks and whether a capture is recording.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

/// The commands the operator window runs; a look's is `look:<id>`.
pub const COMMANDS: [&str; 7] = [
    "toggle-audience",
    "edit-looks",
    "toggle-stage",
    "edit-layouts",
    "configure-screens",
    "toggle-capture",
    "capture-settings",
];

pub fn is_command(id: &str) -> bool {
    COMMANDS.contains(&id) || id.starts_with("look:")
}

pub struct ScreensMenu {
    menu: Submenu<Wry>,
    audience: CheckMenuItem<Wry>,
    stage: CheckMenuItem<Wry>,
    capture: MenuItem<Wry>,
    live: Mutex<Live>,
}

/// Live ▸ and what it lists: the live look's name, the looks as (id, name), and their items.
struct Live {
    submenu: Submenu<Wry>,
    name: String,
    looks: Vec<(String, String)>,
    items: Vec<CheckMenuItem<Wry>>,
}

/// Where Live ▸ sits in the Screens menu, after the Audience header and Enable.
const LIVE_AT: usize = 2;

pub fn build(app: &AppHandle) -> tauri::Result<(Submenu<Wry>, ScreensMenu)> {
    let item = |id: &str, text: &str, accelerator: Option<&str>| MenuItem::with_id(app, id, text, true, accelerator);
    // The section headers are plain, greyed-out items.
    let header = |text: &str| MenuItem::new(app, text, false, None::<&str>);
    let audience = CheckMenuItem::with_id(app, "toggle-audience", "Enable", true, false, Some("CmdOrCtrl+1"))?;
    let stage = CheckMenuItem::with_id(app, "toggle-stage", "Enable", true, false, Some("CmdOrCtrl+2"))?;
    let live = Submenu::new(app, "Live", true)?;
    let capture = item("toggle-capture", "Start Capture", None)?;
    let separator = || PredefinedMenuItem::separator(app);
    let menu = Submenu::with_items(
        app,
        "Screens",
        true,
        &[
            &header("Audience")?,
            &audience,
            &live,
            &item("edit-looks", "Edit Looks…", Some("Shift+CmdOrCtrl+1"))?,
            &separator()?,
            &header("Stage")?,
            &stage,
            &item("edit-layouts", "Edit Layouts…", Some("CmdOrCtrl+4"))?,
            &separator()?,
            &item("configure-screens", "Configure Screens…", Some("Alt+CmdOrCtrl+1"))?,
            &separator()?,
            &capture,
            &item("capture-settings", "Capture Settings…", None)?,
        ],
    )?;
    Ok((
        menu.clone(),
        ScreensMenu {
            menu,
            audience,
            stage,
            capture,
            live: Mutex::new(Live {
                submenu: live,
                name: String::new(),
                looks: vec![],
                items: vec![],
            }),
        },
    ))
}

#[derive(Deserialize, PartialEq)]
pub struct Look {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreensState {
    audience_enabled: bool,
    stage_enabled: bool,
    looks: Vec<Look>,
    live_look_id: String,
    live_look_name: String,
    capturing: bool,
}

/// "&" marks a menu's access key; "&&" is a plain one.
fn label(text: &str) -> String {
    text.replace('&', "&&")
}

/// Sets the checkmarks, lists the looks under Live (checking the live one), and names the capture item.
#[tauri::command]
pub fn set_menu_state(app: AppHandle, menu: tauri::State<'_, ScreensMenu>, state: ScreensState) -> Result<(), String> {
    let _ = menu.audience.set_checked(state.audience_enabled);
    let _ = menu.stage.set_checked(state.stage_enabled);
    let _ = menu
        .capture
        .set_text(if state.capturing { "Stop Capture" } else { "Start Capture" });
    let wanted: Vec<(String, String)> = state.looks.into_iter().map(|l| (l.id, l.name)).collect();
    let mut live = menu.live.lock().map_err(|e| e.to_string())?;
    if live.looks != wanted || live.name != state.live_look_name {
        // A new Live ▸ in place of the old: renaming a submenu doesn't show everywhere (GTK).
        let error = |e: tauri::Error| e.to_string();
        let submenu = Submenu::new(&app, label(&format!("Live: {}", state.live_look_name)), true).map_err(error)?;
        let mut items = vec![];
        for (id, name) in &wanted {
            let item = CheckMenuItem::with_id(&app, format!("look:{id}"), label(name), true, false, None::<&str>).map_err(error)?;
            submenu.append(&item).map_err(error)?;
            items.push(item);
        }
        menu.menu.remove(&live.submenu).map_err(error)?;
        menu.menu.insert(&submenu, LIVE_AT).map_err(error)?;
        *live = Live {
            submenu,
            name: state.live_look_name,
            looks: wanted,
            items,
        };
    }
    for ((id, _), item) in live.looks.iter().zip(&live.items) {
        let _ = item.set_checked(*id == state.live_look_id);
    }
    Ok(())
}
