//! Plays media files to the web view over a small HTTP server on this computer only (127.0.0.1),
//! rather than through Tauri's asset protocol. The asset protocol hands a video over at most 1 MB a
//! request, so a 4K video's busiest seconds (a countdown's fade can need 10 MB in one second) ran
//! dry and stuttered; macOS's player streams from an HTTP server as it does from a file.
//!
//! Only Lumen's media folders (Documents ▸ Lumen ▸ Media ▸ Assets and Audio) are served, only to
//! addresses carrying a key made at launch, and only on the loopback address.

use std::collections::hash_map::RandomState;
use std::fs::File;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

/// "http://127.0.0.1:port/key", once the server is running.
static ADDRESS: OnceLock<Result<String, String>> = OnceLock::new();

/// The folders under Documents ▸ Lumen it serves files from.
const FOLDERS: [&str; 2] = ["Media/Assets", "Media/Audio"];

/// A key no other program can guess, so only Lumen's pages can ask for files.
fn key() -> String {
    let mut out = String::new();
    for _ in 0..2 {
        let mut h = RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

/// Starts the server (once) and gives its address, files being at `<address>/<folder>/<name>`.
pub fn address(base: PathBuf) -> Result<String, String> {
    ADDRESS
        .get_or_init(|| {
            let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("Couldn’t start the media server: {e}"))?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let key = key();
            let prefix = format!("/{key}/");
            std::thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    let base = base.clone();
                    let prefix = prefix.clone();
                    std::thread::spawn(move || {
                        let _ = serve(stream, &base, &prefix);
                    });
                }
            });
            Ok(format!("http://127.0.0.1:{port}/{key}"))
        })
        .clone()
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("heic") => "image/heic",
        Some("heif") => "image/heif",
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("wav") => "audio/wav",
        Some("aac") => "audio/aac",
        Some("ogg") => "audio/ogg",
        _ => "application/octet-stream",
    }
}

/// "%20" and the like, decoded.
fn decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The file a request names: in one of the media folders, with no way out of them.
fn file_for(base: &Path, prefix: &str, target: &str) -> Option<PathBuf> {
    let rest = decode(target.split('?').next()?.strip_prefix(prefix)?)?;
    let folder = FOLDERS.iter().find(|f| rest.starts_with(&format!("{f}/")))?;
    let name = &rest[folder.len() + 1..];
    let path = Path::new(name);
    if name.is_empty() || name.starts_with('.') || path.components().count() != 1 || !matches!(path.components().next(), Some(Component::Normal(_))) {
        return None;
    }
    Some(base.join(folder).join(name))
}

/// "bytes=start-end" (either may be missing), within a file of `len` bytes.
fn range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            (len.saturating_sub(n), len.checked_sub(1)?)
        }
        (start, "") => (start.parse().ok()?, len.checked_sub(1)?),
        (start, end) => (start.parse().ok()?, end.parse::<u64>().ok()?.min(len.checked_sub(1)?)),
    };
    (start <= end && start < len).then_some((start, end))
}

fn serve(stream: TcpStream, base: &Path, prefix: &str) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let mut range_header = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.trim().eq_ignore_ascii_case("range") {
                range_header = Some(value.trim().to_string());
            }
        }
    }
    let mut out = stream;
    // The pages ask from tauri://localhost (or http://localhost while developing).
    let cors = "Access-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n";
    if method == "OPTIONS" {
        return write!(out, "HTTP/1.1 204 No Content\r\n{cors}Access-Control-Allow-Headers: Range\r\nConnection: close\r\n\r\n");
    }
    let Some(path) = file_for(base, prefix, &target).filter(|_| method == "GET" || method == "HEAD") else {
        return write!(out, "HTTP/1.1 404 Not Found\r\n{cors}Content-Length: 0\r\nConnection: close\r\n\r\n");
    };
    let Ok(mut file) = File::open(&path) else {
        return write!(out, "HTTP/1.1 404 Not Found\r\n{cors}Content-Length: 0\r\nConnection: close\r\n\r\n");
    };
    let len = file.metadata()?.len();
    let kind = content_type(&path);
    let (status, start, end) = match range_header.as_deref() {
        Some(r) => match range(r, len) {
            Some((s, e)) => ("206 Partial Content", s, e),
            None => {
                return write!(
                    out,
                    "HTTP/1.1 416 Range Not Satisfiable\r\n{cors}Content-Range: bytes */{len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
            }
        },
        None => ("200 OK", 0, len.saturating_sub(1)),
    };
    let count = if len == 0 { 0 } else { end - start + 1 };
    let content_range = if status.starts_with("206") { format!("Content-Range: bytes {start}-{end}/{len}\r\n") } else { String::new() };
    write!(
        out,
        "HTTP/1.1 {status}\r\n{cors}Content-Type: {kind}\r\nAccept-Ranges: bytes\r\n{content_range}Content-Length: {count}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
    )?;
    if method == "HEAD" || count == 0 {
        return Ok(());
    }
    file.seek(SeekFrom::Start(start))?;
    // The player closes the connection when it has enough (or seeks): that just ends the copy.
    std::io::copy(&mut file.take(count), &mut out)?;
    out.flush()
}

#[cfg(test)]
mod tests {
    use super::{file_for, range};
    use std::path::Path;

    #[test]
    fn serves_only_files_in_the_media_folders() {
        let base = Path::new("/Users/me/Documents/Lumen");
        assert_eq!(
            file_for(base, "/k/", "/k/Media/Assets/Walk%20In.mp4"),
            Some(base.join("Media/Assets/Walk In.mp4"))
        );
        assert_eq!(file_for(base, "/k/", "/other/Media/Assets/a.mp4"), None);
        assert_eq!(file_for(base, "/k/", "/k/Media/Assets/../secret"), None);
        assert_eq!(file_for(base, "/k/", "/k/Media/Assets/%2E%2E%2Fsecret"), None);
        assert_eq!(file_for(base, "/k/", "/k/Libraries/Songs/a.lumen"), None);
    }

    #[test]
    fn reads_byte_ranges() {
        assert_eq!(range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(range("bytes=90-500", 100), Some((90, 99)));
        assert_eq!(range("bytes=100-", 100), None);
    }
}

#[cfg(test)]
mod streaming {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    #[test]
    fn streams_a_range_of_a_file() {
        let base = std::env::temp_dir().join(format!("lumen-media-test-{}", std::process::id()));
        std::fs::create_dir_all(base.join("Media/Assets")).unwrap();
        std::fs::write(base.join("Media/Assets/a b.mp4"), (0..=255u8).cycle().take(3_000_000).collect::<Vec<_>>()).unwrap();
        let address = super::address(base.clone()).unwrap();
        let rest = address.strip_prefix("http://").unwrap();
        let (host, key) = rest.split_once('/').unwrap();
        let mut s = TcpStream::connect(host).unwrap();
        write!(s, "GET /{key}/Media/Assets/a%20b.mp4 HTTP/1.1\r\nHost: x\r\nRange: bytes=1000000-2999999\r\n\r\n").unwrap();
        let mut body = Vec::new();
        s.read_to_end(&mut body).unwrap();
        let split = body.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head = String::from_utf8_lossy(&body[..split]).to_string();
        assert!(head.starts_with("HTTP/1.1 206"), "{head}");
        assert!(head.contains("Content-Range: bytes 1000000-2999999/3000000"), "{head}");
        let data = &body[split + 4..];
        assert_eq!(data.len(), 2_000_000);
        assert_eq!(data[0], (1_000_000 % 256) as u8);
        std::fs::remove_dir_all(base).ok();
    }
}
