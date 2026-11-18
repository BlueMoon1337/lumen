//! Interface updates: a newer version of Lumen's interface (its pages, scripts and styles) put in
//! place of the one built into the app, without building the app again. They come as a signed
//! package (Settings ▸ Updates ▸ Install from Zip…, or a release carrying one, through the Update
//! button), made with `npm run interface-package`. Changes to the app itself (this Rust code)
//! still need a full release.
//!
//! An installed interface lives in Lumen's data folder (`interface/current`), and Lumen serves its
//! pages from there instead of the built-in ones, from the same address, so the library and
//! settings the pages keep are the same. It's used only while it's newer than the app and the app
//! is new enough for it (`requires`); a full update to a newer app leaves it unused. The interface
//! it replaced is kept (`interface/previous`) for Go Back.
//!
//! A package is a zip holding `interface.zip` (the interface, with `lumen-interface.json` saying
//! its version and the oldest app it runs on) and `interface.zip.sig`, its signature by the same
//! key as Lumen's updates (tauri.conf.json's updater `pubkey`), so only Lumen's own packages install.

use std::borrow::Cow;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{AppHandle, Assets, Runtime};

/// What an interface says about itself, in `lumen-interface.json`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Manifest {
    pub app: String,
    pub version: String,
    /// The oldest version of the app it runs on: the first with the commands it uses.
    pub requires: String,
    #[serde(default)]
    pub notes: Option<String>,
}

pub const MANIFEST: &str = "lumen-interface.json";
/// The signed package an installed interface came from, kept with it, so File ▸ Export ▸ Lumen App
/// can take it along.
pub const KEPT_PACKAGE: &str = "lumen-update-package.zip";
/// A package an exported copy of Lumen carries inside it (see export_app.rs): installed the first
/// time that copy opens, so it opens at the version it was exported at.
pub const BUNDLED: &str = "interface-update.zip";

/// "1.2.10" → [1, 2, 10]; anything after a "-" or "+" is ignored.
fn parts(v: &str) -> Vec<u64> {
    v.split(['-', '+'])
        .next()
        .unwrap_or("")
        .split('.')
        .map(|p| p.trim().parse().unwrap_or(0))
        .collect()
}

/// Compares two versions numerically ("1.0.10" is after "1.0.9").
pub fn compare(a: &str, b: &str) -> std::cmp::Ordering {
    let (a, b) = (parts(a), parts(b));
    for i in 0..a.len().max(b.len()) {
        let o = a.get(i).unwrap_or(&0).cmp(b.get(i).unwrap_or(&0));
        if o.is_ne() {
            return o;
        }
    }
    std::cmp::Ordering::Equal
}

/// Lumen's data folder, as Tauri names it (the same as `app_data_dir`), known before the app starts.
pub fn data_dir(identifier: &str) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));
    base.map(|b| b.join(identifier))
}

fn root(identifier: &str) -> Option<PathBuf> {
    data_dir(identifier).map(|d| d.join("interface"))
}

fn read_manifest(dir: &Path) -> Option<Manifest> {
    serde_json::from_slice(&fs::read(dir.join(MANIFEST)).ok()?).ok()
}

/// The installed interface, if the app should use it: newer than the app, and needing no newer app.
pub fn active(identifier: &str, native: &str) -> Option<(PathBuf, Manifest)> {
    let dir = root(identifier)?.join("current");
    let m = read_manifest(&dir)?;
    let usable =
        m.app == "Lumen" && compare(&m.version, native).is_gt() && compare(&m.requires, native).is_le() && dir.join("index.html").is_file();
    usable.then_some((dir, m))
}

/// Serves the installed interface's files, and the built-in ones when there's none (or for any
/// file it doesn't have).
pub struct InterfaceAssets<R: Runtime> {
    built_in: Box<dyn Assets<R>>,
    dir: Option<PathBuf>,
}

impl<R: Runtime> InterfaceAssets<R> {
    pub fn new(built_in: Box<dyn Assets<R>>, dir: Option<PathBuf>) -> Self {
        Self { built_in, dir }
    }
}

/// A file of the installed interface: only plain names below its folder.
fn file_in(dir: &Path, key: &str) -> Option<PathBuf> {
    let rel = Path::new(key.trim_start_matches('/'));
    if rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(dir.join(rel))
}

impl<R: Runtime> Assets<R> for InterfaceAssets<R> {
    fn setup(&self, app: &tauri::App<R>) {
        self.built_in.setup(app);
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        if let Some(path) = self.dir.as_deref().and_then(|d| file_in(d, key.as_ref())) {
            if let Ok(bytes) = fs::read(path) {
                return Some(Cow::Owned(bytes));
            }
        }
        self.built_in.get(key)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.built_in.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.built_in.csp_hashes(html_path)
    }
}

/// Stands in for the built-in assets while they're being wrapped.
pub struct NoAssets;

