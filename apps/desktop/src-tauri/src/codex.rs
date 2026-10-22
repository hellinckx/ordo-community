//! Bridge to the OpenAI Codex CLI ("Sign in with ChatGPT"). Ordo keeps one `codex app-server` process open and
//! sends it the invoice image(s) or Atlas prompt with a JSON schema; Codex uses the person's own ChatGPT login.
//! Older Codex versions without the app server fall back to one `codex exec` run per request.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::ipc::{InvokeBody, Request};

#[derive(Serialize, Default)]
pub struct CodexStatus {
    installed: bool,
    version: Option<String>,
    logged_in: bool,
    auth_mode: Option<String>,
    default_model: Option<String>,
    path: Option<String>,
    error: Option<String>,
}

enum Exe {
    Direct(PathBuf),
    Cmd(PathBuf),
}

fn find_codex() -> Option<Exe> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join("codex.exe"));
            candidates.push(dir.join("codex.cmd"));
            candidates.push(dir.join("codex"));
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local).join("Programs").join("OpenAI").join("Codex").join("bin").join("codex.exe"));
    }
    if let Ok(roaming) = std::env::var("APPDATA") {
        candidates.push(PathBuf::from(&roaming).join("npm").join("codex.cmd"));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".local").join("bin").join("codex"));
        candidates.push(PathBuf::from(&home).join(".npm-global").join("bin").join("codex"));
    }
    for c in candidates {
        if c.is_file() {
            let is_cmd = c.extension().map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat")).unwrap_or(false);
            return Some(if is_cmd { Exe::Cmd(c) } else { Exe::Direct(c) });
        }
    }
    None
}

