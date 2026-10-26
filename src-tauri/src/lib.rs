//! Lumen's desktop app: hosts the operator window and opens output windows on the
//! connected displays. The interface itself is the web app in src/; this side gives it
//! the display list, output windows, the Screens menu and the app icon (see the
//! `DesktopBridge` in src/outputs.ts and src/desktop.ts).

mod camera;
mod displays;
mod icon;
mod menu;
mod outputs;

use tauri::window::Color;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(outputs::Outputs::default())
        .on_permission_request(camera::on_permission_request)
        .invoke_handler(tauri::generate_handler![
            displays::get_displays,
            outputs::set_outputs,
            outputs::open_outputs,
            menu::set_menu_state,
            menu::set_undo_state,
            icon::set_app_icon,
        ])
        .setup(|app| {
            let handle = app.handle();
            icon::load(handle);
            let (menu, screens, edit) = menu::build(handle)?;
            app.set_menu(menu)?;
            app.manage(screens);
            app.manage(edit);

            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Lumen")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1000.0, 640.0)
                .background_color(Color(0x1d, 0x1d, 0x1d, 255))
                // Files dropped on the window go to the page (import songs, media and Bibles by dragging).
                .disable_drag_drop_handler()
                .icon(icon::current(handle))?;
            // macOS: the window buttons sit inside the toolbar, as in ProPresenter.
            #[cfg(target_os = "macos")]
            let main = main
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(18.0, 24.0));
            camera::enable(&main.build()?);

            displays::watch(handle.clone());
            Ok(())
        })
        .on_menu_event(menu::on_event)
        .on_window_event(outputs::on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running Lumen");
}
