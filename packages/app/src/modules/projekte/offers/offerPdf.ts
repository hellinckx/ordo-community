/* Offer PDF with jsPDF, laid out like the old ERP offer: company block + meta box, "Angebot an", items table
   (title bold + description), discount, totals, Hinweis / Fertigstellung / Zahlungsbedingungen / Steuerhinweis,
   signature lines for the acceptance and a footer with company data on every page. */
import {
  formatCents,
  fillOfferPlaceholders,
  offerLineNetCents,
  offerPlaceholderValues,
  offerTotals,
  suggestOfferPaymentTerms,
  OFFER_KLEINUNTERNEHMER_NOTE,
  OFFER_REVERSE_CHARGE_NOTE,
  type Contact,
  type Offer,
  type Profile,
  type Project,
  type ProjectSettings,
} from "@ordo/core";

type JsPdf = import("jspdf").jsPDF;
type Rgb = [number, number, number];

export interface OfferPdfInput {
  offer: Offer;
  profile: Profile;
  customer?: Contact;
  project?: Project;
  settings: ProjectSettings;
  /** PNG or JPEG bytes of the company logo. */
  logo?: Uint8Array | null;
}

const PAGE_W = 210;
const M = 18;
const W = PAGE_W - 2 * M;
const CONTENT_BOTTOM = 268;
const TEXT: Rgb = [31, 41, 55];
const MUTED: Rgb = [107, 114, 128];
const SHADE: Rgb = [244, 246, 251];
const HAIRLINE: Rgb = [226, 230, 236];

