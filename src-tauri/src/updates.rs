//! The Update button: new versions of Lumen come from the GitHub repository's releases, which a
//! GitHub Actions workflow builds and signs (.github/workflows/release.yml). The repository is
//! private, so Lumen downloads with a read-only GitHub token the operator pastes in once; it's
//! kept in a file of its own in Lumen's settings folder, never in the page.
//!
//! Each release carries `latest.json` (the version, and each platform's download and signature).
//! Lumen reads it through GitHub's API, lets Tauri's updater check the signature against the key
//! in tauri.conf.json, downloads and installs the new version, and restarts.

use std::path::PathBuf;
use std::sync::Mutex;

use reqwest::header::{ACCEPT, AUTHORIZATION, HeaderMap, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

/// Where releases come from.
pub const REPOSITORY: &str = "BlueMoon1337/lumen";

/// The update found by the last check, ready to install.
#[derive(Default)]
pub struct Updates(Mutex<Option<Update>>);

fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("update-token"))
}

fn token(app: &AppHandle) -> Option<String> {
    let token = std::fs::read_to_string(token_path(app).ok()?).ok()?;
    let token = token.trim().to_string();
    (!token.is_empty()).then_some(token)
}

/// macOS runs an app downloaded from the internet, and not notarized, from a temporary read-only
/// copy ("App Translocation") until the download mark is taken off it. An update can't replace
/// that copy, so the Update window explains how to take the mark off.
fn translocated() -> bool {
    cfg!(target_os = "macos")
        && std::env::current_exe()
            .map(|p| p.to_string_lossy().contains("/AppTranslocation/"))
            .unwrap_or(false)
}

/// Why updates can't be installed here, if they can't: "translocated" (see above).
#[tauri::command]
pub fn update_blocker() -> Option<&'static str> {
    translocated().then_some("translocated")
}

/// Lumen's version, as built.
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Whether a GitHub token has been given.
#[tauri::command]
pub fn has_update_token(app: AppHandle) -> bool {
    token(&app).is_some()
}

/// Keeps the GitHub token (readable only by this user); an empty one forgets it.
#[tauri::command]
pub fn set_update_token(app: AppHandle, token: String) -> Result<(), String> {
    let path = token_path(&app)?;
    let token = token.trim();
    if token.is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    if token.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("That doesn’t look like a GitHub token.".into());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, token).map_err(|e| format!("Couldn’t keep the token: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    /// The API address, which downloads with the token (the browser address doesn't, for a private repository).
    url: String,
}

#[derive(Serialize)]
pub struct Found {
    version: String,
    current: String,
    notes: Option<String>,
    date: Option<String>,
}

fn headers(token: &str, accept: &'static str) -> Result<HeaderMap, String> {
    let mut h = HeaderMap::new();
    h.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| "That doesn’t look like a GitHub token.")?,
    );
    h.insert(ACCEPT, HeaderValue::from_static(accept));
    h.insert(USER_AGENT, HeaderValue::from_static("Lumen"));
    h.insert("X-GitHub-Api-Version", HeaderValue::from_static("2022-11-28"));
    Ok(h)
}

/// GitHub's API. A development build can be pointed elsewhere (LUMEN_UPDATE_API) to try updates
/// against a stand-in; a release build always asks GitHub, and checks every update's signature.
fn api() -> String {
    std::env::var("LUMEN_UPDATE_API")
        .ok()
        .filter(|_| cfg!(debug_assertions))
        .unwrap_or_else(|| "https://api.github.com".into())
}

/// The newest release, through GitHub's API.
async fn latest_release(token: &str) -> Result<Release, String> {
    // The updater sets up the same TLS; whichever runs first does it.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/repos/{REPOSITORY}/releases/latest", api()))
        .headers(headers(token, "application/vnd.github+json")?)
        .send()
        .await
        .map_err(|e| format!("Couldn’t reach GitHub: {e}"))?;
    match res.status().as_u16() {
        200 => res
            .json::<Release>()
            .await
            .map_err(|e| format!("GitHub sent something unexpected: {e}")),
        401 => Err("GitHub didn’t accept the token. It may have expired: make a new one and paste it in.".into()),
        403 | 404 => Err(format!(
            "No release found. Either none has been published yet, or the token can’t read {REPOSITORY} (it needs Contents: Read-only on that repository)."
        )),
        code => Err(format!("GitHub answered with an error ({code}). Try again later.")),
    }
}

