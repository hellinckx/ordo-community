/**
 * PDF reports and invoice documents via jsPDF (browser). All text is German.
 */
import type { Invoice, Profile } from "../model/types";
import { formatCents } from "../model/money";
import { invoiceTotals } from "../analytics/stats";
import type { UvaResult } from "../tax/at/uva";
import type { E1aResult } from "../tax/at/e1a";
import type { L1Result } from "../tax/at/l1";
import type { DerivedEntry } from "../accounting/posting";
import { accountName } from "../accounting/chart";

type JsPdf = import("jspdf").jsPDF;

async function newDoc(): Promise<JsPdf> {
  const { jsPDF } = await import("jspdf");
  await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "normal");
  return doc;
}

type AutoTable = (doc: JsPdf, opts: Record<string, unknown>) => void;
async function autoTable(): Promise<AutoTable> {
  const mod = await import("jspdf-autotable");
  return (mod.default ?? (mod as unknown as { autoTable: AutoTable }).autoTable) as AutoTable;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function header(doc: JsPdf, title: string, subtitle: string, profile: Profile) {
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, 18);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90);
  doc.text(subtitle, 14, 24);
  const right = [profile.company.name || profile.name, profile.company.uid ? `UID ${profile.company.uid}` : "", profile.company.steuernummer ? `St.Nr. ${profile.company.steuernummer}` : ""].filter(Boolean);
  right.forEach((t, i) => doc.text(t, 196, 14 + i * 5, { align: "right" }));
  doc.setTextColor(0);
  doc.setDrawColor(200);
  doc.line(14, 28, 196, 28);
}

