/**
 * Demo data: a complete, realistic Austrian bookkeeping example for the guest mode.
 * Two profiles: "Muster Design e.U." (Unternehmer, EÜR, Regelbesteuerung) and "Max Muster" (Angestellt).
 * Everything is generated relative to `today`, so the demo always looks current.
 */
import type { Asset, BankLine, BankStatement, Category, Contact, Invoice, Profile, RecurringRule, Transaction, Vault } from "../model/types";
import type { VatRate } from "../model/vat";
import { nowIso, todayIso } from "../model/types";
import { lineFromGross } from "../model/vat";
import { reconcile } from "../bank/reconcile";
import { invoiceTotals } from "../analytics/stats";

/* deterministic pseudo random so the demo is stable between runs */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function iso(y: number, m: number, d: number) {
  const dim = new Date(y, m, 0).getDate();
  return `${y}-${pad(m)}-${pad(Math.min(d, dim))}`;
}
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DemoIds {
  business: string;
  employee: string;
}

export interface DemoSeedResult {
  ids: DemoIds;
  /** Transactions that should get the sample receipt image / invoice PDF attached. */
  receiptTxId: string;
  invoiceTxId: string;
}

export function seedDemoVault(vault: Vault, opts: { today?: string } = {}): DemoSeedResult {
  const today = opts.today ?? todayIso();
  const rnd = mulberry32(20261020);
  const now = nowIso();
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  const td = Number(today.slice(8, 10));
  let seq = 1;
  const id = (p: string) => `${p}_demo${String(seq++).padStart(4, "0")}`;
  const months: { y: number; m: number }[] = [];
  for (let i = 12; i >= 0; i--) {
    let y = ty;
    let m = tm - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    months.push({ y, m });
  }
  const isPast = (date: string) => date <= today;

  /* ------------------------------------------------------------ */
  /* Profiles                                                      */
  /* ------------------------------------------------------------ */
  const business: Profile = {
    id: id("prf"),
    name: "Muster Design e.U.",
    mode: "business",
    accountingMethod: "eur",
    vatRegime: "regelbesteuerung",
    uvaPeriod: "quarterly",
    ustSystem: "netto",
    pauschalierung: "none",
    pauschalierungBranch: "regular",
    fiscalYearStartMonth: 1,
    company: { name: "Muster Design e.U.", legalForm: "Einzelunternehmen", street: "Gumpendorfer Straße 42/7", zip: "1060", city: "Wien", country: "AT", uid: "ATU61234567", steuernummer: "12-345/6789", iban: "AT40 2011 1000 0001 2345", bic: "GIBAATWWXXX", email: "hallo@musterdesign.at", phone: "+43 660 1234567", website: "musterdesign.at", invoiceFooter: "Inhaberin: Mia Muster · Mitglied der WKO Wien", invoiceNumberPattern: "RE-{YYYY}-{NNNN}", nextInvoiceNumber: 1, invoiceMode: "summa" },
    color: "#0f766e",
    createdAt: now,
    updatedAt: now,
  };
  const employee: Profile = {
    id: id("prf"),
    name: "Max Muster",
    mode: "employee",
    accountingMethod: "eur",
    vatRegime: "kleinunternehmer",
    uvaPeriod: "none",
    ustSystem: "netto",
    pauschalierung: "none",
    pauschalierungBranch: "regular",
    fiscalYearStartMonth: 1,
    company: { name: "Max Muster", legalForm: "", street: "Linzer Straße 118/3", zip: "1140", city: "Wien", country: "AT", uid: "", steuernummer: "", iban: "AT61 1904 3002 3457 3201", bic: "", email: "max@muster.at", phone: "", website: "", invoiceFooter: "", invoiceNumberPattern: "RE-{YYYY}-{NNNN}", nextInvoiceNumber: 1 },
    color: "#2563eb",
    createdAt: now,
    updatedAt: now,
  };
  vault.profiles.push(business, employee);
  vault.activeProfileId = business.id;

  /* ------------------------------------------------------------ */
  /* Contacts                                                      */
  /* ------------------------------------------------------------ */
  const mkContact = (profileId: string, name: string, kind: Contact["kind"], extra: Partial<Contact> = {}): Contact => {
    const c: Contact = { id: id("ctc"), profileId, name, kind, uid: "", email: "", phone: "", street: "", zip: "", city: "", country: "AT", iban: "", notes: "", aliases: [], createdAt: now, updatedAt: now, ...extra };
    vault.contacts.push(c);
    return c;
  };
  const b = business.id;
  const cHotel = mkContact(b, "Alpenblick Hotel GmbH", "customer", { uid: "ATU55512345", street: "Seestraße 1", zip: "5700", city: "Zell am See", email: "office@alpenblick.at" });
  const cStadtwerke = mkContact(b, "Stadtwerke Linz GmbH", "customer", { uid: "ATU23456789", street: "Fichtenstraße 7", zip: "4020", city: "Linz" });
  const cCafe = mkContact(b, "Café Morgenrot", "customer", { street: "Yppenplatz 5", zip: "1160", city: "Wien" });
  const cA1 = mkContact(b, "A1 Telekom Austria AG", "vendor", { uid: "ATU62895905", defaultCategoryId: "cat_b_ex_telefon", iban: "AT381200000000000081" });
  const cAdobe = mkContact(b, "Adobe Systems Software Ireland Ltd", "vendor", { uid: "IE6364992H", country: "IE", defaultCategoryId: "cat_b_ex_software", defaultVatTreatment: "reverse_charge" });
  const cGoogle = mkContact(b, "Google Ireland Ltd", "vendor", { uid: "IE6388047V", country: "IE", defaultCategoryId: "cat_b_ex_werbung", defaultVatTreatment: "reverse_charge" });
  const cOmv = mkContact(b, "OMV Tankstelle", "vendor", { defaultCategoryId: "cat_b_ex_treibstoff", aliases: ["omv"] });
  const cBilla = mkContact(b, "BILLA AG", "vendor", { uid: "ATU12345678", defaultCategoryId: "cat_b_ex_bewirtung", aliases: ["billa"] });
  const cMustermann = mkContact(b, "Mustermann IT Services GmbH", "vendor", { uid: "ATU98765432", street: "Technikerstraße 5", zip: "4020", city: "Linz", iban: "AT611904300234573201", defaultCategoryId: "cat_b_ex_fremd" });
  const cSvs = mkContact(b, "SVS – Sozialversicherung der Selbständigen", "vendor", { defaultCategoryId: "cat_b_ex_svs", aliases: ["svs"] });
  const cHausverwaltung = mkContact(b, "Hausverwaltung Wimmer GmbH", "vendor", { uid: "ATU44455566", defaultCategoryId: "cat_b_ex_miete", iban: "AT021100000012345678" });
  const cStb = mkContact(b, "Steuerberatung Huber & Partner", "vendor", { uid: "ATU33322211", defaultCategoryId: "cat_b_ex_stb" });
  const cBank = mkContact(b, "Erste Bank", "vendor", { defaultCategoryId: "cat_b_ex_bank" });
  const cLibro = mkContact(b, "LIBRO", "vendor", { defaultCategoryId: "cat_b_ex_buero", aliases: ["libro"] });
  const cMediaMarkt = mkContact(b, "MediaMarkt", "vendor", { uid: "ATU37893801", defaultCategoryId: "cat_b_ex_gwg" });
  const cApple = mkContact(b, "Apple Retail Austria", "vendor", { uid: "ATU65108214", defaultCategoryId: "cat_b_ex_anlage" });
  const cOebb = mkContact(b, "ÖBB Personenverkehr AG", "vendor", { uid: "ATU40938309", defaultCategoryId: "cat_b_ex_reise", aliases: ["öbb", "oebb"] });
  const cHotelLinz = mkContact(b, "Hotel am Domplatz", "vendor", { defaultCategoryId: "cat_b_ex_reise" });

  const e = employee.id;
  const eArbeitgeber = mkContact(e, "TechNova GmbH (Arbeitgeber)", "customer");
  const eHausverwaltung = mkContact(e, "Hausverwaltung Nord", "vendor", { defaultCategoryId: "cat_e_p_wohnen" });
  const eBilla = mkContact(e, "BILLA AG", "vendor", { uid: "ATU12345678", defaultCategoryId: "cat_e_p_lebensmittel", aliases: ["billa"] });
  const eSpar = mkContact(e, "SPAR", "vendor", { defaultCategoryId: "cat_e_p_lebensmittel" });
  const eWienEnergie = mkContact(e, "Wien Energie", "vendor", { defaultCategoryId: "cat_e_p_energie" });
  const eA1 = mkContact(e, "A1 Telekom Austria AG", "vendor", { defaultCategoryId: "cat_e_p_abos" });
  const eNetflix = mkContact(e, "Netflix", "vendor", { defaultCategoryId: "cat_e_p_abos" });
  const eWienerLinien = mkContact(e, "Wiener Linien", "vendor", { defaultCategoryId: "cat_e_p_mobilitaet" });
  const eFitness = mkContact(e, "FitInn", "vendor", { defaultCategoryId: "cat_e_p_gesundheit" });
  const eZahnarzt = mkContact(e, "Dr. Zahn – Zahnarztpraxis", "vendor", { defaultCategoryId: "cat_e_agb_krankheit" });
  const eOptiker = mkContact(e, "Fielmann", "vendor", { defaultCategoryId: "cat_e_agb_krankheit" });
  const eWifi = mkContact(e, "WIFI Wien", "vendor", { defaultCategoryId: "cat_e_wk_fortbildung" });
  const eMediaMarkt = mkContact(e, "MediaMarkt", "vendor", { defaultCategoryId: "cat_e_wk_digital" });
  const eThalia = mkContact(e, "Thalia", "vendor", { defaultCategoryId: "cat_e_wk_literatur" });
  const eGpa = mkContact(e, "GPA – Gewerkschaft", "vendor", { defaultCategoryId: "cat_e_wk_gewerkschaft" });
  const eKirche = mkContact(e, "Erzdiözese Wien – Kirchenbeitrag", "vendor", { defaultCategoryId: "cat_e_sa_kirche" });
  const eCaritas = mkContact(e, "Caritas", "vendor", { defaultCategoryId: "cat_e_sa_spenden" });
  const eStb = mkContact(e, "Steuerberatung Huber & Partner", "vendor", { defaultCategoryId: "cat_e_sa_stb" });
  const eRestaurants = ["Pizzeria Riva", "Gasthaus Zum Goldenen Hirschen", "Café Sperl", "Ramen Bar"].map((n) => mkContact(e, n, "vendor", { defaultCategoryId: "cat_e_p_restaurant" }));

  /* ------------------------------------------------------------ */
  /* Transactions                                                  */
  /* ------------------------------------------------------------ */
  const catById = new Map(vault.categories.map((c) => [c.id, c]));
  const tx = (profileId: string, kind: Transaction["kind"], date: string, gross: number, categoryId: string | undefined, contact?: Contact, extra: Partial<Transaction> = {}): Transaction => {
    const cat = categoryId ? catById.get(categoryId) : undefined;
    const rate = (extra.vatLines?.[0]?.rate ?? cat?.defaultVatRate ?? 20) as VatRate;
    const treatment = extra.vatTreatment ?? "standard";
    const vatLines = treatment === "reverse_charge" || treatment === "ig_erwerb" ? [{ rate: 20 as VatRate, netCents: gross, vatCents: 0 }] : treatment === "standard" ? [lineFromGross(gross, rate)] : [{ rate: 0 as VatRate, netCents: gross, vatCents: 0 }];
    const t: Transaction = {
      id: id("txn"),
      profileId,
      kind,
      date,
      paidDate: date,
      description: cat?.name ?? "",
      contactId: contact?.id,
      categoryId,
      vatLines,
      grossCents: gross,
      currency: "EUR",
      vatTreatment: treatment,
      vatDeductiblePct: cat?.defaultDeductiblePct ?? 100,
      paymentMethod: "bank",
      invoiceNumber: "",
      reference: "",
      documentIds: [],
      tags: [],
      notes: "",
      origin: "manual",
      reviewed: true,
      createdAt: now,
      updatedAt: now,
      ...extra,
    };
    vault.transactions.push(t);
    return t;
  };
  const cents = (euros: number) => Math.round(euros * 100);
  const jitter = (base: number, pct = 0.15) => Math.round(base * (1 + (rnd() * 2 - 1) * pct));

  // --- Business: income & expenses per month ---
  let invoiceNo = 0;
  const customers = [cHotel, cStadtwerke, cCafe];
  const projects = ["Website-Relaunch", "Corporate Design", "Social-Media-Kampagne", "Speisekarten-Design", "Jahresbericht Layout", "Messestand-Grafik", "Logo-Entwicklung", "Print-Kampagne"];
  const incomeTx: Transaction[] = [];
  months.forEach(({ y, m }, mi) => {
    const nInv = mi === months.length - 1 ? 1 : 2 + (rnd() > 0.6 ? 1 : 0);
    for (let k = 0; k < nInv; k++) {
      const date = iso(y, m, 3 + k * 9 + Math.floor(rnd() * 4));
      if (!isPast(date)) continue;
      invoiceNo++;
      const customer = customers[(mi + k) % customers.length]!;
      const gross = cents(jitter(customer === cStadtwerke ? 5400 : customer === cHotel ? 3600 : 1800, 0.3));
      const paidDate = addDays(date, 8 + Math.floor(rnd() * 14));
      const t = tx(b, "income", date, gross, "cat_b_in_20", customer, { description: `${projects[(mi + k) % projects.length]} – ${customer.name}`, invoiceNumber: `RE-${y}-${pad(invoiceNo).padStart(4, "0")}`, dueDate: addDays(date, 14), paidDate: isPast(paidDate) ? paidDate : undefined, origin: "invoice" });
      incomeTx.push(t);
    }
    // fixed costs
    const first = iso(y, m, 1);
    if (isPast(first)) {
      tx(b, "expense", first, cents(890), "cat_b_ex_miete", cHausverwaltung, { description: "Büromiete Gumpendorfer Straße", vatLines: [lineFromGross(cents(890), 20)], origin: "recurring" });
      tx(b, "expense", iso(y, m, 5), cents(61234 / 100), "cat_b_ex_svs", cSvs, { description: "SVS Beitragsvorschreibung", origin: "recurring" });
    }
    const a1 = iso(y, m, 12);
    if (isPast(a1)) tx(b, "expense", a1, cents(49.9), "cat_b_ex_telefon", cA1, { description: "A1 Business Mobil + Internet", invoiceNumber: `${y}${pad(m)}-${7000000 + mi}`, origin: "recurring" });
    const adobe = iso(y, m, 15);
    if (isPast(adobe)) tx(b, "expense", adobe, cents(71.99), "cat_b_ex_software", cAdobe, { description: "Adobe Creative Cloud (Reverse Charge)", vatTreatment: "reverse_charge", paymentMethod: "card", origin: "recurring" });
    const bank = iso(y, m, 28);
    if (isPast(bank)) tx(b, "expense", bank, cents(9.9), "cat_b_ex_bank", cBank, { description: "Kontoführung Geschäftskonto" });
    // variable costs
    const fuelDays = [4, 19];
    for (const d of fuelDays) {
      const date = iso(y, m, d + Math.floor(rnd() * 3));
      if (isPast(date) && rnd() > 0.25) tx(b, "expense", date, cents(jitter(68, 0.3)), "cat_b_ex_treibstoff", cOmv, { description: "Diesel OMV", paymentMethod: "card", vatDeductiblePct: 0 });
    }
    const lunch = iso(y, m, 9 + Math.floor(rnd() * 10));
    if (isPast(lunch) && rnd() > 0.3) {
      // one amount for the total and the VAT split – two draws made them disagree
      const lunchCents = cents(jitter(64, 0.4));
      tx(b, "expense", lunch, lunchCents, "cat_b_ex_bewirtung", cBilla, { description: "Geschäftsessen / Bewirtung Kunde", paymentMethod: "card", vatLines: [lineFromGross(lunchCents, 10)] });
    }
    const office = iso(y, m, 21);
    if (isPast(office) && rnd() > 0.4) tx(b, "expense", office, cents(jitter(38, 0.5)), "cat_b_ex_buero", cLibro, { description: "Büromaterial", paymentMethod: "card" });
    const ads = iso(y, m, 2);
    if (isPast(ads) && mi % 2 === 0) tx(b, "expense", ads, cents(jitter(240, 0.3)), "cat_b_ex_werbung", cGoogle, { description: "Google Ads (Reverse Charge)", vatTreatment: "reverse_charge", paymentMethod: "card" });
    if (m % 3 === 1) {
      const stb = iso(y, m, 20);
      if (isPast(stb)) tx(b, "expense", stb, cents(480), "cat_b_ex_stb", cStb, { description: "Steuerberatung – Quartalsabschluss & UVA", invoiceNumber: `H-${y}-${m}` });
    }
    if (mi % 4 === 1) {
      const trip = iso(y, m, 16);
      if (isPast(trip)) {
        tx(b, "expense", trip, cents(78.4), "cat_b_ex_reise", cOebb, { description: "Bahnfahrt Wien–Linz retour (Kundentermin)", vatLines: [lineFromGross(cents(78.4), 10)], paymentMethod: "card" });
        tx(b, "expense", addDays(trip, 1), cents(129), "cat_b_ex_reise", cHotelLinz, { description: "Nächtigung Linz", vatLines: [lineFromGross(cents(129), 10)], paymentMethod: "card" });
      }
    }
  });
  // one-off: GWG + asset + Fremdleistung (the invoice PDF)
  const m0 = months[1]!;
  const gwgDate = iso(m0.y, m0.m, 8);
  tx(b, "expense", gwgDate, cents(838.8), "cat_b_ex_gwg", cMediaMarkt, { description: "Monitor 27\" 4K (GWG)", paymentMethod: "card", invoiceNumber: "MM-4471120" });
  const laptopDate = iso(months[2]!.y, months[2]!.m, 14);
  const laptopTx = tx(b, "expense", laptopDate, cents(2868), "cat_b_ex_anlage", cApple, { description: "MacBook Pro 14\" (Anlage, AfA 4 Jahre)", invoiceNumber: "AR-2026-09812" });
  const invoiceTxDate = iso(months[months.length - 2]!.y, months[months.length - 2]!.m, 3);
  const invoiceTx = tx(b, "expense", invoiceTxDate, cents(1200), "cat_b_ex_fremd", cMustermann, { description: "Softwareentwicklung Onlineshop-Modul (Fremdleistung)", invoiceNumber: "2026-0042", dueDate: addDays(invoiceTxDate, 14), paidDate: addDays(invoiceTxDate, 10), origin: "extraction" });
  const receiptDate = iso(months[months.length - 1]!.y, months[months.length - 1]!.m, Math.max(1, Math.min(td - 2, 12)));
  const receiptTx = tx(b, "expense", receiptDate, cents(17.51), "cat_b_ex_bewirtung", cBilla, { description: "Bewirtung Kundentermin – BILLA", paymentMethod: "card", vatLines: [{ rate: 20, netCents: 666, vatCents: 133 }, { rate: 10, netCents: 865, vatCents: 87 }], origin: "extraction" });
  // a few unreviewed drafts so the inbox is not empty
  const draftDate = iso(ty, tm, Math.max(1, td - 1));
  tx(b, "expense", draftDate, cents(24.5), "cat_b_ex_buero", cLibro, { description: "Druckerpapier & Toner", paymentMethod: "card", reviewed: false, origin: "extraction" });
  tx(b, "expense", draftDate, cents(45), "cat_b_ex_reise", cOebb, { description: "ÖBB Ticket Wien–St. Pölten", paymentMethod: "card", reviewed: false, origin: "extraction", vatLines: [lineFromGross(cents(45), 10)] });
  // Privatentnahme
  months.slice(-6).forEach(({ y, m }) => {
    const d = iso(y, m, 27);
    if (isPast(d)) tx(b, "expense", d, cents(1800), "cat_b_ex_privat", undefined, { description: "Privatentnahme", vatTreatment: "private" });
  });

  // --- Employee ---
  months.forEach(({ y, m }, mi) => {
    const pay = iso(y, m, 1);
    if (isPast(pay)) tx(e, "income", pay, cents(2965.4), "cat_e_in_gehalt", eArbeitgeber, { description: "Gehalt TechNova GmbH", vatTreatment: "private" });
    if ((m === 6 || m === 11) && isPast(pay)) tx(e, "income", iso(y, m, 15), cents(2965.4), "cat_e_in_sonder", eArbeitgeber, { description: m === 6 ? "Urlaubsgeld (14. Gehalt)" : "Weihnachtsgeld (13. Gehalt)", vatTreatment: "private" });
    const rent = iso(y, m, 2);
    if (isPast(rent)) {
      tx(e, "expense", rent, cents(985), "cat_e_p_wohnen", eHausverwaltung, { description: "Miete + Betriebskosten", vatTreatment: "private", origin: "recurring" });
      tx(e, "expense", iso(y, m, 3), cents(92), "cat_e_p_energie", eWienEnergie, { description: "Strom & Gas Teilbetrag", vatTreatment: "private", origin: "recurring" });
      tx(e, "expense", iso(y, m, 6), cents(15.99), "cat_e_p_abos", eNetflix, { description: "Netflix", paymentMethod: "card", vatTreatment: "private", origin: "recurring" });
      tx(e, "expense", iso(y, m, 10), cents(29.9), "cat_e_p_abos", eA1, { description: "A1 Handyvertrag", vatTreatment: "private", origin: "recurring" });
      tx(e, "expense", iso(y, m, 7), cents(39.9), "cat_e_p_gesundheit", eFitness, { description: "Fitnessstudio", paymentMethod: "direct_debit", vatTreatment: "private", origin: "recurring" });
      tx(e, "expense", iso(y, m, 8), cents(24.6), "cat_e_wk_gewerkschaft", eGpa, { description: "Gewerkschaftsbeitrag GPA", vatTreatment: "private", origin: "recurring" });
    }
    for (let k = 0; k < 5; k++) {
      const date = iso(y, m, 2 + k * 6 + Math.floor(rnd() * 4));
      if (isPast(date)) tx(e, "expense", date, cents(jitter(58, 0.5)), "cat_e_p_lebensmittel", rnd() > 0.5 ? eBilla : eSpar, { description: "Wocheneinkauf", paymentMethod: "card", vatTreatment: "private" });
    }
    for (let k = 0; k < 3; k++) {
      const date = iso(y, m, 5 + k * 9 + Math.floor(rnd() * 5));
      if (isPast(date) && rnd() > 0.3) tx(e, "expense", date, cents(jitter(34, 0.6)), "cat_e_p_restaurant", eRestaurants[Math.floor(rnd() * eRestaurants.length)], { description: "Essen gehen", paymentMethod: "card", vatTreatment: "private" });
    }
    if (mi === 0) tx(e, "expense", iso(y, m, 4), cents(1095), "cat_e_p_mobilitaet", eWienerLinien, { description: "KlimaTicket Österreich (Jahreskarte)", vatTreatment: "private" });
  });
  const wkYear = months[months.length - 1]!.y;
  const wkMonth = (mo: number) => iso(wkYear, Math.max(1, Math.min(tm, mo)), 10);
  tx(e, "expense", wkMonth(2), cents(1199), "cat_e_wk_digital", eMediaMarkt, { description: "Notebook für Homeoffice (beruflicher Anteil 100 %)", paymentMethod: "card", vatTreatment: "private", invoiceNumber: "MM-5520017" });
  tx(e, "expense", wkMonth(3), cents(49.9), "cat_e_wk_literatur", eThalia, { description: "Fachbuch: Clean Architecture", paymentMethod: "card", vatTreatment: "private" });
  tx(e, "expense", wkMonth(4), cents(690), "cat_e_wk_fortbildung", eWifi, { description: "WIFI-Kurs Projektmanagement", vatTreatment: "private" });
  tx(e, "expense", wkMonth(5), cents(1250), "cat_e_agb_krankheit", eZahnarzt, { description: "Zahnersatz Krone (Selbstbehalt)", vatTreatment: "private" });
  tx(e, "expense", wkMonth(6), cents(420), "cat_e_agb_krankheit", eOptiker, { description: "Gleitsichtbrille", paymentMethod: "card", vatTreatment: "private" });
  tx(e, "expense", wkMonth(3), cents(240), "cat_e_sa_kirche", eKirche, { description: "Kirchenbeitrag Jahresvorschreibung", vatTreatment: "private" });
  tx(e, "expense", wkMonth(12), cents(100), "cat_e_sa_spenden", eCaritas, { description: "Spende Caritas", vatTreatment: "private" });
  tx(e, "expense", wkMonth(2), cents(150), "cat_e_sa_stb", eStb, { description: "Steuerberatung Arbeitnehmerveranlagung", vatTreatment: "private" });
  tx(e, "expense", draftDate, cents(18.9), "cat_e_p_lebensmittel", eBilla, { description: "Einkauf BILLA", paymentMethod: "card", vatTreatment: "private", reviewed: false, origin: "extraction" });

  /* ------------------------------------------------------------ */
  /* Recurring rules                                               */
  /* ------------------------------------------------------------ */
  const rule = (profileId: string, name: string, interval: RecurringRule["interval"], day: number, template: RecurringRule["template"]) => {
    const r: RecurringRule = { id: id("rec"), profileId, name, active: true, interval, dayOfMonth: day, startDate: iso(months[0]!.y, months[0]!.m, day), lastMaterializedDate: today, autoBook: true, template, createdAt: now, updatedAt: now };
    vault.recurringRules.push(r);
  };
  rule(b, "Büromiete", "monthly", 1, { kind: "expense", description: "Büromiete Gumpendorfer Straße", contactId: cHausverwaltung.id, categoryId: "cat_b_ex_miete", vatLines: [lineFromGross(cents(890), 20)], grossCents: cents(890), vatTreatment: "standard", vatDeductiblePct: 100, paymentMethod: "bank", tags: [] });
  rule(b, "SVS Beitrag", "monthly", 5, { kind: "expense", description: "SVS Beitragsvorschreibung", contactId: cSvs.id, categoryId: "cat_b_ex_svs", vatLines: [{ rate: 0, netCents: 61234, vatCents: 0 }], grossCents: 61234, vatTreatment: "exempt", vatDeductiblePct: 100, paymentMethod: "bank", tags: [] });
  rule(b, "Adobe Creative Cloud", "monthly", 15, { kind: "expense", description: "Adobe Creative Cloud (Reverse Charge)", contactId: cAdobe.id, categoryId: "cat_b_ex_software", vatLines: [{ rate: 20, netCents: 7199, vatCents: 0 }], grossCents: 7199, vatTreatment: "reverse_charge", vatDeductiblePct: 100, paymentMethod: "card", tags: [] });
  rule(b, "A1 Business", "monthly", 12, { kind: "expense", description: "A1 Business Mobil + Internet", contactId: cA1.id, categoryId: "cat_b_ex_telefon", vatLines: [lineFromGross(4990, 20)], grossCents: 4990, vatTreatment: "standard", vatDeductiblePct: 100, paymentMethod: "bank", tags: [] });
  rule(e, "Gehalt", "monthly", 1, { kind: "income", description: "Gehalt TechNova GmbH", contactId: eArbeitgeber.id, categoryId: "cat_e_in_gehalt", vatLines: [], grossCents: cents(2965.4), vatTreatment: "private", vatDeductiblePct: 100, paymentMethod: "bank", tags: [] });
  rule(e, "Miete", "monthly", 2, { kind: "expense", description: "Miete + Betriebskosten", contactId: eHausverwaltung.id, categoryId: "cat_e_p_wohnen", vatLines: [], grossCents: cents(985), vatTreatment: "private", vatDeductiblePct: 100, paymentMethod: "bank", tags: [] });
  rule(e, "Netflix", "monthly", 6, { kind: "expense", description: "Netflix", contactId: eNetflix.id, categoryId: "cat_e_p_abos", vatLines: [], grossCents: 1599, vatTreatment: "private", vatDeductiblePct: 100, paymentMethod: "card", tags: [] });

  /* ------------------------------------------------------------ */
  /* Assets                                                        */
  /* ------------------------------------------------------------ */
  const asset = (a: Omit<Asset, "id" | "createdAt" | "updatedAt" | "profileId">) => vault.assets.push({ ...a, id: id("ast"), profileId: b, createdAt: now, updatedAt: now });
  asset({ name: "MacBook Pro 14\"", acquisitionDate: laptopDate, costCents: 239000, usefulLifeYears: 4, method: "linear", degressiveRatePct: 30, privateUsePct: 0, transactionId: laptopTx.id, ekrAccount: "0620", categoryId: "cat_b_ex_anlage", notes: "Netto 2.390 € (Vorsteuer abgezogen)" });
  asset({ name: "Spiegelreflexkamera Canon EOS", acquisitionDate: iso(ty - 1, 3, 22), costCents: 145000, usefulLifeYears: 5, method: "linear", degressiveRatePct: 30, privateUsePct: 20, ekrAccount: "0600", notes: "20 % Privatanteil" });
  asset({ name: "Büroeinrichtung (Schreibtisch, Regale)", acquisitionDate: iso(ty - 2, 9, 5), costCents: 268000, usefulLifeYears: 10, method: "linear", degressiveRatePct: 30, privateUsePct: 0, ekrAccount: "0600", notes: "" });
  asset({ name: "Monitor 27\" 4K", acquisitionDate: gwgDate, costCents: 69900, usefulLifeYears: 1, method: "gwg", degressiveRatePct: 30, privateUsePct: 0, ekrAccount: "0620", categoryId: "cat_b_ex_gwg", notes: "GWG < 1.000 € netto" });

  /* ------------------------------------------------------------ */
  /* Invoices (Ausgangsrechnungen)                                 */
  /* ------------------------------------------------------------ */
  const mkInvoice = (customer: Contact, number: string, issueDate: string, lines: { description: string; quantity: number; unit: string; unitNetCents: number }[], status: Invoice["status"], paidDate?: string): Invoice => {
    const inv: Invoice = {
      id: id("inv"), profileId: b, number, kind: "invoice", customerId: customer.id,
      customerSnapshot: { name: customer.name, street: customer.street, zip: customer.zip, city: customer.city, country: customer.country, uid: customer.uid, email: customer.email },
      issueDate, dueDate: addDays(issueDate, 14), servicePeriod: new Date(issueDate + "T00:00:00").toLocaleDateString("de-AT", { month: "long", year: "numeric" }),
      lines: lines.map((l) => ({ id: id("inl"), ...l, vatRate: 20 as VatRate, discountPct: 0 })),
      introText: "Vielen Dank für Ihren Auftrag. Ich erlaube mir, folgende Leistungen in Rechnung zu stellen:", footerText: "Zahlbar innerhalb von 14 Tagen ohne Abzug. Es gelten meine AGB.",
      status, paidDate, paidCents: 0, vatTreatment: "standard", reference: "", createdAt: now, updatedAt: now,
    };
    inv.paidCents = status === "paid" ? invoiceTotals(inv).grossCents : 0;
    vault.invoices.push(inv);
    return inv;
  };
  const lastM = months[months.length - 2]!;
  const inv1 = mkInvoice(cHotel, `RE-${lastM.y}-${pad(invoiceNo + 1).padStart(4, "0")}`, iso(lastM.y, lastM.m, 6), [{ description: "Website-Relaunch – Konzept & Design", quantity: 24, unit: "h", unitNetCents: 9500 }, { description: "Fotoshooting Hotelzimmer", quantity: 1, unit: "Pausch.", unitNetCents: 68000 }], "paid", iso(lastM.y, lastM.m, 19));
  const inv2 = mkInvoice(cStadtwerke, `RE-${ty}-${pad(invoiceNo + 2).padStart(4, "0")}`, addDays(today, -20), [{ description: "Jahresbericht – Layout & Satz (96 Seiten)", quantity: 1, unit: "Pausch.", unitNetCents: 420000 }], "overdue");
  const inv3 = mkInvoice(cCafe, `RE-${ty}-${pad(invoiceNo + 3).padStart(4, "0")}`, addDays(today, -4), [{ description: "Speisekarten-Design (Sommer)", quantity: 8, unit: "h", unitNetCents: 8500 }, { description: "Druckkostenzuschuss", quantity: 1, unit: "Pausch.", unitNetCents: 12000 }], "sent");
  business.company.nextInvoiceNumber = invoiceNo + 4;
  for (const inv of [inv1, inv2, inv3]) {
    const totals = invoiceTotals(inv);
    const t = tx(b, "income", inv.issueDate, totals.grossCents, "cat_b_in_20", customers.find((c) => c.id === inv.customerId), { description: `Rechnung ${inv.number} – ${inv.customerSnapshot.name}`, invoiceNumber: inv.number, dueDate: inv.dueDate, paidDate: inv.paidDate, invoiceId: inv.id, origin: "invoice", tags: ["rechnung"] });
    inv.transactionId = t.id;
  }

  /* ------------------------------------------------------------ */
  /* Bank statement (last month, business)                         */
  /* ------------------------------------------------------------ */
  const stFrom = iso(lastM.y, lastM.m, 1);
  const stTo = iso(lastM.y, lastM.m, 31);
  const statement: BankStatement = { id: id("bst"), profileId: b, documentId: "", iban: "AT402011100000012345", accountName: "Muster Design e.U.", bankName: "Erste Bank", from: stFrom, to: stTo, lineCount: 0, format: "csv", importedAt: now, warnings: [], createdAt: now, updatedAt: now };
  const lines: BankLine[] = [];
  const mkLine = (date: string, amountCents: number, counterparty: string, purpose: string, iban = "") => {
    lines.push({ id: id("bnk"), profileId: b, statementId: statement.id, date, valueDate: date, amountCents, currency: "EUR", counterparty, counterpartyIban: iban, purpose, reference: "", hash: `demo-${lines.length}`, status: "unmatched", createdAt: now, updatedAt: now });
  };
  for (const t of vault.transactions) {
    if (t.profileId !== b || t.kind === "transfer" || t.paymentMethod !== "bank") continue;
    const d = t.paidDate ?? t.date;
    if (d < stFrom || d > stTo) continue;
    const c = t.contactId ? vault.contacts.find((x) => x.id === t.contactId) : undefined;
    mkLine(d, t.kind === "income" ? t.grossCents : -t.grossCents, c?.name ?? t.description, t.invoiceNumber ? `${t.invoiceNumber} ${t.description}` : t.description, c?.iban ?? "");
  }
  mkLine(iso(lastM.y, lastM.m, 11), -4490, "Amazon EU S.a.r.L.", "AMZN Mktp AT 2X7F4-Bestellung 302-44711", "");
  mkLine(iso(lastM.y, lastM.m, 30), -1250, "Erste Bank", "Spesen Auslandsüberweisung");
  mkLine(iso(lastM.y, lastM.m, 24), 25000, "Mia Muster", "Privateinlage");
  statement.lineCount = lines.length;
  const r = reconcile(lines, vault.transactions.filter((t) => t.profileId === b), vault.contacts.filter((c) => c.profileId === b));
  vault.bankStatements.push(statement);
  vault.bankLines.push(...r.lines);

  /* ------------------------------------------------------------ */
  /* Employee settings                                             */
  /* ------------------------------------------------------------ */
  vault.settings.employee[e] = { monthlyGrossCents: cents(4180), monthlyNetCents: cents(2965.4), employerName: "TechNova GmbH", pendlerpauschaleCents: cents(696), pendlereuroCents: cents(38), homeofficeDays: 72 };
  vault.settings.onboardingDone = true;
  vault.settings.tourDone = false;
  vault.settings.demoMode = true;
  vault.settings.ai.provider = "none";
  vault.settings.notifications.uvaDaysBefore = 45;

  return { ids: { business: b, employee: e }, receiptTxId: receiptTx.id, invoiceTxId: invoiceTx.id };
}

/** Categories referenced by the demo – exported for tests. */
export const DEMO_CATEGORY_IDS: string[] = ["cat_b_in_20", "cat_b_ex_miete", "cat_b_ex_svs", "cat_b_ex_telefon", "cat_b_ex_software", "cat_b_ex_bank", "cat_b_ex_treibstoff", "cat_b_ex_bewirtung", "cat_b_ex_buero", "cat_b_ex_werbung", "cat_b_ex_stb", "cat_b_ex_reise", "cat_b_ex_gwg", "cat_b_ex_anlage", "cat_b_ex_fremd", "cat_b_ex_privat", "cat_e_in_gehalt", "cat_e_in_sonder", "cat_e_p_wohnen", "cat_e_p_energie", "cat_e_p_abos", "cat_e_p_gesundheit", "cat_e_wk_gewerkschaft", "cat_e_p_lebensmittel", "cat_e_p_restaurant", "cat_e_p_mobilitaet", "cat_e_wk_digital", "cat_e_wk_literatur", "cat_e_wk_fortbildung", "cat_e_agb_krankheit", "cat_e_sa_kirche", "cat_e_sa_spenden", "cat_e_sa_stb"];

export function isCategory(c: Category | undefined): c is Category {
  return !!c;
}
