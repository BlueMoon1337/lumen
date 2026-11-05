//! File ▸ Export ▸ Lumen App: saves a copy of the installed app, to put on another computer.
//!
//! On a Mac, as a disk image like the one Lumen is downloaded as (the app, an Applications folder
//! to drag it onto, and the Read Me), or as a zip; elsewhere, the folder Lumen runs from, zipped.
//! Only the app goes: presentations, libraries and media stay in Documents ▸ Lumen.

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::AppHandle;

use crate::files::dialog;

/// What Lumen runs from: Lumen.app on a Mac, the folder holding the program elsewhere.
fn installed() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.canonicalize().unwrap_or(exe);
    #[cfg(target_os = "macos")]
    {
        // Lumen.app/Contents/MacOS/lumen
        exe.ancestors()
            .nth(3)
            .filter(|p| p.extension().is_some_and(|e| e == "app"))
            .map(Path::to_path_buf)
            .ok_or_else(|| "Only Lumen installed as an app can export itself.".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        exe.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "Couldn’t find Lumen’s folder.".to_string())
    }
}

/// Runs a tool, with what it printed as the error if it fails.
fn run(command: &mut Command) -> Result<(), String> {
    let out = command.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(());
    }
    let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(if said.is_empty() {
        format!("{command:?} failed ({})", out.status)
    } else {
        said
    })
}

/// A disk image: the app, a link to Applications, and the Read Me, as in the downloaded one.
#[cfg(target_os = "macos")]
fn disk_image(app: &Path, out: &Path, version: &str) -> Result<(), String> {
    let stage = std::env::temp_dir().join(format!("lumen-export-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        run(Command::new("/usr/bin/ditto").arg(app).arg(stage.join("Lumen.app")))?;
        std::os::unix::fs::symlink("/Applications", stage.join("Applications")).map_err(|e| e.to_string())?;
        std::fs::write(stage.join("Read Me First.txt"), include_str!("../dmg/Read Me First.txt")).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(out);
        run(Command::new("/usr/bin/hdiutil")
            .args(["create", "-quiet", "-ov", "-format", "UDZO", "-fs", "HFS+", "-volname"])
            .arg(format!("Lumen {version}"))
            .arg("-srcfolder")
            .arg(&stage)
            .arg(out))
    })();
    let _ = std::fs::remove_dir_all(&stage);
    result
}

fn zip(app: &Path, out: &Path) -> Result<(), String> {
    let _ = std::fs::remove_file(out);
    #[cfg(target_os = "macos")]
    {
        // ditto keeps what makes it an app (its signature, links and permissions), as Finder's Compress does.
        run(Command::new("/usr/bin/ditto")
            .args(["-c", "-k", "--sequesterRsrc", "--keepParent"])
            .arg(app)
            .arg(out))
    }
    #[cfg(target_os = "windows")]
    {
        // Windows 10 and later come with tar, which writes zips.
        let parent = app.parent().ok_or("Couldn’t find Lumen’s folder.")?;
        let name = app.file_name().ok_or("Couldn’t find Lumen’s folder.")?;
        run(Command::new("tar")
            .arg("-a")
            .arg("-c")
            .arg("-f")
            .arg(out)
            .arg("-C")
            .arg(parent)
            .arg(name))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let parent = app.parent().ok_or("Couldn’t find Lumen’s folder.")?;
        let name = app.file_name().ok_or("Couldn’t find Lumen’s folder.")?;
        run(Command::new("zip").arg("-qry").arg(out).arg(name).current_dir(parent))
    }
}

/// Asks where to save Lumen as a disk image ("dmg", Mac only) or a zip, and makes it there.
/// Returns where it went, or nothing when the operator cancelled.
#[tauri::command]
pub async fn export_app(app: AppHandle, format: String) -> Result<Option<String>, String> {
    let installed = installed()?;
    let version = app.package_info().version.to_string();
    let dmg = format == "dmg";
    if dmg && !cfg!(target_os = "macos") {
        return Err("Disk images are for Macs: export Lumen as a zip.".into());
    }
    let (kind, extension) = if dmg { ("Disk Image", "dmg") } else { ("Zip Archive", "zip") };
    let Some(path) = dialog(&app)
        .set_file_name(format!("Lumen {version}.{extension}"))
        .add_filter(kind, &[extension])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut out = path.into_path().map_err(|e| e.to_string())?;
    if out.extension().is_none_or(|e| !e.eq_ignore_ascii_case(extension)) {
        out.set_extension(extension);
    }
    let target = out.clone();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        if dmg {
            return disk_image(&installed, &target, &version);
        }
        let _ = &version;
        zip(&installed, &target)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Couldn’t export Lumen: {e}"))?;
    Ok(Some(out.display().to_string()))
}
