import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl as openerOpenUrl } from "@tauri-apps/plugin-opener";
import { fromBase64, mimeFor, toBase64, type CodexBridge, type StorageAdapter } from "@ordo/core";
import type { LocalApiBridge, LocalApiRequest, NetRequest, NetResponse, Platform, PickedFile, WatchedFile } from "./types";

class TauriStorage implements StorageAdapter {
  readonly kind = "tauri" as const;
  async readVault() {
    const buf = await invoke<ArrayBuffer>("vault_read");
    const bytes = new Uint8Array(buf);
    return bytes.length ? bytes : null;
  }
  async writeVault(bytes: Uint8Array) {
    await invoke("vault_write", bytes);
  }
  async readBlob(id: string) {
    const buf = await invoke<ArrayBuffer>("blob_read", { id });
    const bytes = new Uint8Array(buf);
    return bytes.length ? bytes : null;
  }
  async writeBlob(id: string, bytes: Uint8Array) {
    await invoke("blob_write", bytes, { headers: { "x-blob-id": id } });
  }
  async deleteBlob(id: string) {
    await invoke("blob_delete", { id });
  }
  async listBlobIds() {
    return invoke<string[]>("blob_list");
  }
  describe() {
    return "Lokale Tresordatei (verschlüsselt)";
  }
  async usage() {
    const u = await invoke<{ vault_bytes: number; blob_bytes: number; backup_bytes: number }>("storage_usage");
    return { vaultBytes: u.vault_bytes, blobBytes: u.blob_bytes };
  }
}

const te = new TextEncoder();

const net = {
  async fetch(req: NetRequest): Promise<NetResponse> {
    const body = req.body === undefined ? null : toBase64(typeof req.body === "string" ? te.encode(req.body) : req.body);
    const r = await invoke<{ status: number; headers: [string, string][]; body_b64: string }>("net_fetch", { req: { method: req.method, url: req.url, headers: req.headers ?? [], body_b64: body, timeout_ms: req.timeoutMs ?? null } });
    return { status: r.status, headers: r.headers, body: fromBase64(r.body_b64) };
  },
};

const localApi: LocalApiBridge = {
  async start(port, tokens) {
    await invoke("api_start", { port, tokens });
  },
  async stop() {
    await invoke("api_stop");
  },
  async setTokens(tokens) {
    await invoke("api_set_tokens", { tokens });
  },
  async status() {
    const s = await invoke<{ running: boolean; port: number | null }>("api_status");
    return { running: s.running, port: s.port ?? undefined };
  },
  async onRequest(handler) {
    return listen<LocalApiRequest>("ordo-api-request", (ev) => {
      const req = ev.payload;
      void handler(req)
        .catch((e: unknown) => ({ status: 500, body: { error: e instanceof Error ? e.message : String(e) } }))
        .then((r) => invoke("api_respond", { id: req.id, status: r.status, body: JSON.stringify(r.body) }));
    });
  },
};

