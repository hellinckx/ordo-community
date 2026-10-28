import type { Category } from "./types";

/**
 * Default categories. Each category knows its EKR account (doppelte Buchführung),
 * its E1a Kennzahl (Unternehmer) and/or L1 Kennzahl (Angestellte) and keywords used by the
 * automatic categorisation of extracted receipts.
 *
 * ids are stable so that user data stays mappable across versions.
 */
type Seed = Omit<Category, "createdAt" | "updatedAt" | "deletedAt" | "isSystem" | "defaultDeductiblePct" | "deductibleIncomePct" | "userKeywords" | "isArchived"> & { isSystem?: boolean; defaultDeductiblePct?: number; deductibleIncomePct?: number };

const stamp = "2026-01-01T00:00:00.000Z";

function cat(seed: Seed): Category {
  return { isSystem: true, defaultDeductiblePct: 100, deductibleIncomePct: 100, userKeywords: [], isArchived: false, createdAt: stamp, updatedAt: stamp, ...seed } as Category;
}

/* ------------------------------------------------------------------ */
/* Unternehmer – Einnahmen                                             */
/* ------------------------------------------------------------------ */

const BUSINESS_INCOME: Seed[] = [
  { id: "cat_b_in_20", name: "Erlöse 20 %", kind: "income", mode: "business", icon: "banknote", color: "#16a34a", ekrAccount: "4000", e1aKz: "9040", defaultVatRate: 20, keywords: ["honorar", "rechnung", "leistung"], sortOrder: 10 },
  { id: "cat_b_in_10", name: "Erlöse 10 %", kind: "income", mode: "business", icon: "banknote", color: "#16a34a", ekrAccount: "4001", e1aKz: "9040", defaultVatRate: 10, keywords: [], sortOrder: 11 },
  { id: "cat_b_in_13", name: "Erlöse 13 %", kind: "income", mode: "business", icon: "banknote", color: "#16a34a", ekrAccount: "4002", e1aKz: "9040", defaultVatRate: 13, keywords: [], sortOrder: 12 },
  { id: "cat_b_in_ku", name: "Erlöse Kleinunternehmer (steuerfrei)", kind: "income", mode: "business", icon: "banknote", color: "#16a34a", ekrAccount: "4003", e1aKz: "9040", defaultVatRate: 0, keywords: [], sortOrder: 13 },
  { id: "cat_b_in_109a", name: "Erlöse mit § 109a-Mitteilung", kind: "income", mode: "business", icon: "file-badge", color: "#15803d", ekrAccount: "4010", e1aKz: "9050", defaultVatRate: 20, keywords: ["109a", "werkvertrag", "vortrag"], sortOrder: 14 },
  { id: "cat_b_in_rc", name: "Erlöse Ausland (Reverse Charge)", kind: "income", mode: "business", icon: "globe", color: "#0d9488", ekrAccount: "4120", e1aKz: "9040", defaultVatRate: 0, keywords: ["reverse charge", "steuerschuldnerschaft"], sortOrder: 15 },
  { id: "cat_b_in_ig", name: "Innergemeinschaftliche Lieferung", kind: "income", mode: "business", icon: "globe", color: "#0d9488", ekrAccount: "4100", e1aKz: "9040", defaultVatRate: 0, keywords: ["innergemeinschaftlich"], sortOrder: 16 },
  { id: "cat_b_in_export", name: "Ausfuhrlieferung (Drittland)", kind: "income", mode: "business", icon: "ship", color: "#0d9488", ekrAccount: "4110", e1aKz: "9040", defaultVatRate: 0, keywords: ["export", "ausfuhr"], sortOrder: 17 },
  { id: "cat_b_in_anlage", name: "Anlagenverkauf", kind: "income", mode: "business", icon: "package", color: "#65a30d", ekrAccount: "4600", e1aKz: "9060", defaultVatRate: 20, keywords: [], sortOrder: 18 },
  { id: "cat_b_in_sonst", name: "Sonstige Erträge", kind: "income", mode: "business", icon: "plus-circle", color: "#65a30d", ekrAccount: "4800", e1aKz: "9090", defaultVatRate: 20, keywords: ["gutschrift", "förderung", "zuschuss"], sortOrder: 19 },
  { id: "cat_b_in_zins", name: "Zinserträge", kind: "income", mode: "business", icon: "percent", color: "#65a30d", ekrAccount: "8000", e1aKz: "9090", defaultVatRate: 0, keywords: ["zinsen", "habenzinsen"], sortOrder: 20 },
  { id: "cat_b_in_einlage", name: "Privateinlage", kind: "income", mode: "business", icon: "piggy-bank", color: "#94a3b8", ekrAccount: "9610", defaultVatRate: 0, keywords: ["einlage"], sortOrder: 21 },
];

/* ------------------------------------------------------------------ */
/* Unternehmer – Ausgaben                                              */
/* ------------------------------------------------------------------ */

