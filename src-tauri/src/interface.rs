//! Interface updates: a newer version of Lumen's interface (its pages, scripts and styles) put in
//! place of the one built into the app, without building the app again. They come as a signed
//! package (Settings ▸ Updates ▸ Install from Zip…, or a release carrying one, through the Update
//! button), made with `npm run interface-package`. Changes to the app itself (this Rust code)
//! still need a full release.
//!
//! Installed packages are kept, as they came, in Lumen's data folder (`interface/packages`), with
//! `interface/state.json` naming the one in use and the one it replaced (for Go Back). At start-up
//! Lumen checks the signature of the one in use again and serves its files from memory, in place
//! of the built-in ones and from the same address (so the library and settings the pages keep are
//! the same): a changed package is refused, and installing another while Lumen runs never touches
//! what the running window is using. An interface is used only while it's newer than the app and
//! the app is new enough for it (`requires`); a full update to a newer app leaves it unused.
//!
//! A package is a zip holding `interface.zip` (the interface, with `lumen-interface.json` saying
//! its version and the oldest app it runs on) and `interface.zip.sig`, its signature by the same
//! key as Lumen's updates (tauri.conf.json's updater `pubkey`), so only Lumen's own packages install.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

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

/// An installed package, as state.json names it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Entry {
    /// Its file in `interface/packages`.
    pub file: String,
    pub version: String,
    pub requires: String,
}

/// Which installed interface is in use, and which one Go Back returns to (none: the built-in one).
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Saved {
    pub current: Option<Entry>,
    pub previous: Option<Entry>,
}

