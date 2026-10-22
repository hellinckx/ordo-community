/**
 * JSON schema for AI structured output (OpenAI/Codex strict mode compatible: every property required,
 * nullable via type unions, additionalProperties false).
 */
export const AI_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "document_type",
    "direction",
    "vendor_name",
    "vendor_uid",
    "vendor_address",
    "vendor_iban",
    "customer_name",
    "invoice_number",
    "invoice_date",
    "due_date",
    "service_date",
    "currency",
    "gross_total",
    "net_total",
    "vat_total",
    "vat_lines",
    "payment_method",
    "is_paid",
    "description",
    "line_items",
    "suggested_category",
    "reverse_charge",
    "confidence",
    "notes",
  ],
  properties: {
    document_type: { type: "string", enum: ["invoice", "receipt", "credit_note", "bank_statement", "salary_slip", "other"] },
    direction: { type: "string", enum: ["incoming", "outgoing", "unknown"], description: "incoming = we received this document and have to pay (expense); outgoing = we issued it (income)" },
    vendor_name: { type: ["string", "null"], description: "Name of the issuing company / merchant" },
    vendor_uid: { type: ["string", "null"], description: "VAT id of the issuer, e.g. ATU12345678" },
    vendor_address: { type: ["string", "null"] },
    vendor_iban: { type: ["string", "null"] },
    customer_name: { type: ["string", "null"], description: "Addressee of the invoice if printed" },
    invoice_number: { type: ["string", "null"] },
    invoice_date: { type: ["string", "null"], description: "ISO date YYYY-MM-DD" },
    due_date: { type: ["string", "null"], description: "ISO date YYYY-MM-DD" },
    service_date: { type: ["string", "null"], description: "Leistungsdatum / Leistungszeitraum as printed" },
    currency: { type: ["string", "null"], description: "ISO 4217, e.g. EUR" },
    gross_total: { type: ["number", "null"], description: "Total amount including VAT in currency units with 2 decimals" },
    net_total: { type: ["number", "null"] },
    vat_total: { type: ["number", "null"] },
    vat_lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rate", "net", "vat"],
        properties: {
          rate: { type: "number", description: "VAT rate in percent (0, 10, 13, 20)" },
          net: { type: ["number", "null"] },
          vat: { type: ["number", "null"] },
        },
      },
    },
    payment_method: { type: ["string", "null"], enum: ["bank", "cash", "card", "paypal", "direct_debit", "other", null] },
    is_paid: { type: ["boolean", "null"], description: "true if the receipt shows payment was completed (e.g. cash register receipt, 'bezahlt')" },
    description: { type: ["string", "null"], description: "Short German description of what was bought (max 80 chars)" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unit_price", "total", "vat_rate"],
        properties: {
          description: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unit_price: { type: ["number", "null"] },
          total: { type: ["number", "null"] },
          vat_rate: { type: ["number", "null"] },
        },
      },
    },
    suggested_category: { type: ["string", "null"], description: "One of the category names given in the prompt, or null" },
    reverse_charge: { type: ["boolean", "null"], description: "true if the invoice states reverse charge / Steuerschuldnerschaft des Leistungsempfängers" },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["overall", "vendor_name", "invoice_date", "gross_total", "vat_lines", "invoice_number"],
      properties: {
        overall: { type: "number" },
        vendor_name: { type: "number" },
        invoice_date: { type: "number" },
        gross_total: { type: "number" },
        vat_lines: { type: "number" },
        invoice_number: { type: "number" },
      },
    },
    notes: { type: ["string", "null"], description: "Anything unusual (handwritten, partially unreadable, foreign currency ...)" },
  },
} as const;

export interface AiOutput {
  document_type: "invoice" | "receipt" | "credit_note" | "bank_statement" | "salary_slip" | "other";
  direction: "incoming" | "outgoing" | "unknown";
  vendor_name: string | null;
  vendor_uid: string | null;
  vendor_address: string | null;
  vendor_iban: string | null;
  customer_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  service_date: string | null;
  currency: string | null;
  gross_total: number | null;
  net_total: number | null;
  vat_total: number | null;
  vat_lines: { rate: number; net: number | null; vat: number | null }[];
  payment_method: "bank" | "cash" | "card" | "paypal" | "direct_debit" | "other" | null;
  is_paid: boolean | null;
  description: string | null;
  line_items: { description: string | null; quantity: number | null; unit_price: number | null; total: number | null; vat_rate: number | null }[];
  suggested_category: string | null;
  reverse_charge: boolean | null;
  confidence: { overall: number; vendor_name: number; invoice_date: number; gross_total: number; vat_lines: number; invoice_number: number };
  notes: string | null;
}