impl<R: Runtime> Assets<R> for NoAssets {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

// ------------------------------------------------------------------ packages

/// A checked package, ready to install.
pub struct Package {
    pub manifest: Manifest,
    /// The interface's files (path → contents).
    files: Vec<(PathBuf, Vec<u8>)>,
}

/// The public key in tauri.conf.json's updater settings (base64 of minisign's .pub file).
fn public_key(config_key: &str) -> Result<minisign_verify::PublicKey, String> {
    let text = base64::engine::general_purpose::STANDARD
        .decode(config_key.trim())
        .map_err(|_| "Lumen’s update key is unreadable.")?;
    let text = String::from_utf8_lossy(&text);
    let line = text
        .lines()
        .find(|l| !l.starts_with("untrusted comment") && !l.trim().is_empty())
        .unwrap_or("");
    minisign_verify::PublicKey::from_base64(line.trim()).map_err(|_| "Lumen’s update key is unreadable.".into())
}

fn zip_file(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Option<Vec<u8>> {
    let mut f = archive.by_name(name).ok()?;
    let mut out = Vec::new();
    f.read_to_end(&mut out).ok()?;
    Some(out)
}

/// Checks a package: Lumen's signature on it, and that it's an interface for Lumen.
pub fn open_package(bytes: &[u8], config_key: &str) -> Result<Package, String> {
    let invalid = |why: &str| format!("This isn’t a Lumen update package: {why}");
    let mut outer = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid("it isn’t a zip file."))?;
    let inner = zip_file(&mut outer, "interface.zip").ok_or_else(|| invalid("it has no interface.zip."))?;
    let sig = zip_file(&mut outer, "interface.zip.sig").ok_or_else(|| invalid("it isn’t signed."))?;
    // Tauri's signer writes the minisign signature file base64-encoded.
    let sig_text = base64::engine::general_purpose::STANDARD
        .decode(String::from_utf8_lossy(&sig).trim())
        .map_err(|_| invalid("its signature is unreadable."))?;
    let signature =
        minisign_verify::Signature::decode(&String::from_utf8_lossy(&sig_text)).map_err(|_| invalid("its signature is unreadable."))?;
    public_key(config_key)?
        .verify(&inner, &signature, false)
        .map_err(|_| "This package isn’t signed by Lumen’s release key, so it wasn’t installed.".to_string())?;

    let mut archive = zip::ZipArchive::new(Cursor::new(&inner[..])).map_err(|_| invalid("its interface is damaged."))?;
    let manifest: Manifest =
        serde_json::from_slice(&zip_file(&mut archive, MANIFEST).ok_or_else(|| invalid("it doesn’t say its version."))?)
            .map_err(|_| invalid("it doesn’t say its version."))?;
    if manifest.app != "Lumen" {
        return Err(invalid("it’s for another app."));
    }
    let mut files = Vec::new();
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|_| invalid("its interface is damaged."))?;
        if f.is_dir() {
            continue;
        }
        let Some(path) = f.enclosed_name() else {
            return Err(invalid("it has a file outside its folder."));
        };
        let mut data = Vec::new();
        f.read_to_end(&mut data).map_err(|_| invalid("its interface is damaged."))?;
        files.push((path, data));
    }
    if !files.iter().any(|(p, _)| p == Path::new("index.html")) {
        return Err(invalid("it has no index.html."));
    }
    Ok(Package { manifest, files })
}

/// Puts a checked package in place (the interface it replaces kept for Go Back), keeping the
/// package itself (`bytes`) with it.
pub fn install(identifier: &str, package: &Package, bytes: &[u8]) -> Result<(), String> {
    let root = root(identifier).ok_or("Couldn’t find Lumen’s data folder.")?;
    let staging = root.join("staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| format!("Couldn’t install the update: {e}"))?;
    fs::write(staging.join(KEPT_PACKAGE), bytes).map_err(|e| format!("Couldn’t install the update: {e}"))?;
    for (path, data) in &package.files {
        let to = staging.join(path);
        if let Some(dir) = to.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Couldn’t install the update: {e}"))?;
        }
        fs::write(&to, data).map_err(|e| format!("Couldn’t install the update: {e}"))?;
    }
    let current = root.join("current");
    let previous = root.join("previous");
    if current.is_dir() {
        let _ = fs::remove_dir_all(&previous);
        fs::rename(&current, &previous).map_err(|e| format!("Couldn’t install the update: {e}"))?;
    } else {
        // Going back from this one goes back to the interface built into the app.
        let _ = fs::remove_dir_all(&previous);
    }
    fs::rename(&staging, &current).map_err(|e| format!("Couldn’t install the update: {e}"))
}

