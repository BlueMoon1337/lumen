//! The menu bar, with ProPresenter's Screens menu: ⌘1 Audience, ⌘2 Stage,
//! ⌥⌘1 Configure Screens…, Identify Screens. Clicks go to the operator window, which
//! owns the setup and sends back the checkmarks.
//!
//! The Edit and Presentation menus are ProPresenter's too (see edit.rs and presentation.rs);
//! their commands run in the operator window.
//!
//! The File menu is ProPresenter's: New Presentation, Playlist and Library, and Import and Export
//! submenus. Its commands also run in the operator window.

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

use crate::edit::{self, EditMenu};
use crate::presentation::{self, PresentationMenu};

const COMMANDS: [&str; 18] = [
    "toggle-audience",
    "toggle-stage",
    "configure-screens",
    "identify-screens",
    "new-presentation",
    "new-playlist",
    "new-library",
    "import-file",
    "import-library",
    "import-media",
    "import-clipboard",
    "import-bible",
    "export-presentation",
    "export-bundle",
    "export-text",
    "export-images",
    "export-playlist",
    "export-themes",
];

/// The menu items whose checkmarks follow the setup.
pub struct ScreensMenu {
    audience: CheckMenuItem<Wry>,
    stage: CheckMenuItem<Wry>,
    identify: CheckMenuItem<Wry>,
}

/// File ▸ Export's items, on only when there's a presentation selected to export.
pub struct FileMenu {
    presentation: [MenuItem<Wry>; 4],
}

/// ProPresenter's File menu, without Print. Returns the items to put at the top of File.
fn file_menu(app: &AppHandle) -> tauri::Result<(Vec<MenuItemKind<Wry>>, FileMenu)> {
    let item = |id: &str, text: &str, accelerator: Option<&str>| MenuItem::with_id(app, id, text, true, accelerator);
    let import = Submenu::with_items(
        app,
        "Import",
        true,
        &[
            &item("import-file", "File…", Some("Shift+CmdOrCtrl+I"))?,
            &item("import-library", "Library…", None)?,
            &item("import-media", "Media…", None)?,
            &item("import-clipboard", "Text from Clipboard…", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("import-bible", "Import Bible…", None)?,
        ],
    )?;
    let presentation = [
        MenuItem::with_id(app, "export-presentation", "Presentation…", false, None::<&str>)?,
        MenuItem::with_id(app, "export-bundle", "Presentation Bundle…", false, None::<&str>)?,
        MenuItem::with_id(app, "export-text", "Text…", false, None::<&str>)?,
        MenuItem::with_id(app, "export-images", "Slide Images…", false, None::<&str>)?,
    ];
    let export = Submenu::with_items(
        app,
        "Export",
        true,
        &[
            &presentation[0],
            &presentation[1],
            &presentation[2],
            &presentation[3],
            &PredefinedMenuItem::separator(app)?,
            &item("export-playlist", "Playlist…", None)?,
            &item("export-themes", "Themes…", None)?,
        ],
    )?;
    let items = vec![
        MenuItemKind::MenuItem(item("new-presentation", "New Presentation", Some("CmdOrCtrl+N"))?),
        MenuItemKind::MenuItem(item("new-playlist", "New Playlist", None)?),
        MenuItemKind::MenuItem(item("new-library", "New Library", None)?),
        MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?),
        MenuItemKind::Submenu(import),
        MenuItemKind::Submenu(export),
    ];
    Ok((items, FileMenu { presentation }))
}

/// The platform's standard menus (so copy and paste work in text fields) plus Screens, before Window.
/// Edit's Undo and Redo are Lumen's own, in place of the standard ones that only undo typing.
pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, ScreensMenu, EditMenu, PresentationMenu, FileMenu)> {
    let audience = CheckMenuItem::with_id(app, "toggle-audience", "Audience", true, false, Some("CmdOrCtrl+1"))?;
    let stage = CheckMenuItem::with_id(app, "toggle-stage", "Stage", true, false, Some("CmdOrCtrl+2"))?;
    let configure = MenuItem::with_id(app, "configure-screens", "Configure Screens…", true, Some("Alt+CmdOrCtrl+1"))?;
    let identify = CheckMenuItem::with_id(app, "identify-screens", "Identify Screens", true, false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let screens = Submenu::with_items(app, "Screens", true, &[&audience, &stage, &separator, &configure, &identify])?;
    let menu = Menu::default(app)?;
    let at = menu.items()?.len().saturating_sub(2);
    menu.insert(&screens, at)?;

    // Edit: Lumen's own, in place of the standard one (Linux has none, so it goes after File).
    let (edit, edit_menu) = edit::build(app)?;
    // Presentation comes after Edit, as in ProPresenter.
    let (presentation, presentation_menu) = presentation::build(app)?;
    let items = menu.items()?;
    match items
        .iter()
        .position(|item| matches!(item, MenuItemKind::Submenu(sub) if sub.text().ok().as_deref() == Some("Edit")))
    {
        Some(at) => {
            menu.remove_at(at)?;
            menu.insert(&edit, at)?;
            menu.insert(&presentation, at + 1)?;
        }
        None => {
            menu.insert(&edit, 0)?;
            menu.insert(&presentation, 1)?;
        }
    }

    // File: Lumen's commands above the standard Close Window (and Quit). Linux has no standard
    // File menu, so it gets one, ending in Quit.
    let (items, file) = file_menu(app)?;
    let mut items: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    let separator = PredefinedMenuItem::separator(app)?;
    let standard = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(sub) if sub.text().ok().as_deref() == Some("File") => Some(sub),
        _ => None,
    });
    match standard {
        Some(sub) => {
            items.push(&separator);
            sub.insert_items(&items, 0)?;
        }
        None => {
            // GTK has no standard Quit item, so this one is Lumen's.
            let quit = MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?;
            items.extend([&separator as &dyn tauri::menu::IsMenuItem<Wry>, &quit]);
            menu.insert(&Submenu::with_items(app, "File", true, &items)?, 0)?;
        }
    }
    Ok((menu, ScreensMenu { audience, stage, identify }, edit_menu, presentation_menu, file))
}

pub fn on_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == "quit" {
        app.exit(0);
    } else if edit::COMMANDS.contains(&id) {
        if !edit::forward_to_panel(app, id) {
            let _ = app.emit_to("main", "menu", id);
        }
    } else if COMMANDS.contains(&id) || presentation::is_command(id) {
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
pub struct FileState {
    presentation: bool,
}

/// Turns File ▸ Export's presentation items on when a presentation is selected.
#[tauri::command]
pub fn set_file_state(menu: tauri::State<'_, FileMenu>, state: FileState) {
    for item in &menu.presentation {
        let _ = item.set_enabled(state.presentation);
    }
}