const codex: CodexBridge = {
  async status() {
    const s = await invoke<{ installed: boolean; version?: string; logged_in: boolean; auth_mode?: string; default_model?: string; error?: string }>("codex_status");
    return { installed: s.installed, version: s.version, loggedIn: s.logged_in, authMode: (s.auth_mode as "chatgpt" | "apikey" | "none" | undefined) ?? "none", defaultModel: s.default_model, error: s.error };
  },
  async login() {
    const r = await invoke<{ ok: boolean; message?: string }>("codex_login");
    return r;
  },
  async logout() {
    await invoke("codex_logout");
  },
  async extract(args) {
    const r = await invoke<{ text: string; model?: string; duration_ms: number; input_tokens?: number; output_tokens?: number }>("codex_extract", {
      prompt: args.prompt,
      schema: args.schema,
      model: args.model ?? null,
      reasoning: args.reasoning ?? null,
      images: args.images.map(toBase64),
    });
    return { text: r.text, model: r.model, durationMs: r.duration_ms, usage: { inputTokens: r.input_tokens, outputTokens: r.output_tokens } };
  },
  async chat(args) {
    const requestId = args.requestId ?? `atlas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const onAbort = () => void invoke("codex_cancel", { requestId }).catch(() => undefined);
    if (args.signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    args.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const r = await invoke<{ text: string; model?: string; duration_ms: number; input_tokens?: number; output_tokens?: number }>("codex_chat", {
        prompt: args.prompt,
        schema: args.schema,
        model: args.model ?? null,
        reasoning: args.reasoning ?? null,
        request_id: requestId,
      });
      if (args.signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      return { text: r.text, model: r.model, durationMs: r.duration_ms, usage: { inputTokens: r.input_tokens, outputTokens: r.output_tokens } };
    } catch (e) {
      if (args.signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      throw e;
    } finally {
      args.signal?.removeEventListener("abort", onAbort);
    }
  },
  async cancel(requestId) {
    await invoke("codex_cancel", { requestId });
  },
};

const unlisteners = new Map<string, () => void>();

export function createTauriPlatform(): Platform {
  return {
    kind: "tauri",
    storage: new TauriStorage(),
    async pickFiles(opts = {}) {
      // A caller that only accepts file endings (e.g. a backup) gets exactly those as the first filter.
      const endings = opts.accept?.every((a) => a.startsWith(".")) ? opts.accept.map((a) => a.slice(1)) : null;
      const selected = await openDialog({
        multiple: opts.multiple ?? true,
        directory: false,
        filters: [
          endings ? { name: "Passende Dateien", extensions: endings } : { name: "Rechnungen & Bons", extensions: ["pdf", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "xlsx", "xls", "csv", "txt", "eml", "xml"] },
          { name: "Alle Dateien", extensions: ["*"] },
        ],
      });
      if (!selected) return [];
      const paths = Array.isArray(selected) ? selected : [selected];
      const out: PickedFile[] = [];
      for (const p of paths) {
        const buf = await invoke<ArrayBuffer>("read_file", { path: p });
        const name = p.split(/[\\/]/).pop() ?? p;
        out.push({ name, mime: mimeFor(name), bytes: new Uint8Array(buf), path: p });
      }
      return out;
    },
    async pickFolder() {
      const r = await openDialog({ directory: true, multiple: false });
      return typeof r === "string" ? r : null;
    },
    async saveFile(name, bytes) {
      const ext = name.includes(".") ? name.split(".").pop()! : "";
      const path = await saveDialog({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined });
      if (!path) return false;
      await invoke("write_file", bytes, { headers: { "x-path": path } });
      return true;
    },
    async notify(title, body) {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
    },
    async requestNotificationPermission() {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    },
    async openUrl(url) {
      await openerOpenUrl(url);
    },
    async appInfo() {
      const i = await invoke<{ version: string; data_dir: string; vault_path: string }>("app_info");
      return { version: i.version, dataDir: i.data_dir, vaultPath: i.vault_path };
    },
    async revealDataDir() {
      await invoke("reveal_data_dir");
    },
    codex,
    net,
    localApi,
    watch: {
      async scan(path, opts) {
        return invoke<WatchedFile[]>("watch_scan", { path, recursive: opts?.recursive ?? false });
      },
      async start(path, onFile, opts) {
        await invoke("watch_start", { path, recursive: opts?.recursive ?? false });
        if (!unlisteners.has(path)) {
          // One global event stream – only pass on files that live inside this folder (not in "C:\Belege2").
          const prefix = path.replace(/[\\/]+$/, "").toLowerCase();
          const un = await listen<WatchedFile>("summa://file-added", (ev) => {
            const p = ev.payload.path.toLowerCase();
            if (p.startsWith(prefix + "\\") || p.startsWith(prefix + "/")) onFile(ev.payload);
          });
          unlisteners.set(path, un);
        }
      },
      async stop(path) {
        await invoke("watch_stop", { path });
        unlisteners.get(path)?.();
        unlisteners.delete(path);
      },
      async readFile(path) {
        return new Uint8Array(await invoke<ArrayBuffer>("read_file", { path }));
      },
      async moveToProcessed(path) {
        return invoke<string>("move_to_processed", { path });
      },
    },
    backups: {
      list: () => invoke("list_backups"),
      restore: (path) => invoke("restore_backup", { path }),
    },
    async wipe() {
      await invoke("vault_delete");
    },
  };
}
