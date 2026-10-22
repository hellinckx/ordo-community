use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

const VAULT_FILE: &str = "vault.summa";
const BACKUP_KEEP: usize = 10;

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(VAULT_FILE))
}

fn blob_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') || id.is_empty() || id.len() > 80 {
        return Err("Ungültige Anhang-ID".into());
    }
    Ok(data_dir(app)?.join("blobs").join(format!("{id}.bin")))
}

fn body_bytes(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(v) => {
            // Fallback: JSON array of numbers
            let arr = v.as_array().ok_or("Erwarte Binärdaten")?;
            Ok(arr.iter().filter_map(|n| n.as_u64().map(|x| x as u8)).collect())
        }
    }
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<String> {
    request.headers().get(name).and_then(|v| v.to_str().ok()).map(|s| s.to_string())
}

/// Atomic write: temp file + rename, keeping a rolling set of backups of the previous version.
fn atomic_write(path: &Path, bytes: &[u8], backup_dir: Option<&Path>) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("Schreiben fehlgeschlagen: {e}"))?;
    if path.exists() {
        if let Some(dir) = backup_dir {
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let name = format!("vault-{stamp}.summa-backup");
            let _ = fs::copy(path, dir.join(name));
            rotate_backups(dir);
        }
    }
    fs::rename(&tmp, path).map_err(|e| format!("Umbenennen fehlgeschlagen: {e}"))?;
    Ok(())
}

fn rotate_backups(dir: &Path) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map(|x| x == "summa-backup").unwrap_or(false)).collect())
        .unwrap_or_default();
    entries.sort();
    // Keep the most recent N plus one daily backup for the last 30 days would be nicer; keep it simple and robust.
    while entries.len() > BACKUP_KEEP {
        let oldest = entries.remove(0);
        let _ = fs::remove_file(oldest);
    }
}

#[derive(Serialize)]
pub struct AppInfo {
    version: String,
    data_dir: String,
    vault_path: String,
    os: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: data_dir(&app)?.display().to_string(),
        vault_path: vault_path(&app)?.display().to_string(),
        os: std::env::consts::OS.to_string(),
    })
}

#[tauri::command]
pub fn vault_exists(app: AppHandle) -> Result<bool, String> {
    Ok(vault_path(&app)?.exists())
}

#[tauri::command]
pub fn vault_read(app: AppHandle) -> Result<Response, String> {
    let p = vault_path(&app)?;
    if !p.exists() {
        return Ok(Response::new(Vec::<u8>::new()));
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn vault_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let bytes = body_bytes(&request)?;
    if bytes.len() < 16 {
        return Err("Tresordaten zu kurz".into());
    }
    let dir = data_dir(&app)?;
    atomic_write(&vault_path(&app)?, &bytes, Some(&dir.join("backups")))
}

#[tauri::command]
pub fn vault_delete(app: AppHandle) -> Result<(), String> {
    let p = vault_path(&app)?;
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    let blobs = data_dir(&app)?.join("blobs");
    if blobs.exists() {
        fs::remove_dir_all(&blobs).map_err(|e| e.to_string())?;
        fs::create_dir_all(&blobs).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn blob_read(app: AppHandle, id: String) -> Result<Response, String> {
    let p = blob_path(&app, &id)?;
    if !p.exists() {
        return Ok(Response::new(Vec::<u8>::new()));
    }
    Ok(Response::new(fs::read(&p).map_err(|e| e.to_string())?))
}

#[tauri::command]
pub fn blob_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let id = header(&request, "x-blob-id").ok_or("x-blob-id Header fehlt")?;
    let bytes = body_bytes(&request)?;
    atomic_write(&blob_path(&app, &id)?, &bytes, None)
}

#[tauri::command]
pub fn blob_delete(app: AppHandle, id: String) -> Result<(), String> {
    let p = blob_path(&app, &id)?;
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn blob_list(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = data_dir(&app)?.join("blobs");
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            if let Some(name) = e.path().file_stem().and_then(|s| s.to_str()) {
                out.push(name.to_string());
            }
        }
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct Usage {
    vault_bytes: u64,
    blob_bytes: u64,
    backup_bytes: u64,
}

#[tauri::command]
pub fn storage_usage(app: AppHandle) -> Result<Usage, String> {
    let dir = data_dir(&app)?;
    let size_of = |p: &Path| fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let dir_size = |p: &Path| fs::read_dir(p).map(|rd| rd.flatten().map(|e| size_of(&e.path())).sum()).unwrap_or(0u64);
    Ok(Usage { vault_bytes: size_of(&vault_path(&app)?), blob_bytes: dir_size(&dir.join("blobs")), backup_bytes: dir_size(&dir.join("backups")) })
}

/// Reads any file the user picked (dialog) or that appeared in a watched folder.
#[tauri::command]
pub fn read_file(path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| format!("{path}: {e}"))?;
    if meta.len() > 200 * 1024 * 1024 {
        return Err("Datei größer als 200 MB".into());
    }
    Ok(Response::new(fs::read(&p).map_err(|e| e.to_string())?))
}

/// Writes an export (CSV/PDF/ZIP/backup) to a path the user chose in a save dialog.
#[tauri::command]
pub fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = header(&request, "x-path").ok_or("x-path Header fehlt")?;
    let bytes = body_bytes(&request)?;
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, bytes).map_err(|e| e.to_string())
}

/// Moves a processed receipt into a "Verarbeitet" sub folder next to it.
#[tauri::command]
pub fn move_to_processed(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let parent = p.parent().ok_or("Kein Ordner")?;
    let target_dir = parent.join("Verarbeitet");
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let name = p.file_name().ok_or("Kein Dateiname")?;
    let mut target = target_dir.join(name);
    let mut i = 1;
    while target.exists() {
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("datei");
        let ext = p.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
        target = target_dir.join(format!("{stem}_{i}{ext}"));
        i += 1;
    }
    fs::rename(&p, &target).map_err(|e| e.to_string())?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn reveal_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    tauri_plugin_opener::reveal_item_in_dir(&dir).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct BackupInfo {
    name: String,
    path: String,
    bytes: u64,
    modified: u64,
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let dir = data_dir(&app)?.join("backups");
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "summa-backup").unwrap_or(false) {
                let m = fs::metadata(&p).ok();
                out.push(BackupInfo {
                    name: p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
                    path: p.display().to_string(),
                    bytes: m.as_ref().map(|m| m.len()).unwrap_or(0),
                    modified: m.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
                });
            }
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    let dir = data_dir(&app)?;
    if !src.starts_with(dir.join("backups")) {
        return Err("Nur Backups aus dem Summa-Backup-Ordner können wiederhergestellt werden.".into());
    }
    let bytes = fs::read(&src).map_err(|e| e.to_string())?;
    atomic_write(&vault_path(&app)?, &bytes, Some(&dir.join("backups")))
}