/// Swaps the installed interface with the one it replaced (or, with none kept, goes back to the
/// built-in one, and from there forward again). Returns the version now in place, None for the
/// built-in one.
pub fn go_back(identifier: &str) -> Result<Option<String>, String> {
    let root = root(identifier).ok_or("Couldn’t find Lumen’s data folder.")?;
    let (current, previous, swap) = (root.join("current"), root.join("previous"), root.join("swap"));
    if !current.is_dir() {
        // Using the built-in interface after going back: switch to the update again.
        if !previous.is_dir() {
            return Err("There’s no interface update to go back from.".into());
        }
        fs::rename(&previous, &current).map_err(|e| e.to_string())?;
        return Ok(read_manifest(&current).map(|m| m.version));
    }
    let _ = fs::remove_dir_all(&swap);
    fs::rename(&current, &swap).map_err(|e| e.to_string())?;
    let back = if previous.is_dir() {
        fs::rename(&previous, &current).map_err(|e| e.to_string())?;
        read_manifest(&current).map(|m| m.version)
    } else {
        None
    };
    fs::rename(&swap, &previous).map_err(|e| e.to_string())?;
    Ok(back)
}

// ------------------------------------------------------------------ commands

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    /// The app's own version.
    app: String,
    /// The interface in use, when it's an installed one.
    interface: Option<String>,
    /// What Go Back would go back to: an interface's version, or the app's own ("built-in").
    previous: Option<String>,
}

fn identifier<R: Runtime>(app: &AppHandle<R>) -> String {
    app.config().identifier.clone()
}

fn update_key<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    config_key(app.config())
}

fn config_key(config: &tauri::Config) -> Result<String, String> {
    config
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Lumen has no update key.".into())
}

/// The version of Lumen in use: the installed interface's, or the app's.
pub fn effective_version<R: Runtime>(app: &AppHandle<R>) -> String {
    let native = app.package_info().version.to_string();
    active(&identifier(app), &native).map(|(_, m)| m.version).unwrap_or(native)
}

