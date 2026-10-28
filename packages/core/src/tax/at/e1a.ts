import type { Asset, Category, Profile, Transaction } from "../../model/types";
import { roundCents, type Cents } from "../../model/money";
import { SPECIAL_CATEGORIES } from "../../model/defaults";
import { E1A_KENNZAHLEN, kzLabel } from "./kennzahlen";
import { constantsFor } from "./constants";
import { incomeTaxCents } from "./tariff";
import { afaForYear } from "../../accounting/assets";

export interface E1aLine {
  kz: string;
  label: string;
  section: string;
  amountCents: Cents;
  /** Transactions contributing (ids) for drill-down */
  transactionIds: string[];
}

export interface E1aResult {
  year: number;
  profileId: string;
  kz: Record<string, Cents>;
  lines: E1aLine[];
  einnahmenCents: Cents;
  ausgabenCents: Cents;
  pauschaleCents: Cents;
  gewinnVorFreibetragCents: Cents;
  grundfreibetragCents: Cents;
  investFreibetragMaxCents: Cents;
  investFreibetragCoveredCents: Cents;
  gewinnCents: Cents;
  /** Informational tax estimate on the business profit alone. */
  estSchaetzungCents: Cents;
  warnings: string[];
  info: {
    transactionCount: number;
    uncategorized: number;
    unreviewed: number;
    pauschalierung: Profile["pauschalierung"];
    ustSystem: Profile["ustSystem"];
    bewirtungKorrekturCents: Cents;
    kfzKorrekturCents: Cents;
  };
}

/** Which Kennzahlen stay deductible next to the Basispauschalierung (E 2, Anm. 54). */
const BASIS_ALLOWED = new Set(["9100", "9110", "9120", "9160", "9165", "9215", "9217", "9225"]);
/** Kleinunternehmerpauschalierung: nur SV-Beiträge, Arbeitsplatzpauschale und 50 % Öffi-Ticket zusätzlich. */
const KU_ALLOWED = new Set(["9225", "9215", "9217", "9165"]);

const INCOME_KZ = new Set(["9040", "9050", "9060", "9070", "9080", "9090", "9093"]);

