//! Local API (Einstellungen → Schnittstellen): other programs on this computer – an ERP connector, a script, n8n,
//! Power Automate – talk to Ordo over HTTP on 127.0.0.1 while Ordo is open and unlocked.
//! Rust only listens, checks the key and the Host header, and hands the request to the web view; the web view holds the
//! unlocked vault, checks the key's rights and answers. Nothing is reachable from other computers.

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const MAX_BODY: u64 = 40 * 1024 * 1024;
const ANSWER_TIMEOUT: Duration = Duration::from_secs(60);

struct Reply {
    status: u16,
    body: String,
}

struct Running {
    server: Arc<tiny_http::Server>,
    port: u16,
}

#[derive(Default)]
pub struct ApiState {
    running: Mutex<Option<Running>>,
    tokens: Arc<Mutex<Vec<String>>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Reply>>>>,
}

#[derive(Serialize, Clone)]
struct ApiRequest {
    id: String,
    method: String,
    path: String,
    query: String,
    body: String,
    token: String,
}

#[derive(Serialize)]
pub struct ApiStatus {
    running: bool,
    port: Option<u16>,
}

/// Constant-time comparison, so the key cannot be guessed byte by byte from response times.
fn same(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn header(req: &tiny_http::Request, name: &str) -> Option<String> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str().to_string())
}

fn respond(req: tiny_http::Request, status: u16, body: &str) {
    let mut res = tiny_http::Response::from_string(body).with_status_code(status);
    if let Ok(h) = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]) {
        res = res.with_header(h);
    }
    if let Ok(h) = tiny_http::Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]) {
        res = res.with_header(h);
    }
    let _ = req.respond(res);
}

fn error(req: tiny_http::Request, status: u16, message: &str) {
    respond(req, status, &serde_json::json!({ "error": message }).to_string());
}

fn handle(app: AppHandle, mut req: tiny_http::Request, port: u16, tokens: Arc<Mutex<Vec<String>>>, pending: Arc<Mutex<HashMap<String, mpsc::Sender<Reply>>>>) {
    // DNS rebinding guard: a web page that resolves its own name to 127.0.0.1 still sends its own Host header
    let host = header(&req, "Host").unwrap_or_default();
    let allowed_hosts = [format!("127.0.0.1:{port}"), format!("localhost:{port}"), "127.0.0.1".to_string(), "localhost".to_string()];
    if !allowed_hosts.iter().any(|h| h.eq_ignore_ascii_case(&host)) {
        return error(req, 403, "Nur von diesem Computer aus erreichbar (Host 127.0.0.1 oder localhost).");
    }
    let url = req.url().to_string();
    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (url.clone(), String::new()),
    };
    if path == "/" || path == "/v1" || path == "/v1/" {
        return respond(req, 200, &serde_json::json!({ "app": "Ordo", "api": "ordo.v1", "docs": "https://ordo-app.at/schnittstellen/" }).to_string());
    }
    let token = header(&req, "Authorization")
        .and_then(|v| v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")).map(|s| s.trim().to_string()))
        .or_else(|| header(&req, "X-Ordo-Key").map(|s| s.trim().to_string()))
        .unwrap_or_default();
    let known = !token.is_empty() && tokens.lock().map(|t| t.iter().any(|k| same(k, &token))).unwrap_or(false);
    if !known {
        return error(req, 401, "Schlüssel fehlt oder ist ungültig. Header: Authorization: Bearer <Schlüssel>");
    }
    let mut body = String::new();
    if req.body_length().unwrap_or(0) as u64 > MAX_BODY {
        return error(req, 413, "Anfrage zu groß (höchstens 40 MB).");
    }
    if req.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
        return error(req, 400, "Der Inhalt ist kein gültiger UTF-8-Text (JSON erwartet).");
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel::<Reply>();
    if let Ok(mut p) = pending.lock() {
        p.insert(id.clone(), tx);
    }
    let event = ApiRequest { id: id.clone(), method: req.method().as_str().to_uppercase(), path, query, body, token };
    if app.emit("ordo-api-request", event).is_err() {
        pending.lock().ok().map(|mut p| p.remove(&id));
        return error(req, 503, "Ordo ist gerade nicht bereit.");
    }
    match rx.recv_timeout(ANSWER_TIMEOUT) {
        Ok(reply) => respond(req, reply.status, &reply.body),
        Err(_) => {
            pending.lock().ok().map(|mut p| p.remove(&id));
            error(req, 504, "Ordo hat nicht rechtzeitig geantwortet.")
        }
    }
}

#[tauri::command]
pub fn api_start(app: AppHandle, state: State<'_, ApiState>, port: u16, tokens: Vec<String>) -> Result<(), String> {
    if let Ok(mut t) = state.tokens.lock() {
        *t = tokens;
    }
    let mut running = state.running.lock().map_err(|e| e.to_string())?;
    if let Some(r) = running.as_ref() {
        if r.port == port {
            return Ok(());
        }
        r.server.unblock();
    }
    *running = None;
    let server = Arc::new(tiny_http::Server::http(("127.0.0.1", port)).map_err(|e| format!("Port {port} ist belegt oder gesperrt: {e}"))?);
    let s = server.clone();
    let tokens = state.tokens.clone();
    let pending = state.pending.clone();
    thread::spawn(move || {
        for req in s.incoming_requests() {
            let (app, tokens, pending) = (app.clone(), tokens.clone(), pending.clone());
            thread::spawn(move || handle(app, req, port, tokens, pending));
        }
    });
    *running = Some(Running { server, port });
    log::info!("Ordo local API on 127.0.0.1:{port}");
    Ok(())
}

#[tauri::command]
pub fn api_stop(state: State<'_, ApiState>) -> Result<(), String> {
    let mut running = state.running.lock().map_err(|e| e.to_string())?;
    if let Some(r) = running.take() {
        r.server.unblock();
    }
    Ok(())
}

#[tauri::command]
pub fn api_set_tokens(state: State<'_, ApiState>, tokens: Vec<String>) -> Result<(), String> {
    let mut t = state.tokens.lock().map_err(|e| e.to_string())?;
    *t = tokens;
    Ok(())
}

#[tauri::command]
pub fn api_respond(state: State<'_, ApiState>, id: String, status: u16, body: String) -> Result<(), String> {
    let tx = state.pending.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(tx) = tx {
        let _ = tx.send(Reply { status, body });
    }
    Ok(())
}

#[tauri::command]
pub fn api_status(state: State<'_, ApiState>) -> ApiStatus {
    let port = state.running.lock().ok().and_then(|r| r.as_ref().map(|r| r.port));
    ApiStatus { running: port.is_some(), port }
}
