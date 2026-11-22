//! Lumen's desktop app: hosts the operator window and opens output windows on the
//! connected displays. The interface itself is the web app in src/; this side gives it
//! the display list, output windows, the menus, Save panels, the clipboard, capture files
//! and the app icon (see the `DesktopBridge` in src/outputs.ts and src/desktop.ts).

mod camera;
mod capture;
mod displays;
mod edit;
mod export_app;
mod files;
mod finder;
mod icon;
mod interface;
mod keynote;
mod media_server;
mod menu;
mod outputs;
mod presentation;
mod remote;
mod screens;
mod startup;
mod updates;
mod view;
mod window;

use tauri::window::Color;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Opens the window filling the main screen (the one with the menu bar), as ProPresenter's does: all
/// of it but the menu bar and the Dock, which stay showing (a maximized window covered them on macOS).
/// Never the projector or TV, which the outputs use.
fn fill_work_area(window: &tauri::WebviewWindow) {
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let _ = window.set_position(area.position);
        let _ = window.set_size(area.size);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // An interface update, once installed, is served in place of the interface built in.
    let mut context = tauri::generate_context!();
    interface::wrap_assets(&mut context);
    tauri::Builder::default()
        // One Lumen at a time: opening it again (from the Dock, Finder or a disk image) brings the
        // open one to the front instead of starting a second copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Settings ▸ Open at Login (a launch agent on macOS, the plugin's default).
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .manage(updates::Updates::default())
        .manage(outputs::Outputs::default())
        .manage(files::ExportFolder::default())
        .manage(files::OpenedFiles::default())
        .manage(capture::Capture::default())
        .manage(keynote::KeynoteExports::default())
        .manage(remote::Remote::default())
        .on_permission_request(camera::on_permission_request)
        .invoke_handler(tauri::generate_handler![
            displays::get_displays,
            outputs::set_outputs,
            outputs::open_outputs,
            screens::set_menu_state,
            view::set_view_state,
            window::set_window_state,
            window::run_window_command,
            updates::app_version,
            updates::has_update_token,
            updates::update_blocker,
            updates::set_update_token,
            updates::check_update,
            updates::install_update,
            edit::set_undo_state,
            edit::set_edit_state,
            presentation::set_presentation_state,
            menu::set_file_state,
            files::open_files,
            files::read_opened_file,
            files::save_file,
            files::choose_export_folder,
            files::write_export_file,
            export_app::export_app,
            interface::interface_state,
            interface::check_interface_package,
            interface::install_interface_package,
            interface::interface_go_back,
            finder::finder_file,
            finder::write_finder_file,
            finder::reveal_finder_file,
            finder::lumen_folder,
            finder::lumen_file_exists,
            finder::media_server,
            finder::read_lumen_file,
            finder::remove_lumen_file,
            finder::reveal_lumen_folder,
            files::read_clipboard_text,
            files::write_clipboard_text,
            icon::set_app_icon,
            capture::capture_open,
            capture::capture_write,
            capture::capture_close,
            capture::choose_capture_folder,
            keynote::keynote_export,
            keynote::keynote_image,
            keynote::keynote_pptx,
            keynote::keynote_done,
            startup::open_at_login,
            startup::set_open_at_login,
            remote::remote_status,
        ])
        .setup(|app| {
            let handle = app.handle();
            icon::load(handle);
            let (menu, screens, edit, presentation, view, window, file) = menu::build(handle)?;
            app.set_menu(menu)?;
            #[cfg(target_os = "macos")]
            edit::attach_text_menus();
            app.manage(screens);
            app.manage(edit);
            app.manage(presentation);
            app.manage(view);
            app.manage(window);
            app.manage(file);

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
            let main = main.build()?;
            fill_work_area(&main);
            camera::enable(&main);

            displays::watch(handle.clone());
            // Player can play a random countdown or the outro (see remote.rs).
            remote::start(handle.clone());
            window::refresh_windows(handle);
            Ok(())
        })
        .on_menu_event(menu::on_event)
        .on_window_event(outputs::on_window_event)
        .run(context)
        .expect("error while running Lumen");
}
