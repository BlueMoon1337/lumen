//! Lumen Remote: lets Player (github.com/BlueMoon1337/Player), on this computer or another one on
//! the local network, play a random countdown or the outro, from boxes at either end of its song
//! list, and fade out the music.
//!
//! JSON over UDP on port 57312. Player asks `{"app":"lumen-remote","v":1,"cmd":"hello"}` (to
//! everyone on the network, or to this computer) and Lumen answers with its name and what it can
//! do; `{"app":"lumen-remote","v":1,"cmd":"play","what":"random-countdown","id":"…"}` does it
//! ("outro"; "fade-music" with "seconds"), and Lumen answers whether it did. Lumen only ever
//! answers: it sends nothing by itself. Which commands there are, whether each can be done now
//! (and whether Player may: Settings ▸ Player) is told by the interface (src/remote.ts),
//! which also does them, so a new command needs only the interface.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub const PORT: u16 = 57312;
const APP: &str = "lumen-remote";

/// What the interface says Player can play, kept for the answers.
#[derive(Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Settings ▸ Player ▸ "Player can play the countdown and outro, and fade the music".
    pub allowed: bool,
    /// How many countdown videos there are.
    pub countdowns: u32,
    /// The active outro's name, if there is one.
    pub outro: Option<String>,
    /// The track on the Audio layer, if any.
    #[serde(default)]
    pub music: Option<String>,
    /// Each command: None when it can be done now, else why not.
    #[serde(default)]
    pub can: HashMap<String, Option<String>>,
    /// Anything more the interface tells Player (the logo's name…), passed on as it is.
    #[serde(default)]
    pub details: serde_json::Value,
}

/// What the interface is asked to do.
#[derive(Clone, Serialize)]
struct Play {
    what: String,
    seconds: Option<f64>,
}

/// None until the interface has said (it's still starting).
#[derive(Default)]
pub struct Remote(Mutex<Option<Status>>);

#[derive(Deserialize)]
struct Request {
    app: String,
    v: u32,
    cmd: String,
    what: Option<String>,
    id: Option<String>,
    seconds: Option<f64>,
}

/// The interface tells what can be played, whenever that changes.
#[tauri::command]
pub fn remote_status(remote: tauri::State<'_, Remote>, status: Status) {
    if let Ok(mut s) = remote.0.lock() {
        *s = Some(status);
    }
}

/// This computer's name, as the user knows it ("Jason's MacBook Pro").
fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    if let Some(name) = std::process::Command::new("scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|name| !name.is_empty())
    {
        return name;
    }
    if let Some(name) = std::env::var("COMPUTERNAME").ok().filter(|name| !name.is_empty()) {
        return name;
    }
    std::fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Lumen".into())
}

/// Why `what` can't be done now, if it can't.
fn refusal(status: Option<&Status>, what: &str) -> Option<String> {
    let Some(s) = status else {
        return Some("Lumen is still starting.".into());
    };
    if !s.allowed {
        return Some("Lumen is set not to let Player play anything (Lumen's Settings ▸ Player).".into());
    }
    let unknown = || Some("Lumen doesn't know that command; it may need updating.".to_string());
    if s.can.is_empty() {
        // An interface from before the command list (1.0.17's, after Go Back): what it could do then.
        return match what {
            "random-countdown" if s.countdowns == 0 => Some("Lumen has no countdown videos (Media ▸ Countdowns).".into()),
            "outro" if s.outro.is_none() => Some("Lumen has no outro (Media ▸ Outro).".into()),
            "random-countdown" | "outro" => None,
            _ => unknown(),
        };
    }
    match s.can.get(what) {
        None => unknown(),
        Some(why) => why.clone(),
    }
}

/// Answers one request; None for anything that isn't one.
fn answer(app: &AppHandle, packet: &[u8], name: &str) -> Option<serde_json::Value> {
    let req: Request = serde_json::from_slice(packet).ok()?;
    if req.app != APP || req.v != 1 {
        return None;
    }
    let status = app.state::<Remote>().0.lock().ok()?.clone();
    match req.cmd.as_str() {
        "hello" => Some(json!({
            "app": APP, "v": 1, "type": "hello",
            "name": name,
            "version": app.package_info().version.to_string(),
            "ready": status.is_some(),
            "allowed": status.as_ref().is_some_and(|s| s.allowed),
            "countdowns": status.as_ref().map_or(0, |s| s.countdowns),
            "outro": status.as_ref().and_then(|s| s.outro.clone()),
            "music": status.as_ref().and_then(|s| s.music.clone()),
            "can": status.as_ref().map(|s| s.can.clone()).unwrap_or_default(),
            "details": status.as_ref().map(|s| s.details.clone()).unwrap_or_default(),
        })),
        "play" => {
            let what = req.what.unwrap_or_default();
            let refused = refusal(status.as_ref(), &what);
            if refused.is_none() {
                let play = Play {
                    what: what.clone(),
                    seconds: req.seconds,
                };
                let _ = app.emit_to("main", "remote-play", &play);
            }
            Some(json!({ "app": APP, "v": 1, "type": "played", "id": req.id, "what": what, "ok": refused.is_none(), "message": refused }))
        }
        _ => None,
    }
}

/// Starts listening for Player (once, at launch). If the port is taken, Lumen goes on without it.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let socket = match UdpSocket::bind(("0.0.0.0", PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Lumen Remote couldn’t listen on port {PORT}: {e}");
                return;
            }
        };
        let name = computer_name();
        let mut buf = [0u8; 2048];
        loop {
            let Ok((n, from)) = socket.recv_from(&mut buf) else { continue };
            if let Some(reply) = answer(&app, &buf[..n], &name) {
                let _ = socket.send_to(reply.to_string().as_bytes(), from);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn does_what_the_interface_says_it_can() {
        let can = |pairs: &[(&str, Option<&str>)]| pairs.iter().map(|(k, v)| (k.to_string(), v.map(String::from))).collect();
        let s = Status {
            allowed: true,
            countdowns: 2,
            outro: None,
            music: None,
            details: serde_json::Value::Null,
            can: can(&[
                ("random-countdown", None),
                ("outro", Some("Lumen has no outro.")),
                ("fade-music", None),
            ]),
        };
        assert_eq!(refusal(Some(&s), "random-countdown"), None);
        assert_eq!(refusal(Some(&s), "fade-music"), None);
        assert_eq!(refusal(Some(&s), "outro").as_deref(), Some("Lumen has no outro."));
        assert!(refusal(Some(&s), "shutdown").unwrap().contains("doesn't know"));
        let off = Status {
            allowed: false,
            ..s.clone()
        };
        assert!(refusal(Some(&off), "random-countdown").unwrap().contains("set not to"));
        assert!(refusal(None, "outro").unwrap().contains("starting"));
    }

    #[test]
    fn reads_the_status_an_older_interface_sends() {
        // Lumen 1.0.17's interface sends no "music" or "can": its two commands still work.
        let s: Status = serde_json::from_str(r#"{"allowed":true,"countdowns":1,"outro":null}"#).unwrap();
        assert_eq!(refusal(Some(&s), "random-countdown"), None);
        assert!(refusal(Some(&s), "outro").unwrap().contains("no outro"));
        assert!(refusal(Some(&s), "fade-music").unwrap().contains("doesn't know"));
    }
}
