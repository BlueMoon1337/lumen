//! Cameras and capture cards for the Video Input layer. The operator picks them in Lumen, and
//! each window that shows one opens it itself, so the web views may use cameras without asking.

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{Runtime, Webview, WebviewWindow};

pub fn on_permission_request<R: Runtime>(_webview: Webview<R>, kind: PermissionKind) -> PermissionResponse {
    match kind {
        PermissionKind::Camera => PermissionResponse::Allow,
        _ => PermissionResponse::Default,
    }
}

/// WebKitGTK (Linux) leaves cameras off unless a page is allowed media streams.
pub fn enable<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "linux")]
    let _ = window.with_webview(|webview| {
        use webkit2gtk::{SettingsExt, WebViewExt};
        if let Some(settings) = webview.inner().settings() {
            settings.set_enable_media_stream(true);
        }
    });
    #[cfg(not(target_os = "linux"))]
    let _ = window;
}
