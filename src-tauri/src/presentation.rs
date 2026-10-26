//! The Presentation menu, as in ProPresenter: New Slide; Next and Previous Slide and Background;
//! Clear Groups ▸ (Clear All, the operator's clear groups, Configure Clear Groups…); Clear Slide,
//! Media, Logo (where ProPresenter has Props), Audio, Messages and Announcements; Clear to Logo;
//! Show Triggered Presentation and Announcement, Reveal in Library; Show Slide on Stage Screens
//! Only. The commands run in the operator window, which says which can run and what the clear
//! groups are.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{IsMenuItem, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

/// The commands the operator window runs; a clear group's is `clear-group:<id>`.
pub const COMMANDS: [&str; 18] = [
    "new-slide",
    "next-slide",
    "prev-slide",
    "next-background",
    "prev-background",
    "clear-all",
    "configure-clear-groups",
    "clear-slide",
    "clear-media",
    "clear-logo",
    "clear-audio",
    "clear-messages",
    "clear-announcements",
    "clear-to-logo",
    "show-triggered",
    "show-triggered-announcement",
    "reveal-in-library",
    "stage-only",
];

pub fn is_command(id: &str) -> bool {
    COMMANDS.contains(&id) || id.starts_with("clear-group:")
}

pub struct PresentationMenu {
    items: Vec<(&'static str, MenuItem<Wry>)>,
    clear_groups: Submenu<Wry>,
    /// The clear groups listed after Clear All, as (id, name), and their items.
    groups: Mutex<(Vec<(String, String)>, Vec<MenuItem<Wry>>)>,
}

/// ⌘→ and ⌘← move the caret in a text field elsewhere, where a menu would take the keys first,
/// so only the Mac's menu has them (the page handles them everywhere).
#[cfg(target_os = "macos")]
const BACKGROUND_KEYS: [Option<&str>; 2] = [Some("CmdOrCtrl+Right"), Some("CmdOrCtrl+Left")];
#[cfg(not(target_os = "macos"))]
const BACKGROUND_KEYS: [Option<&str>; 2] = [None, None];

pub fn build(app: &AppHandle) -> tauri::Result<(Submenu<Wry>, PresentationMenu)> {
    let item = |id: &'static str, text: &str, accelerator: Option<&str>| MenuItem::with_id(app, id, text, true, accelerator);
    // The arrow keys have no shortcut here: a menu would take them from text fields. The page handles them.
    let items = vec![
        ("new-slide", item("new-slide", "New Slide", Some("Shift+CmdOrCtrl+N"))?),
        ("next-slide", item("next-slide", "Next Slide", None)?),
        ("prev-slide", item("prev-slide", "Previous Slide", None)?),
        ("next-background", item("next-background", "Next Background", BACKGROUND_KEYS[0])?),
        (
            "prev-background",
            item("prev-background", "Previous Background", BACKGROUND_KEYS[1])?,
        ),
        ("clear-all", item("clear-all", "Clear All", Some("F1"))?),
        (
            "configure-clear-groups",
            item("configure-clear-groups", "Configure Clear Groups…", None)?,
        ),
        ("clear-slide", item("clear-slide", "Clear Slide", Some("F2"))?),
        ("clear-media", item("clear-media", "Clear Media", Some("F3"))?),
        ("clear-logo", item("clear-logo", "Clear Logo", Some("F4"))?),
        ("clear-audio", item("clear-audio", "Clear Audio", Some("F5"))?),
        ("clear-messages", item("clear-messages", "Clear Messages", Some("F6"))?),
        (
            "clear-announcements",
            item("clear-announcements", "Clear Announcements", Some("F7"))?,
        ),
        ("clear-to-logo", item("clear-to-logo", "Clear to Logo", Some("F12"))?),
        (
            "show-triggered",
            item("show-triggered", "Show Triggered Presentation", Some("CmdOrCtrl+L"))?,
        ),
        (
            "show-triggered-announcement",
            item(
                "show-triggered-announcement",
                "Show Triggered Announcement",
                Some("Shift+CmdOrCtrl+L"),
            )?,
        ),
        (
            "reveal-in-library",
            item("reveal-in-library", "Reveal in Library", Some("Alt+CmdOrCtrl+L"))?,
        ),
        (
            "stage-only",
            item("stage-only", "Show Slide on Stage Screens Only", Some("CmdOrCtrl+0"))?,
        ),
    ];
    let get = |id: &str| -> &dyn IsMenuItem<Wry> { &items.iter().find(|(i, _)| *i == id).expect("presentation item").1 };
    let separator = || PredefinedMenuItem::separator(app);
    let clear_groups = Submenu::with_items(
        app,
        "Clear Groups",
        true,
        &[get("clear-all"), &separator()?, get("configure-clear-groups")],
    )?;
    let menu = Submenu::with_items(
        app,
        "Presentation",
        true,
        &[
            get("new-slide"),
            &separator()?,
            get("next-slide"),
            get("prev-slide"),
            get("next-background"),
            get("prev-background"),
            &separator()?,
            &clear_groups,
            &separator()?,
            get("clear-slide"),
            get("clear-media"),
            get("clear-logo"),
            get("clear-audio"),
            get("clear-messages"),
            get("clear-announcements"),
            &separator()?,
            get("clear-to-logo"),
            &separator()?,
            get("show-triggered"),
            get("show-triggered-announcement"),
            get("reveal-in-library"),
            &separator()?,
            get("stage-only"),
        ],
    )?;
    Ok((
        menu,
        PresentationMenu {
            items,
            clear_groups,
            groups: Mutex::new((vec![], vec![])),
        },
    ))
}

#[derive(Deserialize, PartialEq)]
pub struct ClearGroup {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationState {
    /// The commands that can run now, by id.
    enabled: Vec<String>,
    clear_groups: Vec<ClearGroup>,
}

/// Turns the items on and off, and lists the clear groups after Clear All.
#[tauri::command]
pub fn set_presentation_state(app: AppHandle, menu: tauri::State<'_, PresentationMenu>, state: PresentationState) -> Result<(), String> {
    for (id, item) in &menu.items {
        let _ = item.set_enabled(state.enabled.iter().any(|e| e == id));
    }
    let wanted: Vec<(String, String)> = state.clear_groups.into_iter().map(|g| (g.id, g.name)).collect();
    let mut groups = menu.groups.lock().map_err(|e| e.to_string())?;
    if groups.0 == wanted {
        return Ok(());
    }
    for old in groups.1.drain(..) {
        menu.clear_groups.remove(&old).map_err(|e| e.to_string())?;
    }
    for (at, (id, name)) in wanted.iter().enumerate() {
        // "&" marks a menu's access key; "&&" is a plain one ("Clear Media & Audio").
        let item =
            MenuItem::with_id(&app, format!("clear-group:{id}"), name.replace('&', "&&"), true, None::<&str>).map_err(|e| e.to_string())?;
        menu.clear_groups.insert(&item, 1 + at).map_err(|e| e.to_string())?;
        groups.1.push(item);
    }
    groups.0 = wanted;
    Ok(())
}
