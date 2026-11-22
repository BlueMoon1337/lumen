//! Lumen's folder in Documents, laid out like ProPresenter's: Media ▸ Assets holds the media bin's
//! images and videos, Media ▸ Audio the Audio tab's tracks, and Libraries ▸ (each library) a copy
//! of each presentation as a .lumen file, kept up to date as it changes. In the desktop app media is kept
//! there as files (the page plays them through the asset protocol), so Show in Finder opens with
//! the item's own file selected, and a file moved or deleted in Finder can be reconnected.

use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

/// The folders media goes in, under Documents ▸ Lumen.
const FOLDERS: [&str; 2] = ["Media/Assets", "Media/Audio"];

/// Documents ▸ Lumen (the home folder's Lumen if there's no Documents folder).
fn base(app: &AppHandle) -> Result<PathBuf, String> {
    let paths = app.path();
    let documents = paths.document_dir().or_else(|_| paths.home_dir()).map_err(|e| e.to_string())?;
    Ok(documents.join("Lumen"))
}

/// A library's folder: "Libraries/Songs".
fn library_folder(which: &str) -> Option<&str> {
    which.strip_prefix("Libraries/").filter(|name| check_name(name).is_ok())
}

fn folder(app: &AppHandle, which: &str) -> Result<PathBuf, String> {
    if !FOLDERS.contains(&which) && library_folder(which).is_none() {
        return Err(format!("“{which}” isn’t one of Lumen’s folders."));
    }
    Ok(base(app)?.join(which))
}

/// Deletes a file Lumen keeps (a presentation's copy, when it's deleted, renamed or moved), and its
/// library's folder once that's empty.
#[tauri::command]
pub fn remove_lumen_file(app: AppHandle, folder: String, name: String) -> Result<(), String> {
    check_name(&name)?;
    let dir = self::folder(&app, &folder)?;
    let path = dir.join(&name);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| format!("Couldn’t remove {}: {e}", path.display()))?;
    }
    if library_folder(&folder).is_some() {
        // Gone once nothing's left in it but Finder's .DS_Store.
        let left: Vec<_> = std::fs::read_dir(&dir)
            .map(|d| d.flatten().map(|e| e.file_name()).collect())
            .unwrap_or_default();
        if left.iter().all(|n| n == ".DS_Store") {
            let _ = std::fs::remove_file(dir.join(".DS_Store"));
            let _ = std::fs::remove_dir(&dir);
        }
    }
    Ok(())
}

/// Opens one of Lumen's folders in Finder (Libraries ▸ Songs, say), making it if it isn't there.
#[tauri::command]
pub fn reveal_lumen_folder(app: AppHandle, folder: String) -> Result<(), String> {
    let path = if folder == "Libraries" {
        base(&app)?.join("Libraries")
    } else {
        self::folder(&app, &folder)?
    };
    std::fs::create_dir_all(&path).map_err(|e| format!("Couldn’t make the folder {}: {e}", path.display()))?;
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(&path).spawn()
    } else if cfg!(target_os = "windows") {
        Command::new("explorer").arg(&path).spawn()
    } else {
        Command::new("xdg-open").arg(&path).spawn()
    };
    result.map(|_| ()).map_err(|e| format!("Couldn’t open the folder: {e}"))
}

/// Makes Lumen's folders, and gives the path of Documents ▸ Lumen, for the page to play files from.
#[tauri::command]
pub fn lumen_folder(app: AppHandle) -> Result<String, String> {
    for which in FOLDERS {
        let dir = folder(&app, which)?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn’t make the folder {}: {e}", dir.display()))?;
    }
    Ok(base(&app)?.to_string_lossy().into_owned())
}

/// A media file's bytes, for exporting it or drawing it into a slide picture.
#[tauri::command]
pub async fn read_lumen_file(app: AppHandle, folder: String, name: String) -> Result<Response, String> {
    check_name(&name)?;
    let path = self::folder(&app, &folder)?.join(&name);
    let data = std::fs::read(&path).map_err(|e| format!("Couldn’t read {}: {e}", path.display()))?;
    Ok(Response::new(data))
}

/// Where media files are played from: the media server on this computer (src/media_server.rs).
#[tauri::command]
pub fn media_server(app: AppHandle) -> Result<String, String> {
    crate::media_server::address(base(&app)?)
}

