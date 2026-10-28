/**
 * Files handed to Atlas in the chat. They stay in memory on this device (not in the vault, not in the chat history):
 * the chat only carries a short line per file – name, size and what Ordo recognised in it (counts and column names,
 * never rows). Atlas reads content only through tools (read_attachment), where it arrives as data, not as part of the
 * person's message; known formats such as the old ERP backup are imported locally without the content going to the AI.
 * File content can come from anyone, so while a file is in play every change needs the person's confirmation
 * (see toolset.ts).
 */
import { ids, type AtlasChat } from "@ordo/core";
import type { PickedFile } from "@/platform/types";
import { PARTS } from "@/operator";
import { rememberImage } from "./vision";
import type { Screenshot } from "./screenshot";

export type AttachmentKind = "table" | "text" | "json" | "invoice" | "screenshot" | "known" | "other";

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
  kind: AttachmentKind;
  /** One line for the model and the chat ("Tabelle mit 120 Zeilen, Spalten: …"). */
  summary: string;
  /** Tables: header + rows as text. */
  rows?: string[][];
  /** Text and JSON files: the decoded text. */
  text?: string;
  /** Set by a recognizer of a known format (e.g. "erp-export"), with whatever it parsed. */
  known?: { format: string; data: unknown };
}

const files = new Map<string, Attachment>();

export function getAttachment(id: string): Attachment | undefined {
  return files.get(id.trim());
}

const FILE_TOOLS = new Set(["read_attachment", "add_invoice_files", "import_old_erp"]);

/**
 * Whether a chat ever had a file in it (a 📎 line from the person or a file tool call). File content can come from
 * anyone, so in such a chat every change waits for the person's confirmation – also after a restart, when the files
 * themselves are gone from memory but their content may still sit in the history.
 */
export function chatHasFiles(chat: Pick<AtlasChat, "messages"> | undefined): boolean {
  return !!chat?.messages.some((m) => (m.role === "user" && m.text.includes("[Datei-ID: att_")) || m.toolCalls.some((t) => FILE_TOOLS.has(t.name)));
}

/**
 * Text from a file that goes into a message: letters, digits and a few harmless signs only – no quotes, brackets,
 * line breaks or invisible format characters (bidi overrides, zero-width), so it cannot pose as Ordo's own text.
 */