/* Standard PDF fonts only know WinAnsi – replace what they cannot draw. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const FALLBACK: Record<string, string> = { "−": "-", "‑": "-", "‐": "-", " ": " ", " ": " ", " ": " ", "​": "", "­": "", "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≈": "~", "✓": "", "\t": " " };
function safe(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || (code >= 32 && code <= 255 && code !== 127) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else out += FALLBACK[ch] ?? "?";
  }
  return out;
}

function hexToRgb(hex: string | undefined, fallback: Rgb): Rgb {
  const h = (hex ?? "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

const money = (cents: number) => formatCents(cents);

/** "DE" → "Deutschland"; unknown codes stay as they are. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["de-AT"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
const qty = (n: number) => n.toLocaleString("de-AT", { maximumFractionDigits: 3 });

export async function offerPdf(input: OfferPdfInput): Promise<Uint8Array> {
  const { offer, profile, customer, project, settings, logo } = input;
  const { jsPDF } = await import("jspdf");
  const doc: JsPdf = new jsPDF({ unit: "mm", format: "a4" });
  const c = profile.company;
  const primary = hexToRgb(c.brandColor, [15, 23, 42]);
  const ku = profile.vatRegime === "kleinunternehmer";
  const totals = offerTotals(offer, { kleinunternehmer: ku });
  const companyName = c.name || profile.name;
  const ctx = {
    offer,
    companyName,
    customerName: customer?.name ?? "",
    projectName: project?.name ?? "",
    projectStart: project?.startDate,
    projectEnd: project?.endDate,
  };
  const values = offerPlaceholderValues(ctx);
  const fill = (t: string) => fillOfferPlaceholders(t, values).trim();

  let y = 0;

  /* ---------- drawing helpers ---------- */
  const font = (style: "normal" | "bold" | "italic", size: number, color: Rgb = TEXT) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const text = (t: string, x: number, yy: number, opts?: { align?: "left" | "right" | "center" }) => doc.text(safe(t), x, yy, opts);
  const wrap = (t: string, width: number): string[] => {
    const out: string[] = [];
    for (const para of safe(t).replace(/\r\n?/g, "\n").split("\n")) {
      if (!para.trim()) {
        out.push("");
        continue;
      }
      out.push(...(doc.splitTextToSize(para, width) as string[]));
    }
    return out;
  };
  const lineH = (size: number) => size * 0.4233 * 1.22; // pt → mm × line spacing

  const secondaryHeader = () => {
    y = 22;
    font("bold", 13, primary);
    text(`Angebot ${offer.number}`, M, y);
    y += 8;
  };
  const newPage = () => {
    doc.addPage();
    secondaryHeader();
  };
  const ensure = (h: number) => {
    if (y + h > CONTENT_BOTTOM) {
      newPage();
      return true;
    }
    return false;
  };

  /* ---------- header: logo, company, meta ---------- */
  let logoW = 0;
  let logoBottom = 14;
  if (logo && logo.length > 8) {
    try {
      const isJpeg = logo[0] === 0xff && logo[1] === 0xd8;
      const props = doc.getImageProperties(logo);
      const ratio = props.width / Math.max(1, props.height);
      let w = 40;
      let h = w / ratio;
      if (h > 20) {
        h = 20;
        w = h * ratio;
      }
      doc.addImage(logo, isJpeg ? "JPEG" : "PNG", M, 14, w, h, undefined, "FAST");
      logoW = w;
      logoBottom = 14 + h;
    } catch {
      logoW = 0;
    }
  }
  let infoY: number;
  let infoX: number;
  if (logoW) {
    infoX = M + logoW + 7;
    infoY = 17;
    font("bold", 10.5, primary);
    text(companyName, infoX, infoY);
    infoY += 5;
  } else {
    infoX = M;
    font("bold", 17, primary);
    text(companyName, M, 21);
    infoY = 27;
  }
  const contactLines = [
    c.owner ?? "",
    c.street,
    [[c.zip, c.city].filter(Boolean).join(" "), c.country && c.country !== "AT" ? countryName(c.country) : ""].filter(Boolean).join(", "),
    c.email,
    c.phone,
    (c.website ?? "").replace(/^https?:\/\//i, ""),
  ].filter((s) => s && s.trim());
  font("normal", 8.5, MUTED);
  const infoMaxW = PAGE_W - M - 62 - infoX;
  for (const l of contactLines) {
    for (const part of wrap(l, Math.max(40, infoMaxW))) {
      text(part, infoX, infoY);
      infoY += 3.9;
    }
  }
  const meta: [string, string][] = [
    ["Angebotsnummer", offer.number || "–"],
    ["Angebotsdatum", fmtDate(offer.date)],
    ["Gültig bis", fmtDate(offer.validUntil)],
  ];
  if (c.uid) meta.push(["UID", c.uid]);
  let metaY = 16;
  for (const [label, value] of meta) {
    font("normal", 7, MUTED);
    text(label.toUpperCase(), PAGE_W - M, metaY, { align: "right" });
    font("bold", 10, TEXT);
    text(value, PAGE_W - M, metaY + 4.6, { align: "right" });
    metaY += 10;
  }
  y = Math.max(infoY, metaY - 4, logoBottom) + 9;
  font("bold", 22, primary);
  text("Angebot", M, y);
  y += 10;

  /* ---------- recipient + subject ---------- */
  const top = y;
  font("bold", 9, MUTED);
  text("Angebot an", M, y);
  let ly = y + 5.2;
  const addr = customer
    ? [
        [customer.name, "bold"],
        [customer.street, "normal"],
        [[customer.zip, customer.city].filter(Boolean).join(" "), "normal"],
        [customer.country && customer.country !== "AT" ? countryName(customer.country) : "", "normal"],
        [customer.uid ? `UID: ${customer.uid}` : "", "normal"],
      ]
    : [["–", "normal"]];
  for (const [t, style] of addr as [string, "bold" | "normal"][]) {
    if (!t) continue;
    font(style, 10, TEXT);
    for (const part of wrap(t, W / 2 - 4)) {
      text(part, M, ly);
      ly += 4.6;
    }
  }
  let ry = top;
  const rightW = 74;
  const side: [string, string][] = [];
  if (offer.subject.trim()) side.push(["Betreff", offer.subject.trim()]);
  if (project) side.push(["Projekt", [project.number, project.name].filter(Boolean).join(" · ")]);
  for (const [label, value] of side) {
    font("normal", 7, MUTED);
    text(label.toUpperCase(), PAGE_W - M, ry, { align: "right" });
    ry += 4.4;
    font("normal", 10, TEXT);
    for (const part of wrap(value, rightW)) {
      text(part, PAGE_W - M, ry, { align: "right" });
      ry += 4.4;
    }
    ry += 2;
  }
  y = Math.max(ly, ry) + 6;

  /* ---------- intro ---------- */
  const intro = fill(offer.introText);
  if (intro) {
    font("normal", 10, TEXT);
    for (const l of wrap(intro, W)) {
      ensure(lineH(10));
      text(l, M, y);
      y += lineH(10);
    }
    y += 3;
  }

  /* ---------- items table ---------- */
  const colPos = 10;
  const colQty = 26;
  const colPrice = 28;
  const colTotal = 30;
  const colDesc = W - colPos - colQty - colPrice - colTotal;
  const xDesc = M + colPos;
  const xQtyR = xDesc + colDesc + colQty - 2;
  const xPriceR = xQtyR + colPrice;
  const xTotalR = PAGE_W - M - 2.5;
  const tableHeader = () => {
    ensure(18);
    doc.setFillColor(primary[0], primary[1], primary[2]);
    doc.rect(M, y, W, 8, "F");
    font("bold", 7.5, [255, 255, 255]);
    const ty = y + 5.2;
    text("POS", M + 2.5, ty);
    text("BESCHREIBUNG", xDesc + 1, ty);
    text("MENGE", xQtyR, ty, { align: "right" });
    text("EINZELPREIS", xPriceR, ty, { align: "right" });
    text("GESAMT", xTotalR, ty, { align: "right" });
    y += 10;
  };
  tableHeader();

  const PAD = 2.4;
  const TITLE_LH = lineH(9.5);
  const DESC_LH = lineH(9);
  const drawRow = (r: { pos: string; title: string; description: string; italicNote?: string; qty: string; price: string; total: string; shade: boolean; boldTotal?: boolean }) => {
    const titleLines = r.title ? wrap(r.title, colDesc - 4) : [];
    font("normal", 9, TEXT);
    const descLines = r.description ? wrap(r.description, colDesc - 4) : [];
    const noteLines = r.italicNote ? [r.italicNote] : [];
    const contentH = titleLines.length * TITLE_LH + descLines.length * DESC_LH + noteLines.length * DESC_LH;
    const rowH = Math.max(contentH + 2 * PAD, 9);
    if (y + rowH > CONTENT_BOTTOM) {
      // a row that does not fit moves to the next page; only really long ones are split
      if (rowH <= CONTENT_BOTTOM - 40) {
        newPage();
        tableHeader();
      }
    }
    const fitsWhole = y + rowH <= CONTENT_BOTTOM;
    if (r.shade && fitsWhole) {
      doc.setFillColor(SHADE[0], SHADE[1], SHADE[2]);
      doc.rect(M, y, W, rowH, "F");
    }
    const firstBase = y + PAD + 3.2;
    font("normal", 9, TEXT);
    text(r.pos, M + 2.5, firstBase);
    text(r.qty, xQtyR, firstBase, { align: "right" });
    text(r.price, xPriceR, firstBase, { align: "right" });
    font(r.boldTotal === false ? "normal" : "bold", 9.5, TEXT);
    text(r.total, xTotalR, firstBase, { align: "right" });
    let ty = firstBase;
    const flow = (lh: number) => {
      ty += lh;
      if (ty > CONTENT_BOTTOM) {
        newPage();
        tableHeader();
        ty = y + PAD + 3.2;
      }
    };
    titleLines.forEach((l, i) => {
      if (i > 0) flow(TITLE_LH);
      font("bold", 9.5, TEXT);
      text(l, xDesc + 1, ty);
    });
    descLines.forEach((l, i) => {
      if (i > 0 || titleLines.length) flow(i === 0 ? TITLE_LH : DESC_LH);
      font("normal", 9, [55, 65, 81]);
      text(l, xDesc + 1, ty);
    });
    noteLines.forEach((l) => {
      if (titleLines.length || descLines.length) flow(DESC_LH);
      font("italic", 8.5, MUTED);
      text(l, xDesc + 1, ty);
    });
    y = Math.max(y + (fitsWhole ? rowH : 0), ty + PAD + 1.5);
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.setLineWidth(0.15);
    doc.line(M, y, PAGE_W - M, y);
  };

  let pos = 0;
  offer.lines.forEach((l, i) => {
    pos++;
    const net = offerLineNetCents(l);
    drawRow({
      pos: String(pos),
      title: l.title || (l.description ? "" : "Position"),
      description: l.description,
      italicNote: l.optional ? "Optional – nicht in der Summe enthalten" : undefined,
      qty: `${qty(l.quantity)} ${l.unit}`.trim(),
      price: money(l.unitNetCents),
      total: l.optional ? `(${money(net)})` : money(net),
      shade: i % 2 === 1,
      boldTotal: !l.optional,
    });
  });

  if (totals.discountNetCents > 0) {
    const label = [`${String(totals.discountPct).replace(".", ",")} %`, offer.discountText.trim()].filter(Boolean).join(" · ");
    drawRow({ pos: "", title: "Rabatt", description: label, qty: "", price: "", total: money(-totals.discountNetCents), shade: false });
  }

  const sumRow = (label: string, value: string, bold: boolean, size = 9.5) => {
    const h = 7.5;
    ensure(h + 2);
    doc.setFillColor(SHADE[0], SHADE[1], SHADE[2]);
    doc.rect(M, y, W, h, "F");
    font(bold ? "bold" : "normal", size, TEXT);
    text(label, xDesc + 1, y + 5);
    text(value, xTotalR, y + 5, { align: "right" });
    y += h;
    doc.setDrawColor(210, 216, 225);
    doc.setLineWidth(0.2);
    doc.line(M, y, PAGE_W - M, y);
  };
  y += 1;
  sumRow("Zwischensumme netto", money(totals.netCents), true);
  if (totals.noVat) {
    sumRow(ku ? "Umsatzsteuer (befreit)" : "Umsatzsteuer (Reverse Charge)", money(0), false);
  } else {
    for (const r of totals.byRate) if (r.rate > 0) sumRow(`Umsatzsteuer ${r.rate} %`, money(r.vatCents), false);
  }
  sumRow("Gesamt brutto", money(totals.grossCents), true, 11);
  y += 2;

  /* ---------- text sections ---------- */
  const section = (title: string, body: string) => {
    const t = body.trim();
    if (!t) return;
    font("normal", 9.5, TEXT);
    const lines = wrap(t, W);
    ensure(8 + Math.min(lines.length, 3) * lineH(9.5));
    y += 6;
    font("bold", 10.5, primary);
    text(title, M, y);
    y += 5.2;
    font("normal", 9.5, TEXT);
    for (const l of lines) {
      if (ensure(lineH(9.5))) font("normal", 9.5, TEXT);
      if (l) text(l, M, y);
      y += l ? lineH(9.5) : 1.6;
    }
  };
  section("Hinweis", fill(offer.scopeText));
  section("Fertigstellung", fill(offer.completionText));
  section("Zahlungsbedingungen", offer.paymentTermsText.trim() ? fill(offer.paymentTermsText) : suggestOfferPaymentTerms(settings.offerPaymentTermsText, ctx));
  if (offer.reverseCharge) section("Steuerhinweis", `${OFFER_REVERSE_CHARGE_NOTE}${customer?.uid ? ` UID des Leistungsempfängers: ${customer.uid}.` : ""}`);
  else if (ku) section("Steuerhinweis", OFFER_KLEINUNTERNEHMER_NOTE);

  /* ---------- acceptance ---------- */
  const labels = ["Ort, Datum", "Unternehmen", "Name, Funktion", "Unterschrift Auftraggeber"];
  ensure(14 + labels.length * 9);
  y += 9;
  font("bold", 10.5, primary);
  text("Annahme des Angebotes", M, y);
  y += 9;
  for (const label of labels) {
    font("normal", 9.5, TEXT);
    text(`${label}:`, M, y);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.line(M + 48, y + 0.8, PAGE_W - M, y + 0.8);
    y += 9;
  }

  /* ---------- footer on every page ---------- */
  const legal = fill(settings.offerFooterText ?? "");
  const register = c.registerNumber ? `FB: ${[c.registerNumber, c.registerCourt].filter(Boolean).join(", ")}` : "";
  const footerParts = [
    companyName,
    [c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    c.uid ? `UID ${c.uid}` : "",
    register,
    c.iban ? `IBAN ${c.iban}${c.bic ? ` · BIC ${c.bic}` : ""}${c.bankName ? ` · ${c.bankName}` : ""}` : "",
    [c.email, c.phone].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.setLineWidth(0.3);
    doc.line(M, 274, PAGE_W - M, 274);
    let fy = 278.5;
    font("normal", 7.5, MUTED);
    text(`Seite ${i} von ${pages}`, PAGE_W - M, fy, { align: "right" });
    if (legal) {
      for (const l of wrap(legal, W - 28).slice(0, 2)) {
        text(l, M, fy);
        fy += 3.4;
      }
    }
    font("normal", 7, MUTED);
    for (const l of wrap(footerParts.join(" · "), legal ? W : W - 28).slice(0, 3)) {
      text(l, M, fy);
      fy += 3.2;
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
