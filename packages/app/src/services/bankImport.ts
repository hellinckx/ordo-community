import {
  parseBankCsv,
  parseCamt,
  parseBankPdfText,
  fromAiBankOutput,
  selectBankExtraction,
  bankLineHash,
  reconcile,
  sha256Hex,
  nowIso,
  ids,
  detectKind,
  AI_BANK_SCHEMA,
  BANK_PROMPT,
  type ParsedStatement,
  type BankLine,
  type BankStatement,
  type SummaDocument,
  type AiBankOutput,
} from "@ordo/core";
import { requirePlatform, requireStore } from "@/state/session";
import { toast } from "@/state/toasts";
import { createProvider, getTextExtractor } from "./extraction";

const td = new TextDecoder();

export interface BankImportResult {
  statement: BankStatement;
  added: number;
  duplicates: number;
  autoMatched: number;
  suggested: number;
}

/** Imports one bank statement file (CSV, CAMT XML, PDF). */
export async function importBankStatement(file: { name: string; mime: string; bytes: Uint8Array; path?: string }, onStatus?: (s: string) => void): Promise<BankImportResult> {
  const store = requireStore();
  const platform = requirePlatform();
  const profile = store.activeProfile;
  const settings = store.vault.settings;
  const sha = await sha256Hex(file.bytes);
  const existingDoc = store.list("documents", { profileId: profile.id }).find((d) => d.sha256 === sha);
  if (existingDoc) throw new Error(`Diese Datei wurde bereits importiert (${existingDoc.originalName}).`);

  onStatus?.("Datei wird gelesen …");
  const kind = detectKind(file.name, file.mime, file.bytes);
  let parsed: ParsedStatement;
  const lower = file.name.toLowerCase();
  if (kind === "csv" || lower.endsWith(".csv") || lower.endsWith(".txt")) {
    parsed = parseBankCsv(td.decode(file.bytes));
  } else if (lower.endsWith(".xml") || lower.endsWith(".camt") || td.decode(file.bytes.subarray(0, 200)).includes("<?xml")) {
    parsed = parseCamt(td.decode(file.bytes));
  } else if (kind === "pdf") {
    const local = await getTextExtractor(settings).extract(file.bytes, file.name, file.mime);
    parsed = parseBankPdfText(local.text);
    const provider = createProvider(settings, platform);
    const useAi = provider && settings.ai.provider !== "none" && (settings.ai.cloudConsent || !provider.cloud);
    if ((parsed.lines.length === 0 || parsed.warnings.length) && useAi && provider && local.images.length) {
      onStatus?.(`KI liest Kontoauszug (${provider.name}) …`);
      try {
        const r = await provider.extract({ prompt: `${BANK_PROMPT}\n\n<text>\n${local.text.slice(0, 15000)}\n</text>`, schema: AI_BANK_SCHEMA, images: local.images, pdf: file.bytes });
        const ai = fromAiBankOutput(r.output as unknown as AiBankOutput);
        parsed = selectBankExtraction(parsed, ai);
      } catch (e) {
        parsed.warnings.push(`KI-Erkennung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else if (kind === "spreadsheet") {
    const local = await getTextExtractor(settings).extract(file.bytes, file.name, file.mime);
    parsed = parseBankCsv(local.text.split("\n").filter((l) => !l.startsWith("#")).map((l) => l.replace(/ \| /g, ";")).join("\n"));
  } else {
    throw new Error("Dateityp nicht unterstützt. Bitte CSV, CAMT-XML oder PDF-Kontoauszug verwenden.");
  }
  if (!parsed.lines.length) throw new Error(parsed.warnings[0] ?? "Keine Umsätze erkannt.");

  onStatus?.("Umsätze werden gespeichert …");
  const att = await store.putAttachment(profile.id, file.bytes, { name: file.name, mime: file.mime });
  const now = nowIso();
  const docId = ids.document();
  const doc: SummaDocument = { id: docId, profileId: profile.id, attachmentId: att.id, originalName: file.name, originalPath: file.path, mime: file.mime, sha256: sha, source: "bank", importedAt: now, status: "approved", createdAt: now, updatedAt: now };
  const statement: BankStatement = {
    id: ids.document().replace("doc_", "bst_"),
    profileId: profile.id,
    documentId: docId,
    iban: parsed.iban,
    accountName: parsed.accountName,
    bankName: parsed.bankName,
    from: parsed.from,
    to: parsed.to,
    openingBalanceCents: parsed.openingBalanceCents,
    closingBalanceCents: parsed.closingBalanceCents,
    lineCount: parsed.lines.length,
    format: parsed.format,
    importedAt: now,
    warnings: parsed.warnings,
    createdAt: now,
    updatedAt: now,
  };
  const existingHashes = new Set(store.list("bankLines", { profileId: profile.id }).map((l) => l.hash));
  const fresh: BankLine[] = [];
  let duplicates = 0;
  for (const l of parsed.lines) {
    const hash = await bankLineHash(l, parsed.iban, sha256Hex);
    if (existingHashes.has(hash)) {
      duplicates++;
      continue;
    }
    existingHashes.add(hash);
    fresh.push({ id: ids.transaction().replace("txn_", "bnk_"), profileId: profile.id, statementId: statement.id, date: l.date, valueDate: l.valueDate, amountCents: l.amountCents, currency: l.currency, counterparty: l.counterparty, counterpartyIban: l.counterpartyIban, purpose: l.purpose, reference: l.reference, hash, status: "unmatched", balanceAfterCents: l.balanceAfterCents, createdAt: now, updatedAt: now });
  }
  statement.lineCount = fresh.length;
  store.mutate((v) => {
    v.documents = [...v.documents, doc];
    v.bankStatements = [...v.bankStatements, statement];
    v.bankLines = [...v.bankLines, ...fresh];
  }, { audit: { action: "bank.import", entity: "bankStatements", entityId: statement.id, details: `${fresh.length} Zeilen` } });
  const r = runReconcile();
  return { statement, added: fresh.length, duplicates, autoMatched: r.autoMatched, suggested: r.suggested };
}

/** Re-runs matching for all open lines of the active profile. */
export function runReconcile(): { autoMatched: number; suggested: number } {
  const store = requireStore();
  const profile = store.activeProfile;
  const lines = store.list("bankLines", { profileId: profile.id });
  const txs = store.list("transactions", { profileId: profile.id });
  const contacts = store.list("contacts", { profileId: profile.id });
  const r = reconcile(lines, txs, contacts, { autoThreshold: 0.85 });
  const byId = new Map(r.lines.map((l) => [l.id, l]));
  store.mutate((v) => {
    v.bankLines = v.bankLines.map((l) => {
      const n = byId.get(l.id);
      if (!n) return l;
      if (n.status === l.status && n.matchedTransactionId === l.matchedTransactionId && n.suggestedTransactionId === l.suggestedTransactionId) return l;
      return { ...n, updatedAt: nowIso() };
    });
  });
  return { autoMatched: r.autoMatched, suggested: r.suggested };
}

export async function importBankFiles(files: { name: string; mime: string; bytes: Uint8Array; path?: string }[], onStatus?: (s: string) => void) {
  let ok = 0;
  for (const f of files) {
    try {
      const r = await importBankStatement(f, onStatus);
      ok++;
      toast.success(`Kontoauszug importiert: ${f.name}`, `${r.added} Umsätze (${r.duplicates} bereits bekannt) · ${r.autoMatched} automatisch zugeordnet · ${r.suggested} Vorschläge`);
    } catch (e) {
      toast.error(`Import fehlgeschlagen: ${f.name}`, e instanceof Error ? e.message : String(e));
    }
  }
  return ok;
}
