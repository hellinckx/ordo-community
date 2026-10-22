import type { Category, Contact, Extraction, ExtractedFields, Profile, Settings, Transaction } from "../model/types";
import { ExtractedFieldsSchema, nowIso, todayIso } from "../model/types";
import { ids } from "../model/ids";
import { lineFromGross } from "../model/vat";
import { overallConfidence, parseReceiptText, type ParseResult } from "./parse";
import { fromAiOutput, mergeExtractions } from "./normalize";
import { suggestCategory } from "./categorize";
import { AI_OUTPUT_SCHEMA, buildExtractionPrompt } from "./schema";
import { ProviderError, type ExtractionProvider, type ProviderUsage } from "./providers/types";
import { extractionModelLabel } from "./escalation";
import type { LocalTextResult, TextExtractor } from "./text";
import { decodeQrCodes, fieldsFromQr, parseQrPayload, type QrPayload } from "./qr";
import { findEInvoiceAttachment, parseEInvoiceXml } from "./einvoice";

export interface ExtractContext {
  profile: Profile;
  settings: Settings;
  categories: Category[];
  contacts: Contact[];
  textExtractor: TextExtractor;
  provider?: ExtractionProvider;
  onProgress?: (stage: "text" | "ocr" | "qr" | "einvoice" | "rules" | "ai" | "done", detail?: string) => void;
  /** Known direction (e.g. file came from the outgoing-invoice folder). Overrides detection. */
  forceDirection?: "incoming" | "outgoing";
  /**
   * "Mit KI lesen": ask the AI regardless of strategy, let it read the image itself (no local OCR), and throw
   * instead of falling back to the local result when the AI is not set up or fails.
   */
  forceAi?: boolean;
  signal?: AbortSignal;
}

export interface ExtractOutcome {
  extraction: Extraction;
  local: LocalTextResult;
  suggestion: ReturnType<typeof suggestCategory>;
  aiError?: string;
  /** Which sources contributed, in priority order. */
  sources: ("einvoice" | "qr" | "rules" | "ai")[];
  /** QR payload kinds found on the document ("rksv" = Kassenbon, "epc" = payment code). */
  qrKinds: QrPayload["kind"][];
  /** Every AI call with its token usage (for cost tracking). */
  aiUsage: { model: string; usage?: ProviderUsage }[];
}

const overallOf = overallConfidence;

/** Overlays authoritative structured data (e-invoice XML, QR) on top of weaker fields. */
function overlay(base: ExtractedFields, baseConf: Record<string, number>, top: Partial<ExtractedFields>, topConf: Record<string, number>): { fields: ExtractedFields; confidence: Record<string, number>; warnings: string[] } {
  const fields: ExtractedFields = { ...base };
  const confidence = { ...baseConf };
  const warnings: string[] = [];
  for (const [k, v] of Object.entries(top) as [keyof ExtractedFields, unknown][]) {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    const cur = fields[k];
    if ((k === "grossCents" || k === "invoiceDate") && cur !== null && cur !== undefined && cur !== v) {
      warnings.push(`${k === "grossCents" ? "Betrag" : "Datum"}: strukturierte Quelle (${k === "grossCents" ? ((v as number) / 100).toFixed(2) : String(v)}) ersetzt erkannten Wert (${k === "grossCents" ? ((cur as number) / 100).toFixed(2) : String(cur)}).`);
    }
    (fields as Record<string, unknown>)[k] = v;
    if (topConf[k] !== undefined) confidence[k] = topConf[k]!;
  }
  if (fields.vatLines.length && fields.grossCents !== null) {
    const sum = fields.vatLines.reduce((s, l) => s + l.netCents + l.vatCents, 0);
    if (Math.abs(sum - fields.grossCents) > 2) warnings.push("Steuerzeilen und Gesamtbetrag stimmen nicht überein – bitte prüfen.");
  }
  return { fields, confidence, warnings };
}

