//! The Window menu, as in ProPresenter: Minimize, Zoom, Fill, Center, Move & Resize ▸ (halves,
//! quarters, arranging two or four windows, Return to Previous Size), Bring All to Front, New
//! Windowed Output ▸ (each screen, by kind), and the open windows.
//!
//! On a Mac the menu is the app's standard Window menu: macOS adds Fill, Center, Move & Resize,
//! Full Screen Tile and the window list itself (and Remove Window from Set for tabbed windows).
//! Elsewhere Lumen does them, and the same moves are under More ▸ Window in the operator window.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, IsMenuItem, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, Wry};

/// Where windows go: a share of the screen's work area, as (x, y, width, height) fractions.
type Share = (f64, f64, f64, f64);

const LEFT: Share = (0.0, 0.0, 0.5, 1.0);
const RIGHT: Share = (0.5, 0.0, 0.5, 1.0);
const TOP: Share = (0.0, 0.0, 1.0, 0.5);
const BOTTOM: Share = (0.0, 0.5, 1.0, 0.5);
const QUARTERS: [Share; 4] = [
    (0.0, 0.0, 0.5, 0.5),
    (0.5, 0.0, 0.5, 0.5),
    (0.0, 0.5, 0.5, 0.5),
    (0.5, 0.5, 0.5, 0.5),
];

/// The moves, by command id: the front window's share, then the next windows' (to arrange them).
fn layout(id: &str) -> Option<&'static [Share]> {
    Some(match id {
        "window-fill" => &[(0.0, 0.0, 1.0, 1.0)],
        "window-left" => &[LEFT],
        "window-right" => &[RIGHT],
        "window-top" => &[TOP],
        "window-bottom" => &[BOTTOM],
        "window-top-left" => &QUARTERS[0..1],
        "window-top-right" => &QUARTERS[1..2],
        "window-bottom-left" => &QUARTERS[2..3],
        "window-bottom-right" => &QUARTERS[3..4],
        "window-left-right" => &[LEFT, RIGHT],
        "window-right-left" => &[RIGHT, LEFT],
        "window-top-bottom" => &[TOP, BOTTOM],
        "window-bottom-top" => &[BOTTOM, TOP],
        "window-quarters" => &QUARTERS,
        _ => return None,
    })
}

/// The commands Lumen runs here, without the operator window.
pub const COMMANDS: [&str; 19] = [
    "window-minimize",
    "window-zoom",
    "window-fill",
    "window-center",
    "window-left",
    "window-right",
    "window-top",
    "window-bottom",
    "window-top-left",
    "window-top-right",
    "window-bottom-left",
    "window-bottom-right",
    "window-left-right",
    "window-right-left",
    "window-top-bottom",
    "window-bottom-top",
    "window-quarters",
    "window-previous",
    "window-bring-all",
];

pub fn is_command(id: &str) -> bool {
    COMMANDS.contains(&id) || id.starts_with("window-focus:")
}

/// New Windowed Output's items go to the operator window, which opens the window.
pub fn is_output_command(id: &str) -> bool {
    id.starts_with("windowed-output:")
}

type Rect = (PhysicalPosition<i32>, PhysicalSize<u32>);

pub struct WindowMenu {
    outputs: Submenu<Wry>,
    /// The screens under New Windowed Output, as (id, name, kind), and their items (headers too).
    screens: Mutex<(Vec<(String, String, String)>, Vec<MenuItemKind<Wry>>)>,
    /// The open windows, listed at the end (macOS lists them itself).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    menu: Submenu<Wry>,
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    windows: Mutex<Vec<(String, CheckMenuItem<Wry>)>>,
    /// Each window's place before Lumen moved it, for Return to Previous Size, and where Lumen put
    /// it (so moving it again still returns to where it started).
    previous: Mutex<HashMap<String, (Rect, Rect)>>,
}

pub fn build(app: &AppHandle) -> tauri::Result<(Submenu<Wry>, WindowMenu)> {
    let outputs = Submenu::new(app, "New Windowed Output", true)?;
    let separator = || PredefinedMenuItem::separator(app);

    #[cfg(target_os = "macos")]
    let menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            // macOS puts Fill, Center, Move & Resize and Full Screen Tile here.
            &separator()?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
            &separator()?,
            &outputs,
            // …and the windows after this.
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let menu = {
        let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
        let header = |text: &str| MenuItem::new(app, text, false, None::<&str>);
        let move_resize = Submenu::with_items(
            app,
            "Move && Resize",
            true,
            &[
                &header("Halves")?,
                &item("window-left", "Left")?,
                &item("window-right", "Right")?,
                &item("window-top", "Top")?,
                &item("window-bottom", "Bottom")?,
                &separator()?,
                &header("Quarters")?,
                &item("window-top-left", "Top Left")?,
                &item("window-top-right", "Top Right")?,
                &item("window-bottom-left", "Bottom Left")?,
                &item("window-bottom-right", "Bottom Right")?,
                &separator()?,
                &header("Arrange")?,
                &item("window-left-right", "Left && Right")?,
                &item("window-right-left", "Right && Left")?,
                &item("window-top-bottom", "Top && Bottom")?,
                &item("window-bottom-top", "Bottom && Top")?,
                &item("window-quarters", "Quarters")?,
                &separator()?,
                &item("window-previous", "Return to Previous Size")?,
            ],
        )?;
        Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            "Window",
            true,
            &[
                &MenuItem::with_id(app, "window-minimize", "Minimize", true, Some("CmdOrCtrl+M"))?,
                &item("window-zoom", "Zoom")?,
                &item("window-fill", "Fill")?,
                &item("window-center", "Center")?,
                &separator()?,
                &move_resize,
                &separator()?,
                &item("window-bring-all", "Bring All to Front")?,
                &separator()?,
                &outputs,
                &separator()?,
            ],
        )?
    };

    Ok((
        menu.clone(),
        WindowMenu {
            outputs,
            screens: Mutex::new((vec![], vec![])),
            menu,
            windows: Mutex::new(vec![]),
            previous: Mutex::new(HashMap::new()),
        },
    ))
}

