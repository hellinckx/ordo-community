//! Bridge to the OpenAI Codex CLI ("Sign in with ChatGPT"). Summa runs `codex exec` as a local
//! subprocess with the receipt image(s) and a JSON schema; the CLI uses the user's own ChatGPT login.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
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

/// Running chat requests (request id -> process id), so the stop button can end them.
fn running() -> &'static Mutex<HashMap<String, u32>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled() -> &'static Mutex<HashSet<String>> {
    static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Stops a running `codex_chat` (including the processes it started).
#[tauri::command]
pub fn codex_cancel(request_id: String) -> Result<(), String> {
    let pid = running().lock().map_err(|e| e.to_string())?.get(&request_id).copied();
    let Some(pid) = pid else { return Ok(()) };
    cancelled().lock().map_err(|e| e.to_string())?.insert(request_id);
    kill_tree(pid);
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

fn run_exec(exe: Exe, args: ExecJob) -> Result<ExtractResult, String> {
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
            map.insert(id.clone(), child.id());
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