const BUSINESS_EXPENSE: Seed[] = [
  { id: "cat_b_ex_waren", name: "Wareneinkauf / Material", kind: "expense", mode: "business", icon: "shopping-cart", color: "#ea580c", ekrAccount: "5000", e1aKz: "9100", defaultVatRate: 20, keywords: ["material", "rohstoff", "großhandel", "metro"], sortOrder: 100 },
  { id: "cat_b_ex_fremd", name: "Fremdleistungen / Subunternehmer", kind: "expense", mode: "business", icon: "users", color: "#ea580c", ekrAccount: "5700", e1aKz: "9110", defaultVatRate: 20, keywords: ["fremdleistung", "subunternehmer", "freelancer", "honorarnote", "werkvertrag", "upwork", "fiverr"], sortOrder: 101 },
  { id: "cat_b_ex_personal", name: "Personalaufwand", kind: "expense", mode: "business", icon: "user", color: "#ea580c", ekrAccount: "6000", e1aKz: "9120", defaultVatRate: 0, keywords: ["gehalt", "lohn", "ögk", "dienstgeber", "lohnverrechnung"], sortOrder: 102 },
  { id: "cat_b_ex_miete", name: "Miete / Pacht", kind: "expense", mode: "business", icon: "building", color: "#d97706", ekrAccount: "7400", e1aKz: "9180", defaultVatRate: 20, keywords: ["miete", "pacht", "büromiete", "coworking"], sortOrder: 110 },
  { id: "cat_b_ex_bk", name: "Betriebskosten", kind: "expense", mode: "business", icon: "building-2", color: "#d97706", ekrAccount: "7410", e1aKz: "9230", defaultVatRate: 10, keywords: ["betriebskosten", "hausverwaltung"], sortOrder: 111 },
  { id: "cat_b_ex_leasing", name: "Leasing", kind: "expense", mode: "business", icon: "car", color: "#d97706", ekrAccount: "7420", e1aKz: "9180", defaultVatRate: 20, keywords: ["leasing", "leasingrate"], sortOrder: 112 },
  { id: "cat_b_ex_energie", name: "Strom / Gas / Energie", kind: "expense", mode: "business", icon: "zap", color: "#d97706", ekrAccount: "7450", e1aKz: "9230", defaultVatRate: 20, keywords: ["strom", "gas", "energie", "wien energie", "verbund", "evn", "fernwärme", "heizung"], sortOrder: 113 },
  { id: "cat_b_ex_telefon", name: "Telefon / Internet", kind: "expense", mode: "business", icon: "phone", color: "#2563eb", ekrAccount: "7580", e1aKz: "9230", defaultVatRate: 20, keywords: ["telefon", "handy", "mobil", "internet", "magenta", "spusu", "yesss", "festnetz"], sortOrder: 120 },
  { id: "cat_b_ex_buero", name: "Büromaterial", kind: "expense", mode: "business", icon: "paperclip", color: "#2563eb", ekrAccount: "7600", e1aKz: "9230", defaultVatRate: 20, keywords: ["büro", "papier", "toner", "druckerpatrone", "libro", "pagro", "thalia", "schreibwaren", "stifte"], sortOrder: 121 },
  { id: "cat_b_ex_porto", name: "Porto / Versand", kind: "expense", mode: "business", icon: "mail", color: "#2563eb", ekrAccount: "7590", e1aKz: "9230", defaultVatRate: 20, keywords: ["porto", "versand", "dhl", "dpd", "gls", "paket", "briefmarke"], sortOrder: 122 },
  { id: "cat_b_ex_literatur", name: "Fachliteratur", kind: "expense", mode: "business", icon: "book-open", color: "#2563eb", ekrAccount: "7610", e1aKz: "9230", defaultVatRate: 10, keywords: ["buch", "fachbuch", "fachzeitschrift", "amazon kindle", "manz", "linde"], sortOrder: 123 },
  { id: "cat_b_ex_weiterbildung", name: "Aus- und Weiterbildung", kind: "expense", mode: "business", icon: "graduation-cap", color: "#2563eb", ekrAccount: "7620", e1aKz: "9230", defaultVatRate: 20, keywords: ["seminar", "schulung", "weiterbildung", "training", "workshop", "udemy", "coursera", "wifi", "bfi"], sortOrder: 124 },
  { id: "cat_b_ex_software", name: "Software / EDV-Dienste / Hosting", kind: "expense", mode: "business", icon: "monitor", color: "#7c3aed", ekrAccount: "7790", e1aKz: "9230", defaultVatRate: 20, keywords: ["software", "saas", "hosting", "domain", "microsoft", "adobe", "google workspace", "openai", "anthropic", "github", "netlify", "supabase", "vercel", "hetzner", "ionos", "world4you", "dropbox", "notion", "slack", "zoom", "subscription"], sortOrder: 125 },
  { id: "cat_b_ex_gwg", name: "Geringwertige Wirtschaftsgüter (bis 1.000 €)", kind: "expense", mode: "business", icon: "laptop", color: "#7c3aed", ekrAccount: "7030", e1aKz: "9130", defaultVatRate: 20, keywords: ["monitor", "tastatur", "maus", "drucker", "headset", "webcam", "handy", "smartphone", "tablet", "mediamarkt", "saturn", "e-tec", "ditech", "cyberport", "conrad"], sortOrder: 126 },
  { id: "cat_b_ex_anlage", name: "Anlagenkauf (über 1.000 €, wird abgeschrieben)", kind: "expense", mode: "business", icon: "package-plus", color: "#7c3aed", ekrAccount: "0600", defaultVatRate: 20, keywords: ["macbook", "notebook", "laptop", "maschine", "fahrzeug", "kamera"], sortOrder: 127 },
  { id: "cat_b_ex_afa", name: "Abschreibung (AfA)", kind: "expense", mode: "business", icon: "trending-down", color: "#7c3aed", ekrAccount: "7010", e1aKz: "9130", defaultVatRate: 0, keywords: [], sortOrder: 128 },
  { id: "cat_b_ex_werbung", name: "Werbung / Marketing", kind: "expense", mode: "business", icon: "megaphone", color: "#db2777", ekrAccount: "7650", e1aKz: "9200", defaultVatRate: 20, keywords: ["werbung", "marketing", "google ads", "meta ads", "facebook", "instagram", "anzeige", "inserat", "flyer", "visitenkarten", "druck", "website", "seo"], sortOrder: 130 },
  { id: "cat_b_ex_bewirtung", name: "Bewirtung (50 % abzugsfähig)", kind: "expense", mode: "business", icon: "utensils", color: "#db2777", ekrAccount: "7660", e1aKz: "9200", defaultVatRate: 10, deductibleIncomePct: 50, keywords: ["restaurant", "gasthaus", "bewirtung", "geschäftsessen", "wirtshaus", "pizzeria", "café", "bistro"], sortOrder: 131 },
  { id: "cat_b_ex_geschenke", name: "Geschenke / Repräsentation", kind: "expense", mode: "business", icon: "gift", color: "#db2777", ekrAccount: "7650", e1aKz: "9200", defaultVatRate: 20, keywords: ["geschenk", "präsent", "blumen"], sortOrder: 132 },
  { id: "cat_b_ex_spenden", name: "Spenden (betrieblich)", kind: "expense", mode: "business", icon: "heart-handshake", color: "#db2777", ekrAccount: "7670", e1aKz: "9200", defaultVatRate: 0, keywords: ["spende", "rotes kreuz", "caritas", "ärzte ohne grenzen"], sortOrder: 133 },
  { id: "cat_b_ex_trinkgeld", name: "Trinkgelder", kind: "expense", mode: "business", icon: "coins", color: "#db2777", ekrAccount: "7680", e1aKz: "9200", defaultVatRate: 0, keywords: ["trinkgeld"], sortOrder: 134 },
  { id: "cat_b_ex_reise", name: "Reisekosten / Diäten / Nächtigung", kind: "expense", mode: "business", icon: "plane", color: "#0891b2", ekrAccount: "7340", e1aKz: "9160", defaultVatRate: 10, keywords: ["hotel", "nächtigung", "flug", "austrian", "ryanair", "booking", "airbnb", "diäten", "taggeld", "öbb", "westbahn", "zugticket", "taxi", "uber", "bolt"], sortOrder: 140 },
  { id: "cat_b_ex_km", name: "Kilometergeld", kind: "expense", mode: "business", icon: "route", color: "#0891b2", ekrAccount: "7300", e1aKz: "9160", defaultVatRate: 0, keywords: ["kilometergeld", "fahrtenbuch"], sortOrder: 141 },
  { id: "cat_b_ex_oeffi", name: "Öffi-Ticket (Wochen-/Monats-/Jahreskarte)", kind: "expense", mode: "business", icon: "train", color: "#0891b2", ekrAccount: "7350", e1aKz: "9165", defaultVatRate: 10, keywords: ["klimaticket", "jahreskarte", "monatskarte", "wiener linien", "öbb vorteilscard"], sortOrder: 142 },
  { id: "cat_b_ex_kfz", name: "Kfz-Kosten (Versicherung, Service, Maut)", kind: "expense", mode: "business", icon: "car-front", color: "#0891b2", ekrAccount: "7320", e1aKz: "9170", defaultVatRate: 20, defaultDeductiblePct: 0, keywords: ["kfz", "pkw", "auto", "werkstatt", "reifen", "vignette", "asfinag", "maut", "parken", "garage", "öamtc", "arbö", "autoversicherung"], sortOrder: 143 },
  { id: "cat_b_ex_treibstoff", name: "Treibstoff", kind: "expense", mode: "business", icon: "fuel", color: "#0891b2", ekrAccount: "7330", e1aKz: "9170", defaultVatRate: 20, defaultDeductiblePct: 0, keywords: ["tankstelle", "diesel", "benzin", "omv", "shell", "eni", "avanti", "turmöl", "ladestrom"], sortOrder: 144 },
  { id: "cat_b_ex_instand_geb", name: "Instandhaltung Gebäude", kind: "expense", mode: "business", icon: "hammer", color: "#4b5563", ekrAccount: "7200", e1aKz: "9150", defaultVatRate: 20, keywords: ["sanierung", "maler", "installateur", "elektriker"], sortOrder: 150 },
  { id: "cat_b_ex_reparatur", name: "Reparaturen / Instandhaltung sonstige", kind: "expense", mode: "business", icon: "wrench", color: "#4b5563", ekrAccount: "7210", e1aKz: "9230", defaultVatRate: 20, keywords: ["reparatur", "wartung", "instandhaltung", "baumarkt", "obi", "hornbach", "bauhaus"], sortOrder: 151 },
  { id: "cat_b_ex_reinigung", name: "Reinigung", kind: "expense", mode: "business", icon: "sparkles", color: "#4b5563", ekrAccount: "7220", e1aKz: "9230", defaultVatRate: 20, keywords: ["reinigung", "putz"], sortOrder: 152 },
  { id: "cat_b_ex_versicherung", name: "Versicherungen (betrieblich)", kind: "expense", mode: "business", icon: "shield", color: "#4b5563", ekrAccount: "7700", e1aKz: "9230", defaultVatRate: 0, keywords: ["versicherung", "haftpflicht", "betriebsversicherung", "uniqa", "wiener städtische", "generali", "allianz", "donau", "zürich", "grawe"], sortOrder: 153 },
  { id: "cat_b_ex_svs", name: "SVS Pflichtversicherung (eigene)", kind: "expense", mode: "business", icon: "heart-pulse", color: "#4b5563", ekrAccount: "7710", e1aKz: "9225", defaultVatRate: 0, keywords: ["svs", "sozialversicherung der selbständigen", "pflichtversicherung", "selbständigenvorsorge"], sortOrder: 154 },
  { id: "cat_b_ex_beratung", name: "Rechts- und Beratungskosten", kind: "expense", mode: "business", icon: "scale", color: "#4b5563", ekrAccount: "7750", e1aKz: "9230", defaultVatRate: 20, keywords: ["rechtsanwalt", "notar", "beratung", "consulting", "anwalt"], sortOrder: 155 },
  { id: "cat_b_ex_stb", name: "Steuerberatung / Buchhaltung", kind: "expense", mode: "business", icon: "calculator", color: "#4b5563", ekrAccount: "7760", e1aKz: "9230", defaultVatRate: 20, keywords: ["steuerberat", "buchhaltung", "bilanzbuchhalter", "wirtschaftstreuhand", "tpa", "bdo", "lbg"], sortOrder: 156 },
  { id: "cat_b_ex_bank", name: "Bankspesen / Zahlungsgebühren", kind: "expense", mode: "business", icon: "landmark", color: "#4b5563", ekrAccount: "7780", e1aKz: "9230", defaultVatRate: 0, keywords: ["kontoführung", "spesen", "bankgebühr", "paypal gebühr", "stripe", "sumup", "kartengebühr"], sortOrder: 157 },
  { id: "cat_b_ex_zinsen", name: "Zinsen / Finanzierungskosten", kind: "expense", mode: "business", icon: "percent", color: "#4b5563", ekrAccount: "8280", e1aKz: "9220", defaultVatRate: 0, keywords: ["zinsen", "kredit", "darlehen", "sollzinsen"], sortOrder: 158 },
  { id: "cat_b_ex_steuern", name: "Steuern / Gebühren / Kammerumlage", kind: "expense", mode: "business", icon: "receipt", color: "#4b5563", ekrAccount: "7100", e1aKz: "9230", defaultVatRate: 0, keywords: ["gebühr", "kammerumlage", "wko", "grundumlage", "abgabe", "magistrat", "gemeinde", "gis", "ors"], sortOrder: 159 },
  { id: "cat_b_ex_provision", name: "Provisionen an Dritte", kind: "expense", mode: "business", icon: "handshake", color: "#4b5563", ekrAccount: "7500", e1aKz: "9190", defaultVatRate: 20, keywords: ["provision", "vermittlung", "affiliate"], sortOrder: 160 },
  { id: "cat_b_ex_lizenz", name: "Lizenzgebühren (an Dritte)", kind: "expense", mode: "business", icon: "key", color: "#4b5563", ekrAccount: "7510", e1aKz: "9190", defaultVatRate: 20, keywords: ["lizenzgebühr", "royalty"], sortOrder: 161 },
  { id: "cat_b_ex_arbeitsplatz", name: "Arbeitsplatzpauschale (Homeoffice)", kind: "expense", mode: "business", icon: "home", color: "#4b5563", ekrAccount: "7900", e1aKz: "9215", defaultVatRate: 0, keywords: ["arbeitsplatzpauschale"], sortOrder: 162 },
  { id: "cat_b_ex_mobiliar", name: "Ergonomisches Mobiliar (Homeoffice)", kind: "expense", mode: "business", icon: "armchair", color: "#4b5563", ekrAccount: "7905", e1aKz: "9216", defaultVatRate: 20, keywords: ["bürosessel", "schreibtisch", "bürostuhl", "ikea", "ergonomisch"], sortOrder: 163 },
  { id: "cat_b_ex_arbeitszimmer", name: "Arbeitszimmer", kind: "expense", mode: "business", icon: "door-open", color: "#4b5563", ekrAccount: "7910", e1aKz: "9275", defaultVatRate: 20, keywords: ["arbeitszimmer"], sortOrder: 164 },
  { id: "cat_b_ex_sonst", name: "Sonstige Betriebsausgaben", kind: "expense", mode: "business", icon: "more-horizontal", color: "#64748b", ekrAccount: "7990", e1aKz: "9230", defaultVatRate: 20, keywords: [], sortOrder: 190 },
  { id: "cat_b_ex_privat", name: "Privatentnahme (nicht abzugsfähig)", kind: "expense", mode: "business", icon: "user-minus", color: "#94a3b8", ekrAccount: "9600", defaultVatRate: 0, defaultDeductiblePct: 0, deductibleIncomePct: 0, keywords: ["privat", "entnahme"], sortOrder: 199 },
];

