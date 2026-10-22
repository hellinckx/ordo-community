import type { ExtractedFields } from "../model/types";
import { ExtractedFieldsSchema } from "../model/types";
import { isVatRate, type VatLine } from "../model/vat";
import type { AiOutput } from "./schema";
import { overallConfidence, type ParseResult } from "./parse";

function euroToCents(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

function isoOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const de = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (de) return `${de[3]}-${de[2]!.padStart(2, "0")}-${de[1]!.padStart(2, "0")}`;
  return null;
}

export function fromAiOutput(ai: AiOutput): { fields: ExtractedFields; confidence: Record<string, number>; overall: number } {
  const vatLines: VatLine[] = [];
  for (const l of ai.vat_lines ?? []) {
    const rate = Math.round(Number(l.rate));
    if (!isVatRate(rate)) continue;
    let net = euroToCents(l.net);
    let vat = euroToCents(l.vat);
    if (net === null && vat !== null && rate > 0) net = Math.round((vat * 100) / rate);
    if (vat === null && net !== null) vat = Math.round((net * rate) / 100);
    if (net === null || vat === null) continue;
    const existing = vatLines.find((x) => x.rate === rate);
    if (existing) {
      existing.netCents += net;
      existing.vatCents += vat;
    } else vatLines.push({ rate, netCents: net, vatCents: vat });
  }
  let gross = euroToCents(ai.gross_total);
  const sumLines = vatLines.reduce((s, l) => s + l.netCents + l.vatCents, 0);
  if (gross === null && vatLines.length) gross = sumLines;
  if (gross !== null && vatLines.length === 0 && ai.net_total !== null && ai.vat_total !== null) {
    const net = euroToCents(ai.net_total)!;
    const vat = euroToCents(ai.vat_total)!;
    const rate = net > 0 ? Math.round((vat * 100) / net) : 0;
    if (isVatRate(rate)) vatLines.push({ rate, netCents: net, vatCents: vat });
  }
  const fields = ExtractedFieldsSchema.parse({
    documentType: ai.document_type ?? "other",
    direction: ai.direction ?? "unknown",
    vendorName: ai.vendor_name?.trim() || null,
    vendorUid: ai.vendor_uid?.replace(/\s+/g, "").toUpperCase() || null,
    vendorAddress: ai.vendor_address || null,
    vendorIban: ai.vendor_iban?.replace(/\s+/g, "").toUpperCase() || null,
    customerName: ai.customer_name || null,
    invoiceNumber: ai.invoice_number?.trim() || null,
    invoiceDate: isoOrNull(ai.invoice_date),
    dueDate: isoOrNull(ai.due_date),
    serviceDate: ai.service_date || null,
    currency: ai.currency?.toUpperCase() || "EUR",
    grossCents: gross,
    netCents: euroToCents(ai.net_total) ?? (vatLines.length ? vatLines.reduce((s, l) => s + l.netCents, 0) : null),
    vatCents: euroToCents(ai.vat_total) ?? (vatLines.length ? vatLines.reduce((s, l) => s + l.vatCents, 0) : null),
    vatLines,
    paymentMethod: ai.payment_method ?? null,
    isPaid: ai.is_paid ?? null,
    description: ai.description?.slice(0, 120) || null,
    lineItems: (ai.line_items ?? []).slice(0, 100).map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPriceCents: euroToCents(li.unit_price),
      totalCents: euroToCents(li.total),
      vatRate: li.vat_rate,
    })),
    suggestedCategory: ai.suggested_category || null,
    reverseCharge: ai.reverse_charge ?? null,
    notes: ai.notes || null,
  });
  const c = ai.confidence ?? { overall: 0.7, vendor_name: 0.7, invoice_date: 0.7, gross_total: 0.7, vat_lines: 0.7, invoice_number: 0.7 };
  const clamp = (v: number | undefined) => Math.max(0, Math.min(1, Number(v ?? 0.7)));
  const confidence: Record<string, number> = {
    vendorName: clamp(c.vendor_name),
    invoiceDate: clamp(c.invoice_date),
    grossCents: clamp(c.gross_total),
    vatLines: clamp(c.vat_lines),
    invoiceNumber: clamp(c.invoice_number),
    documentType: 0.9,
    currency: 0.9,
    paymentMethod: ai.payment_method ? 0.8 : 0,
    dueDate: ai.due_date ? 0.8 : 0,
    vendorUid: ai.vendor_uid ? 0.9 : 0,
    vendorIban: ai.vendor_iban ? 0.9 : 0,
  };
  if (gross !== null && vatLines.length && Math.abs(sumLines - gross) > 2) {
    confidence.vatLines = Math.min(confidence.vatLines!, 0.5);
  }
  return { fields, confidence, overall: clamp(c.overall) };
}

/**
 * Merges the rule-based result with the AI result: the AI wins for every field it is confident about,
 * rules fill the gaps and act as a cross-check (agreement boosts confidence).
 */
export function mergeExtractions(rules: ParseResult, ai: { fields: ExtractedFields; confidence: Record<string, number>; overall: number }): { fields: ExtractedFields; confidence: Record<string, number>; overall: number; warnings: string[] } {
  const fields: ExtractedFields = { ...ai.fields };
  const confidence: Record<string, number> = { ...ai.confidence };
  const warnings: string[] = [];
  const keys: (keyof ExtractedFields)[] = ["vendorName", "vendorUid", "vendorIban", "invoiceNumber", "invoiceDate", "dueDate", "grossCents", "netCents", "vatCents", "paymentMethod", "isPaid", "currency", "vendorAddress", "reverseCharge"];
  for (const k of keys) {
    const aiVal = ai.fields[k];
    const rVal = rules.fields[k];
    const aiConf = ai.confidence[k] ?? 0.7;
    const rConf = rules.confidence[k] ?? 0;
    if ((aiVal === null || aiVal === undefined) && rVal !== null && rVal !== undefined) {
      (fields as Record<string, unknown>)[k] = rVal;
      confidence[k] = rConf * 0.9;
    } else if (aiVal !== null && rVal !== null && rVal !== undefined) {
      const same = typeof aiVal === "string" && typeof rVal === "string" ? aiVal.trim().toLowerCase() === rVal.trim().toLowerCase() : aiVal === rVal;
      if (same) confidence[k] = Math.min(1, Math.max(aiConf, rConf) + 0.08);
      else if (rConf > aiConf + 0.25 && (k === "grossCents" || k === "invoiceDate" || k === "vendorUid" || k === "vendorIban")) {
        (fields as Record<string, unknown>)[k] = rVal;
        confidence[k] = rConf;
        warnings.push(`Feld ${k}: Regel-Parser (${String(rVal)}) hat KI-Wert (${String(aiVal)}) ersetzt.`);
      } else if (k === "grossCents" || k === "invoiceDate") {
        confidence[k] = Math.min(aiConf, 0.65);
        warnings.push(`Feld ${k}: KI (${String(aiVal)}) und Regel-Parser (${String(rVal)}) weichen ab – bitte prüfen.`);
      }
    }
  }
  if (!fields.vatLines.length && rules.fields.vatLines.length) {
    fields.vatLines = rules.fields.vatLines;
    confidence.vatLines = (rules.confidence.vatLines ?? 0.5) * 0.9;
  }
  const overall = overallConfidence(confidence);
  return { fields, confidence, overall: Math.round(Math.min(overall, ai.overall + 0.1) * 100) / 100, warnings };
}