export function computeE1a(profile: Profile, year: number, transactions: Transaction[], categories: Category[], assets: Asset[]): E1aResult {
  const c = constantsFor(year);
  const catById = new Map(categories.map((x) => [x.id, x]));
  const kz: Record<string, Cents> = {};
  const txByKz: Record<string, string[]> = {};
  const warnings: string[] = [];
  const isKu = profile.vatRegime === "kleinunternehmer";
  const liveAssets = assets.filter((a) => !a.deletedAt && a.profileId === profile.id);
  const brutto = profile.ustSystem === "brutto";
  let count = 0;
  let uncategorized = 0;
  let unreviewed = 0;
  let bewirtungKorrektur = 0;
  let kfzKorrektur = 0;
  let vereinnahmteUst = 0;
  let verausgabteUst = 0;

  const put = (code: string, amount: Cents, txId?: string) => {
    kz[code] = (kz[code] ?? 0) + amount;
    if (txId) (txByKz[code] ??= []).push(txId);
  };

  for (const tx of transactions) {
    if (tx.deletedAt || tx.profileId !== profile.id) continue;
    if (tx.kind === "transfer" || tx.kind === "private") continue;
    // EÜR: Zufluss-/Abflussprinzip → Zahlungsdatum
    const d = profile.accountingMethod === "doppik" ? tx.date : tx.paidDate ?? tx.date;
    if (!d.startsWith(String(year))) continue;
    if (!tx.reviewed) unreviewed++;
    const cat = tx.categoryId ? catById.get(tx.categoryId) : undefined;
    if (!cat) uncategorized++;
    if (tx.vatTreatment === "private") continue;
    if (cat?.id === SPECIAL_CATEGORIES.privateWithdrawal || cat?.id === SPECIAL_CATEGORIES.privateDeposit) continue;
    count++;
    const net = tx.vatLines.reduce((s, l) => s + l.netCents, 0) || tx.grossCents;
    const vat = tx.vatLines.reduce((s, l) => s + l.vatCents, 0);
    const deductible = Math.max(0, Math.min(100, tx.vatDeductiblePct)) / 100;

    if (tx.kind === "income") {
      const code = liveAssets.some((a) => a.disposalTransactionId === tx.id) ? "9060" : tx.e1aKzOverride ?? cat?.e1aKz ?? "9090";
      if (isKu) {
        put(code, tx.grossCents, tx.id);
      } else if (brutto) {
        put(code, tx.grossCents, tx.id);
        vereinnahmteUst += vat;
      } else {
        put(code, net, tx.id);
      }
      continue;
    }

    // expense
    if (cat?.id === SPECIAL_CATEGORIES.assetPurchase || liveAssets.some((a) => a.transactionId === tx.id && a.method !== "gwg")) {
      // Anlagenkauf: kein sofortiger Aufwand; AfA kommt aus dem Anlagenverzeichnis
      continue;
    }
    const code = tx.e1aKzOverride ?? cat?.e1aKz ?? "9230";
    let amount: Cents;
    if (isKu) {
      amount = tx.grossCents; // keine Vorsteuer → Brutto ist Aufwand
    } else if (brutto) {
      amount = tx.grossCents;
      verausgabteUst += vat;
    } else {
      // Nettosystem: nicht abzugsfähige Vorsteuer (z. B. PKW) erhöht den Aufwand
      amount = net + roundCents(vat * (1 - deductible));
    }
    if (tx.vatTreatment === "reverse_charge" || tx.vatTreatment === "ig_erwerb") {
      // Reverse Charge: USt wird in UVA geschuldet und (meist) als Vorsteuer abgezogen; Aufwand = Netto
      amount = isKu ? tx.grossCents + roundCents((net * 20) / 100) : net;
    }
    if (code === "9165") amount = roundCents(amount * 0.5); // 50 % Öffi-Pauschale
    put(code, amount, tx.id);

    const incomePct = cat?.deductibleIncomePct ?? 100;
    if (incomePct < 100) {
      const korrektur = roundCents(amount * (1 - incomePct / 100));
      if (code === "9200") {
        put("9280", korrektur, tx.id);
        bewirtungKorrektur += korrektur;
      } else if (code === "9170" || code === "9160") {
        put("9260", korrektur, tx.id);
        kfzKorrektur += korrektur;
      } else {
        put("9290", korrektur, tx.id);
      }
    }
  }

  // Abschreibungen aus dem Anlagenverzeichnis
  let afaTotal = 0;
  let gwgTotal = 0;
  let buchwertAbgang = 0;
  let anlagenErloese = 0;
  for (const a of assets) {
    if (a.deletedAt || a.profileId !== profile.id) continue;
    const purchase = transactions.find((t) => !t.deletedAt && t.profileId === profile.id && t.id === a.transactionId);
    const linkedGwgExpense = a.method === "gwg" && purchase && purchase.categoryId !== SPECIAL_CATEGORIES.assetPurchase;
    const taxAsset = a.method === "gwg" && purchase && profile.accountingMethod !== "doppik" ? { ...a, acquisitionDate: purchase.paidDate ?? purchase.date, inServiceDate: purchase.paidDate ?? purchase.date } : a;
    const r = afaForYear(taxAsset, year);
    if (a.method === "gwg") { if (!linkedGwgExpense) gwgTotal += r.afaCents; }
    else afaTotal += r.afaCents;
    if (r.privateShareCents) put("9240", r.privateShareCents);
    if (a.disposedAt?.startsWith(String(year))) {
      buchwertAbgang += r.bookValueAtDisposalCents ?? 0;
      if (!transactions.some((t) => !t.deletedAt && t.profileId === profile.id && t.id === a.disposalTransactionId)) anlagenErloese += a.disposalProceedsCents ?? 0;
    }
  }
  if (afaTotal + gwgTotal) put("9130", afaTotal + gwgTotal);
  if (buchwertAbgang) put("9210", buchwertAbgang);
  if (anlagenErloese) put("9060", anlagenErloese);

  if (brutto) {
    if (vereinnahmteUst) put("9093", vereinnahmteUst);
    if (verausgabteUst) put("9233", verausgabteUst);
  }
  if (!("9050" in kz)) kz["9050"] = 0; // immer auszufüllen

  // Pauschalierung
  const umsatz = (kz["9040"] ?? 0) + (kz["9050"] ?? 0) + (kz["9090"] ?? 0);
  let pauschale = 0;
  if (profile.pauschalierung === "basis") {
    const p = c.basisPauschale;
    const pct = profile.pauschalierungBranch === "service" ? p.servicePct : p.regularPct;
    const max = (profile.pauschalierungBranch === "service" ? p.serviceMax : p.regularMax) * 100;
    pauschale = Math.min(roundCents((umsatz * pct) / 100), max);
    for (const code of Object.keys(kz)) {
      if (!INCOME_KZ.has(code) && !BASIS_ALLOWED.has(code)) delete kz[code];
    }
    kz["9259"] = pauschale;
    if (brutto) warnings.push("Basispauschalierung: Nettomethode verwenden – verausgabte USt (KZ 9233) ist durch das Pauschale abgegolten.");
    if (umsatz > p.umsatzGrenze * 100) warnings.push(`Umsatz über ${p.umsatzGrenze.toLocaleString("de-AT")} € – Basispauschalierung prüfen (Vorjahresumsatz maßgeblich).`);
  } else if (profile.pauschalierung === "kleinunternehmer") {
    const p = c.kuPauschale;
    const pct = profile.pauschalierungBranch === "service" ? p.servicePct : p.regularPct;
    const max = (profile.pauschalierungBranch === "service" ? p.serviceMax : p.regularMax) * 100;
    pauschale = Math.min(roundCents((umsatz * pct) / 100), max);
    for (const code of Object.keys(kz)) {
      if (!INCOME_KZ.has(code) && !KU_ALLOWED.has(code)) delete kz[code];
    }
    kz["9259"] = pauschale;
    if (umsatz > p.umsatzGrenze * 100) warnings.push(`Umsatz über ${p.umsatzGrenze.toLocaleString("de-AT")} € – Kleinunternehmerpauschalierung nicht mehr anwendbar.`);
  }

  const einnahmen = Object.entries(kz).filter(([k]) => INCOME_KZ.has(k)).reduce((s, [, v]) => s + v, 0);
  const korrekturen = ["9240", "9260", "9270", "9280", "9290"].reduce((s, k) => s + (kz[k] ?? 0), 0);
  const ausgaben = Object.entries(kz)
    .filter(([k]) => !INCOME_KZ.has(k) && !["9240", "9260", "9270", "9280", "9290", "9221", "9227", "9229", "9276", "9277"].includes(k))
    .reduce((s, [, v]) => s + v, 0);
  const gewinnVorFreibetrag = einnahmen - ausgaben + korrekturen;

  // Gewinnfreibetrag § 10
  let grundfreibetrag = 0;
  let investMax = 0;
  let investCovered = 0;
  if (gewinnVorFreibetrag > 0) {
    const gfb = c.gewinnfreibetrag;
    const basis = Math.min(gewinnVorFreibetrag, gfb.grundBasisMax * 100);
    grundfreibetrag = roundCents((basis * gfb.grundPct) / 100);
    kz["9221"] = grundfreibetrag;
    let remaining = gewinnVorFreibetrag - gfb.grundBasisMax * 100;
    let lower = gfb.grundBasisMax * 100;
    for (const st of gfb.stufen) {
      if (remaining <= 0) break;
      const upper = st.upTo * 100;
      const slice = Math.min(remaining, upper - lower);
      investMax += roundCents((slice * st.pct) / 100);
      remaining -= slice;
      lower = upper;
    }
    investMax = Math.min(investMax, gfb.max * 100 - grundfreibetrag);
    // qualifying investments: körperliche Wirtschaftsgüter mit Nutzungsdauer >= 4 Jahre, angeschafft im Jahr
    const qualifying = assets
      .filter((a) => !a.deletedAt && a.profileId === profile.id && a.gfbEligible === true && a.acquisitionDate.startsWith(String(year)) && a.usefulLifeYears >= 4 && a.method !== "gwg" && a.method !== "none")
      .reduce((s, a) => s + a.costCents, 0);
    investCovered = Math.min(investMax, qualifying);
    if (investCovered > 0) kz["9227"] = investCovered;
    if (investMax > investCovered) {
      warnings.push(`Investitionsbedingter Gewinnfreibetrag: bis zu ${((investMax - investCovered) / 100).toLocaleString("de-AT", { style: "currency", currency: "EUR" })} zusätzlich möglich, wenn begünstigte Wirtschaftsgüter/Wertpapiere angeschafft werden.`);
    }
  }
  const gewinn = gewinnVorFreibetrag - grundfreibetrag - investCovered;
  const estSchaetzung = incomeTaxCents(gewinn, year);

  const lines: E1aLine[] = E1A_KENNZAHLEN.filter((k) => k.kz in kz).map((k) => ({
    kz: k.kz,
    label: kzLabel(k.kz),
    section: k.section,
    amountCents: kz[k.kz]!,
    transactionIds: txByKz[k.kz] ?? [],
  }));

  if (uncategorized) warnings.push(`${uncategorized} Buchung(en) ohne Kategorie – landen in KZ 9230/9090.`);
  if (unreviewed) warnings.push(`${unreviewed} Buchung(en) noch nicht geprüft.`);
  if (isKu && umsatz > c.kleinunternehmerGrenze * 100) warnings.push(`Umsatz über der Kleinunternehmergrenze (${c.kleinunternehmerGrenze.toLocaleString("de-AT")} €) – USt-Pflicht prüfen (Toleranz ${c.kleinunternehmerToleranzPct} %).`);

  return {
    year,
    profileId: profile.id,
    kz,
    lines,
    einnahmenCents: einnahmen,
    ausgabenCents: ausgaben - korrekturen,
    pauschaleCents: pauschale,
    gewinnVorFreibetragCents: gewinnVorFreibetrag,
    grundfreibetragCents: grundfreibetrag,
    investFreibetragMaxCents: investMax,
    investFreibetragCoveredCents: investCovered,
    gewinnCents: gewinn,
    estSchaetzungCents: estSchaetzung,
    warnings,
    info: { transactionCount: count, uncategorized, unreviewed, pauschalierung: profile.pauschalierung, ustSystem: profile.ustSystem, bewirtungKorrekturCents: bewirtungKorrektur, kfzKorrekturCents: kfzKorrektur },
  };
}