/// Whether a media file is still where Lumen put it.
#[tauri::command]
pub fn lumen_file_exists(app: AppHandle, folder: String, name: String) -> Result<bool, String> {
    check_name(&name)?;
    Ok(self::folder(&app, &folder)?.join(&name).is_file())
}

fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name.starts_with('.') {
        return Err(format!("“{name}” isn’t a file name Lumen can save."));
    }
    Ok(())
}

/// "Walk In.mp4" → "Walk In 2.mp4".
fn numbered(name: &str, n: u32) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) => format!("{stem} {n}.{ext}"),
        None => format!("{name} {n}"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinderFile {
    /// The copy's name in the folder.
    name: String,
    /// It's there already (the same size), so it needn't be saved again.
    saved: bool,
}

/// Whether a file starts with `head` and ends with `tail`: with the same size, the same file (a
/// different one of the same size and name almost never matches both).
fn same_ends(path: &std::path::Path, head: &[u8], tail: &[u8]) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let mut buf = vec![0; head.len()];
    if f.read_exact(&mut buf).is_err() || buf != head {
        return false;
    }
    let mut buf = vec![0; tail.len()];
    f.seek(SeekFrom::End(-(tail.len() as i64))).is_ok() && f.read_exact(&mut buf).is_ok() && buf == tail
}

/// Where an item's copy goes: its own name, or a numbered one if a different file has that name.
/// A file there with the same size, beginning and end is this one, already saved.
#[tauri::command]
pub fn finder_file(
    app: AppHandle,
    folder: String,
    name: String,
    size: u64,
    head: Option<Vec<u8>>,
    tail: Option<Vec<u8>>,
) -> Result<FinderFile, String> {
    check_name(&name)?;
    let dir = self::folder(&app, &folder)?;
    let (head, tail) = (head.unwrap_or_default(), tail.unwrap_or_default());
    for n in 1..1000 {
        let candidate = if n == 1 { name.clone() } else { numbered(&name, n) };
        match std::fs::metadata(dir.join(&candidate)) {
            Ok(meta) if meta.len() == size && same_ends(&dir.join(&candidate), &head, &tail) => {
                return Ok(FinderFile {
                    name: candidate,
                    saved: true,
                });
            }
            Ok(_) => continue,
            Err(_) => {
                return Ok(FinderFile {
                    name: candidate,
                    saved: false,
                });
            }
        }
    }
    Err("There are too many files with that name.".into())
}

/// Saves an item's copy (the request's bytes), named by `x-file-name`, in the folder `x-folder` names.
#[tauri::command]
pub fn write_finder_file(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let header = |key: &str| crate::files::header(&request, key);
    let name = header("x-file-name");
    check_name(&name)?;
    let dir = folder(&app, &header("x-folder"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn’t make the folder {}: {e}", dir.display()))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("There was nothing to save.".into());
    };
    let path = dir.join(&name);
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn’t save {}: {e}", path.display()))
}

/// Opens Finder (Explorer on Windows) with the copy selected.
#[tauri::command]
pub fn reveal_finder_file(app: AppHandle, folder: String, name: String) -> Result<(), String> {
    check_name(&name)?;
    let path = self::folder(&app, &folder)?.join(&name);
    if !path.exists() {
        return Err(format!("{} isn’t there.", path.display()));
    }
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg("-R").arg(&path).spawn()
    } else if cfg!(target_os = "windows") {
        Command::new("explorer").arg(format!("/select,{}", path.display())).spawn()
    } else {
        Command::new("xdg-open").arg(path.parent().unwrap_or(&path)).spawn()
    };
    result.map(|_| ()).map_err(|e| format!("Couldn’t open the folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{numbered, same_ends};

    #[test]
    fn knows_a_file_by_its_ends() {
        let path = std::env::temp_dir().join(format!("lumen-same-ends-{}", std::process::id()));
        std::fs::write(&path, b"abcdefghij").unwrap();
        assert!(same_ends(&path, b"abc", b"hij"));
        assert!(!same_ends(&path, b"abd", b"hij"));
        assert!(!same_ends(&path, b"abc", b"hiJ"));
        assert!(same_ends(&path, b"", b""));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn numbers_names_before_the_extension() {
        assert_eq!(numbered("Walk In.mp4", 2), "Walk In 2.mp4");
        assert_eq!(numbered("Logo", 3), "Logo 3");
    }
}