function footer(doc: JsPdf) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Erstellt mit Ordo am ${new Date().toLocaleDateString("de-AT")} · Seite ${i}/${pages}`, 14, 290);
    doc.setTextColor(0);
  }
}

export async function uvaPdf(result: UvaResult, profile: Profile): Promise<Uint8Array> {
  const doc = await newDoc();
  const table = await autoTable();
  header(doc, "Umsatzsteuervoranmeldung (U 30)", `${result.period.label} · ${result.period.from} bis ${result.period.to} · Fällig am ${fmtDate(result.period.dueDate)} · ${result.info.basis === "ist" ? "Istbesteuerung" : "Sollbesteuerung"}`, profile);
  table(doc, {
    startY: 34,
    head: [["KZ", "Bezeichnung", "Bemessungsgrundlage", "Steuer"]],
    body: result.lines.map((l) => [l.kz, l.label, l.baseCents !== undefined ? formatCents(l.baseCents) : "", l.taxCents !== undefined ? formatCents(l.taxCents) : ""]),
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [15, 118, 110] },
    columnStyles: { 0: { cellWidth: 12, fontStyle: "bold" }, 2: { halign: "right", cellWidth: 34 }, 3: { halign: "right", cellWidth: 28 } },
  });
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(`Umsatzsteuer: ${formatCents(result.totals.umsatzsteuer)}`, 14, y);
  doc.text(`Vorsteuer: ${formatCents(result.totals.vorsteuer)}`, 14, y + 6);
  doc.text(`${result.totals.zahllast >= 0 ? "Zahllast" : "Gutschrift"} (KZ 095): ${formatCents(Math.abs(result.totals.zahllast))}`, 14, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  result.warnings.forEach((w, i) => doc.text(`• ${w}`, 14, y + 20 + i * 4));
  footer(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function e1aPdf(result: E1aResult, profile: Profile): Promise<Uint8Array> {
  const doc = await newDoc();
  const table = await autoTable();
  header(doc, `Einnahmen-Ausgaben-Rechnung ${result.year}`, `Beilage E 1a · ${result.info.pauschalierung === "none" ? "ohne Pauschalierung" : result.info.pauschalierung === "basis" ? "Basispauschalierung" : "Kleinunternehmerpauschalierung"} · USt-${result.info.ustSystem === "brutto" ? "Brutto" : "Netto"}system`, profile);
  table(doc, {
    startY: 34,
    head: [["KZ", "Bezeichnung", "Betrag"]],
    body: result.lines.map((l) => [l.kz, l.label, formatCents(l.amountCents)]),
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [15, 118, 110] },
    columnStyles: { 0: { cellWidth: 14, fontStyle: "bold" }, 2: { halign: "right", cellWidth: 34 } },
  });
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  const rows = [
    ["Betriebseinnahmen", formatCents(result.einnahmenCents)],
    ["Betriebsausgaben", formatCents(result.ausgabenCents)],
    ["Pauschalierte Betriebsausgaben", formatCents(result.pauschaleCents)],
    ["Gewinn vor Gewinnfreibetrag", formatCents(result.gewinnVorFreibetragCents)],
    ["Grundfreibetrag (KZ 9221)", formatCents(result.grundfreibetragCents)],
    ["Investitionsbedingter Gewinnfreibetrag (KZ 9227)", formatCents(result.investFreibetragCoveredCents)],
    ["Gewinn (steuerpflichtig)", formatCents(result.gewinnCents)],
    ["Einkommensteuer-Schätzung (nur Betrieb, ohne Absetzbeträge)", formatCents(result.estSchaetzungCents)],
  ];
  rows.forEach(([a, b], i) => {
    doc.setFont("helvetica", i === 6 ? "bold" : "normal");
    doc.text(a!, 14, y + i * 6);
    doc.text(b!, 196, y + i * 6, { align: "right" });
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  result.warnings.forEach((w, i) => doc.text(`• ${w}`.slice(0, 150), 14, y + rows.length * 6 + 4 + i * 4));
  footer(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function l1Pdf(result: L1Result, profile: Profile): Promise<Uint8Array> {
  const doc = await newDoc();
  const table = await autoTable();
  header(doc, `Arbeitnehmerveranlagung ${result.year}`, "Kennzahlen für L 1 / L 1ab / L 1d – zum Übertragen in FinanzOnline", profile);
  table(doc, {
    startY: 34,
    head: [["KZ", "Bezeichnung", "Betrag", "Hinweis"]],
    body: result.lines.map((l) => [l.kz, l.label, formatCents(l.amountCents), l.note ?? ""]),
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: { 0: { cellWidth: 12, fontStyle: "bold" }, 2: { halign: "right", cellWidth: 28 }, 3: { cellWidth: 50 } },
  });
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  const rows = [
    ["Werbungskosten gesamt", formatCents(result.werbungskostenCents)],
    ["Sonderausgaben gesamt", formatCents(result.sonderausgabenCents)],
    ["Außergewöhnliche Belastungen (mit Selbstbehalt)", formatCents(result.agbMitSelbstbehaltCents)],
    [`Geschätzter Selbstbehalt (${result.selbstbehaltPct} %)`, formatCents(result.selbstbehaltCents)],
    ["Außergewöhnliche Belastungen (ohne Selbstbehalt)", formatCents(result.agbOhneSelbstbehaltCents)],
    [`Geschätzte Steuerersparnis (Grenzsteuersatz ${Math.round(result.marginalRate * 100)} %)`, formatCents(result.estimatedRefundCents)],
  ];
  rows.forEach(([a, b], i) => {
    doc.setFont("helvetica", i === rows.length - 1 ? "bold" : "normal");
    doc.text(a!, 14, y + i * 6);
    doc.text(b!, 196, y + i * 6, { align: "right" });
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  result.warnings.forEach((w, i) => doc.text(`• ${w}`.slice(0, 150), 14, y + rows.length * 6 + 4 + i * 4));
  footer(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function journalPdf(entries: DerivedEntry[], profile: Profile, title = "Buchungsjournal"): Promise<Uint8Array> {
  const doc = await newDoc();
  const table = await autoTable();
  header(doc, title, `${entries.length} Buchungen`, profile);
  const body: (string | number)[][] = [];
  for (const e of entries) {
    e.lines.forEach((l, i) => {
      body.push([i === 0 ? e.number : "", i === 0 ? fmtDate(e.date) : "", l.text || e.description, `${l.account} ${accountName(l.account)}`, l.debitCents ? formatCents(l.debitCents) : "", l.creditCents ? formatCents(l.creditCents) : ""]);
    });
  }
  table(doc, {
    startY: 34,
    head: [["Nr.", "Datum", "Text", "Konto", "Soll", "Haben"]],
    body,
    styles: { fontSize: 7, cellPadding: 1 },
    headStyles: { fillColor: [15, 118, 110] },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 18 }, 4: { halign: "right", cellWidth: 24 }, 5: { halign: "right", cellWidth: 24 } },
  });
  footer(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function tablePdf(title: string, subtitle: string, profile: Profile, head: string[], body: (string | number)[][], rightAligned: number[] = []): Promise<Uint8Array> {
  const doc = await newDoc();
  const table = await autoTable();
  header(doc, title, subtitle, profile);
  const columnStyles: Record<number, { halign: "right" }> = {};
  for (const i of rightAligned) columnStyles[i] = { halign: "right" };
  table(doc, { startY: 34, head: [head], body, styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [15, 118, 110] }, columnStyles });
  footer(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

/**
 * Ausgangsrechnung nach § 11 UStG: Name/Anschrift beider Parteien, Menge/Bezeichnung, Leistungsdatum,
 * Entgelt je Steuersatz, Steuerbetrag, Ausstellungsdatum, fortlaufende Nummer, UID.
 */
export async function invoicePdf(inv: Invoice, profile: Profile, logoPng?: Uint8Array): Promise<Uint8Array> {
  const doc = await newDoc();
  const table = await autoTable();
  const c = profile.company;
  const totals = invoiceTotals(inv);
  const isKu = profile.vatRegime === "kleinunternehmer" || inv.vatTreatment === "kleinunternehmer";
  const titleMap = { invoice: "Rechnung", credit_note: "Gutschrift", offer: "Angebot" } as const;

  if (logoPng) {
    try {
      doc.addImage(logoPng, "PNG", 150, 12, 46, 18, undefined, "FAST");
    } catch {
      /* ignore broken logo */
    }
  }
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${c.name || profile.name}${c.street ? " · " + c.street : ""}${c.zip || c.city ? " · " + [c.zip, c.city].filter(Boolean).join(" ") : ""}`, 20, 40);
  doc.setTextColor(0);
  doc.setFontSize(11);
  const cs = inv.customerSnapshot;
  const addr = [cs.name, cs.street, [cs.zip, cs.city].filter(Boolean).join(" "), cs.country && cs.country !== "AT" ? cs.country : "", cs.uid ? `UID: ${cs.uid}` : ""].filter(Boolean);
  addr.forEach((t, i) => doc.text(t, 20, 48 + i * 5.5));

  doc.setFontSize(9);
  const meta = [
    [`${titleMap[inv.kind]}snummer`, inv.number],
    ["Rechnungsdatum", fmtDate(inv.issueDate)],
    ["Fällig bis", fmtDate(inv.dueDate)],
    ["Leistungszeitraum", inv.servicePeriod || fmtDate(inv.issueDate)],
    ...(inv.reference ? [["Referenz", inv.reference]] : []),
  ];
  meta.forEach(([k, v], i) => {
    doc.setTextColor(110);
    doc.text(k!, 130, 48 + i * 5.5);
    doc.setTextColor(0);
    doc.text(v!, 196, 48 + i * 5.5, { align: "right" });
  });

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`${titleMap[inv.kind]} ${inv.number}`, 20, 86);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  let y = 94;
  if (inv.introText) {
    const lines = doc.splitTextToSize(inv.introText, 176) as string[];
    doc.text(lines, 20, y);
    y += lines.length * 5 + 4;
  }
  table(doc, {
    startY: y,
    margin: { left: 20, right: 14 },
    head: [["Pos.", "Bezeichnung", "Menge", "Einheit", "Einzelpreis", isKu || inv.vatTreatment !== "standard" ? "" : "USt", "Betrag"]],
    body: inv.lines.map((l, i) => {
      const net = Math.round(l.quantity * l.unitNetCents * (1 - (l.discountPct || 0) / 100));
      return [i + 1, l.description + (l.discountPct ? ` (-${l.discountPct} %)` : ""), l.quantity.toLocaleString("de-AT"), l.unit, formatCents(l.unitNetCents), isKu || inv.vatTreatment !== "standard" ? "" : `${l.vatRate} %`, formatCents(net)];
    }),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { cellWidth: 12 }, 2: { halign: "right", cellWidth: 18 }, 3: { cellWidth: 18 }, 4: { halign: "right", cellWidth: 26 }, 5: { halign: "right", cellWidth: 16 }, 6: { halign: "right", cellWidth: 28 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const sumRows: [string, string, boolean][] = [];
  if (inv.discountPct) {
    // totals are after the discount; show the amount before and the discount itself
    const before = Math.round(totals.netCents / (1 - inv.discountPct / 100));
    sumRows.push(["Zwischensumme", formatCents(before), false]);
    sumRows.push([`${inv.discountText || "Rabatt"} (-${inv.discountPct.toLocaleString("de-AT")} %)`, formatCents(totals.netCents - before), false]);
  }
  sumRows.push(["Nettobetrag", formatCents(totals.netCents), false]);
  for (const r of totals.byRate) if (r.rate > 0) sumRows.push([`zzgl. ${r.rate} % USt`, formatCents(r.vatCents), false]);
  sumRows.push([inv.kind === "credit_note" ? "Gutschriftsbetrag" : "Rechnungsbetrag", formatCents(totals.grossCents), true]);
  sumRows.forEach(([k, v, bold]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11 : 10);
    doc.text(k, 130, y);
    doc.text(v, 196, y, { align: "right" });
    y += 6;
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y += 4;
  const notes: string[] = [];
  if (isKu) notes.push("Umsatzsteuerbefreit gemäß § 6 Abs. 1 Z 27 UStG (Kleinunternehmerregelung).");
  if (inv.vatTreatment === "reverse_charge") notes.push("Übergang der Steuerschuld auf den Leistungsempfänger (Reverse Charge, § 19 Abs. 1 UStG / Art. 196 MwStSystRL).");
  if (inv.vatTreatment === "ig_lieferung") notes.push("Steuerfreie innergemeinschaftliche Lieferung (Art. 6 Abs. 1 UStG).");
  if (inv.vatTreatment === "export") notes.push("Steuerfreie Ausfuhrlieferung (§ 6 Abs. 1 Z 1 UStG).");
  if (inv.kind !== "offer") notes.push(`Zahlbar bis ${fmtDate(inv.dueDate)} ohne Abzug${c.iban ? ` auf IBAN ${c.iban}${c.bic ? ` (BIC ${c.bic})` : ""}` : ""}. Verwendungszweck: ${inv.number}.`);
  if (inv.footerText) notes.push(inv.footerText);
  for (const n of notes) {
    const lines = doc.splitTextToSize(n, 176) as string[];
    doc.text(lines, 20, y);
    y += lines.length * 4.5 + 2;
  }
  // Fußzeile mit Firmendaten
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  const f = [
    [c.name || profile.name, c.legalForm, c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
    [c.uid ? `UID ${c.uid}` : "", c.steuernummer ? `St.Nr. ${c.steuernummer}` : "", c.email, c.phone, c.website].filter(Boolean).join(" · "),
    [c.iban ? `IBAN ${c.iban}` : "", c.bic ? `BIC ${c.bic}` : "", c.invoiceFooter].filter(Boolean).join(" · "),
  ].filter(Boolean);
  f.forEach((t, i) => doc.text(t, 105, 280 + i * 3.6, { align: "center" }));
  doc.setTextColor(0);
  return new Uint8Array(doc.output("arraybuffer"));
}
