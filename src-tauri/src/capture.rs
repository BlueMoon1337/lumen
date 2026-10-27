//! Screens ▸ Start Capture: the operator window records the screen and sends the movie here a
//! second at a time, to be written to a file in the folder Capture Settings names.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

/// The file being recorded to.
#[derive(Default)]
pub struct Capture(Mutex<Option<(PathBuf, File)>>);

/// A Save To choice ("downloads", "documents", "desktop", "movies", or a folder's path) as a folder.
fn folder(app: &AppHandle, which: &str) -> Result<PathBuf, String> {
    let paths = app.path();
    let dir = match which {
        "downloads" => paths.download_dir(),
        "documents" => paths.document_dir(),
        "desktop" => paths.desktop_dir(),
        "movies" => paths.video_dir(),
        path if Path::new(path).is_absolute() => return Ok(PathBuf::from(path)),
        other => return Err(format!("“{other}” isn’t a folder.")),
    };
    // Not every system has a Movies (Videos) folder; the home folder will do.
    dir.or_else(|_| paths.home_dir()).map_err(|e| e.to_string())
}

/// A name in `dir` that isn't taken: "Name.mp4", else "Name 2.mp4", "Name 3.mp4"…
fn unique(dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(name);
    if !path.exists() {
        return path;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(at) => (&name[..at], &name[at..]),
        None => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} {n}{ext}")))
        .find(|p| !p.exists())
        .expect("a free name")
}

/// Starts a capture file. Returns its path.
#[tauri::command]
pub fn capture_open(app: AppHandle, capture: tauri::State<'_, Capture>, folder: String, name: String) -> Result<String, String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name.starts_with('.') {
        return Err(format!("“{name}” isn’t a file name Lumen can save."));
    }
    let dir = self::folder(&app, &folder)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn’t open the folder {}: {e}", dir.display()))?;
    let path = unique(&dir, &name);
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("Couldn’t save {}: {e}", path.display()))?;
    let shown = path.display().to_string();
    *capture.0.lock().map_err(|e| e.to_string())? = Some((path, file));
    Ok(shown)
}

/// Adds the next part of the recording (the raw request body) to the file.
#[tauri::command]
pub fn capture_write(capture: tauri::State<'_, Capture>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("There was nothing to write.".into());
    };
    let mut open = capture.0.lock().map_err(|e| e.to_string())?;
    let (path, file) = open.as_mut().ok_or("No capture is recording.")?;
    file.write_all(bytes)
        .map_err(|e| format!("Couldn’t write to {}: {e}", path.display()))
}

/// Finishes the file.
#[tauri::command]
pub fn capture_close(capture: tauri::State<'_, Capture>) -> Result<(), String> {
    if let Some((path, file)) = capture.0.lock().map_err(|e| e.to_string())?.take() {
        file.sync_all().map_err(|e| format!("Couldn’t finish {}: {e}", path.display()))?;
    }
    Ok(())
}

/// Save To ▸ Other Location…: asks for a folder. Returns its path, or nothing when cancelled.
#[tauri::command]
pub async fn choose_capture_folder(app: AppHandle) -> Result<Option<String>, String> {
    let Some(path) = crate::files::dialog(&app)
        .set_title("Choose a Folder for Captures")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    Ok(Some(path.into_path().map_err(|e| e.to_string())?.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_overwrites() {
        let dir = std::env::temp_dir().join(format!("lumen-capture-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique(&dir, "Take.mp4"), dir.join("Take.mp4"));
        std::fs::write(dir.join("Take.mp4"), b"").unwrap();
        assert_eq!(unique(&dir, "Take.mp4"), dir.join("Take 2.mp4"));
        std::fs::write(dir.join("Take 2.mp4"), b"").unwrap();
        assert_eq!(unique(&dir, "Take.mp4"), dir.join("Take 3.mp4"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