fn read_state(root: &Path) -> Saved {
    fs::read(root.join("state.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Writes the state whole (to a new file, then renamed over the old one).
fn write_state(root: &Path, state: &Saved) -> Result<(), String> {
    let tmp = root.join("state.json.new");
    fs::write(&tmp, serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, root.join("state.json")).map_err(|e| e.to_string())
}

/// Whether an interface can run on this app: newer than it, and needing no newer app.
fn usable(e: &Entry, native: &str) -> bool {
    compare(&e.version, native).is_gt() && compare(&e.requires, native).is_le()
}

/// The installed interface state.json says is in use, if the app can use it (not checked: see `load`).
pub fn active(identifier: &str, native: &str) -> Option<(PathBuf, Entry)> {
    let root = root(identifier)?;
    let e = read_state(&root).current.filter(|e| usable(e, native))?;
    let path = root.join("packages").join(&e.file);
    path.is_file().then_some((path, e))
}

/// The interface in use, checked again: its package's signature, that it's the one state.json
/// says, and that this app can use it. Its files, by path.
fn load(identifier: &str, native: &str, key: &str) -> Option<(Manifest, HashMap<String, Vec<u8>>)> {
    let (path, e) = active(identifier, native)?;
    let package = open_package(&fs::read(path).ok()?, key).ok()?;
    if package.manifest.version != e.version || package.manifest.requires != e.requires {
        return None;
    }
    let files = package
        .files
        .into_iter()
        .map(|(p, data)| (p.to_string_lossy().replace('\\', "/"), data))
        .collect();
    Some((package.manifest, files))
}

/// The version of the interface being served (set once at start-up), when it's an installed one.
static SERVED: OnceLock<Option<String>> = OnceLock::new();

/// Serves the installed interface's files (checked at start-up, held in memory), and the built-in
/// ones when there's none (or for any file it doesn't have).
pub struct InterfaceAssets<R: Runtime> {
    built_in: Box<dyn Assets<R>>,
    files: Option<HashMap<String, Vec<u8>>>,
}

impl<R: Runtime> InterfaceAssets<R> {
    pub fn new(built_in: Box<dyn Assets<R>>, files: Option<HashMap<String, Vec<u8>>>) -> Self {
        Self { built_in, files }
    }
}

impl<R: Runtime> Assets<R> for InterfaceAssets<R> {
    fn setup(&self, app: &tauri::App<R>) {
        self.built_in.setup(app);
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        if let Some(data) = self.files.as_ref().and_then(|f| f.get(key.as_ref().trim_start_matches('/'))) {
            return Some(Cow::Borrowed(data));
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

/// Keeps a checked package (`bytes`, as it came) and makes it the interface in use from the next
/// start, the one it replaces kept for Go Back. What the running window uses isn't touched.
pub fn install(identifier: &str, package: &Package, bytes: &[u8]) -> Result<(), String> {
    let root = root(identifier).ok_or("Couldn’t find Lumen’s data folder.")?;
    let fail = |e: std::io::Error| format!("Couldn’t install the update: {e}");
    let packages = root.join("packages");
    fs::create_dir_all(&packages).map_err(fail)?;
    let m = &package.manifest;
    let file = format!("Lumen-{}-interface.zip", m.version.replace(['/', '\\'], "-"));
    let tmp = packages.join(format!("{file}.new"));
    fs::write(&tmp, bytes).map_err(fail)?;
    fs::rename(&tmp, packages.join(&file)).map_err(fail)?;
    let mut state = read_state(&root);
    let entry = Entry {
        file,
        version: m.version.clone(),
        requires: m.requires.clone(),
    };
    if state.current.as_ref().is_some_and(|c| c.file != entry.file) {
        state.previous = state.current.take();
    } else if state.current.is_none() {
        // Going back from this one goes back to the interface built into the app.
        state.previous = None;
    }
    state.current = Some(entry);
    write_state(&root, &state)?;
    tidy(&root, &state);
    Ok(())
}

/// Removes packages no longer named (and the folders older versions of Lumen unpacked into).
fn tidy(root: &Path, state: &Saved) {
    let keep: Vec<&str> = [&state.current, &state.previous]
        .into_iter()
        .flatten()
        .map(|e| e.file.as_str())
        .collect();
    if let Ok(entries) = fs::read_dir(root.join("packages")) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !keep.contains(&name.as_str()) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    for old in ["current", "previous", "staging", "swap"] {
        let _ = fs::remove_dir_all(root.join(old));
    }
}

/// Swaps the interface in use with the one it replaced (none: the built-in one), from the next
/// start. Returns the version now in use, None for the built-in one.
pub fn go_back(identifier: &str) -> Result<Option<String>, String> {
    let root = root(identifier).ok_or("Couldn’t find Lumen’s data folder.")?;
    let mut state = read_state(&root);
    if state.current.is_none() && state.previous.is_none() {
        return Err("There’s no interface update to go back from.".into());
    }
    std::mem::swap(&mut state.current, &mut state.previous);
    write_state(&root, &state)?;
    Ok(state.current.map(|e| e.version))
}

/// Lumen before this kept an installed interface unpacked (`interface/current`, `previous`), with
/// its package inside; those packages move into `packages` (one without its package is dropped).
fn migrate(identifier: &str) {
    let Some(root) = root(identifier) else { return };
    if root.join("state.json").is_file() || !(root.join("current").is_dir() || root.join("previous").is_dir()) {
        return;
    }
    let mut state = Saved::default();
    for (dir, slot) in [("current", 0), ("previous", 1)] {
        let dir = root.join(dir);
        let (Ok(bytes), Some(m)) = (
            fs::read(dir.join("lumen-update-package.zip")),
            fs::read(dir.join(MANIFEST))
                .ok()
                .and_then(|b| serde_json::from_slice::<Manifest>(&b).ok()),
        ) else {
            continue;
        };
        let file = format!("Lumen-{}-interface.zip", m.version.replace(['/', '\\'], "-"));
        let _ = fs::create_dir_all(root.join("packages"));
        if fs::write(root.join("packages").join(&file), bytes).is_ok() {
            let e = Some(Entry {
                file,
                version: m.version,
                requires: m.requires,
            });
            if slot == 0 { state.current = e } else { state.previous = e }
        }
    }
    if write_state(&root, &state).is_ok() {
        tidy(&root, &state);
    }
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

/// The version of Lumen in use: the installed interface's being served, or the app's.
pub fn effective_version<R: Runtime>(app: &AppHandle<R>) -> String {
    SERVED
        .get()
        .cloned()
        .flatten()
        .unwrap_or_else(|| app.package_info().version.to_string())
}

#[tauri::command]
pub fn interface_state(app: AppHandle) -> State {
    let id = identifier(&app);
    let native = app.package_info().version.to_string();
    let interface = SERVED.get().cloned().flatten();
    let kept = root(&id)
        .and_then(|r| read_state(&r).previous)
        .filter(|e| usable(e, &native))
        .map(|e| e.version);
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

/// The package of the interface being served, and its version, when it's an installed one.
pub fn active_package(identifier: &str, native: &str) -> Option<(PathBuf, String)> {
    let served = SERVED.get().cloned().flatten()?;
    active(identifier, native)
        .filter(|(_, e)| e.version == served)
        .map(|(path, e)| (path, e.version))
}

/// Whether an installed interface is being served (it should then go along with an export).
pub fn serving() -> Option<String> {
    SERVED.get().cloned().flatten()
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
    // Only once: after that, Go Back (or a newer update) is the operator's choice, not undone at the next start.
    let Some(root) = root(&config.identifier) else { return };
    let marker = root.join("bundled-installed");
    // By what it is (its size, and its version once read), not where the app is: a copy moved to
    // Applications after opening from its disk image mustn't install it again.
    let stamp_of = |version: &str| format!("{version}:{}", bytes.len());
    let Ok(key) = config_key(config) else { return };
    let Ok(package) = open_package(&bytes, &key) else { return };
    let stamp = stamp_of(&package.manifest.version);
    if fs::read_to_string(&marker).is_ok_and(|s| s == stamp) {
        return;
    }
    let current = active(&config.identifier, native)
        .map(|(_, e)| e.version)
        .unwrap_or_else(|| native.to_string());
    let m = &package.manifest;
    if compare(&m.version, &current).is_gt() && compare(&m.requires, native).is_le() {
        let _ = install(&config.identifier, &package, &bytes);
    }
    let _ = fs::create_dir_all(&root);
    let _ = fs::write(&marker, stamp);
}

/// The webview's files: the installed interface's, when there's one to use.
pub fn wrap_assets<R: Runtime>(context: &mut tauri::Context<R>) {
    let native = context.package_info().version.to_string();
    let id = context.config().identifier.clone();
    migrate(&id);
    install_bundled(context.config(), &native);
    let loaded = config_key(context.config()).ok().and_then(|key| load(&id, &native, &key));
    let _ = SERVED.set(loaded.as_ref().map(|(m, _)| m.version.clone()));
    let built_in = context.set_assets(Box::new(NoAssets));
    context.set_assets(Box::new(InterfaceAssets::new(built_in, loaded.map(|(_, files)| files))));
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
        let native = package.manifest.requires.clone();
        install(id, &package, &bytes).unwrap();
        let (m, files) = load(id, &native, key).expect("installed and checked");
        assert_eq!(m.version, package.manifest.version);
        assert!(files.contains_key("index.html"));
        assert!(
            load(id, &package.manifest.version, key).is_none(),
            "not used once the app is as new"
        );
        // A changed package on disk is refused at start-up.
        let (path, _) = active(id, &native).unwrap();
        let good = fs::read(&path).unwrap();
        fs::write(&path, &tampered).unwrap();
        assert!(load(id, &native, key).is_none());
        fs::write(&path, &good).unwrap();
        // Go Back to the built-in interface, and forward again.
        assert_eq!(go_back(id).unwrap(), None);
        assert!(load(id, &native, key).is_none());
        assert_eq!(go_back(id).unwrap(), Some(package.manifest.version.clone()));
        assert!(load(id, &native, key).is_some());
        // Unpacked interfaces from before move into packages.
        let root = root(id).unwrap();
        fs::remove_file(root.join("state.json")).unwrap();
        fs::create_dir_all(root.join("current")).unwrap();
        fs::write(root.join("current/lumen-update-package.zip"), &bytes).unwrap();
        fs::write(root.join("current").join(MANIFEST), serde_json::to_vec(&package.manifest).unwrap()).unwrap();
        migrate(id);
        assert!(!root.join("current").exists());
        assert!(load(id, &native, key).is_some());
        let _ = fs::remove_dir_all(&home);
    }
}
