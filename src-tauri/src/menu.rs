//! The menu bar, with ProPresenter's Screens menu: ⌘1 Audience, ⌘2 Stage,
//! ⌥⌘1 Configure Screens…, Identify Screens. Clicks go to the operator window, which
//! owns the setup and sends back the checkmarks.
//!
//! Edit ▸ Undo and Redo go to the operator window too: it undoes typing in a text field,
//! or else the last change to the library, and names that change in the menu ("Undo Delete Slide").

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

const COMMANDS: [&str; 6] = [
    "toggle-audience",
    "toggle-stage",
    "configure-screens",
    "identify-screens",
    "undo",
    "redo",
];

/// The menu items whose checkmarks follow the setup.
pub struct ScreensMenu {
    audience: CheckMenuItem<Wry>,
    stage: CheckMenuItem<Wry>,
    identify: CheckMenuItem<Wry>,
}

/// Edit ▸ Undo and Redo, renamed after the step they'd take.
pub struct EditMenu {
    undo: MenuItem<Wry>,
    redo: MenuItem<Wry>,
}

/// The platform's standard menus (so copy and paste work in text fields) plus Screens, before Window.
/// Edit's Undo and Redo are Lumen's own, in place of the standard ones that only undo typing.
pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, ScreensMenu, EditMenu)> {
    let audience = CheckMenuItem::with_id(app, "toggle-audience", "Audience", true, false, Some("CmdOrCtrl+1"))?;
    let stage = CheckMenuItem::with_id(app, "toggle-stage", "Stage", true, false, Some("CmdOrCtrl+2"))?;
    let configure = MenuItem::with_id(app, "configure-screens", "Configure Screens…", true, Some("Alt+CmdOrCtrl+1"))?;
    let identify = CheckMenuItem::with_id(app, "identify-screens", "Identify Screens", true, false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let screens = Submenu::with_items(app, "Screens", true, &[&audience, &stage, &separator, &configure, &identify])?;
    let menu = Menu::default(app)?;
    let at = menu.items()?.len().saturating_sub(2);
    menu.insert(&screens, at)?;

    let undo = MenuItem::with_id(app, "undo", "Undo", false, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "Redo", false, Some("Shift+CmdOrCtrl+Z"))?;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(edit) = item
            && edit.text()? == "Edit"
        {
            // The standard Undo and Redo come first.
            edit.remove_at(0)?;
            edit.remove_at(0)?;
            edit.insert(&undo, 0)?;
            edit.insert(&redo, 1)?;
        }
    }
    Ok((menu, ScreensMenu { audience, stage, identify }, EditMenu { undo, redo }))
}

pub fn on_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if COMMANDS.contains(&id) {
        let _ = app.emit_to("main", "menu", id);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuState {
    audience_enabled: bool,
    stage_enabled: bool,
    identify: bool,
}

#[tauri::command]
pub fn set_menu_state(menu: tauri::State<'_, ScreensMenu>, state: MenuState) {
    let _ = menu.audience.set_checked(state.audience_enabled);
    let _ = menu.stage.set_checked(state.stage_enabled);
    let _ = menu.identify.set_checked(state.identify);
}

#[derive(Deserialize)]
pub struct UndoState {
    undo: Option<String>,
    redo: Option<String>,
}

/// Names the steps Undo and Redo would take, and turns them off when there's none.
#[tauri::command]
pub fn set_undo_state(menu: tauri::State<'_, EditMenu>, state: UndoState) {
    for (item, verb, label) in [(&menu.undo, "Undo", state.undo), (&menu.redo, "Redo", state.redo)] {
        let _ = item.set_text(label.as_deref().map_or(verb.to_string(), |l| format!("{verb} {l}")));
        let _ = item.set_enabled(label.is_some());
    }
}
