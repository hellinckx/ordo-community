use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct WatchState {
    watchers: Mutex<HashMap<String, Debouncer<notify::RecommendedWatcher>>>,
}

#[derive(Serialize, Clone)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

const SUPPORTED: &[&str] = &["pdf", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif", "xlsx", "xls", "csv", "txt", "eml", "xml"];
/// Sub folder Ordo itself moves processed files into – never read back.
const PROCESSED_DIR: &str = "Verarbeitet";

fn is_supported(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).map(|e| SUPPORTED.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false)
}

/// Folders we never descend into: hidden (dot-prefixed or Windows hidden attribute) and "Verarbeitet".
fn skip_dir(p: &Path) -> bool {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.starts_with('.') || name == PROCESSED_DIR {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if let Ok(meta) = std::fs::metadata(p) {
            if meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
                return true;
            }
        }
    }
    false
}

/// True when any folder between `root` and the file is one we skip (so recursive events ignore them too).
fn under_skipped_dir(root: &Path, p: &Path) -> bool {
    let mut cur = p.parent();
    while let Some(d) = cur {
        if d == root {
            return false;
        }
        if skip_dir(d) {
            return true;
        }
        cur = d.parent();
    }
    false
}

fn file_info(p: &Path) -> Option<FileInfo> {
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() {
        return None;
    }
    Some(FileInfo {
        path: p.display().to_string(),
        name: p.file_name()?.to_str()?.to_string(),
        size: meta.len(),
        modified: meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
    })
}

fn collect(dir: &Path, recursive: bool, depth: usize, out: &mut Vec<FileInfo>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            // depth guard against junction loops; 12 levels is plenty for year/month trees
            if recursive && depth < 12 && !skip_dir(&p) {
                collect(&p, recursive, depth + 1, out);
            }
        } else if is_supported(&p) {
            if let Some(fi) = file_info(&p) {
                out.push(fi);
            }
        }
    }
}

/// Lists supported files in a folder – optionally in all sub folders (skips hidden ones and "Verarbeitet").
#[tauri::command]
pub fn watch_scan(path: String, recursive: Option<bool>) -> Result<Vec<FileInfo>, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("Ordner nicht gefunden: {path}"));
    }
    let mut out = Vec::new();
    collect(&dir, recursive.unwrap_or(false), 0, &mut out);
    out.sort_by(|a, b| a.modified.cmp(&b.modified));
    Ok(out)
}

/// Starts watching a folder; emits "summa://file-added" events with FileInfo payloads.
#[tauri::command]
pub fn watch_start(app: AppHandle, state: State<'_, WatchState>, path: String, recursive: Option<bool>) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("Ordner nicht gefunden: {path}"));
    }
    let mut map = state.watchers.lock().map_err(|_| "Watcher gesperrt")?;
    if map.contains_key(&path) {
        return Ok(());
    }
    let app2 = app.clone();
    let root = dir.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(1500), move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
        if let Ok(events) = res {
            for ev in events {
                if ev.kind != DebouncedEventKind::Any {
                    continue;
                }
                let p = ev.path;
                if !is_supported(&p) || under_skipped_dir(&root, &p) {
                    continue;
                }
                if let Some(fi) = file_info(&p) {
                    let _ = app2.emit("summa://file-added", fi);
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;
    let mode = if recursive.unwrap_or(false) { RecursiveMode::Recursive } else { RecursiveMode::NonRecursive };
    debouncer.watcher().watch(&dir, mode).map_err(|e| e.to_string())?;
    map.insert(path, debouncer);
    Ok(())
}

#[tauri::command]
pub fn watch_stop(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let mut map = state.watchers.lock().map_err(|_| "Watcher gesperrt")?;
    map.remove(&path);
    Ok(())
}