// ---- Moving windows ---------------------------------------------------------------------------

/// The window the commands work on: the one in front, else the operator window.
fn front(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .cloned()
        .or_else(|| windows.get("main").cloned())
}

/// The other windows that can be arranged with it: shown, not minimized and not fullscreen
/// (an output filling its display stays where it is). The operator window comes first.
fn others(app: &AppHandle, front: &WebviewWindow) -> Vec<WebviewWindow> {
    let mut list: Vec<WebviewWindow> = app
        .webview_windows()
        .into_values()
        .filter(|w| w.label() != front.label())
        .filter(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && !w.is_fullscreen().unwrap_or(false))
        .collect();
    list.sort_by_key(|w| (w.label() != "main", w.label().to_string()));
    list
}

fn rect(w: &WebviewWindow) -> Option<Rect> {
    Some((w.outer_position().ok()?, w.outer_size().ok()?))
}

/// Puts a window at a share of a work area, remembering where it was.
fn place(menu: &WindowMenu, w: &WebviewWindow, area: &tauri::PhysicalRect<i32, u32>, share: Share) {
    let _ = w.unmaximize();
    let Some(before) = rect(w) else { return };
    let (ax, ay) = (area.position.x as f64, area.position.y as f64);
    let (aw, ah) = (area.size.width as f64, area.size.height as f64);
    let position = PhysicalPosition::new((ax + aw * share.0).round() as i32, (ay + ah * share.1).round() as i32);
    let size = PhysicalSize::new((aw * share.2).round() as u32, (ah * share.3).round() as u32);
    // set_size is the inside of the window; the frame takes the rest of the share.
    let frame = match (w.outer_size(), w.inner_size()) {
        (Ok(o), Ok(i)) => (o.width.saturating_sub(i.width), o.height.saturating_sub(i.height)),
        _ => (0, 0),
    };
    let _ = w.set_position(position);
    let _ = w.set_size(PhysicalSize::new(
        size.width.saturating_sub(frame.0),
        size.height.saturating_sub(frame.1),
    ));
    let mut previous = menu.previous.lock().unwrap();
    let start = match previous.get(w.label()) {
        // Moved again from where Lumen put it: Return to Previous Size still goes back to the start.
        Some((start, placed)) if *placed == before => *start,
        _ => before,
    };
    previous.insert(w.label().to_string(), (start, (position, size)));
}

fn work_area(w: &WebviewWindow) -> Option<tauri::PhysicalRect<i32, u32>> {
    Some(*w.current_monitor().ok()??.work_area())
}

/// Runs a Window command (from the menu bar, or More ▸ Window).
pub fn run(app: &AppHandle, id: &str) {
    let menu = app.state::<WindowMenu>();
    if let Some(label) = id.strip_prefix("window-focus:") {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        return;
    }
    if id == "window-bring-all" {
        let front = front(app);
        for w in app.webview_windows().values() {
            let _ = w.unminimize();
            let _ = w.show();
        }
        if let Some(w) = front {
            let _ = w.set_focus();
        }
        return;
    }
    let Some(w) = front(app) else { return };
    match id {
        "window-minimize" => {
            let _ = w.minimize();
        }
        "window-zoom" => {
            let _ = if w.is_maximized().unwrap_or(false) {
                w.unmaximize()
            } else {
                w.maximize()
            };
        }
        "window-center" => {
            let _ = w.unmaximize();
            let _ = w.center();
        }
        "window-previous" => {
            let back = menu.previous.lock().unwrap().remove(w.label());
            if let Some(((position, size), _)) = back {
                let frame = match (w.outer_size(), w.inner_size()) {
                    (Ok(o), Ok(i)) => (o.width.saturating_sub(i.width), o.height.saturating_sub(i.height)),
                    _ => (0, 0),
                };
                let _ = w.set_position(position);
                let _ = w.set_size(PhysicalSize::new(
                    size.width.saturating_sub(frame.0),
                    size.height.saturating_sub(frame.1),
                ));
            }
        }
        _ => {
            let (Some(shares), Some(area)) = (layout(id), work_area(&w)) else {
                return;
            };
            let windows: Vec<WebviewWindow> = std::iter::once(w.clone()).chain(others(app, &w)).collect();
            for (win, share) in windows.iter().zip(shares) {
                place(&menu, win, &area, *share);
            }
            let _ = w.set_focus();
        }
    }
}

