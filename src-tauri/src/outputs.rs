//! Output windows. The operator window says which it wants (see `DesktopOutputRequest` in
//! src/outputs.ts): one per display, fullscreen and showing every output that goes to that
//! display, or a plain window for an output with no display of its own.

use crate::displays::monitor_id;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputRequest {
    key: String,
    /// App route after "#/", e.g. "screen?size=1920x1080&o=…".
    route: String,
    title: String,
    /// Fullscreen on this display; unset opens a window on the operator's screen.
    display_id: Option<u32>,
}

struct Open {
    label: String,
    display: Option<u32>,
    route: String,
}

/// Open output windows by request key.
#[derive(Default)]
pub struct Outputs {
    open: Mutex<HashMap<String, Open>>,
    next: AtomicU32,
}

fn tell_operator(app: &AppHandle) {
    let keys: Vec<String> = app.state::<Outputs>().open.lock().unwrap().keys().cloned().collect();
    let _ = app.emit_to("main", "outputs-changed", keys);
}

#[tauri::command]
pub fn open_outputs(outputs: tauri::State<'_, Outputs>) -> Vec<String> {
    outputs.open.lock().unwrap().keys().cloned().collect()
}

/// Opens, moves, re-points and closes output windows to match the operator window's setup.
#[tauri::command]
pub async fn set_outputs(app: AppHandle, outputs: Vec<OutputRequest>) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let operator = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .map(|m| monitor_id(&m));
    let state = app.state::<Outputs>();

    // Decide under the lock; touch windows after it, because a closing window reports back through `on_window_event`.
    let mut close = Vec::new();
    let mut update = Vec::new();
    let mut create = Vec::new();
    {
        let mut open = state.open.lock().unwrap();
        open.retain(|key, o| {
            let keep = outputs.iter().any(|r| &r.key == key);
            if !keep {
                close.push(o.label.clone());
            }
            keep
        });
        for r in &outputs {
            let display = r.display_id.filter(|id| monitors.iter().any(|m| monitor_id(m) == *id));
            match open.get_mut(&r.key) {
                Some(o) if o.display == display && app.get_webview_window(&o.label).is_some() => {
                    // Same display: keep the window; only its outputs (the address) may have changed.
                    update.push((o.label.clone(), r.title.clone(), (o.route != r.route).then(|| r.route.clone())));
                    o.route = r.route.clone();
                }
                Some(o) => {
                    close.push(o.label.clone());
                    create.push((r, display));
                }
                None => create.push((r, display)),
            }
        }
        for (r, _) in &create {
            open.remove(&r.key);
        }
    }

    for label in close {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
    }
    for (label, title, route) in update {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.set_title(&title);
            if let Some(route) = route {
                let hash = serde_json::to_string(&format!("#/{route}")).unwrap_or_default();
                let _ = w.eval(format!("location.hash = {hash}"));
            }
        }
    }
    for (r, display) in create {
        // New labels each time: a closing window may not be gone yet.
        let label = format!("out-{}", state.next.fetch_add(1, Ordering::Relaxed));
        let monitor = display.and_then(|id| monitors.iter().find(|m| monitor_id(m) == id));
        match build(&app, &label, r, monitor, operator) {
            Ok(_) => {
                state.open.lock().unwrap().insert(
                    r.key.clone(),
                    Open {
                        label,
                        display,
                        route: r.route.clone(),
                    },
                );
            }
            Err(e) => eprintln!("Lumen: couldn't open output window: {e}"),
        }
    }
    tell_operator(&app);
    crate::window::refresh_windows(&app);
    Ok(())
}

fn build(
    app: &AppHandle,
    label: &str,
    r: &OutputRequest,
    monitor: Option<&Monitor>,
    operator: Option<u32>,
) -> tauri::Result<WebviewWindow> {
    // Outputs on another display fill it; one on the operator's screen stays a window, so it can't cover the controls.
    let target = monitor.filter(|m| Some(monitor_id(m)) != operator);
    let url = WebviewUrl::App(format!("index.html#/{}", r.route).into());
    let mut builder = WebviewWindowBuilder::new(app, label, url)
        .title(&r.title)
        .background_color(Color(0, 0, 0, 255))
        .disable_drag_drop_handler()
        .icon(crate::icon::current(app))?;
    builder = match target {
        Some(_) => builder.decorations(false).visible(false),
        None => builder.inner_size(960.0, 540.0),
    };
    let win = builder.build()?;
    crate::camera::enable(&win);
    // Windows and Linux give every window the app menu; outputs shouldn't have one.
    #[cfg(not(target_os = "macos"))]
    let _ = win.remove_menu();
    if let Some(m) = target {
        win.set_position(*m.position())?;
        win.set_size(*m.size())?;
        win.show()?;
        // macOS: cover the display without the fullscreen animation or a new Space, like a presentation app.
        #[cfg(target_os = "macos")]
        {
            win.set_simple_fullscreen(true)?;
            keep_menu_bar_and_dock(&win);
        }
        #[cfg(not(target_os = "macos"))]
        win.set_fullscreen(true)?;
    }
    Ok(win)
}

/// Simple fullscreen puts an output window over its whole display (the way that worked), but it
/// also hides the menu bar and the Dock for the whole app, so they'd hide on the operator's screen
/// whenever Lumen is in front. This brings them back, and lifts the output over its own display's
/// menu bar instead, on every Space.
#[cfg(target_os = "macos")]
fn keep_menu_bar_and_dock(win: &WebviewWindow) {
    let target = win.clone();
    // Queued after the fullscreen change, which runs on the main thread too.
    let _ = win.run_on_main_thread(move || {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        // NSMainMenuWindowLevel (24) + 1: above the menu bar.
        const ABOVE_MENU_BAR: isize = 25;
        // Can join all Spaces (1 << 0), stationary (1 << 4), left out of ⌘` (1 << 6), beside full-screen windows (1 << 8).
        const BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8);
        unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            if !app.is_null() {
                // NSApplicationPresentationDefault: the menu bar and the Dock as the user has them.
                let _: () = msg_send![&*app, setPresentationOptions: 0usize];
            }
        }
        let Ok(ptr) = target.ns_window() else { return };
        // SAFETY: the window's NSWindow, used on the main thread while the window is open.
        let window = unsafe { &*(ptr as *mut AnyObject) };
        unsafe {
            let _: () = msg_send![window, setLevel: ABOVE_MENU_BAR];
            let _: () = msg_send![window, setCollectionBehavior: BEHAVIOR];
        }
    });
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let app = window.app_handle();
    // Window lists the open windows, with a checkmark on the one in front.
    if matches!(event, WindowEvent::Focused(_) | WindowEvent::Destroyed) {
        crate::window::refresh_windows(app);
    }
    if !matches!(event, WindowEvent::Destroyed) {
        return;
    }
    if window.label() == "main" {
        // Closing the controls closes the outputs too, and with them the app.
        for (label, w) in app.webview_windows() {
            if label != "main" {
                let _ = w.destroy();
            }
        }
        return;
    }
    // An output closed by hand (or by us): forget it and tell the operator window.
    let forgotten = {
        let state = app.state::<Outputs>();
        let mut open = state.open.lock().unwrap();
        let before = open.len();
        open.retain(|_, o| o.label != window.label());
        open.len() != before
    };
    if forgotten {
        tell_operator(app);
    }
}
