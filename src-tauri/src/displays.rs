//! The displays the computer can see, named the way the operator knows them
//! ("Built-in Retina Display", "E65-E0"), and a watcher that reports when one
//! is plugged in, unplugged or rearranged.

use serde::Serialize;
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Monitor, Runtime};

/// One display, in the shape of `DetectedDisplay` in src/screens.ts.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: u32,
    pub label: String,
    /// Device pixels.
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub internal: Option<bool>,
    pub primary: bool,
    /// The display the operator window is on.
    pub current: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh: Option<f64>,
    /// Desktop position, in desktop units.
    pub left: f64,
    pub top: f64,
    pub scale: f64,
}

/// A stable id for a monitor from its name and where it sits, so it survives a resolution change.
pub fn monitor_id(m: &Monitor) -> u32 {
    let mut h = DefaultHasher::new();
    (m.name(), m.position().x, m.position().y).hash(&mut h);
    (h.finish() & 0x7fff_ffff) as u32
}

/// What the operating system can add about a display, keyed by its position in device pixels.
#[derive(Default, Clone)]
struct Native {
    name: Option<String>,
    internal: Option<bool>,
    refresh: Option<f64>,
}

pub fn list<R: Runtime>(app: &AppHandle<R>) -> Vec<Display> {
    let monitors = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let current = app.get_webview_window("main").and_then(|w| w.current_monitor().ok().flatten());
    let same = |a: &Monitor, b: &Option<Monitor>| b.as_ref().is_some_and(|b| a.position() == b.position() && a.size() == b.size());
    let native = native_info(app);
    let mut seen: HashMap<String, usize> = HashMap::new();
    monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let pos = m.position();
            let extra = native.get(&(pos.x, pos.y)).cloned().unwrap_or_default();
            // Two displays with the same name still need telling apart.
            let mut label = extra.name.unwrap_or_else(|| fallback_name(m.name(), i));
            let n = seen.entry(label.clone()).or_default();
            *n += 1;
            if *n > 1 {
                label = format!("{label} ({n})");
            }
            let scale = m.scale_factor();
            Display {
                id: monitor_id(m),
                label,
                width: m.size().width,
                height: m.size().height,
                internal: extra.internal,
                primary: same(m, &primary),
                current: same(m, &current),
                refresh: extra.refresh,
                left: pos.x as f64 / scale,
                top: pos.y as f64 / scale,
                scale,
            }
        })
        .collect()
}

/// Tauri's own monitor names: the display's model on Linux, "\\.\DISPLAY2" on Windows (shown as "Display 2").
fn fallback_name(name: Option<&String>, index: usize) -> String {
    match name {
        Some(n) if n.starts_with(r"\\.\DISPLAY") => format!("Display {}", &n[11..]),
        Some(n) if !n.trim().is_empty() && !n.starts_with("Monitor #") => n.clone(),
        _ => format!("Display {}", index + 1),
    }
}

#[cfg(target_os = "macos")]
fn native_info<R: Runtime>(app: &AppHandle<R>) -> HashMap<(i32, i32), Native> {
    // AppKit is only usable on the main thread.
    if let Some(mtm) = objc2::MainThreadMarker::new() {
        return macos::screens(mtm);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let asked = app.run_on_main_thread(move || {
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            let _ = tx.send(macos::screens(mtm));
        }
    });
    if asked.is_err() {
        return HashMap::new();
    }
    rx.recv_timeout(Duration::from_secs(2)).unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
fn native_info<R: Runtime>(_app: &AppHandle<R>) -> HashMap<(i32, i32), Native> {
    HashMap::new()
}

#[cfg(target_os = "macos")]
mod macos {
    use super::Native;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    use objc2_foundation::{NSNumber, ns_string};
    use std::collections::HashMap;
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGDisplayIsBuiltin(display: u32) -> u32;
        fn CGDisplayCopyDisplayMode(display: u32) -> *mut c_void;
        fn CGDisplayModeGetRefreshRate(mode: *mut c_void) -> f64;
        fn CGDisplayModeRelease(mode: *mut c_void);
    }

    /// The names System Settings shows, whether each display is built in, and its refresh rate.
    /// Keyed the way Tauri positions monitors on macOS: the display's origin in points, times its scale.
    pub fn screens(mtm: MainThreadMarker) -> HashMap<(i32, i32), Native> {
        let mut out = HashMap::new();
        for screen in NSScreen::screens(mtm).iter() {
            let Some(number) = screen.deviceDescription().objectForKey(ns_string!("NSScreenNumber")) else {
                continue;
            };
            let Ok(number) = number.downcast::<NSNumber>() else {
                continue;
            };
            let id = number.unsignedIntValue();
            let scale = screen.backingScaleFactor();
            let bounds = unsafe { CGDisplayBounds(id) };
            let key = ((bounds.origin.x * scale).round() as i32, (bounds.origin.y * scale).round() as i32);
            let refresh = unsafe {
                let mode = CGDisplayCopyDisplayMode(id);
                if mode.is_null() {
                    None
                } else {
                    let hz = CGDisplayModeGetRefreshRate(mode);
                    CGDisplayModeRelease(mode);
                    (hz > 0.0).then_some(hz)
                }
            };
            out.insert(
                key,
                Native {
                    name: Some(screen.localizedName().to_string()),
                    internal: Some(unsafe { CGDisplayIsBuiltin(id) } != 0),
                    refresh,
                },
            );
        }
        out
    }
}

#[tauri::command]
pub async fn get_displays(app: AppHandle) -> Vec<Display> {
    list(&app)
}

/// Checks the displays every second and tells the operator window when they change, so
/// outputs open as soon as an HDMI cable goes in and close when it comes out.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = Vec::new();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let now = list(&app);
            if now != last {
                let _ = app.emit_to("main", "displays-changed", &now);
                last = now;
            }
        }
    });
}