/// More ▸ Window in the operator window runs the same commands.
#[tauri::command]
pub fn run_window_command(app: AppHandle, id: String) -> Result<(), String> {
    if !is_command(&id) {
        return Err(format!("“{id}” isn’t a Window command."));
    }
    run(&app, &id);
    Ok(())
}

// ---- New Windowed Output and the window list ---------------------------------------------------

#[derive(Deserialize, PartialEq)]
pub struct Screen {
    id: String,
    name: String,
    /// "audience" or "stage".
    kind: String,
}

#[derive(Deserialize)]
pub struct WindowState {
    screens: Vec<Screen>,
}

/// Lists the screens under New Windowed Output, under Audience and Stage headers.
#[tauri::command]
pub fn set_window_state(app: AppHandle, menu: tauri::State<'_, WindowMenu>, state: WindowState) -> Result<(), String> {
    let wanted: Vec<(String, String, String)> = state.screens.into_iter().map(|s| (s.id, s.name, s.kind)).collect();
    let mut screens = menu.screens.lock().map_err(|e| e.to_string())?;
    if screens.0 == wanted {
        return Ok(());
    }
    let error = |e: tauri::Error| e.to_string();
    for old in screens.1.drain(..) {
        menu.outputs.remove(&old).map_err(error)?;
    }
    let mut items: Vec<MenuItemKind<Wry>> = vec![];
    for (kind, title) in [("audience", "Audience"), ("stage", "Stage")] {
        let of_kind: Vec<_> = wanted.iter().filter(|s| s.2 == kind).collect();
        if of_kind.is_empty() {
            continue;
        }
        if !items.is_empty() {
            items.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(&app).map_err(error)?));
        }
        items.push(MenuItemKind::MenuItem(
            MenuItem::new(&app, title, false, None::<&str>).map_err(error)?,
        ));
        for (id, name, _) in of_kind {
            let item =
                MenuItem::with_id(&app, format!("windowed-output:{id}"), name.replace('&', "&&"), true, None::<&str>).map_err(error)?;
            items.push(MenuItemKind::MenuItem(item));
        }
    }
    if items.is_empty() {
        items.push(MenuItemKind::MenuItem(
            MenuItem::new(&app, "No Screens", false, None::<&str>).map_err(error)?,
        ));
    }
    for item in &items {
        menu.outputs.append(item as &dyn IsMenuItem<Wry>).map_err(error)?;
    }
    *screens = (wanted, items);
    Ok(())
}

/// Lists the open windows at the end of the menu, checking the one in front (macOS does this itself).
/// Always on the main thread, one refresh at a time: menus are changed there anyway, and a
/// refresh from elsewhere would wait for it while holding the list.
pub fn refresh_windows(app: &AppHandle) {
    #[cfg(not(target_os = "macos"))]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || list_windows(&handle));
    }
    #[cfg(target_os = "macos")]
    let _ = app;
}

#[cfg(not(target_os = "macos"))]
fn list_windows(app: &AppHandle) {
    {
        let Some(menu) = app.try_state::<WindowMenu>() else { return };
        let mut windows: Vec<WebviewWindow> = app.webview_windows().into_values().collect();
        windows.sort_by_key(|w| (w.label() != "main", w.label().to_string()));
        let mut listed = menu.windows.lock().unwrap();
        let labels: Vec<&str> = windows.iter().map(|w| w.label()).collect();
        if listed.iter().map(|(l, _)| l.as_str()).ne(labels.iter().copied()) {
            for (_, item) in listed.drain(..) {
                let _ = menu.menu.remove(&item);
            }
            for w in &windows {
                let title = w.title().unwrap_or_else(|_| w.label().to_string());
                if let Ok(item) = CheckMenuItem::with_id(
                    app,
                    format!("window-focus:{}", w.label()),
                    title.replace('&', "&&"),
                    true,
                    false,
                    None::<&str>,
                ) {
                    let _ = menu.menu.append(&item);
                    listed.push((w.label().to_string(), item));
                }
            }
        }
        for (label, item) in listed.iter() {
            let focused = app.get_webview_window(label).and_then(|w| w.is_focused().ok()).unwrap_or(false);
            let _ = item.set_checked(focused);
            if let Some(w) = app.get_webview_window(label) {
                if let Ok(title) = w.title() {
                    let _ = item.set_text(title.replace('&', "&&"));
                }
            }
        }
    }
}

/// Sends New Windowed Output's choice to the operator window.
pub fn open_output(app: &AppHandle, id: &str) {
    let _ = app.emit_to("main", "menu", id);
}
