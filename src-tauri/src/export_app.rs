//! File ▸ Export ▸ Lumen App: saves a copy of the installed app, to put on another computer.
//!
//! On a Mac, as a disk image like the one Lumen is downloaded as (the app, an Applications folder
//! to drag it onto, and the Read Me), or as a zip; elsewhere, the folder Lumen runs from, zipped.
//! Only the app goes: presentations, libraries and media stay in Documents ▸ Lumen. An interface
//! update in use goes inside the copy, which installs it when it first opens (interface.rs).

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

/// Copies the app into `stage`, with the interface update in use (its signed package) inside it, so
/// the copy opens at the same version: it installs the package the first time it opens (see
/// interface.rs). On a Mac the copy is signed again (ad hoc, as it was), since its contents changed.
fn stage_copy(app: &Path, package: Option<&Path>, stage: &Path) -> Result<PathBuf, String> {
    let name = app.file_name().ok_or("Couldn’t find Lumen’s folder.")?;
    let copy = stage.join(name);
    #[cfg(target_os = "macos")]
    {
        run(Command::new("/usr/bin/ditto").arg(app).arg(&copy))?;
        if let Some(package) = package {
            std::fs::copy(package, copy.join("Contents/Resources").join(crate::interface::BUNDLED)).map_err(|e| e.to_string())?;
            run(Command::new("/usr/bin/codesign")
                .args(["--force", "--deep", "--sign", "-"])
                .arg(&copy))?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        copy_dir(app, &copy).map_err(|e| e.to_string())?;
        if let Some(package) = package {
            std::fs::copy(package, copy.join(crate::interface::BUNDLED)).map_err(|e| e.to_string())?;
        }
    }
    Ok(copy)
}

#[cfg(not(target_os = "macos"))]
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// A folder to put things together in, removed afterwards.
fn with_stage<T>(run: impl FnOnce(&Path) -> Result<T, String>) -> Result<T, String> {
    // Its own folder, so two exports at once can't use (and remove) the same one.
    static COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let stage = std::env::temp_dir().join(format!("lumen-export-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let result = run(&stage);
    let _ = std::fs::remove_dir_all(&stage);
    result
}

/// A disk image: the app, a link to Applications, and the Read Me, as in the downloaded one.
#[cfg(target_os = "macos")]
fn disk_image(app: &Path, package: Option<&Path>, out: &Path, version: &str) -> Result<(), String> {
    with_stage(|stage| {
        let copy = stage_copy(app, package, stage)?;
        if copy.file_name() != Some(std::ffi::OsStr::new("Lumen.app")) {
            std::fs::rename(&copy, stage.join("Lumen.app")).map_err(|e| e.to_string())?;
        }
        std::os::unix::fs::symlink("/Applications", stage.join("Applications")).map_err(|e| e.to_string())?;
        std::fs::write(stage.join("Read Me First.txt"), include_str!("../dmg/Read Me First.txt")).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(out);
        run(Command::new("/usr/bin/hdiutil")
            .args(["create", "-quiet", "-ov", "-format", "UDZO", "-fs", "HFS+", "-volname"])
            .arg(format!("Lumen {version}"))
            .arg("-srcfolder")
            .arg(stage)
            .arg(out))
    })
}

fn zip(app: &Path, package: Option<&Path>, out: &Path) -> Result<(), String> {
    let _ = std::fs::remove_file(out);
    with_stage(|stage| {
        let app = stage_copy(app, package, stage)?;
        #[cfg(target_os = "macos")]
        {
            // ditto keeps what makes it an app (its signature, links and permissions), as Finder's Compress does.
            run(Command::new("/usr/bin/ditto")
                .args(["-c", "-k", "--sequesterRsrc", "--keepParent"])
                .arg(&app)
                .arg(out))
        }
        #[cfg(target_os = "windows")]
        {
            // Windows 10 and later come with tar, which writes zips.
            let name = app.file_name().ok_or("Couldn’t find Lumen’s folder.")?;
            run(Command::new("tar")
                .arg("-a")
                .arg("-c")
                .arg("-f")
                .arg(out)
                .arg("-C")
                .arg(stage)
                .arg(name))
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let name = app.file_name().ok_or("Couldn’t find Lumen’s folder.")?;
            run(Command::new("zip").arg("-qry").arg(out).arg(name).current_dir(stage))
        }
    })
}

/// Asks where to save Lumen as a disk image ("dmg", Mac only) or a zip, and makes it there.
/// Returns where it went, or nothing when the operator cancelled.
#[tauri::command]
pub async fn export_app(app: AppHandle, format: String) -> Result<Option<String>, String> {
    let installed = installed()?;
    // The interface update in use (if any) goes along, and names the export's version.
    let native = app.package_info().version.to_string();
    let package = crate::interface::active_package(&app.config().identifier, &native);
    if let (None, Some(serving)) = (&package, crate::interface::serving()) {
        return Err(format!(
            "Lumen {serving}’s update package can’t be found, so it can’t go along with the export. Install it again (Settings ▸ Updates ▸ Install from Zip…), then export."
        ));
    }
    let version = package.as_ref().map(|(_, v)| v.clone()).unwrap_or(native);
    let package = package.map(|(p, _)| p);
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
            return disk_image(&installed, package.as_deref(), &target, &version);
        }
        let _ = &version;
        zip(&installed, package.as_deref(), &target)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Couldn’t export Lumen: {e}"))?;
    Ok(Some(out.display().to_string()))
}
