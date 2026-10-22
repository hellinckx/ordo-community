/**
 * HTTP for connections the person set up. On the desktop every request goes through the shell (no CORS, no CSP
 * limits, works with ERPs in the office network); in the browser it is a normal fetch, which only works when the
 * other side allows cross-origin requests – the UI says so.
 */
import { getPlatform, isTauri } from "@/platform";

export interface HttpResult {
  status: number;
  ok: boolean;
  headers: [string, string][];
  text: string;
  json<T = unknown>(): T;
  header(name: string): string | undefined;
  all(name: string): string[];
}

const td = new TextDecoder();

function result(status: number, headers: [string, string][], body: Uint8Array): HttpResult {
  const text = td.decode(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text,
    json<T>() {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Antwort ist kein JSON (HTTP ${status}).`);
      }
    },
    header: (name) => headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1],
    all: (name) => headers.filter(([k]) => k.toLowerCase() === name.toLowerCase()).map(([, v]) => v),
  };
}

export async function http(req: { method: string; url: string; headers?: Record<string, string>; body?: string | Uint8Array; timeoutMs?: number }): Promise<HttpResult> {
  if (!/^https?:\/\//i.test(req.url)) throw new Error("Die Adresse muss mit https:// (oder http:// im Firmennetz) beginnen.");
  const headers = Object.entries(req.headers ?? {});
  if (isTauri) {
    const platform = await getPlatform();
    if (platform.net) {
      const r = await platform.net.fetch({ method: req.method, url: req.url, headers, body: req.body, timeoutMs: req.timeoutMs });
      return result(r.status, r.headers, r.body);
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 30_000);
  try {
    const res = await fetch(req.url, { method: req.method, headers, body: req.body as BodyInit | undefined, signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    const out: [string, string][] = [];
    res.headers.forEach((v, k) => out.push([k, v]));
    return result(res.status, out, new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/abort/i.test(msg) ? "Zeitüberschreitung – der Server antwortet nicht." : `Nicht erreichbar (${msg}). Im Browser blockieren viele Programme fremde Anfragen (CORS) – in der Desktop-App klappt es.`);
  } finally {
    clearTimeout(timer);
  }
}

/** HMAC-SHA256 as hex – signs webhook bodies so the receiver can check they really come from this Ordo. */
export async function hmacHex(secret: string, body: string): Promise<string> {
  const te = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, te.encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 40 random characters, URL-safe – API keys and webhook secrets. */
export function randomSecret(prefix = ""): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return prefix + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