/**
 * Full pipeline, in order of trust:
 *   1. embedded e-invoice XML (ZUGFeRD/Factur-X/UBL)   → authoritative
 *   2. QR codes (RKSV Kassenbon, EPC payment)         → authoritative for amounts/VAT/date
 *   3. text layer / OCR + rule parser                  → good
 *   4. AI (per strategy: only when still uncertain, always, or never) → cross-checked against 1–3
 */
export async function extractDocument(bytes: Uint8Array, name: string, mime: string, ctx: ExtractContext): Promise<ExtractOutcome> {
  const started = Date.now();
  const sources: ExtractOutcome["sources"] = [];
  ctx.onProgress?.("text", name);
  const local = await ctx.textExtractor.extract(bytes, name, mime, ctx.forceAi ? { ocr: false } : {});
  const ownNames = [ctx.profile.company.name, ctx.profile.name].filter(Boolean);

  // 3) rules first (cheap) – forms the base
  ctx.onProgress?.("rules");
  const rules: ParseResult = parseReceiptText(local.text, { ownNames: ctx.forceDirection === "outgoing" ? [] : ownNames, ownUid: ctx.profile.company.uid || undefined, outgoing: ctx.forceDirection === "outgoing" });
  let fields = rules.fields;
  let confidence = rules.confidence;
  let warnings = [...local.warnings, ...rules.warnings];
  let provider: Extraction["provider"] = "rules";
  let model: string | undefined;
  let aiError: string | undefined;
  const aiUsage: ExtractOutcome["aiUsage"] = [];
  sources.push("rules");
  // Weak OCR (blurry photo, shadows) makes every rule-based value shaky – lower the confidences and prefer AI.
  const ocrWeak = local.ocrConfidence !== undefined && local.ocrConfidence < 0.6;
  if (ocrWeak) {
    confidence = Object.fromEntries(Object.entries(confidence).map(([k, v]) => [k, Math.round(v * 80) / 100]));
    warnings.push(`OCR-Qualität niedrig (${Math.round(local.ocrConfidence! * 100)} %) – Werte bitte prüfen.`);
  }

  // 1) e-invoice XML inside the PDF
  if (local.einvoiceXml) {
    ctx.onProgress?.("einvoice");
    const e = parseEInvoiceXml(local.einvoiceXml);
    if (e) {
      const o = overlay(fields, confidence, e.fields, e.confidence);
      fields = o.fields;
      confidence = o.confidence;
      warnings = [...warnings, ...o.warnings, `E-Rechnung (${e.format.toUpperCase()}) im PDF gefunden – Werte übernommen.`];
      if (e.fields.lineItems.length) fields.lineItems = e.fields.lineItems;
      sources.unshift("einvoice");
    }
  }

  // 2) QR codes on the image / rendered pages
  const qrPayloads: QrPayload[] = [];
  if (local.images.length && (local.kind === "image" || local.kind === "pdf")) {
    ctx.onProgress?.("qr");
    for (const img of local.images.slice(0, 2)) {
      try {
        for (const raw of await decodeQrCodes(img, "image/png")) {
          const p = parseQrPayload(raw);
          if (p.kind !== "unknown") qrPayloads.push(p);
        }
      } catch {
        /* ignore decoder failures */
      }
      if (qrPayloads.length) break;
    }
    if (qrPayloads.length) {
      const q = fieldsFromQr(qrPayloads);
      const o = overlay(fields, confidence, q.fields, q.confidence);
      fields = o.fields;
      confidence = o.confidence;
      warnings = [...warnings, ...o.warnings, ...q.notes];
      sources.splice(sources.indexOf("rules"), 0, "qr");
    }
  }
  let overall = overallOf(confidence);

  // 4) AI – according to strategy
  const strategy = ctx.settings.ai.strategy;
  const consentOk = !!ctx.provider && (ctx.settings.ai.cloudConsent || !ctx.provider.cloud);
  if (ctx.forceAi) {
    const aiName = ctx.settings.ai.provider;
    if (!ctx.provider || aiName === "none") throw new ProviderError("Es ist noch keine KI zum Lesen von Rechnungen eingerichtet (Einstellungen → KI-Erkennung).", aiName, undefined, "no_provider");
    if (!consentOk) throw new ProviderError("Du hast noch nicht erlaubt, Rechnungen an den KI-Anbieter zu senden (Einstellungen → KI-Erkennung).", aiName, undefined, "consent");
  }
  const aiAllowed = !!ctx.provider && ctx.settings.ai.provider !== "none" && (strategy !== "local_only" || !!ctx.forceAi) && consentOk;
  const essentialMissing = fields.grossCents === null || fields.invoiceDate === null || !fields.vendorName;
  const needAi = !!ctx.forceAi || strategy === "always" || overall < ctx.settings.ai.aiThreshold || essentialMissing || ocrWeak;
  if (aiAllowed && ctx.provider && needAi) {
    ctx.onProgress?.("ai", ctx.provider.name);
    try {
      const mode = ctx.profile.mode;
      const cats = ctx.categories
        .filter((c) => !c.deletedAt && !c.isArchived && (c.mode === "both" || c.mode === mode))
        .map((c) => ({ name: c.name, kind: c.kind, keywords: [...c.userKeywords, ...c.keywords] }));
      const prompt = buildExtractionPrompt({ categories: cats, ocrText: ctx.settings.ai.includeOcrText ? local.text : undefined, ownCompanyName: ctx.profile.company.name || undefined, ownUid: ctx.profile.company.uid || undefined, mode });
      const checkVat = ctx.profile.mode === "business" && ctx.profile.vatRegime !== "kleinunternehmer";
      const r = await ctx.provider.extract({ prompt, schema: AI_OUTPUT_SCHEMA, images: local.images, pdf: local.kind === "pdf" ? bytes : undefined, signal: ctx.signal, checkVat, onStep: (d) => ctx.onProgress?.("ai", d) });
      for (const a of r.attempts ?? [{ model: r.model, issues: [], usage: r.usage }]) aiUsage.push({ model: a.model, usage: a.usage });
      const ai = fromAiOutput(r.output);
      // AI merges with the *rules* result; structured sources re-overlay afterwards so they always win.
      const merged = mergeExtractions({ ...rules, fields, confidence, overall }, ai);
      let f2 = merged.fields;
      let c2 = merged.confidence;
      const w2 = [...merged.warnings];
      if (local.einvoiceXml) {
        const e = parseEInvoiceXml(local.einvoiceXml);
        if (e) {
          const o = overlay(f2, c2, e.fields, e.confidence);
          f2 = o.fields;
          c2 = o.confidence;
        }
      }
      if (qrPayloads.length) {
        const q = fieldsFromQr(qrPayloads);
        const o = overlay(f2, c2, q.fields, q.confidence);
        f2 = o.fields;
        c2 = o.confidence;
        w2.push(...o.warnings);
      }
      // keep the better category hint / description from AI
      fields = f2;
      confidence = c2;
      overall = Math.max(overallOf(confidence), merged.overall);
      warnings = [...warnings, ...w2];
      provider = ctx.provider.id as Extraction["provider"];
      model = r.model;
      sources.push("ai");
      if (r.output.notes) warnings.push(`KI-Hinweis: ${r.output.notes}`);
      const tries = r.attempts ?? [];
      if (tries.length > 1) {
        const [a, b] = [tries[0]!, tries[tries.length - 1]!];
        const why = a.error ? "keine verwertbare Antwort" : `unsicher: ${a.issues.slice(0, 3).join(", ")}`;
        warnings.push(`${extractionModelLabel(a.model)} hat zuerst gelesen (${why}), ${extractionModelLabel(b.model)} hat nachgelesen${b.error ? " – ohne Ergebnis, erstes Ergebnis behalten" : ""}.`);
      }
    } catch (e) {
      if (ctx.forceAi) throw e;
      aiError = e instanceof Error ? e.message : String(e);
      warnings.push(`KI-Erkennung fehlgeschlagen, lokales Ergebnis verwendet: ${aiError}`);
    }
  } else if (aiAllowed && !needAi) {
    warnings.push(`Lokale Erkennung ausreichend sicher (${Math.round(overall * 100)} %) – KI nicht benötigt.`);
  }

  if (ctx.forceDirection) {
    fields = { ...fields, direction: ctx.forceDirection };
    if (ctx.forceDirection === "outgoing") {
      // On our own invoice the "vendor" is us – the business partner is the customer.
      if (fields.isPaid === true && !qrPayloads.some((q) => q.kind === "rksv")) fields.isPaid = null;
      warnings.push("Ausgangsrechnung (aus Ordner/Upload für eigene Rechnungen) – wird als Einnahme gebucht.");
    }
  }
  const kind: "income" | "expense" = fields.direction === "outgoing" ? "income" : "expense";
  const suggestion = suggestCategory(fields, local.text, ctx.categories, ctx.contacts, ctx.profile.mode, kind);
  // Category/contact certainty travels with the extraction so the review UI and auto-booking can show it.
  confidence = { ...confidence, category: suggestion.categoryScore, contact: suggestion.contactScore };
  ctx.onProgress?.("done");
  const extraction: Extraction = {
    provider,
    model,
    extractedAt: nowIso(),
    text: local.text.slice(0, 40000),
    fields: ExtractedFieldsSchema.parse(fields),
    confidence,
    overall: Math.min(1, overall),
    warnings: [...new Set(warnings)],
    durationMs: Date.now() - started,
  };
  return { extraction, local, suggestion, aiError, sources, qrKinds: qrPayloads.map((q) => q.kind), aiUsage };
}