export interface PromptCategory {
  name: string;
  kind: "income" | "expense";
  /** A few example keywords (vendors, products) that help the model pick the right category. */
  keywords?: string[];
}

export function buildExtractionPrompt(opts: { categories: PromptCategory[]; ocrText?: string; ownCompanyName?: string; ownUid?: string; mode: "employee" | "business" }): string {
  const lines: string[] = [];
  lines.push("Du bist ein präziser Buchhaltungs-Assistent (Österreich und Deutschland). Analysiere den beigefügten Beleg (Rechnung, Kassenbon, Gutschrift, Kontoauszug oder ähnliches) und extrahiere die Daten als JSON gemäß Schema.");
  lines.push("Regeln:");
  lines.push("- Beträge als Zahlen in der Belegwährung mit 2 Dezimalstellen (12,50 € → 12.5). Deutsche Zahlenformate (1.234,56) korrekt interpretieren.");
  lines.push("- Datumsangaben als ISO (YYYY-MM-DD). Auf Rechnungen steht meist TT.MM.JJJJ.");
  lines.push("- vat_lines: eine Zeile je Steuersatz (A/B/C-Kennzeichnungen auf Kassenbons: A = 20 %, B = 10 %, C = 13 % sind üblich, aber prüfe die Legende). net + vat = brutto je Satz.");
  lines.push("- gross_total ist der tatsächlich zu zahlende Gesamtbetrag (Summe/Gesamt/Total/zu zahlen).");
  lines.push("- vendor_name ist der Aussteller/Händler, nicht der Empfänger.");
  if (opts.ownCompanyName) lines.push(`- Der Nutzer heißt „${opts.ownCompanyName}“${opts.ownUid ? ` (UID ${opts.ownUid})` : ""}. Wenn dieser Name als Aussteller steht, ist direction = outgoing (Einnahme), sonst incoming (Ausgabe).`);
  else lines.push("- direction: incoming wenn der Beleg eine Ausgabe des Nutzers ist (Standardfall), outgoing wenn der Nutzer selbst der Aussteller ist.");
  lines.push("- is_paid: true bei Kassenbons/Zahlungsbestätigungen, null wenn unklar.");
  lines.push("- reverse_charge: true wenn „Reverse Charge“, „Steuerschuldnerschaft des Leistungsempfängers“ oder „VAT reverse charged“ aufgedruckt ist.");
  lines.push("- confidence-Werte zwischen 0 und 1; sei ehrlich bei schlechter Lesbarkeit.");
  lines.push("- Antworte ausschließlich mit dem JSON-Objekt.");
  if (opts.categories.length) {
    const fmt = (c: PromptCategory) => (c.keywords?.length ? `${c.name} (z. B. ${c.keywords.slice(0, 5).join(", ")})` : c.name);
    const expense = opts.categories.filter((c) => c.kind === "expense").map(fmt);
    const income = opts.categories.filter((c) => c.kind === "income").map(fmt);
    lines.push(`- suggested_category: wähle exakt einen Namen aus der passenden Liste (${opts.mode === "business" ? "Unternehmer" : "Angestellte"}) oder null, wenn nichts passt. Die Beispiele in Klammern sind typische Händler/Produkte.`);
    if (expense.length) lines.push(`  Ausgaben: ${expense.join(" | ")}`);
    if (income.length) lines.push(`  Einnahmen: ${income.join(" | ")}`);
  }
  if (opts.ocrText && opts.ocrText.trim()) {
    lines.push("");
    lines.push("Zusätzlich steht dir ein lokaler OCR-/Text-Extrakt des Dokuments zur Verfügung (kann Fehler enthalten, Bild hat Vorrang):");
    lines.push("<ocr>");
    lines.push(opts.ocrText.slice(0, 12000));
    lines.push("</ocr>");
  }
  return lines.join("\n");
}
