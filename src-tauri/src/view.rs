//! The View menu, as in ProPresenter: Show ⌃S, Presentation Editor ⌃E, Reflow Editor ⌃R and
//! Bibles ⌃B (the Control key on a Mac, as ProPresenter has them); Continuous Playlist; and
//! Slide View ▸ Grid, Easy or Table. The commands run in the operator window, which sends back
//! the checkmarks and which items can run.

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

pub const COMMANDS: [&str; 8] = [
    "view-show",
    "view-edit",
    "view-reflow",
    "view-bibles",
    "continuous-playlist",
    "slide-view-grid",
    "slide-view-easy",
    "slide-view-table",
];

pub struct ViewMenu {
    edit: MenuItem<Wry>,
    reflow: MenuItem<Wry>,
    continuous: CheckMenuItem<Wry>,
    /// Grid, Easy and Table View.
    slide_views: [CheckMenuItem<Wry>; 3],
}

pub fn build(app: &AppHandle) -> tauri::Result<(Submenu<Wry>, ViewMenu)> {
    let item = |id: &str, text: &str, accelerator: &str| MenuItem::with_id(app, id, text, true, Some(accelerator));
    let check = |id: &str, text: &str| CheckMenuItem::with_id(app, id, text, true, false, None::<&str>);
    // "Ctrl" is the Control key on a Mac too (⌘ would be CmdOrCtrl).
    let edit = item("view-edit", "Presentation Editor", "Ctrl+E")?;
    let reflow = item("view-reflow", "Reflow Editor", "Ctrl+R")?;
    let continuous = check("continuous-playlist", "Continuous Playlist")?;
    let slide_views = [
        check("slide-view-grid", "Grid View")?,
        check("slide-view-easy", "Easy View")?,
        check("slide-view-table", "Table View")?,
    ];
    let slide_view = Submenu::with_items(app, "Slide View", true, &[&slide_views[0], &slide_views[1], &slide_views[2]])?;
    let separator = || PredefinedMenuItem::separator(app);
    let menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("view-show", "Show", "Ctrl+S")?,
            &edit,
            &reflow,
            &item("view-bibles", "Bibles", "Ctrl+B")?,
            &separator()?,
            &continuous,
            &separator()?,
            &slide_view,
        ],
    )?;
    // The Mac's standard View menu has Enter Full Screen; it stays, at the end.
    #[cfg(target_os = "macos")]
    menu.append_items(&[&separator()?, &PredefinedMenuItem::fullscreen(app, None)?])?;
    Ok((
        menu,
        ViewMenu {
            edit,
            reflow,
            continuous,
            slide_views,
        },
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    /// Whether a presentation is selected, for the editors.
    presentation: bool,
    continuous_playlist: bool,
    /// "grid", "easy" or "list" (Table View).
    slide_view: String,
}

#[tauri::command]
pub fn set_view_state(menu: tauri::State<'_, ViewMenu>, state: ViewState) {
    let _ = menu.edit.set_enabled(state.presentation);
    let _ = menu.reflow.set_enabled(state.presentation);
    let _ = menu.continuous.set_checked(state.continuous_playlist);
    for (item, view) in menu.slide_views.iter().zip(["grid", "easy", "list"]) {
        let _ = item.set_checked(state.slide_view == view);
    }
}