/// Looks for a newer version. Returns it, or nothing when Lumen is up to date.
#[tauri::command]
pub async fn check_update(app: AppHandle, updates: tauri::State<'_, Updates>) -> Result<Option<Found>, String> {
    let token = token(&app).ok_or("Add a GitHub token first.")?;
    let release = latest_release(&token).await?;
    let manifest = release.assets.iter().find(|a| a.name == "latest.json").ok_or(format!(
        "{} has no update files yet. It may still be building: try again in a few minutes.",
        release.tag_name
    ))?;
    let endpoint = Url::parse(&manifest.url).map_err(|e| e.to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .headers(headers(&token, "application/octet-stream")?)
        .build()
        .map_err(|e| e.to_string())?;
    let Some(mut update) = updater.check().await.map_err(|e| format!("Couldn’t check for updates: {e}"))? else {
        *updates.0.lock().unwrap() = None;
        return Ok(None);
    };
    // The manifest names the file by its browser address; download it through the API instead.
    let file = update
        .download_url
        .path_segments()
        .and_then(|mut s| s.next_back())
        .map(|f| percent_decode(f))
        .unwrap_or_default();
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == file || a.name.replace(' ', ".") == file)
        .ok_or(format!("{} has no download for this computer.", release.tag_name))?;
    update.download_url = Url::parse(&asset.url).map_err(|e| e.to_string())?;
    let found = Found {
        version: update.version.clone(),
        current: update.current_version.clone(),
        notes: update.body.clone().filter(|b| !b.trim().is_empty()),
        date: update.date.map(|d| d.date().to_string()),
    };
    *updates.0.lock().unwrap() = Some(update);
    Ok(Some(found))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = s.get(i + 1..i + 3).and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Clone, Serialize)]
struct Progress {
    received: u64,
    total: Option<u64>,
}

/// Downloads the update found by the last check, checks its signature, installs it and restarts
/// Lumen. Reports progress as `update-progress` events.
#[tauri::command]
pub async fn install_update(app: AppHandle, updates: tauri::State<'_, Updates>) -> Result<(), String> {
    if translocated() {
        return Err(
            "macOS is running Lumen from a temporary read-only copy, so it can’t be updated. Follow the steps above, then try again."
                .into(),
        );
    }
    let update = updates.0.lock().unwrap().take().ok_or("Check for updates first.")?;
    let mut received = 0u64;
    let progress = app.clone();
    update
        .download_and_install(
            |chunk, total| {
                received += chunk as u64;
                let _ = progress.emit_to("main", "update-progress", Progress { received, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("Couldn’t install the update: {e}"))?;
    #[cfg(target_os = "macos")]
    if reopen_after_quitting() {
        app.exit(0);
        return Ok(());
    }
    app.restart();
}

/// macOS: opens Lumen again once this copy has quit, the way the Dock or Finder opens it. Tauri's
/// restart opens a second copy while this one is still quitting (`open -n`), and the Dock gives
/// that copy an icon of its own beside the one kept in the Dock. False if it can't be arranged.
#[cfg(target_os = "macos")]
fn reopen_after_quitting() -> bool {
    use std::process::{Command, Stdio};
    let Ok(exe) = std::env::current_exe() else { return false };
    // …/Lumen.app/Contents/MacOS/lumen → …/Lumen.app
    let Some(bundle) = exe.ancestors().nth(3).filter(|b| b.extension().is_some_and(|e| e == "app")) else { return false };
    let script = "while kill -0 \"$1\" 2>/dev/null; do sleep 0.2; done; exec /usr/bin/open \"$2\"";
    Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("lumen-reopen")
        .arg(std::process::id().to_string())
        .arg(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_file_names() {
        assert_eq!(
            percent_decode("Lumen_0.2.0_universal.app.tar.gz"),
            "Lumen_0.2.0_universal.app.tar.gz"
        );
        assert_eq!(percent_decode("Lumen%200.2.0.msi"), "Lumen 0.2.0.msi");
        assert_eq!(percent_decode("bad%2"), "bad%2");
    }
}
