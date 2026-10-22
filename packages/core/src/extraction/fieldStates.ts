import type { Extraction, Mode } from "../model/types";

export type FieldStateKey = "date" | "gross" | "partner" | "vat" | "category" | "invoiceNumber";
export type FieldStateLevel = "ok" | "unsure" | "missing";

export interface FieldState {
  key: FieldStateKey;
  label: string;
  state: FieldStateLevel;
  /** DOM id of the matching input in TransactionForm (for click-to-focus). */
  inputId: string;
  confidence: number;
}

/** DOM ids used by TransactionForm so the review strip can focus a field. */
export const FIELD_INPUT_IDS: Record<FieldStateKey, string> = {
  date: "tf-date",
  gross: "tf-gross",
  partner: "tf-contact",
  vat: "tf-vat",
  category: "tf-category",
  invoiceNumber: "tf-invoiceNumber",
};

const OK = 0.85;
const OK_CATEGORY = 0.75;

/**
 * Per-field verdict for the review screen: "ok" (recognised with confidence), "unsure" (value present but
 * shaky) or "missing" (nothing found). Derived from the extraction only – user edits are tracked by the UI.
 */
export function fieldStates(ex: Extraction | undefined, opts: { mode: Mode; vatRegime?: string }): FieldState[] {
  if (!ex) return [];
  const f = ex.fields;
  const c = ex.confidence;
  const outgoing = f.direction === "outgoing";
  const level = (present: boolean, conf: number | undefined, ok = OK): FieldStateLevel => (!present ? "missing" : (conf ?? 0) >= ok ? "ok" : "unsure");
  const out: FieldState[] = [
    { key: "date", label: "Datum", state: level(f.invoiceDate !== null, c.invoiceDate), inputId: FIELD_INPUT_IDS.date, confidence: c.invoiceDate ?? 0 },
    { key: "gross", label: "Betrag", state: level(f.grossCents !== null && f.grossCents !== 0, c.grossCents), inputId: FIELD_INPUT_IDS.gross, confidence: c.grossCents ?? 0 },
    {
      key: "partner",
      label: outgoing ? "Kunde" : "Lieferant",
      state: level(!!(outgoing ? f.customerName : f.vendorName), outgoing ? (c.customerName ?? c.vendorName) : c.vendorName),
      inputId: FIELD_INPUT_IDS.partner,
      confidence: (outgoing ? (c.customerName ?? c.vendorName) : c.vendorName) ?? 0,
    },
    { key: "category", label: "Kategorie", state: level(true, c.category, OK_CATEGORY), inputId: FIELD_INPUT_IDS.category, confidence: c.category ?? 0 },
  ];
  if (opts.mode === "business" && opts.vatRegime !== "kleinunternehmer") {
    out.push({ key: "vat", label: "USt-Satz", state: level(f.vatLines.length > 0 || f.reverseCharge === true, c.vatLines), inputId: FIELD_INPUT_IDS.vat, confidence: c.vatLines ?? 0 });
  }
  if (f.documentType === "invoice" || f.documentType === "credit_note") {
    out.push({ key: "invoiceNumber", label: "Rechnungsnummer", state: level(!!f.invoiceNumber, c.invoiceNumber), inputId: FIELD_INPUT_IDS.invoiceNumber, confidence: c.invoiceNumber ?? 0 });
  }
  return out;
}
