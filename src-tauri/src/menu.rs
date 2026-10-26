//! The menu bar, with ProPresenter's Screens menu: ⌘1 Audience, ⌘2 Stage,
//! ⌥⌘1 Configure Screens…, Identify Screens. Clicks go to the operator window, which
//! owns the setup and sends back the checkmarks.

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

const COMMANDS: [&str; 4] = ["toggle-audience", "toggle-stage", "configure-screens", "identify-screens"];

/// The menu items whose checkmarks follow the setup.
pub struct ScreensMenu {
    audience: CheckMenuItem<Wry>,
    stage: CheckMenuItem<Wry>,
    identify: CheckMenuItem<Wry>,
}

/// The platform's standard menus (so copy and paste work in text fields) plus Screens, before Window.
pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, ScreensMenu)> {
    let audience = CheckMenuItem::with_id(app, "toggle-audience", "Audience", true, false, Some("CmdOrCtrl+1"))?;
    let stage = CheckMenuItem::with_id(app, "toggle-stage", "Stage", true, false, Some("CmdOrCtrl+2"))?;
    let configure = MenuItem::with_id(app, "configure-screens", "Configure Screens…", true, Some("Alt+CmdOrCtrl+1"))?;
    let identify = CheckMenuItem::with_id(app, "identify-screens", "Identify Screens", true, false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let screens = Submenu::with_items(app, "Screens", true, &[&audience, &stage, &separator, &configure, &identify])?;
    let menu = Menu::default(app)?;
    let at = menu.items()?.len().saturating_sub(2);
    menu.insert(&screens, at)?;
    Ok((menu, ScreensMenu { audience, stage, identify }))
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
