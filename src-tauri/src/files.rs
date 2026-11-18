//! Opening and saving files, and reading the clipboard, for the File menu. The web view can't
//! do these for a menu command: it only shows a file chooser for a click in the page, a download
//! link does nothing in it, and it can't read the clipboard. So the system's Open and Save
//! panels run here; files opened come back as bytes, and exports come here as bytes.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

/// The folder chosen for an export of several files (slide images). Files are only written there.
#[derive(Default)]
pub struct ExportFolder(Mutex<Option<PathBuf>>);

/// Files the operator chose in an Open panel. Only these can be read.
#[derive(Default)]
pub struct OpenedFiles(Mutex<HashSet<PathBuf>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOptions {
    /// Extensions to offer, without dots; empty for any file.
    extensions: Vec<String>,
    /// What the filter is called, e.g. "Songs and Playlists".
    kind: String,
    multiple: bool,
    /// Choose a folder, and get the files in it (and its subfolders) with those extensions.
    folder: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    name: String,
    path: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// The chosen folder's name, when a folder was chosen.
    folder: Option<String>,
    files: Vec<OpenedFile>,
}

/// A folder holds at most this many files to open, looking this deep.
const MAX_FILES: usize = 5000;
const MAX_DEPTH: usize = 4;

fn matches(path: &Path, extensions: &[String]) -> bool {
    extensions.is_empty()
        || path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| extensions.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

/// The files in a folder and its subfolders, skipping hidden ones, in name order.
fn files_in(dir: &Path, extensions: &[String], depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    paths.sort();
    for path in paths {
        if out.len() >= MAX_FILES {
            return;
        }
        if path.file_name().and_then(|n| n.to_str()).is_none_or(|n| n.starts_with('.')) {
            continue;
        }
        if path.is_dir() {
            if depth < MAX_DEPTH {
                files_in(&path, extensions, depth + 1, out);
            }
        } else if matches(&path, extensions) {
            out.push(path);
        }
    }
}

/// Undoes the front end's `encodeURIComponent`, which keeps any file name safe in a header.
fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Some(byte) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(byte);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub(crate) fn header(request: &Request<'_>, name: &str) -> String {
    decode(request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or_default())
}

fn body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("There was nothing to save.".into()),
    }
}

/// A dialog in front of the operator window.
pub(crate) fn dialog(app: &AppHandle) -> FileDialogBuilder<tauri::Wry> {
    let builder = app.dialog().file();
    match app.get_webview_window("main") {
        Some(window) => builder.set_parent(&window),
        None => builder,
    }
}

/// Shows the Open panel (for files, or a folder) and says what was chosen. Read each file with `read_opened_file`.
#[tauri::command]
pub async fn open_files(app: AppHandle, opened: tauri::State<'_, OpenedFiles>, options: OpenOptions) -> Result<Opened, String> {
    let mut panel = dialog(&app);
    let extensions: Vec<&str> = options.extensions.iter().map(String::as_str).collect();
    if !options.folder && !extensions.is_empty() {
        panel = panel.add_filter(&options.kind, &extensions);
    }
    let mut folder = None;
    let paths: Vec<PathBuf> = if options.folder {
        let Some(dir) = panel.blocking_pick_folder() else {
            return Ok(Opened {
                folder: None,
                files: vec![],
            });
        };
        let dir = dir.into_path().map_err(|e| e.to_string())?;
        folder = dir.file_name().map(|n| n.to_string_lossy().into_owned());
        let mut found = Vec::new();
        files_in(&dir, &options.extensions, 0, &mut found);
        found
    } else if options.multiple {
        panel
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .collect()
    } else {
        panel.blocking_pick_file().and_then(|p| p.into_path().ok()).into_iter().collect()
    };
    let mut allowed = opened.0.lock().map_err(|e| e.to_string())?;
    let files = paths
        .into_iter()
        .map(|path| {
            let file = OpenedFile {
                name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                path: path.display().to_string(),
                size: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
            };
            allowed.insert(path);
            file
        })
        .collect();
    Ok(Opened { folder, files })
}

/// The contents of a file chosen in an Open panel (only those can be read).
pub(crate) fn read_opened(opened: &OpenedFiles, path: &str) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path);
    if !opened.0.lock().map_err(|e| e.to_string())?.contains(&path) {
        return Err("That file wasn’t chosen in an Open panel.".into());
    }
    std::fs::read(&path).map_err(|e| format!("Couldn’t open {}: {e}", path.display()))
}

/// The contents of a file chosen in an Open panel.
#[tauri::command]
pub async fn read_opened_file(opened: tauri::State<'_, OpenedFiles>, path: String) -> Result<Response, String> {
    Ok(Response::new(read_opened(&opened, &path)?))
}

/// Shows the Save panel for a file (named, and filtered to its type, as the front end says) and
/// writes it. Returns where it went, or nothing when the operator cancelled.
#[tauri::command]
pub async fn save_file(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let data = body(&request)?;
    let name = header(&request, "x-file-name");
    let kind = header(&request, "x-file-kind");
    let extensions = header(&request, "x-file-extensions");
    let extensions: Vec<&str> = extensions.split(',').filter(|e| !e.is_empty()).collect();
    let mut panel = dialog(&app).set_file_name(&name);
    if !extensions.is_empty() {
        panel = panel.add_filter(&kind, &extensions);
    }
    let Some(path) = panel.blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| format!("Couldn’t save {}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

/// Asks for a folder to export several files into. Returns its path, or nothing when cancelled.
#[tauri::command]
pub async fn choose_export_folder(app: AppHandle, folder: tauri::State<'_, ExportFolder>) -> Result<Option<String>, String> {
    let Some(path) = dialog(&app)
        .set_title("Choose a Folder for the Slide Images")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let shown = path.display().to_string();
    *folder.0.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(Some(shown))
}

/// Writes one file into the folder chosen last. Its name can't lead out of that folder.
#[tauri::command]
pub fn write_export_file(folder: tauri::State<'_, ExportFolder>, request: Request<'_>) -> Result<(), String> {
    let name = header(&request, "x-file-name");
    if name.is_empty() || name.contains(['/', '\\', ':']) || name.starts_with('.') {
        return Err(format!("“{name}” isn’t a file name Lumen can save."));
    }
    let dir = folder.0.lock().map_err(|e| e.to_string())?.clone().ok_or("No folder was chosen.")?;
    let path = dir.join(&name);
    std::fs::write(&path, body(&request)?).map_err(|e| format!("Couldn’t save {}: {e}", path.display()))
}

/// The text on the clipboard, if there is any.
#[tauri::command]
pub fn read_clipboard_text(app: AppHandle) -> Option<String> {
    app.clipboard().read_text().ok()
}

/// Puts text on the clipboard: Edit ▸ Cut and Copy in a text field.
#[tauri::command]
pub fn write_clipboard_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn decodes_uri_components() {
        assert_eq!(
            decode("Amazing%20Grace%20%E2%80%93%20Chris%20Tomlin.lumen"),
            "Amazing Grace – Chris Tomlin.lumen"
        );
        assert_eq!(decode("100%25"), "100%");
        // A stray % is kept as it is.
        assert_eq!(decode("50%"), "50%");
        assert_eq!(decode("%zz"), "%zz");
    }
}
