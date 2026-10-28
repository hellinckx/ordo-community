/**
 * The person's own Brevo account (brevo.com, free plan: 300 e-mails a day). Every request goes from this device
 * straight to Brevo with the person's API key – on the desktop through the shell, in the browser as a normal fetch.
 */
import { http } from "@/services/integrations/http";

const BASE = "https://api.brevo.com/v3";

export const BREVO_LINKS = {
  signup: "https://onboarding.brevo.com/account/register",
  apiKeys: "https://app.brevo.com/settings/keys/api",
  senders: "https://app.brevo.com/senders/list",
};

export interface BrevoMail {
  to: { email: string; name?: string }[];
  bcc?: { email: string }[];
  subject: string;
  text: string;
  attachments?: { name: string; bytes: Uint8Array }[];
}

export interface BrevoSender {
  name: string;
  email: string;
  replyTo?: string;
}

async function call<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  if (!apiKey.trim()) throw new Error("Es fehlt noch der API-Schlüssel von Brevo.");
  const r = await http({
    method,
    url: `${BASE}${path}`,
    headers: { "api-key": apiKey.trim(), accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = "";
    try {
      msg = r.json<{ message?: string }>().message ?? "";
    } catch {
      msg = r.text.slice(0, 200);
    }
    if (r.status === 401) throw new Error("Brevo kennt diesen API-Schlüssel nicht. Bitte prüfen oder neu anlegen.");
    throw new Error(`Brevo: ${msg || `Fehler ${r.status}`}`);
  }
  return (r.text ? r.json<T>() : (undefined as T));
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text → simple HTML (paragraphs, line breaks). */
export function textToHtml(text: string, footer = ""): string {
  const body = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1d1d1f;max-width:620px;margin:0 auto;padding:24px">${body}${footer}</body></html>`;
}

/** Who the key belongs to – the connection test. */
export function brevoAccount(apiKey: string) {
  return call<{ email: string; companyName?: string; plan?: { type: string; credits?: number }[] }>(apiKey, "GET", "/account");
}

/** Senders verified in Brevo – only these may send. */
export async function brevoSenders(apiKey: string): Promise<{ name: string; email: string; active: boolean }[]> {
  const r = await call<{ senders?: { name: string; email: string; active: boolean }[] }>(apiKey, "GET", "/senders");
  return r.senders ?? [];
}

export async function brevoSend(apiKey: string, sender: BrevoSender, mail: BrevoMail): Promise<string> {
  const r = await call<{ messageId?: string }>(apiKey, "POST", "/smtp/email", {
    sender: { name: sender.name || sender.email, email: sender.email },
    to: mail.to,
    ...(mail.bcc?.length ? { bcc: mail.bcc } : {}),
    ...(sender.replyTo ? { replyTo: { email: sender.replyTo } } : {}),
    subject: mail.subject,
    textContent: mail.text,
    htmlContent: textToHtml(mail.text),
    ...(mail.attachments?.length ? { attachment: mail.attachments.map((a) => ({ name: a.name, content: base64(a.bytes) })) } : {}),
  });
  return r?.messageId ?? "";
}

/** The newsletter list: found by name, or created (Brevo needs a folder for it). */
export async function brevoEnsureList(apiKey: string, name: string): Promise<number> {
  const lists = await call<{ lists?: { id: number; name: string }[] }>(apiKey, "GET", "/contacts/lists?limit=50");
  const found = lists.lists?.find((l) => l.name === name);
  if (found) return found.id;
  const folders = await call<{ folders?: { id: number; name: string }[] }>(apiKey, "GET", "/contacts/folders?limit=50");
  const folderId = folders.folders?.find((f) => f.name === "Ordo")?.id ?? (await call<{ id: number }>(apiKey, "POST", "/contacts/folders", { name: "Ordo" })).id;
  return (await call<{ id: number }>(apiKey, "POST", "/contacts/lists", { name, folderId })).id;
}

/** Everyone currently on a list (paged). */
export async function brevoListEmails(apiKey: string, listId: number): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await call<{ contacts?: { email: string }[]; count?: number }>(apiKey, "GET", `/contacts/lists/${listId}/contacts?limit=500&offset=${offset}`);
    const page = r.contacts ?? [];
    out.push(...page.map((c) => c.email));
    if (page.length < 500) return out;
  }
}

/** Puts the opted-in contacts on the list (creates or updates them) and takes the others off. */
export async function brevoSyncList(apiKey: string, listId: number, keep: { email: string; name: string }[], remove: string[]): Promise<void> {
  for (const c of keep) await call(apiKey, "POST", "/contacts", { email: c.email, attributes: { FIRSTNAME: c.name }, listIds: [listId], updateEnabled: true });
  for (let i = 0; i < remove.length; i += 150) await call(apiKey, "POST", `/contacts/lists/${listId}/contacts/remove`, { emails: remove.slice(i, i + 150) });
}

/** A campaign to the list, sent right away. Brevo adds the unsubscribe link from {{ unsubscribe }}. */
export async function brevoSendCampaign(apiKey: string, sender: BrevoSender, listId: number, subject: string, text: string, imprint: string): Promise<number> {
  const footer = `<hr style="border:0;border-top:1px solid #e5e5ea;margin:28px 0 12px"><p style="font-size:12px;color:#86868b;margin:0">${esc(imprint)}<br>Du bekommst diese E-Mail, weil du dem Newsletter zugestimmt hast. <a href="{{ unsubscribe }}" style="color:#86868b">Abmelden</a></p>`;
  const r = await call<{ id: number }>(apiKey, "POST", "/emailCampaigns", {
    name: `${subject} (${new Date().toISOString().slice(0, 10)})`,
    subject,
    sender: { name: sender.name || sender.email, email: sender.email },
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    htmlContent: textToHtml(text, footer),
    recipients: { listIds: [listId] },
  });
  await call(apiKey, "POST", `/emailCampaigns/${r.id}/sendNow`);
  return r.id;
}
