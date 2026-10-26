//! The app icon the operator chose (Settings → App Icon). On macOS it goes in the Dock;
//! on Windows and Linux on every window. Remembered on disk, so the right icon shows from
//! the moment Lumen starts.

use std::sync::Mutex;
use tauri::image::Image;
use tauri::{AppHandle, Manager};

/// A choice's image: 512 px for the Dock on macOS; 256 px for window icons elsewhere,
/// because GTK silently drops window icons larger than that.
#[cfg(target_os = "macos")]
macro_rules! choice {
    ($name:literal) => {
        include_bytes!(concat!("../icons/choices/", $name, ".png"))
    };
}
#[cfg(not(target_os = "macos"))]
macro_rules! choice {
    ($name:literal) => {
        include_bytes!(concat!("../icons/choices/", $name, "-256.png"))
    };
}

/// The choices, matching `AppIconId` in src/types.ts. The first is the default.
const ICONS: [(&str, &[u8]); 4] = [
    ("projector", choice!("projector")),
    ("star", choice!("star")),
    ("camera", choice!("camera")),
    ("film", choice!("film")),
];

pub struct AppIcon(Mutex<&'static str>);

fn png(id: &str) -> &'static [u8] {
    ICONS.iter().find(|(name, _)| *name == id).unwrap_or(&ICONS[0]).1
}

fn known(id: &str) -> Option<&'static str> {
    ICONS.iter().find(|(name, _)| *name == id).map(|(name, _)| *name)
}

fn prefs_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("prefs.json"))
}

/// The chosen icon, as an image for new windows.
pub fn current(app: &AppHandle) -> Image<'static> {
    let id = *app.state::<AppIcon>().0.lock().unwrap();
    Image::from_bytes(png(id)).expect("bundled icon is a valid PNG")
}

/// Reads the saved choice and shows it. Called once at startup, before any window opens.
pub fn load(app: &AppHandle) {
    let saved = prefs_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|prefs| prefs.get("appIcon").and_then(|v| v.as_str()).and_then(known));
    let id = saved.unwrap_or(ICONS[0].0);
    app.manage(AppIcon(Mutex::new(id)));
    show(app, id);
}

fn show(app: &AppHandle, id: &'static str) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || macos::set_dock_icon(png(id)));
    }
    #[cfg(not(target_os = "macos"))]
    {
        for window in app.webview_windows().values() {
            if let Ok(image) = Image::from_bytes(png(id)) {
                let _ = window.set_icon(image);
            }
        }
    }
}

#[tauri::command]
pub fn set_app_icon(app: AppHandle, id: String) {
    let Some(id) = known(&id) else { return };
    {
        let state = app.state::<AppIcon>();
        let mut chosen = state.0.lock().unwrap();
        if *chosen == id {
            return;
        }
        *chosen = id;
    }
    if let Some(file) = prefs_file(&app) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // Not being able to save it only means the old icon shows briefly at the next start.
        let _ = std::fs::write(file, serde_json::json!({ "appIcon": id }).to_string());
    }
    show(&app, id);
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    pub fn set_dock_icon(png: &[u8]) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let data = NSData::with_bytes(png);
        if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
            unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image)) };
        }
    }
}