function clean(text: string, max: number): string {
  const one = text.normalize("NFKC").replace(/[^\p{L}\p{N} .,_\-()&/+:'@]/gu, " ").replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

/** The marker the chat message carries for a file; the model passes `file_id` to the tools. */
export function attachmentLine(a: Attachment): string {
  return `📎 ${clean(a.name, 80)} (${sizeLabel(a.size)}) – ${a.summary} [Datei-ID: ${a.id}]`;
}

export function sizeLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1).replace(".", ",")} MB`;
}

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");
const INVOICE_EXT = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "tif", "tiff", "gif", "bmp", "eml"]);

/** UTF-8, or Windows-1252 when the bytes are no valid UTF-8 (older Excel CSV exports). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** CSV with ; , or tab, quotes and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = (r.values as unknown[]).slice(1).map((v) => {
      if (v === null || v === undefined) return "";
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === "object") {
        const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
        return o.text ?? (o.richText ? o.richText.map((t) => t.text).join("") : o.result !== undefined ? String(o.result) : "");
      }
      return String(v);
    });
    rows.push(vals);
  });
  return rows;
}

/** Counts and column names only – the rows themselves Atlas reads with read_attachment. */
function tableSummary(rows: string[][], what: string): string {
  const header = (rows[0] ?? []).slice(0, 15).map((h) => clean(h, 30)).filter(Boolean);
  return `${what} mit ${Math.max(0, rows.length - 1)} Zeilen und ${rows[0]?.length ?? 0} Spalten${header.length ? ` (Spaltennamen aus der Datei: ${header.join(" · ")})` : ""}`;
}

function jsonSummary(value: unknown): string {
  if (Array.isArray(value)) {
    const keys = value[0] && typeof value[0] === "object" ? Object.keys(value[0] as object).slice(0, 15).map((k) => clean(k, 30)) : [];
    return `JSON-Liste mit ${value.length} Einträgen${keys.length ? ` (Feldnamen aus der Datei: ${keys.join(" · ")})` : ""}`;
  }
  if (value && typeof value === "object") return `JSON-Objekt mit ${Object.keys(value).length} Feldern`;
  return "JSON-Wert";
}

/** Reads and recognises a file once; afterwards it is available to Atlas' tools under its id. */
export async function addAttachment(file: PickedFile): Promise<Attachment> {
  const base: Attachment = { id: `att_${ids.message().slice(-10)}`, name: file.name, mime: file.mime, size: file.bytes.byteLength, bytes: file.bytes, kind: "other", summary: "Datei" };
  const e = ext(file.name);
  try {
    // formats only the operator's edition knows (e.g. the backup of its old ERP)
    const known = PARTS.atlasFiles ? await PARTS.atlasFiles.recognize(file) : null;
    if (known) Object.assign(base, { kind: "known", summary: known.summary, known: { format: known.format, data: known.data } });
    else if (e === "csv" || e === "tsv") {
      const rows = parseCsv(decodeText(file.bytes));
      Object.assign(base, { kind: "table", rows, summary: tableSummary(rows, "Tabelle (CSV)") });
    } else if (e === "xlsx") {
      const rows = await readXlsx(file.bytes);
      Object.assign(base, { kind: "table", rows, summary: tableSummary(rows, "Excel-Tabelle (erstes Blatt)") });
    } else if (e === "json") {
      const text = decodeText(file.bytes);
      let summary = "JSON-Datei";
      try {
        summary = jsonSummary(JSON.parse(text));
      } catch {
        summary = "JSON-Datei (nicht lesbar)";
      }
      Object.assign(base, { kind: "json", text, summary });
    } else if (["txt", "md", "xml", "html", "htm", "vcf", "ics"].includes(e) || file.mime.startsWith("text/")) {
      const text = decodeText(file.bytes);
      Object.assign(base, { kind: "text", text, summary: `Text mit ${text.split(/\r?\n/).length} Zeilen` });
    } else if (INVOICE_EXT.has(e) || file.mime === "application/pdf" || file.mime.startsWith("image/")) {
      const seen = file.mime.startsWith("image/") && (await rememberImage(base.id, file.bytes, file.mime));
      Object.assign(base, { kind: "invoice", summary: e === "pdf" || file.mime === "application/pdf" ? "PDF – z. B. eine Rechnung" : e === "eml" ? "E-Mail" : seen ? "Bild, Atlas sieht es sich an – z. B. ein Kassenbon oder eine Rechnung" : "Bild – z. B. ein Kassenbon oder eine Rechnung" });
    } else if (e === "xls") {
      Object.assign(base, { summary: "altes Excel-Format (.xls) – bitte als .xlsx oder CSV speichern" });
    }
  } catch (err) {
    base.summary = `nicht lesbar (${err instanceof Error ? err.message : String(err)})`;
  }
  files.set(base.id, base);
  return base;
}

/** A picture of the Ordo page the person is on, taken with the camera button in the Atlas window. */
export async function addScreenshot(shot: Screenshot, page: string): Promise<Attachment> {
  const f = shot.file;
  const a: Attachment = { id: `att_${ids.message().slice(-10)}`, name: f.name, mime: f.mime, size: f.bytes.byteLength, bytes: f.bytes, kind: "screenshot", summary: `Bildschirmfoto von Ordo, Seite ${clean(page, 60) || "unbekannt"}` };
  if (!(await rememberImage(a.id, f.bytes, f.mime, { screen: true, width: shot.width, height: shot.height }))) a.summary += " (zu groß zum Ansehen)";
  files.set(a.id, a);
  return a;
}

/** Turns dropped or pasted files into PickedFile objects. */
export async function pickedFrom(list: FileList | File[]): Promise<PickedFile[]> {
  return Promise.all([...list].map(async (f) => ({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
}
