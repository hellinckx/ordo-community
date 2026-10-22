//! Outgoing HTTP for connections the person set up (webhooks, SAP Business One, other REST APIs, a self-hosted
//! Supabase on its own domain). The web view's content security policy only allows a few fixed hosts, and other
//! programs rarely send CORS headers – so these requests go through Rust. http(s) only, no cookies kept between calls.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::Duration;

const MAX_RESPONSE: u64 = 80 * 1024 * 1024;

#[derive(Deserialize)]
pub struct NetRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    body_b64: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct NetResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body_b64: String,
}

fn read(res: ureq::Response) -> Result<NetResponse, String> {
    let status = res.status();
    let mut headers = Vec::new();
    for name in res.headers_names() {
        for v in res.all(&name) {
            headers.push((name.clone(), v.to_string()));
        }
    }
    let mut body = Vec::new();
    res.into_reader().take(MAX_RESPONSE).read_to_end(&mut body).map_err(|e| e.to_string())?;
    Ok(NetResponse { status, headers, body_b64: B64.encode(body) })
}

fn run(req: NetRequest) -> Result<NetResponse, String> {
    let url = req.url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Nur http:// und https:// sind erlaubt.".into());
    }
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_millis(req.timeout_ms.unwrap_or(30_000).clamp(1_000, 300_000))).redirects(5).build();
    let mut r = agent.request(&req.method.to_uppercase(), url);
    for (k, v) in &req.headers {
        r = r.set(k, v);
    }
    let body = match &req.body_b64 {
        Some(b) if !b.is_empty() => B64.decode(b).map_err(|e| format!("Inhalt nicht lesbar: {e}"))?,
        _ => Vec::new(),
    };
    let result = if body.is_empty() && matches!(req.method.to_uppercase().as_str(), "GET" | "HEAD" | "DELETE" | "OPTIONS") { r.call() } else { r.send_bytes(&body) };
    match result {
        Ok(res) => read(res),
        // 4xx/5xx are answers, not failures – the caller decides what they mean
        Err(ureq::Error::Status(_, res)) => read(res),
        Err(ureq::Error::Transport(t)) => Err(format!("Verbindung fehlgeschlagen: {t}")),
    }
}

#[tauri::command]
pub async fn net_fetch(req: NetRequest) -> Result<NetResponse, String> {
    tauri::async_runtime::spawn_blocking(move || run(req)).await.map_err(|e| e.to_string())?
}
