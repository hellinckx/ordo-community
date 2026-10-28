/**
 * Files attached in the Atlas chat: read what is needed from them, or hand invoices to Summa's normal intake.
 * Formats the edition knows on its own (e.g. a backup of the operator's old ERP) bring their own tools.
 */
import { z } from "zod";
import { importFiles } from "@/services/importer";
import { defineTool, AtlasToolError, type AtlasTool } from "./tools";
import { getAttachment, type Attachment } from "./attachments";
import type { ToolEnv } from "./tools-read";

const MAX_CHARS = 20_000;

function attachment(id: string): Attachment {
  const a = getAttachment(id);
  if (!a) throw new AtlasToolError("Diese Datei ist nicht mehr da (zum Beispiel nach einem Neustart). Bitte noch einmal anhängen.");
  return a;
}

const ReadInput = z.object({
  file_id: z.string().describe("Datei-ID aus der Nachricht (📎 … [Datei-ID: att_…])"),
  from: z.number().int().min(1).optional().describe("Tabellen: ab Zeile (1 = erste Datenzeile); Text: ab Zeile. Standard 1"),
  count: z.number().int().min(1).max(500).optional().describe("Wie viele Zeilen. Standard 100"),
});

const readAttachment = defineTool<z.infer<typeof ReadInput>>({
  name: "read_attachment",
  description:
    "Liest den Inhalt einer angehängten Datei (Tabelle als Zeilen mit Spaltennamen, Text oder JSON in Abschnitten). Lies nur, was du für die Aufgabe brauchst – bei großen Dateien in Abschnitten. PDFs liest du nicht selbst, Bilder siehst du direkt in der Nachricht; Rechnungen und Kassenbons gibst du mit add_invoice_files an Summa.",
  input: ReadInput,
  kind: "read",
  preview: (input) => `„${getAttachment(input.file_id)?.name ?? "Datei"}“ lesen`,
  run(input) {
    const a = attachment(input.file_id);
    const from = input.from ?? 1;
    const count = input.count ?? 100;
    if (a.kind === "table" && a.rows) {
      const header = a.rows[0] ?? [];
      const body = a.rows.slice(from, from + count);
      let rows = body.map((r) => Object.fromEntries(header.map((h, i) => [h || `Spalte ${i + 1}`, r[i] ?? ""])));
      while (JSON.stringify(rows).length > MAX_CHARS && rows.length > 1) rows = rows.slice(0, Math.ceil(rows.length / 2));
      const shown = rows.length;
      return { data: { columns: header, from, rows, total_rows: a.rows.length - 1, more: from + shown - 1 < a.rows.length - 1 }, summary: `${a.name}: Zeilen ${from}–${from + shown - 1} von ${a.rows.length - 1} gelesen` };
    }
    if ((a.kind === "text" || a.kind === "json") && a.text !== undefined) {
      const lines = a.text.split(/\r?\n/);
      const slice = lines.slice(from - 1, from - 1 + count).join("\n").slice(0, MAX_CHARS);
      return { data: { from, text: slice, total_lines: lines.length, more: from - 1 + count < lines.length }, summary: `${a.name}: Zeilen ${from}–${Math.min(lines.length, from - 1 + count)} gelesen` };
    }
    return { data: { name: a.name, summary: a.summary, readable: false }, summary: `${a.name}: ${a.summary}` };
  },
});

const InvoiceInput = z.object({
  file_ids: z.array(z.string()).min(1).describe("Datei-IDs der angehängten Rechnungen, Kassenbons oder PDFs"),
  direction: z.enum(["incoming", "outgoing"]).describe("incoming = Rechnung an dich (Ausgabe) – der Normalfall; outgoing = deine Rechnung an einen Kunden (Einnahme)"),
});

/** Summa's normal intake (same as "Rechnungen hinzufügen"): read, recognise, book what is clear. */
function invoiceTool(): AtlasTool {
  return defineTool<z.infer<typeof InvoiceInput>>({
    name: "add_invoice_files",
    description:
      "Gibt angehängte Rechnungen, Kassenbons oder Kontoauszüge (PDF, Foto) an Summa – genau wie „Rechnungen hinzufügen“: Summa liest sie, bucht Eindeutiges selbst und legt den Rest unter „Zu prüfen“ ab.",
    input: InvoiceInput,
    kind: "write",
    area: "summa",
    atlasArea: "incoming",
    preview: (input) => {
      const names = input.file_ids.map((id) => getAttachment(id)?.name ?? id);
      return names.length === 1 ? `„${names[0]}“ als ${input.direction === "outgoing" ? "Ausgangsrechnung" : "Rechnung"} einlesen` : `${names.length} Dateien als Rechnungen einlesen`;
    },
    run(input) {
      const list = input.file_ids.map(attachment);
      importFiles(list.map((a) => ({ name: a.name, mime: a.mime, bytes: a.bytes })), "upload", { direction: input.direction });
      return { data: { queued: list.map((a) => a.name) }, summary: `${list.length === 1 ? `„${list[0]!.name}“ wird` : `${list.length} Dateien werden`} gelesen`, link: { to: "/belege", label: "Zu den eingehenden Rechnungen" } };
    },
  });
}

/** Attachment tools that fit the installed modules. */
export function fileTools(env: ToolEnv, withWrite: boolean): AtlasTool[] {
  return [readAttachment, ...(withWrite && env.modules.includes("summa") ? [invoiceTool()] : [])];
}