fn command(exe: &Exe) -> Command {
    let mut cmd = match exe {
        Exe::Direct(p) => Command::new(p),
        Exe::Cmd(p) => {
            let mut c = Command::new("cmd.exe");
            c.arg("/C").arg(p);
            c
        }
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.env("NO_COLOR", "1");
    cmd
}

fn run_capture(exe: &Exe, args: &[&str]) -> Result<(bool, String, String), String> {
    let out = command(exe).args(args).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    Ok((out.status.success(), String::from_utf8_lossy(&out.stdout).to_string(), String::from_utf8_lossy(&out.stderr).to_string()))
}

fn read_default_model() -> Option<String> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok()?;
    let cfg = std::fs::read_to_string(PathBuf::from(home).join(".codex").join("config.toml")).ok()?;
    for line in cfg.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("model") {
            let rest = rest.trim();
            if let Some(v) = rest.strip_prefix('=') {
                return Some(v.trim().trim_matches('"').to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub fn codex_status() -> CodexStatus {
    let Some(exe) = find_codex() else {
        return CodexStatus { installed: false, error: Some("codex nicht gefunden".into()), ..Default::default() };
    };
    let path = match &exe {
        Exe::Direct(p) | Exe::Cmd(p) => p.display().to_string(),
    };
    let version = run_capture(&exe, &["--version"]).ok().map(|(_, o, _)| o.trim().to_string()).filter(|s| !s.is_empty());
    let (logged_in, auth_mode, error) = match run_capture(&exe, &["login", "status"]) {
        Ok((_, out, err)) => {
            let text = format!("{out}\n{err}").to_lowercase();
            if text.contains("logged in") && !text.contains("not logged in") {
                let mode = if text.contains("chatgpt") { "chatgpt" } else if text.contains("api key") { "apikey" } else { "unknown" };
                (true, Some(mode.to_string()), None)
            } else {
                (false, Some("none".into()), None)
            }
        }
        Err(e) => (false, None, Some(e)),
    };
    CodexStatus { installed: true, version, logged_in, auth_mode, default_model: read_default_model(), path: Some(path), error }
}

#[derive(Serialize)]
pub struct LoginResult {
    ok: bool,
    message: Option<String>,
}

/// Runs `codex login` – the CLI opens the browser for the ChatGPT sign-in and returns when done.
#[tauri::command]
pub async fn codex_login() -> Result<LoginResult, String> {
    let exe = find_codex().ok_or("Codex CLI nicht gefunden")?;
    let handle = tauri::async_runtime::spawn_blocking(move || run_capture(&exe, &["login"]));
    let (ok, out, err) = handle.await.map_err(|e| e.to_string())??;
    Ok(LoginResult { ok, message: Some(if ok { out.trim().to_string() } else { format!("{}\n{}", out.trim(), err.trim()) }) })
}

#[tauri::command]
pub async fn codex_logout() -> Result<(), String> {
    let exe = find_codex().ok_or("Codex CLI nicht gefunden")?;
    tauri::async_runtime::spawn_blocking(move || run_capture(&exe, &["logout"])).await.map_err(|e| e.to_string())??;
    Ok(())
}

#[derive(Deserialize)]
struct ExtractArgs {
    prompt: String,
    schema: serde_json::Value,
    model: Option<String>,
    reasoning: Option<String>,
    /// base64 encoded PNG images
    images: Vec<String>,
}

#[derive(Serialize)]
pub struct ExtractResult {
    text: String,
    model: Option<String>,
    duration_ms: u128,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    stderr_tail: Option<String>,
}

fn decode_b64(s: &str) -> Result<Vec<u8>, String> {
    // minimal base64 decoder (standard alphabet, with padding)
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    }
    let bytes: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits = 0;
    for &b in &bytes {
        if b == b'=' {
            break;
        }
        let v = val(b).ok_or("Ungültiges Base64")?;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

/// Runs `codex exec` non-interactively with images + output schema. The prompt is passed via stdin.
#[tauri::command]
pub async fn codex_extract(request: Request<'_>) -> Result<ExtractResult, String> {
    let args: ExtractArgs = match request.body() {
        InvokeBody::Json(v) => serde_json::from_value(v.clone()).map_err(|e| e.to_string())?,
        InvokeBody::Raw(bytes) => serde_json::from_slice(bytes).map_err(|e| e.to_string())?,
    };
    let exe = find_codex().ok_or("Codex CLI nicht gefunden")?;
    tauri::async_runtime::spawn_blocking(move || run_exec(exe, ExecJob { prompt: args.prompt, schema: args.schema, model: args.model, reasoning: args.reasoning, images: args.images, request_id: None, chat: false }))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
struct ChatArgs {
    prompt: String,
    schema: serde_json::Value,
    model: Option<String>,
    reasoning: Option<String>,
    request_id: Option<String>,
}

/// Atlas (Ordo's assistant) over the ChatGPT login: a text-only `codex exec` run in an empty temp folder with a
/// read-only sandbox. Codex answers in the given JSON schema (reply or tool calls); it never executes Ordo's tools –
/// the app does that and calls again with the results.
#[tauri::command]
pub async fn codex_chat(request: Request<'_>) -> Result<ExtractResult, String> {
    let args: ChatArgs = match request.body() {
        InvokeBody::Json(v) => serde_json::from_value(v.clone()).map_err(|e| e.to_string())?,
        InvokeBody::Raw(bytes) => serde_json::from_slice(bytes).map_err(|e| e.to_string())?,
    };
    let exe = find_codex().ok_or("Codex CLI nicht gefunden")?;
    tauri::async_runtime::spawn_blocking(move || run_exec(exe, ExecJob { prompt: args.prompt, schema: args.schema, model: args.model, reasoning: args.reasoning, images: Vec::new(), request_id: args.request_id, chat: true }))
        .await
        .map_err(|e| e.to_string())?
}

/// What a running request can be stopped by: a turn on the app server, or (older Codex) the `codex exec` process.
enum Running {
    Turn { thread_id: String, turn_id: String },
    Pid(u32),
}

/// Running requests (request id -> turn or process), so the stop button can end them.
fn running() -> &'static Mutex<HashMap<String, Running>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Running>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled() -> &'static Mutex<HashSet<String>> {
    static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Stops a running `codex_chat`.
#[tauri::command]
pub fn codex_cancel(request_id: String) -> Result<(), String> {
    cancelled().lock().map_err(|e| e.to_string())?.insert(request_id.clone());
    let target = running().lock().map_err(|e| e.to_string())?.remove(&request_id);
    match target {
        Some(Running::Turn { thread_id, turn_id }) => {
            // answered through the reader thread; the waiting request ends with "interrupted"
            std::thread::spawn(move || {
                let _ = call("turn/interrupt", serde_json::json!({ "threadId": thread_id, "turnId": turn_id }), Duration::from_secs(10));
            });
        }
        Some(Running::Pid(pid)) => kill_tree(pid),
        None => {}
    }
    Ok(())
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(CREATE_NO_WINDOW).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
}

struct ExecJob {
    prompt: String,
    schema: serde_json::Value,
    model: Option<String>,
    reasoning: Option<String>,
    /// base64 encoded PNG images
    images: Vec<String>,
    request_id: Option<String>,
    /// Atlas chat: no images, no inherited environment for any command the agent might try.
    chat: bool,
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The Codex app server: one `codex app-server` process stays open and answers every request (JSON lines over  */
/* stdio). Starting Codex, loading the login and the model list happens once – not on every Atlas answer.      */
/* ------------------------------------------------------------------------------------------------------------ */

struct AppServer {
    child: Child,
    stdin: ChildStdin,
    next_id: u64,
    generation: u64,
}

#[derive(Default)]
struct Routes {
    /// request id -> waiting caller
    pending: HashMap<u64, mpsc::Sender<Result<serde_json::Value, String>>>,
    /// thread id -> notifications for that thread
    threads: HashMap<String, mpsc::Sender<serde_json::Value>>,
}

fn server_slot() -> &'static Mutex<Option<AppServer>> {
    static SLOT: OnceLock<Mutex<Option<AppServer>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn routes() -> &'static Mutex<Routes> {
    static ROUTES: OnceLock<Mutex<Routes>> = OnceLock::new();
    ROUTES.get_or_init(|| Mutex::new(Routes::default()))
}

/// Generation of the last app server whose output ended – a server of that generation is gone and gets replaced.
static DEAD_GENERATION: AtomicU64 = AtomicU64::new(0);
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

/// Default model of the ChatGPT account (from `model/list`), asked once per app server.
fn default_model() -> &'static Mutex<Option<String>> {
    static MODEL: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    MODEL.get_or_init(|| Mutex::new(None))
}

fn write_line(stdin: &mut ChildStdin, msg: &serde_json::Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    line.push(b'\n');
    stdin.write_all(&line).and_then(|_| stdin.flush()).map_err(|e| format!("Codex antwortet nicht mehr: {e}"))
}

fn spawn_reader(stdout: ChildStdout, generation: u64) {
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            let id = msg.get("id").and_then(|v| v.as_u64());
            let is_reply = msg.get("result").is_some() || msg.get("error").is_some();
            if let (Some(id), true) = (id, is_reply) {
                let waiting = routes().lock().ok().and_then(|mut r| r.pending.remove(&id));
                if let Some(tx) = waiting {
                    let res = match msg.get("error") {
                        Some(err) => Err(err.get("message").and_then(|m| m.as_str()).unwrap_or("Codex-Fehler").to_string()),
                        None => Ok(msg.get("result").cloned().unwrap_or(serde_json::Value::Null)),
                    };
                    let _ = tx.send(res);
                }
                continue;
            }
            if msg.get("method").is_none() {
                continue;
            }
            if msg.get("id").is_some() {
                // a question from Codex (approval, input): Atlas never grants anything
                let reply = serde_json::json!({ "id": msg["id"], "error": { "code": -32601, "message": "Ordo erlaubt keine Aktionen" } });
                if let Ok(mut slot) = server_slot().try_lock() {
                    if let Some(srv) = slot.as_mut().filter(|s| s.generation == generation) {
                        let _ = write_line(&mut srv.stdin, &reply);
                    }
                }
                continue;
            }
            if let Some(thread) = msg.pointer("/params/threadId").and_then(|t| t.as_str()) {
                let tx = routes().lock().ok().and_then(|r| r.threads.get(thread).cloned());
                if let Some(tx) = tx {
                    let _ = tx.send(msg);
                }
            }
        }
        // output ended: everyone waiting gets an answer instead of hanging
        DEAD_GENERATION.store(generation, Ordering::SeqCst);
        if let Ok(mut r) = routes().lock() {
            for (_, tx) in r.pending.drain() {
                let _ = tx.send(Err("Codex wurde beendet".into()));
            }
            for (_, tx) in r.threads.iter() {
                let _ = tx.send(serde_json::json!({ "method": "ordo/closed" }));
            }
        }
        if let Ok(mut m) = default_model().lock() {
            *m = None;
        }
    });
}

/// The running app server, started (and initialized) when there is none or the last one ended.
fn ensure_server(slot: &mut Option<AppServer>) -> Result<&mut AppServer, String> {
    let alive = slot.as_ref().map(|s| s.generation != DEAD_GENERATION.load(Ordering::SeqCst)).unwrap_or(false);
    if !alive {
        if let Some(mut old) = slot.take() {
            let _ = old.child.kill();
        }
        let exe = find_codex().ok_or("Codex CLI nicht gefunden")?;
        let mut cmd = command(&exe);
        cmd.arg("app-server")
            .arg("-c")
            .arg("web_search=\"disabled\"")
            // whatever the agent might try to run gets no environment (no tokens, no paths)
            .arg("-c")
            .arg("shell_environment_policy.inherit=\"none\"")
            // the person's own MCP servers have no business in Atlas
            .arg("-c")
            .arg("mcp_servers={}")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| format!("codex konnte nicht gestartet werden: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("stdin")?;
        let stdout = child.stdout.take().ok_or("stdout")?;
        let generation = NEXT_GENERATION.fetch_add(1, Ordering::SeqCst);
        spawn_reader(stdout, generation);
        let (tx, rx) = mpsc::channel();
        routes().lock().map_err(|e| e.to_string())?.pending.insert(0, tx);
        write_line(&mut stdin, &serde_json::json!({ "id": 0, "method": "initialize", "params": { "clientInfo": { "name": "ordo", "title": "Ordo", "version": env!("CARGO_PKG_VERSION") }, "capabilities": null } }))?;
        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => {
                let _ = child.kill();
                return Err(e);
            }
            Err(_) => {
                let _ = child.kill();
                return Err("Codex startet nicht (keine Antwort auf initialize)".into());
            }
        }
        write_line(&mut stdin, &serde_json::json!({ "method": "initialized", "params": {} }))?;
        *slot = Some(AppServer { child, stdin, next_id: 1, generation });
    }
    Ok(slot.as_mut().expect("server just started"))
}

/// One request to the app server; waits for its answer.
fn call(method: &str, params: serde_json::Value, timeout: Duration) -> Result<serde_json::Value, String> {
    let (tx, rx) = mpsc::channel();
    {
        let mut slot = server_slot().lock().map_err(|e| e.to_string())?;
        let srv = ensure_server(&mut slot)?;
        let id = srv.next_id;
        srv.next_id += 1;
        routes().lock().map_err(|e| e.to_string())?.pending.insert(id, tx);
        write_line(&mut srv.stdin, &serde_json::json!({ "id": id, "method": method, "params": params }))?;
    }
    rx.recv_timeout(timeout).map_err(|_| format!("Codex antwortet nicht ({method})"))?
}

/// The account's default model – the one in ~/.codex/config.toml may not be available for a ChatGPT login.
fn pick_model(requested: Option<&String>) -> Option<String> {
    if let Some(m) = requested.filter(|m| !m.trim().is_empty()) {
        return Some(m.clone());
    }
    if let Some(m) = default_model().lock().ok().and_then(|m| m.clone()) {
        return Some(m);
    }
    let list = call("model/list", serde_json::json!({}), Duration::from_secs(20)).ok()?;
    let models = list.get("data")?.as_array()?;
    let pick = models.iter().find(|m| m.get("isDefault").and_then(|d| d.as_bool()) == Some(true)).or_else(|| models.first())?;
    let id = pick.get("id")?.as_str()?.to_string();
    if let Ok(mut m) = default_model().lock() {
        *m = Some(id.clone());
    }
    Some(id)
}

const CHAT_INSTRUCTIONS: &str = "Du bist Atlas, der Assistent in Ordo. Du arbeitest nur mit dem Text der Nachricht: keine Befehle, keine Dateien, keine Websuche. Antworte ausschließlich mit dem verlangten JSON-Objekt.";
const EXTRACT_INSTRUCTIONS: &str = "Du liest Rechnungen und Kassabons aus Bildern für Ordo. Keine Befehle, keine Dateien außer den Bildern, keine Websuche. Antworte ausschließlich mit dem verlangten JSON-Objekt.";

fn run_exec(exe: Exe, args: ExecJob) -> Result<ExtractResult, String> {
    match run_turn(&args) {
        Ok(r) => Ok(r),
        // older Codex without app server: one `codex exec` per request, as before
        Err(TurnError::NoServer(e)) => {
            log::warn!("codex app-server nicht verfügbar, nehme codex exec: {e}");
            run_exec_cli(exe, args)
        }
        Err(TurnError::Failed(e)) => Err(e),
    }
}

enum TurnError {
    NoServer(String),
    Failed(String),
}

fn run_turn(args: &ExecJob) -> Result<ExtractResult, TurnError> {
    let started = Instant::now();
    let dir = tempfile::Builder::new().prefix("ordo-codex-").tempdir().map_err(|e| TurnError::Failed(e.to_string()))?;
    let mut input = vec![serde_json::json!({ "type": "text", "text": args.prompt, "text_elements": [] })];
    for (i, b64) in args.images.iter().enumerate() {
        let p = dir.path().join(format!("rechnung-{}.png", i + 1));
        std::fs::write(&p, decode_b64(b64).map_err(TurnError::Failed)?).map_err(|e| TurnError::Failed(e.to_string()))?;
        input.push(serde_json::json!({ "type": "localImage", "path": p }));
    }
    let model = pick_model(args.model.as_ref());
    let thread = call(
        "thread/start",
        serde_json::json!({
            "cwd": dir.path(),
            "sandbox": "read-only",
            "approvalPolicy": "never",
            "ephemeral": true,
            "model": model,
            "baseInstructions": if args.chat { CHAT_INSTRUCTIONS } else { EXTRACT_INSTRUCTIONS },
            "config": { "mcp_servers": {} },
        }),
        Duration::from_secs(60),
    )
    .map_err(TurnError::NoServer)?;
    let thread_id = thread.pointer("/thread/id").and_then(|t| t.as_str()).ok_or_else(|| TurnError::Failed("Codex hat keinen Gesprächsfaden angelegt".into()))?.to_string();
    let model = thread.get("model").and_then(|m| m.as_str()).map(|s| s.to_string()).or(model);

    let (tx, rx) = mpsc::channel();
    routes().lock().map_err(|e| TurnError::Failed(e.to_string()))?.threads.insert(thread_id.clone(), tx);
    let result = (|| {
        let effort = args.reasoning.as_ref().filter(|r| !r.trim().is_empty());
        let turn = call("turn/start", serde_json::json!({ "threadId": thread_id, "input": input, "effort": effort, "outputSchema": args.schema }), Duration::from_secs(60)).map_err(TurnError::Failed)?;
        let turn_id = turn.pointer("/turn/id").and_then(|t| t.as_str()).unwrap_or_default().to_string();
        if let Some(id) = &args.request_id {
            if cancelled().lock().map(|mut c| c.remove(id)).unwrap_or(false) {
                let _ = call("turn/interrupt", serde_json::json!({ "threadId": thread_id, "turnId": turn_id }), Duration::from_secs(10));
                return Err(TurnError::Failed("Abgebrochen".into()));
            }
            if let Ok(mut map) = running().lock() {
                map.insert(id.clone(), Running::Turn { thread_id: thread_id.clone(), turn_id: turn_id.clone() });
            }
        }
        let mut text = String::new();
        let mut usage: Option<(u64, u64)> = None;
        loop {
            let msg = rx.recv_timeout(Duration::from_secs(600)).map_err(|_| TurnError::Failed("Codex hat nach 10 Minuten nicht geantwortet".into()))?;
            match msg.get("method").and_then(|m| m.as_str()) {
                Some("item/completed") => {
                    if msg.pointer("/params/item/type").and_then(|t| t.as_str()) == Some("agentMessage") {
                        text = msg.pointer("/params/item/text").and_then(|t| t.as_str()).unwrap_or_default().to_string();
                    }
                }
                Some("thread/tokenUsage/updated") => {
                    let total = |k: &str| msg.pointer(&format!("/params/tokenUsage/total/{k}")).and_then(|v| v.as_u64()).unwrap_or(0);
                    usage = Some((total("inputTokens"), total("outputTokens")));
                }
                Some("turn/completed") => {
                    let status = msg.pointer("/params/turn/status").and_then(|s| s.as_str()).unwrap_or("completed");
                    if status == "interrupted" {
                        return Err(TurnError::Failed("Abgebrochen".into()));
                    }
                    if status == "failed" {
                        let raw = msg.pointer("/params/turn/error/message").and_then(|m| m.as_str()).unwrap_or("unbekannter Fehler");
                        // the message is often the provider's JSON error – show its inner message
                        let inner = serde_json::from_str::<serde_json::Value>(raw).ok().and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(|s| s.to_string()));
                        return Err(TurnError::Failed(inner.unwrap_or_else(|| raw.to_string())));
                    }
                    break;
                }
                Some("ordo/closed") => return Err(TurnError::Failed("Codex wurde beendet".into())),
                _ => {}
            }
        }
        if text.trim().is_empty() {
            return Err(TurnError::Failed("Codex lieferte keine Antwort.".into()));
        }
        Ok(ExtractResult { text, model: model.clone(), duration_ms: started.elapsed().as_millis(), input_tokens: usage.map(|u| u.0), output_tokens: usage.map(|u| u.1), stderr_tail: None })
    })();
    if let Ok(mut r) = routes().lock() {
        r.threads.remove(&thread_id);
    }
    if let Some(id) = &args.request_id {
        if let Ok(mut map) = running().lock() {
            map.remove(id);
        }
        if let Ok(mut c) = cancelled().lock() {
            c.remove(id);
        }
    }
    result
}

/// Fallback for Codex versions without `app-server`: one `codex exec` run per request.
fn run_exec_cli(exe: Exe, args: ExecJob) -> Result<ExtractResult, String> {
    let started = Instant::now();
    let dir = tempfile::Builder::new().prefix("summa-codex-").tempdir().map_err(|e| e.to_string())?;
    let schema_path = dir.path().join("schema.json");
    std::fs::write(&schema_path, serde_json::to_vec(&args.schema).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let out_path = dir.path().join("last-message.txt");
    let mut image_paths = Vec::new();
    for (i, b64) in args.images.iter().enumerate() {
        let p = dir.path().join(format!("beleg-{}.png", i + 1));
        std::fs::write(&p, decode_b64(b64)?).map_err(|e| e.to_string())?;
        image_paths.push(p);
    }
    let mut cmd = command(&exe);
    cmd.arg("exec")
        .arg("--json")
        .arg("--skip-git-repo-check")
        .arg("--ephemeral")
        .arg("--sandbox")
        .arg("read-only")
        .arg("--cd")
        .arg(dir.path())
        .arg("--output-schema")
        .arg(&schema_path)
        .arg("--output-last-message")
        .arg(&out_path)
        .arg("-c")
        .arg("web_search=\"disabled\"");
    if let Some(m) = args.model.as_ref().filter(|m| !m.trim().is_empty()) {
        cmd.arg("-m").arg(m);
    }
    if let Some(r) = args.reasoning.as_ref().filter(|r| !r.trim().is_empty()) {
        cmd.arg("-c").arg(format!("model_reasoning_effort=\"{r}\""));
    }
    if args.chat {
        // Atlas only wants a JSON answer; whatever the agent might try to run gets no environment (no tokens, no paths).
        cmd.arg("-c").arg("shell_environment_policy.inherit=\"none\"");
    }
    for p in &image_paths {
        cmd.arg("-i").arg(p);
    }
    cmd.arg("-"); // prompt from stdin
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("codex konnte nicht gestartet werden: {e}"))?;
    if let Some(id) = &args.request_id {
        if let Ok(mut map) = running().lock() {
            map.insert(id.clone(), Running::Pid(child.id()));
        }
    }
    {
        let mut stdin = child.stdin.take().ok_or("stdin")?;
        stdin.write_all(args.prompt.as_bytes()).map_err(|e| e.to_string())?;
    }
    let waited = child.wait_with_output();
    let was_cancelled = match &args.request_id {
        Some(id) => {
            if let Ok(mut map) = running().lock() {
                map.remove(id);
            }
            cancelled().lock().map(|mut set| set.remove(id)).unwrap_or(false)
        }
        None => false,
    };
    if was_cancelled {
        return Err("Abgebrochen".into());
    }
    let output = waited.map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Parse JSONL for usage / model / final agent message as fallback.
    let mut input_tokens = None;
    let mut output_tokens = None;
    let mut model = None;
    let mut last_agent_text: Option<String> = None;
    let mut error_text: Option<String> = None;
    for line in stdout.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("turn.completed") => {
                input_tokens = v.pointer("/usage/input_tokens").and_then(|x| x.as_u64());
                output_tokens = v.pointer("/usage/output_tokens").and_then(|x| x.as_u64());
            }
            Some("item.completed") => {
                if v.pointer("/item/type").and_then(|t| t.as_str()) == Some("agent_message") {
                    last_agent_text = v.pointer("/item/text").and_then(|t| t.as_str()).map(|s| s.to_string());
                }
            }
            Some("thread.started") => {
                model = v.get("model").and_then(|m| m.as_str()).map(|s| s.to_string());
            }
            Some("turn.failed") | Some("error") => {
                error_text = v.pointer("/error/message").or(v.get("message")).and_then(|m| m.as_str()).map(|s| s.to_string());
            }
            _ => {}
        }
    }
    let text = std::fs::read_to_string(&out_path).ok().filter(|s| !s.trim().is_empty()).or(last_agent_text).unwrap_or_default();
    if text.trim().is_empty() {
        let tail: String = stderr.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(format!("Codex lieferte keine Antwort (Exit {}). {}{}", output.status.code().unwrap_or(-1), error_text.map(|e| format!("{e} ")).unwrap_or_default(), tail));
    }
    Ok(ExtractResult {
        text,
        model: model.or(args.model),
        duration_ms: started.elapsed().as_millis(),
        input_tokens,
        output_tokens,
        stderr_tail: Some(stderr.lines().rev().take(5).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs Codex installed and signed in with ChatGPT: cargo test codex_app_server -- --ignored
    #[test]
    #[ignore]
    fn codex_app_server_answers_twice_without_restart() {
        let schema = serde_json::json!({ "type": "object", "additionalProperties": false, "required": ["reply"], "properties": { "reply": { "type": "string" } } });
        for q in ["Was ist 2+3? Nur die Zahl.", "Was ist 4+4? Nur die Zahl."] {
            let job = ExecJob { prompt: q.into(), schema: schema.clone(), model: None, reasoning: Some("low".into()), images: Vec::new(), request_id: Some("t".into()), chat: true };
            let r = run_turn(&job).map_err(|e| match e { TurnError::NoServer(e) | TurnError::Failed(e) => e }).expect("answer");
            println!("{} ms {:?} {}", r.duration_ms, r.model, r.text);
            assert!(r.text.contains("reply"));
        }
    }
}