#[tauri::command]
pub fn interface_state(app: AppHandle) -> State {
    let id = identifier(&app);
    let native = app.package_info().version.to_string();
    let interface = active(&id, &native).map(|(_, m)| m.version);
    let usable = |m: &Manifest| compare(&m.version, &native).is_gt() && compare(&m.requires, &native).is_le();
    let kept = root(&id)
        .and_then(|r| read_manifest(&r.join("previous")))
        .filter(usable)
        .map(|m| m.version);
    let previous = match &interface {
        // Go Back from an update: to the one it replaced, or to the built-in interface.
        Some(_) => Some(kept.unwrap_or_else(|| native.clone())),
        // Using the built-in interface with an update kept: Go Back switches to it again.
        None => kept,
    };
    State {
        app: native,
        interface,
        previous,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checked {
    version: String,
    current: String,
    /// "newer", "same" or "older" than the version in use.
    compared: &'static str,
    notes: Option<String>,
}

/// Checks a package chosen in an Open panel, saying what it would install.
pub fn check(app: &AppHandle, bytes: &[u8]) -> Result<(Package, Checked), String> {
    let package = open_package(bytes, &update_key(app)?)?;
    let native = app.package_info().version.to_string();
    if compare(&package.manifest.requires, &native).is_gt() {
        return Err(format!(
            "Lumen {} needs a newer Lumen app ({} or later; this is {native}). Install that from its disk image first.",
            package.manifest.version, package.manifest.requires
        ));
    }
    if compare(&package.manifest.version, &native).is_le() {
        return Err(format!(
            "Lumen {} is the interface of an app older than this one ({native}), so there’s nothing to update.",
            package.manifest.version
        ));
    }
    let current = effective_version(app);
    let compared = match compare(&package.manifest.version, &current) {
        std::cmp::Ordering::Greater => "newer",
        std::cmp::Ordering::Equal => "same",
        std::cmp::Ordering::Less => "older",
    };
    let checked = Checked {
        version: package.manifest.version.clone(),
        current,
        compared,
        notes: package.manifest.notes.clone(),
    };
    Ok((package, checked))
}

/// Reads a package chosen in an Open panel (only those can be read) and says what it would install.
#[tauri::command]
pub fn check_interface_package(
    app: AppHandle,
    opened: tauri::State<'_, crate::files::OpenedFiles>,
    path: String,
) -> Result<Checked, String> {
    let bytes = crate::files::read_opened(&opened, &path)?;
    check(&app, &bytes).map(|(_, c)| c)
}

/// Installs a package chosen in an Open panel and restarts Lumen with it.
#[tauri::command]
pub fn install_interface_package(app: AppHandle, opened: tauri::State<'_, crate::files::OpenedFiles>, path: String) -> Result<(), String> {
    let bytes = crate::files::read_opened(&opened, &path)?;
    let (package, _) = check(&app, &bytes)?;
    install(&identifier(&app), &package, &bytes)?;
    crate::updates::restart(&app);
    Ok(())
}

/// Goes back to the interface the last update replaced, and restarts Lumen with it.
#[tauri::command]
pub fn interface_go_back(app: AppHandle) -> Result<(), String> {
    go_back(&identifier(&app))?;
    crate::updates::restart(&app);
    Ok(())
}

/// The package kept with the interface in use, and its version, when it's an installed one.
pub fn active_package(identifier: &str, native: &str) -> Option<(PathBuf, String)> {
    let (dir, m) = active(identifier, native)?;
    let zip = dir.join(KEPT_PACKAGE);
    zip.is_file().then_some((zip, m.version))
}

/// Where an exported copy of Lumen carries its package: in the app's Resources on a Mac, beside
/// the program elsewhere.
fn bundled_package() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    #[cfg(target_os = "macos")]
    let dir = dir.parent()?.join("Resources");
    Some(dir.join(BUNDLED)).filter(|p| p.is_file())
}

/// An exported copy of Lumen opening for the first time: installs the interface it carries, if
/// it's newer than what's here (checked like any package).
fn install_bundled(config: &tauri::Config, native: &str) {
    let Some(path) = bundled_package() else { return };
    let Ok(bytes) = fs::read(&path) else { return };
    let Ok(key) = config_key(config) else { return };
    let Ok(package) = open_package(&bytes, &key) else { return };
    let current = active(&config.identifier, native)
        .map(|(_, m)| m.version)
        .unwrap_or_else(|| native.to_string());
    let m = &package.manifest;
    if compare(&m.version, &current).is_gt() && compare(&m.requires, native).is_le() {
        let _ = install(&config.identifier, &package, &bytes);
    }
}

/// The webview's files: the installed interface's, when there's one to use.
pub fn wrap_assets<R: Runtime>(context: &mut tauri::Context<R>) {
    let native = context.package_info().version.to_string();
    install_bundled(context.config(), &native);
    let dir = active(&context.config().identifier, &native).map(|(dir, _)| dir);
    let built_in = context.set_assets(Box::new(NoAssets));
    context.set_assets(Box::new(InterfaceAssets::new(built_in, dir)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_numerically() {
        assert!(compare("1.0.10", "1.0.9").is_gt());
        assert!(compare("1.0.8", "1.0.8").is_eq());
        assert!(compare("1.0", "1.0.0").is_eq());
        assert!(compare("0.9.9", "1.0.0").is_lt());
    }

    #[test]
    fn serves_only_files_inside_the_interface() {
        let dir = Path::new("/data/interface/current");
        assert_eq!(file_in(dir, "/index.html"), Some(dir.join("index.html")));
        assert_eq!(file_in(dir, "/assets/app.js"), Some(dir.join("assets/app.js")));
        assert_eq!(file_in(dir, "/../secret"), None);
        assert_eq!(file_in(dir, "/"), None);
    }
}

#[cfg(test)]
mod package_tests {
    use super::*;

    /// Checks a real package against the app's key, and installs it in a scratch data folder:
    /// `LUMEN_TEST_PACKAGE=release/Lumen-x-interface.zip cargo test -- --ignored package`.
    #[test]
    #[ignore]
    fn checks_and_installs_a_real_package() {
        let path = std::env::var("LUMEN_TEST_PACKAGE").expect("LUMEN_TEST_PACKAGE");
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let key = config["plugins"]["updater"]["pubkey"].as_str().unwrap();
        let bytes = fs::read(&path).unwrap();
        let package = open_package(&bytes, key).unwrap();
        assert_eq!(package.manifest.app, "Lumen");

        // Changed by one byte: refused.
        let mut tampered = bytes.clone();
        let at = tampered.len() / 2;
        tampered[at] ^= 1;
        assert!(open_package(&tampered, key).is_err());

        let home = std::env::temp_dir().join(format!("lumen-interface-test-{}", std::process::id()));
        // Safe here: this ignored test runs on its own.
        unsafe {
            std::env::set_var("HOME", &home);
            std::env::set_var("XDG_DATA_HOME", home.join("data"));
        }
        let id = "com.lumen.test";
        install(id, &package, &bytes).unwrap();
        assert_eq!(
            active_package(id, &package.manifest.requires).map(|(_, v)| v),
            Some(package.manifest.version.clone())
        );
        let (dir, m) = active(id, &package.manifest.requires).unwrap();
        assert_eq!(m.version, package.manifest.version);
        assert!(dir.join("index.html").is_file());
        assert!(active(id, &package.manifest.version).is_none(), "not used once the app is as new");
        assert_eq!(go_back(id).unwrap(), None);
        assert!(active(id, &package.manifest.requires).is_none());
        assert_eq!(go_back(id).unwrap(), Some(package.manifest.version.clone()));
        let _ = fs::remove_dir_all(&home);
    }
}
