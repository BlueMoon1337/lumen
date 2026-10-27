//! Settings ▸ Open at Login: Lumen starts when the operator logs in (a launch agent on macOS,
//! the startup entries on Windows, an autostart entry on Linux).

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Whether Lumen is set to open at login.
#[tauri::command]
pub fn open_at_login(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Turns opening at login on or off.
#[tauri::command]
pub fn set_open_at_login(app: AppHandle, on: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if on { manager.enable() } else { manager.disable() }.map_err(|e| format!("Couldn’t change opening at login: {e}"))
}