/** Builds a draft transaction from an extraction (used by the review screen and auto-approve). */
export function transactionFromExtraction(profile: Profile, extraction: Extraction, suggestion: { categoryId?: string; contactId?: string }, categories: Category[], documentId: string): Transaction {
  const f = extraction.fields;
  const now = nowIso();
  const cat = categories.find((c) => c.id === suggestion.categoryId);
  const kind: Transaction["kind"] = f.direction === "outgoing" ? "income" : "expense";
  const gross = f.grossCents ?? 0;
  let vatLines = f.vatLines.length ? f.vatLines : [];
  const isKu = profile.vatRegime === "kleinunternehmer";
  if (!vatLines.length && gross) {
    const rate = cat?.defaultVatRate ?? 20;
    vatLines = [lineFromGross(gross, isKu && kind === "income" ? 0 : rate)];
  }
  let vatTreatment: Transaction["vatTreatment"] = "standard";
  if (f.reverseCharge) vatTreatment = "reverse_charge";
  if (isKu && kind === "income") vatTreatment = "kleinunternehmer";
  // Outgoing invoices are open receivables until the bank statement shows the payment.
  const paid = kind === "income" ? f.isPaid === true : f.isPaid !== false;
  return {
    id: ids.transaction(),
    profileId: profile.id,
    kind,
    date: f.invoiceDate ?? todayIso(),
    description: kind === "income" ? [f.invoiceNumber ? `Rechnung ${f.invoiceNumber}` : null, f.customerName].filter(Boolean).join(" – ") || f.description || "" : f.description ?? f.vendorName ?? "",
    contactId: suggestion.contactId,
    categoryId: suggestion.categoryId,
    vatLines,
    grossCents: gross,
    currency: f.currency ?? "EUR",
    vatTreatment,
    vatDeductiblePct: cat?.defaultDeductiblePct ?? 100,
    paymentMethod: f.paymentMethod ?? (paid ? "card" : "bank"),
    paidDate: paid ? (f.invoiceDate ?? todayIso()) : undefined,
    dueDate: f.dueDate ?? undefined,
    invoiceNumber: f.invoiceNumber ?? "",
    reference: "",
    documentIds: [documentId],
    tags: [],
    notes: "",
    origin: "extraction",
    reviewed: false,
    createdAt: now,
    updatedAt: now,
  };
}