/* ------------------------------------------------------------------ */
/* Angestellte – Einnahmen                                             */
/* ------------------------------------------------------------------ */

const EMPLOYEE_INCOME: Seed[] = [
  { id: "cat_e_in_gehalt", name: "Gehalt / Lohn", kind: "income", mode: "employee", icon: "wallet", color: "#16a34a", defaultVatRate: 0, keywords: ["gehalt", "lohn", "bezug", "lohnzettel"], sortOrder: 10 },
  { id: "cat_e_in_sonder", name: "Sonderzahlung (Urlaubs-/Weihnachtsgeld)", kind: "income", mode: "employee", icon: "gift", color: "#16a34a", defaultVatRate: 0, keywords: ["urlaubsgeld", "weihnachtsgeld"], sortOrder: 11 },
  { id: "cat_e_in_neben", name: "Nebeneinkünfte", kind: "income", mode: "employee", icon: "briefcase", color: "#15803d", defaultVatRate: 0, keywords: ["nebenjob", "honorar"], sortOrder: 12 },
  { id: "cat_e_in_kapital", name: "Kapitalerträge / Zinsen", kind: "income", mode: "employee", icon: "percent", color: "#15803d", defaultVatRate: 0, keywords: ["zinsen", "dividende"], sortOrder: 13 },
  { id: "cat_e_in_transfer", name: "Familienbeihilfe / Förderungen", kind: "income", mode: "employee", icon: "baby", color: "#15803d", defaultVatRate: 0, keywords: ["familienbeihilfe", "kinderbetreuungsgeld", "förderung"], sortOrder: 14 },
  { id: "cat_e_in_geschenke", name: "Taschengeld / Geschenke", kind: "income", mode: "employee", icon: "gift", color: "#15803d", defaultVatRate: 0, keywords: ["taschengeld", "geschenk", "geburtstagsgeld", "osterhase", "weihnachtsgeschenk"], sortOrder: 15 },
  { id: "cat_e_in_sonst", name: "Sonstige Einnahmen", kind: "income", mode: "employee", icon: "plus-circle", color: "#65a30d", defaultVatRate: 0, keywords: ["rückerstattung", "steuerausgleich", "gutschrift"], sortOrder: 15 },
];

