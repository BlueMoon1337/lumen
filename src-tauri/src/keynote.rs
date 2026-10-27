//! Keynote presentations, on a Mac with Keynote. Keynote's files can't be read without it, so
//! Lumen asks Keynote (by Apple Events, which macOS asks the operator to allow the first time)
//! to open a copy of the file and export each slide as a picture, with the slide's words and
//! presenter notes. The front end then reads the pictures one by one and forgets the export.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};

/// Exports waiting to be read: their folder and pictures, by id.
#[derive(Default)]
pub struct KeynoteExports(Mutex<HashMap<String, Export>>);

pub struct Export {
    dir: PathBuf,
    images: Vec<PathBuf>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KeynoteSlide {
    #[serde(default)]
    text: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    skipped: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeynoteDeck {
    /// Read the pictures with `keynote_image` and this id, then `keynote_done`.
    id: String,
    width: f64,
    height: f64,
    /// Every slide, skipped ones too; pictures are of the others, in order.
    slides: Vec<KeynoteSlide>,
    images: usize,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Deserialize)]
struct ScriptResult {
    width: f64,
    height: f64,
    slides: Vec<KeynoteSlide>,
}

/// Opens the file in Keynote, exports its slides as JPEGs into `out`, and says what's on them.
/// JavaScript for Automation, so the words come back as JSON.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const SCRIPT: &str = r#"
function run(argv) {
  const keynote = Application('Keynote');
  const doc = keynote.open(Path(argv[0]));
  const words = (item) => { try { return String(item.objectText() || ''); } catch (e) { return ''; } };
  try {
    const slides = doc.slides().map((s) => {
      const parts = [];
      try { if (s.titleShowing()) parts.push(words(s.defaultTitleItem())); } catch (e) {}
      try { if (s.bodyShowing()) parts.push(words(s.defaultBodyItem())); } catch (e) {}
      try { s.textItems().forEach((t) => parts.push(words(t))); } catch (e) {}
      let notes = '';
      try { notes = String(s.presenterNotes() || ''); } catch (e) {}
      let skipped = false;
      try { skipped = s.skipped(); } catch (e) {}
      const text = parts.map((p) => p.trim()).filter((p, i, all) => p && all.indexOf(p) === i).join('\n\n');
      return { text: text, notes: notes, skipped: skipped };
    });
    const size = { width: doc.width(), height: doc.height() };
    keynote.export(doc, { to: Path(argv[1]), as: 'slide images', withProperties: { imageFormat: 'JPEG', compressionFactor: 0.9, skippedSlides: false } });
    return JSON.stringify({ width: size.width, height: size.height, slides: slides });
  } finally {
    doc.close({ saving: 'no' });
  }
}
"#;

fn new_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}-{}", std::process::id())
}

/// Hands a Keynote file (the request body, named by the `x-file-name` header) to Keynote to export.
#[tauri::command]
pub async fn keynote_export(exports: tauri::State<'_, KeynoteExports>, request: Request<'_>) -> Result<KeynoteDeck, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("There was no Keynote file.".into());
    };
    let id = new_id();
    let dir = std::env::temp_dir().join(format!("lumen-keynote-{id}"));
    let result = export(&dir, bytes);
    let (info, images) = match result {
        Ok(r) => r,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(e);
        }
    };
    let deck = KeynoteDeck {
        id: id.clone(),
        width: info.width,
        height: info.height,
        slides: info.slides,
        images: images.len(),
    };
    exports.0.lock().map_err(|e| e.to_string())?.insert(id, Export { dir, images });
    Ok(deck)
}

#[cfg(target_os = "macos")]
fn export(dir: &std::path::Path, bytes: &[u8]) -> Result<(ScriptResult, Vec<PathBuf>), String> {
    use std::process::Command;
    let out = dir.join("slides");
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let file = dir.join("presentation.key");
    std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
    let run = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", SCRIPT])
        .arg(&file)
        .arg(&out)
        .output()
        .map_err(|e| format!("Couldn’t ask Keynote to open it: {e}"))?;
    if !run.status.success() {
        let err = String::from_utf8_lossy(&run.stderr);
        return Err(if err.contains("-1743") || err.contains("Not authorized") {
            "Lumen isn’t allowed to use Keynote. Allow it in System Settings ▸ Privacy & Security ▸ Automation, then import again.".into()
        } else if err.contains("-1728") || err.contains("Can't get application") || err.contains("Application can't be found") {
            "Keynote isn’t installed on this Mac. Install it from the App Store, or export the presentation from Keynote as PowerPoint and import that.".into()
        } else {
            format!("Keynote couldn’t export it: {}", err.trim())
        });
    }
    let info: ScriptResult = serde_json::from_slice(&run.stdout).map_err(|e| format!("Keynote’s answer wasn’t understood: {e}"))?;
    // Keynote names the pictures after the file, numbered; they may be in a folder of their own.
    let mut images = Vec::new();
    collect_images(&out, 0, &mut images);
    images.sort_by_key(|p| slide_number(p));
    Ok((info, images))
}

#[cfg(not(target_os = "macos"))]
fn export(_dir: &std::path::Path, _bytes: &[u8]) -> Result<(ScriptResult, Vec<PathBuf>), String> {
    Err("Keynote files can only be imported on a Mac with Keynote. Export the presentation from Keynote as PowerPoint and import that instead.".into())
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn collect_images(dir: &std::path::Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for path in entries.filter_map(|e| e.ok().map(|e| e.path())) {
        if path.is_dir() && depth < 2 {
            collect_images(&path, depth + 1, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| ["jpg", "jpeg", "png", "tif", "tiff"].contains(&e.to_ascii_lowercase().as_str()))
        {
            out.push(path);
        }
    }
}

/// The slide number in an exported picture's name ("presentation.012.jpeg" → 12).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn slide_number(path: &std::path::Path) -> (u64, String) {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    let digits: String = stem
        .chars()
        .rev()
        .take_while(char::is_ascii_digit)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    (digits.parse().unwrap_or(u64::MAX), stem.to_string())
}

/// One exported slide picture.
#[tauri::command]
pub async fn keynote_image(exports: tauri::State<'_, KeynoteExports>, id: String, index: usize) -> Result<Response, String> {
    let path = {
        let map = exports.0.lock().map_err(|e| e.to_string())?;
        let export = map.get(&id).ok_or("That Keynote export is gone.")?;
        export.images.get(index).cloned().ok_or("There’s no such slide.")?
    };
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

/// Forgets an export and deletes its files.
#[tauri::command]
pub fn keynote_done(exports: tauri::State<'_, KeynoteExports>, id: String) {
    if let Ok(mut map) = exports.0.lock()
        && let Some(export) = map.remove(&id)
    {
        let _ = std::fs::remove_dir_all(export.dir);
    }
}

#[cfg(test)]
mod tests {
    use super::slide_number;
    use std::path::Path;

    #[test]
    fn orders_exported_pictures_by_number() {
        let mut names = ["deck.010.jpeg", "deck.002.jpeg", "deck.001.jpeg"].map(Path::new).to_vec();
        names.sort_by_key(|p| slide_number(p));
        assert_eq!(names, ["deck.001.jpeg", "deck.002.jpeg", "deck.010.jpeg"].map(Path::new).to_vec());
    }
}