/* ------------------------------------------------------------------ */
/* Angestellte – Ausgaben (steuerlich relevant → L1 Kennzahlen)        */
/* ------------------------------------------------------------------ */

const EMPLOYEE_TAX_EXPENSE: Seed[] = [
  { id: "cat_e_wk_arbeitsmittel", name: "Arbeitsmittel (Werbungskosten)", kind: "expense", mode: "employee", icon: "briefcase", color: "#2563eb", l1Kz: "719", defaultVatRate: 20, keywords: ["werkzeug", "arbeitskleidung", "arbeitsmittel", "fachsoftware"], sortOrder: 100 },
  { id: "cat_e_wk_digital", name: "Digitale Arbeitsmittel (Computer, Handy, Internet)", kind: "expense", mode: "employee", icon: "laptop", color: "#2563eb", l1Kz: "169", defaultVatRate: 20, keywords: ["laptop", "notebook", "computer", "monitor", "handy", "smartphone", "internet", "drucker", "mediamarkt", "saturn", "magenta"], sortOrder: 101 },
  { id: "cat_e_wk_mobiliar", name: "Ergonomisches Mobiliar Homeoffice (max. 300 €)", kind: "expense", mode: "employee", icon: "armchair", color: "#2563eb", l1Kz: "158", defaultVatRate: 20, keywords: ["bürosessel", "bürostuhl", "schreibtisch", "ikea"], sortOrder: 102 },
  { id: "cat_e_wk_literatur", name: "Fachliteratur", kind: "expense", mode: "employee", icon: "book-open", color: "#2563eb", l1Kz: "720", defaultVatRate: 10, keywords: ["fachbuch", "fachzeitschrift", "fachliteratur"], sortOrder: 103 },
  { id: "cat_e_wk_reise", name: "Beruflich veranlasste Reisekosten", kind: "expense", mode: "employee", icon: "plane", color: "#2563eb", l1Kz: "721", defaultVatRate: 10, keywords: ["dienstreise", "hotel", "öbb", "flug"], sortOrder: 104 },
  { id: "cat_e_wk_fortbildung", name: "Fortbildung / Ausbildung / Umschulung", kind: "expense", mode: "employee", icon: "graduation-cap", color: "#2563eb", l1Kz: "722", defaultVatRate: 20, keywords: ["seminar", "studium", "studiengebühr", "öh-beitrag", "wifi", "bfi", "fernstudium", "udemy", "sprachkurs", "fortbildung", "ausbildung"], sortOrder: 105 },
  { id: "cat_e_wk_heimfahrt", name: "Familienheimfahrten", kind: "expense", mode: "employee", icon: "route", color: "#2563eb", l1Kz: "300", defaultVatRate: 0, keywords: ["heimfahrt"], sortOrder: 106 },
  { id: "cat_e_wk_haushalt", name: "Doppelte Haushaltsführung", kind: "expense", mode: "employee", icon: "home", color: "#2563eb", l1Kz: "723", defaultVatRate: 0, keywords: ["zweitwohnung", "doppelte haushaltsführung"], sortOrder: 107 },
  { id: "cat_e_wk_gewerkschaft", name: "Gewerkschaft / Berufsverband", kind: "expense", mode: "employee", icon: "users", color: "#2563eb", l1Kz: "717", defaultVatRate: 0, keywords: ["gewerkschaft", "ögb", "gpa", "vida", "berufsverband", "kammer"], sortOrder: 108 },
  { id: "cat_e_wk_sv", name: "Selbst bezahlte SV-Beiträge (geringfügig/Mitversicherung)", kind: "expense", mode: "employee", icon: "heart-pulse", color: "#2563eb", l1Kz: "274", defaultVatRate: 0, keywords: ["ögk", "selbstversicherung", "mitversicherung", "sozialversicherung"], sortOrder: 109 },
  { id: "cat_e_wk_arbeitszimmer", name: "Arbeitszimmer", kind: "expense", mode: "employee", icon: "door-open", color: "#2563eb", l1Kz: "159", defaultVatRate: 0, keywords: ["arbeitszimmer"], sortOrder: 110 },
  { id: "cat_e_wk_sonst", name: "Sonstige Werbungskosten (z. B. Betriebsratsumlage, Bewerbung)", kind: "expense", mode: "employee", icon: "more-horizontal", color: "#2563eb", l1Kz: "724", defaultVatRate: 20, keywords: ["betriebsratsumlage", "bewerbung", "bewerbungskosten"], sortOrder: 111 },
  { id: "cat_e_sa_stb", name: "Steuerberatungskosten", kind: "expense", mode: "employee", icon: "calculator", color: "#7c3aed", l1Kz: "460", defaultVatRate: 20, keywords: ["steuerberat"], sortOrder: 120 },
  { id: "cat_e_sa_kirche", name: "Kirchenbeitrag (wird automatisch gemeldet)", kind: "expense", mode: "employee", icon: "church", color: "#7c3aed", l1Kz: "458", defaultVatRate: 0, keywords: ["kirchenbeitrag", "kirche", "diözese", "erzdiözese"], sortOrder: 121 },
  { id: "cat_e_sa_spenden", name: "Spenden (werden automatisch gemeldet)", kind: "expense", mode: "employee", icon: "heart-handshake", color: "#7c3aed", defaultVatRate: 0, keywords: ["spende", "rotes kreuz", "caritas", "ärzte ohne grenzen", "sos kinderdorf", "wwf", "unicef"], sortOrder: 122 },
  { id: "cat_e_sa_renten", name: "Renten / dauernde Lasten", kind: "expense", mode: "employee", icon: "file-text", color: "#7c3aed", l1Kz: "280", defaultVatRate: 0, keywords: ["leibrente"], sortOrder: 123 },
  { id: "cat_e_agb_krankheit", name: "Krankheitskosten (inkl. Zahnersatz)", kind: "expense", mode: "employee", icon: "stethoscope", color: "#dc2626", l1Kz: "730", defaultVatRate: 0, keywords: ["arzt", "zahnarzt", "apotheke", "rezeptgebühr", "medikament", "brille", "optiker", "hörgerät", "physiotherapie", "krankenhaus", "spital", "ordination", "selbstbehalt", "therapie", "psychotherapie", "fielmann", "pearle", "zahnersatz", "kieferorthop"], sortOrder: 130 },
  { id: "cat_e_agb_begraebnis", name: "Begräbniskosten", kind: "expense", mode: "employee", icon: "flower", color: "#dc2626", l1Kz: "731", defaultVatRate: 0, keywords: ["begräbnis", "bestattung", "friedhof", "grab"], sortOrder: 131 },
  { id: "cat_e_agb_kur", name: "Kurkosten", kind: "expense", mode: "employee", icon: "bath", color: "#dc2626", l1Kz: "734", defaultVatRate: 0, keywords: ["kur", "reha", "kuraufenthalt"], sortOrder: 132 },
  { id: "cat_e_agb_sonst", name: "Sonstige außergewöhnliche Belastungen (Pflegeheim, Kinderwunsch …)", kind: "expense", mode: "employee", icon: "life-buoy", color: "#dc2626", l1Kz: "735", defaultVatRate: 0, keywords: ["pflegeheim", "altersheim", "adoption", "kinderwunsch", "24-stunden-betreuung"], sortOrder: 133 },
  { id: "cat_e_agb_katastrophe", name: "Katastrophenschäden", kind: "expense", mode: "employee", icon: "cloud-lightning", color: "#dc2626", l1Kz: "475", defaultVatRate: 0, keywords: ["hochwasser", "sturmschaden", "katastrophe"], sortOrder: 134 },
  { id: "cat_e_agb_hilfsmittel", name: "Hilfsmittel / Heilbehandlung bei Behinderung", kind: "expense", mode: "employee", icon: "accessibility", color: "#dc2626", l1Kz: "476", defaultVatRate: 0, keywords: ["rollstuhl", "hilfsmittel", "behinderung"], sortOrder: 135 },
];

/* ------------------------------------------------------------------ */
/* Angestellte – private Ausgaben (Budget, nicht steuerlich)           */
/* ------------------------------------------------------------------ */

const EMPLOYEE_PRIVATE_EXPENSE: Seed[] = [
  { id: "cat_e_p_wohnen", name: "Wohnen (Miete, Betriebskosten)", kind: "expense", mode: "employee", icon: "home", color: "#d97706", defaultVatRate: 10, keywords: ["miete", "betriebskosten", "hausverwaltung", "genossenschaft", "wohnbau"], sortOrder: 200 },
  { id: "cat_e_p_energie", name: "Strom / Gas / Heizung", kind: "expense", mode: "employee", icon: "zap", color: "#d97706", defaultVatRate: 20, keywords: ["strom", "gas", "energie", "wien energie", "verbund", "evn", "fernwärme"], sortOrder: 201 },
  { id: "cat_e_p_lebensmittel", name: "Lebensmittel / Supermarkt", kind: "expense", mode: "employee", icon: "shopping-basket", color: "#ea580c", defaultVatRate: 10, keywords: ["billa", "spar", "hofer", "lidl", "penny", "merkur", "interspar", "eurospar", "mpreis", "unimarkt", "denns", "bipa", "dm", "müller", "supermarkt", "bäckerei", "anker", "ströck"], sortOrder: 202 },
  { id: "cat_e_p_restaurant", name: "Restaurants / Essen gehen", kind: "expense", mode: "employee", icon: "utensils", color: "#ea580c", defaultVatRate: 10, keywords: ["restaurant", "gasthaus", "pizzeria", "mcdonald", "burger king", "kebap", "sushi", "lieferando", "foodora", "wolt", "café", "kaffee", "wirtshaus", "heuriger", "bar"], sortOrder: 203 },
  { id: "cat_e_p_mobilitaet", name: "Mobilität (Öffis, Auto, Tanken)", kind: "expense", mode: "employee", icon: "car", color: "#0891b2", defaultVatRate: 20, keywords: ["wiener linien", "öbb", "klimaticket", "tankstelle", "omv", "shell", "avanti", "jet", "bp", "eni", "turmöl", "parken", "wipark", "apcoa", "vignette", "asfinag", "taxi", "uber", "bolt", "werkstatt", "reifen", "öamtc", "arbö", "westbahn", "carsharing", "sharenow", "flixbus", "ryanair", "austrian airlines"], sortOrder: 204 },
  { id: "cat_e_p_versicherung", name: "Versicherungen (privat)", kind: "expense", mode: "employee", icon: "shield", color: "#4b5563", defaultVatRate: 0, keywords: ["versicherung", "haushaltsversicherung", "uniqa", "wiener städtische", "generali", "allianz", "donau", "grawe", "zürich", "helvetia", "wüstenrot", "merkur versicherung", "ergo", "muki", "oberösterreichische"], sortOrder: 205 },
  { id: "cat_e_p_gesundheit", name: "Gesundheit / Drogerie (nicht absetzbar)", kind: "expense", mode: "employee", icon: "heart", color: "#dc2626", defaultVatRate: 20, keywords: ["fitness", "fitnessstudio", "mcfit", "clever fit", "kosmetik", "friseur", "drogerie", "nahrungsergänzung", "optiker", "fielmann", "pearle", "massage"], sortOrder: 206 },
  { id: "cat_e_p_kleidung", name: "Kleidung / Schuhe", kind: "expense", mode: "employee", icon: "shirt", color: "#db2777", defaultVatRate: 20, keywords: ["h&m", "zara", "peek", "c&a", "humanic", "deichmann", "zalando", "about you", "kleidung", "schuhe", "mode", "intersport", "hervis", "decathlon", "primark", "uniqlo"], sortOrder: 207 },
  { id: "cat_e_p_freizeit", name: "Freizeit / Kultur / Reisen", kind: "expense", mode: "employee", icon: "ticket", color: "#db2777", defaultVatRate: 13, keywords: ["kino", "cineplexx", "theater", "konzert", "museum", "oeticket", "schwimmbad", "therme", "ski", "urlaub", "hotel", "booking", "airbnb", "expedia", "reisebüro", "tui", "camping"], sortOrder: 208 },
  { id: "cat_e_p_abos", name: "Abos / Streaming", kind: "expense", mode: "employee", icon: "tv", color: "#7c3aed", defaultVatRate: 20, keywords: ["netflix", "spotify", "disney", "amazon prime", "youtube", "canal+", "dazn", "sky", "apple tv", "apple music", "icloud", "google one", "gis", "ors", "zeitung", "abo"], sortOrder: 209 },
  { id: "cat_e_p_telefon", name: "Telefon / Internet", kind: "expense", mode: "employee", icon: "smartphone", color: "#7c3aed", defaultVatRate: 20, keywords: ["magenta", "a1", "drei", "spusu", "yesss", "hot", "bob", "educom", "festnetz", "internet", "mobilfunk", "handyvertrag", "kabelplus", "liwest"], sortOrder: 210 },
  { id: "cat_e_p_kinder", name: "Kinder / Betreuung / Schule", kind: "expense", mode: "employee", icon: "baby", color: "#0d9488", defaultVatRate: 0, keywords: ["kindergarten", "hort", "schule", "schulgeld", "nachhilfe", "kinderbetreuung", "spielzeug", "windeln", "babyartikel"], sortOrder: 211 },
  { id: "cat_e_p_bildung", name: "Bildung / Bücher (privat)", kind: "expense", mode: "employee", icon: "graduation-cap", color: "#0d9488", defaultVatRate: 10, keywords: ["vhs", "volkshochschule", "sprachschule", "musikschule", "kurs", "seminar", "thalia", "morawa", "buchhandlung", "udemy", "coursera", "duolingo"], sortOrder: 212 },
  { id: "cat_e_p_haushalt", name: "Haushalt / Möbel", kind: "expense", mode: "employee", icon: "sofa", color: "#64748b", defaultVatRate: 20, keywords: ["ikea", "xxxlutz", "möbelix", "kika", "leiner", "obi", "hornbach", "bauhaus", "bellaflora", "dehner", "tchibo", "haushalt", "möbel", "reinigung", "waschmittel"], sortOrder: 213 },
  { id: "cat_e_p_elektronik", name: "Elektronik / Technik", kind: "expense", mode: "employee", icon: "laptop", color: "#64748b", defaultVatRate: 20, keywords: ["mediamarkt", "saturn", "apple", "cyberport", "e-tec", "ditech", "conrad", "alternate", "amazon", "galaxus", "notebook", "laptop", "smartphone", "kopfhörer"], sortOrder: 214 },
  { id: "cat_e_p_geschenke", name: "Geschenke / Spenden", kind: "expense", mode: "employee", icon: "gift", color: "#64748b", defaultVatRate: 20, keywords: ["geschenk", "spende", "caritas", "rotes kreuz", "ärzte ohne grenzen", "sos kinderdorf", "patenschaft"], sortOrder: 215 },
  { id: "cat_e_p_sparen", name: "Sparen / Investieren", kind: "expense", mode: "employee", icon: "piggy-bank", color: "#16a34a", defaultVatRate: 0, keywords: ["sparplan", "etf", "depot", "flatex", "trade republic", "bausparen", "scalable", "bitpanda"], sortOrder: 216 },
  { id: "cat_e_p_kredit", name: "Kredit / Ratenzahlung", kind: "expense", mode: "employee", icon: "landmark", color: "#64748b", defaultVatRate: 0, keywords: ["kredit", "darlehen", "leasing", "ratenzahlung", "klarna"], sortOrder: 217 },
  { id: "cat_e_p_sonst", name: "Sonstiges (privat)", kind: "expense", mode: "employee", icon: "more-horizontal", color: "#64748b", defaultVatRate: 20, keywords: [], sortOrder: 290 },
];

export const DEFAULT_CATEGORIES: Category[] = [
  ...BUSINESS_INCOME,
  ...BUSINESS_EXPENSE,
  ...EMPLOYEE_INCOME,
  ...EMPLOYEE_TAX_EXPENSE,
  ...EMPLOYEE_PRIVATE_EXPENSE,
].map(cat);

export const FALLBACK_CATEGORY = {
  business: { expense: "cat_b_ex_sonst", income: "cat_b_in_sonst" },
  employee: { expense: "cat_e_p_sonst", income: "cat_e_in_sonst" },
} as const;

/** Category ids with special meaning in the engines. */
export const SPECIAL_CATEGORIES = {
  assetPurchase: "cat_b_ex_anlage",
  gwg: "cat_b_ex_gwg",
  afa: "cat_b_ex_afa",
  privateWithdrawal: "cat_b_ex_privat",
  privateDeposit: "cat_b_in_einlage",
  salary: "cat_e_in_gehalt",
} as const;
