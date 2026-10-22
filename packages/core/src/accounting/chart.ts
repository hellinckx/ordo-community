/**
 * Kontenplan nach dem Österreichischen Einheitskontenrahmen (EKR, Fachgutachten KFS/BW 6).
 * Klassen: 0 Anlagevermögen · 1 Vorräte · 2 Umlaufvermögen/Forderungen/Geld · 3 Verbindlichkeiten/Rückstellungen ·
 * 4 Betriebliche Erträge · 5 Material/Fremdleistungen · 6 Personal · 7 Abschreibungen & sonstige Aufwendungen ·
 * 8 Finanzerträge/-aufwendungen & Steuern · 9 Eigenkapital & Abschlusskonten
 */
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense" | "closing";

export interface Account {
  number: string;
  name: string;
  type: AccountType;
  /** Normal balance side. */
  side: "debit" | "credit";
  e1aKz?: string;
  group?: string;
}

const A = (number: string, name: string, type: AccountType, e1aKz?: string, group?: string): Account => ({
  number,
  name,
  type,
  side: type === "asset" || type === "expense" ? "debit" : "credit",
  e1aKz,
  group,
});

export const CHART_OF_ACCOUNTS: Account[] = [
  // 0 Anlagevermögen
  A("0100", "Software, Lizenzen (immaterielle Vermögensgegenstände)", "asset", undefined, "Anlagevermögen"),
  A("0200", "Grund und Boden", "asset", undefined, "Anlagevermögen"),
  A("0300", "Gebäude auf eigenem Grund", "asset", undefined, "Anlagevermögen"),
  A("0400", "Maschinen und technische Anlagen", "asset", undefined, "Anlagevermögen"),
  A("0600", "Betriebs- und Geschäftsausstattung", "asset", undefined, "Anlagevermögen"),
  A("0620", "Büromaschinen, EDV-Anlagen", "asset", undefined, "Anlagevermögen"),
  A("0630", "Fahrzeuge (Lkw, Kombi)", "asset", undefined, "Anlagevermögen"),
  A("0640", "Pkw", "asset", undefined, "Anlagevermögen"),
  A("0690", "Kumulierte Abschreibungen", "asset", undefined, "Anlagevermögen"),
  // 1 Vorräte
  A("1000", "Vorräte / Handelswaren", "asset", undefined, "Vorräte"),
  // 2 Umlaufvermögen
  A("2000", "Forderungen aus Lieferungen und Leistungen (Kunden)", "asset", undefined, "Forderungen"),
  A("2300", "Sonstige Forderungen", "asset", undefined, "Forderungen"),
  A("2500", "Vorsteuer", "asset", undefined, "Steuern"),
  A("2510", "Einfuhrumsatzsteuer", "asset", undefined, "Steuern"),
  A("2520", "Vorsteuer aus innergemeinschaftlichem Erwerb", "asset", undefined, "Steuern"),
  A("2530", "Vorsteuer aus Reverse Charge (§ 19)", "asset", undefined, "Steuern"),
  A("2700", "Kassa", "asset", undefined, "Geld"),
  A("2800", "Bank (Geschäftskonto)", "asset", undefined, "Geld"),
  A("2810", "PayPal / Zahlungsdienstleister", "asset", undefined, "Geld"),
  A("2820", "Kreditkarte (Verrechnung)", "asset", undefined, "Geld"),
  A("2900", "Aktive Rechnungsabgrenzung", "asset", undefined, "Abgrenzung"),
  // 3 Verbindlichkeiten
  A("3300", "Verbindlichkeiten aus Lieferungen und Leistungen (Lieferanten)", "liability", undefined, "Verbindlichkeiten"),
  A("3100", "Darlehen / Kredite", "liability", undefined, "Verbindlichkeiten"),
  A("3500", "Umsatzsteuer", "liability", undefined, "Steuern"),
  A("3510", "Umsatzsteuer aus innergemeinschaftlichem Erwerb", "liability", undefined, "Steuern"),
  A("3520", "Umsatzsteuer aus Reverse Charge (§ 19)", "liability", undefined, "Steuern"),
  A("3530", "Umsatzsteuer-Zahllast", "liability", undefined, "Steuern"),
  A("3540", "Finanzamt – Verrechnungskonto", "liability", undefined, "Steuern"),
  A("3600", "Verbindlichkeiten gegenüber Sozialversicherung", "liability", undefined, "Verbindlichkeiten"),
  A("3800", "Sonstige Verbindlichkeiten", "liability", undefined, "Verbindlichkeiten"),
  A("3900", "Passive Rechnungsabgrenzung", "liability", undefined, "Abgrenzung"),
  // 4 Erträge
  A("4000", "Erlöse 20 %", "revenue", "9040", "Erlöse"),
  A("4001", "Erlöse 10 %", "revenue", "9040", "Erlöse"),
  A("4002", "Erlöse 13 %", "revenue", "9040", "Erlöse"),
  A("4003", "Erlöse steuerfrei (Kleinunternehmer)", "revenue", "9040", "Erlöse"),
  A("4010", "Erlöse mit § 109a-Mitteilung", "revenue", "9050", "Erlöse"),
  A("4100", "Erlöse innergemeinschaftliche Lieferungen", "revenue", "9040", "Erlöse"),
  A("4110", "Erlöse Ausfuhrlieferungen", "revenue", "9040", "Erlöse"),
  A("4120", "Erlöse sonstige Leistungen Ausland (Reverse Charge)", "revenue", "9040", "Erlöse"),
  A("4400", "Erlösschmälerungen (Skonti, Rabatte)", "revenue", "9040", "Erlöse"),
  A("4600", "Erlöse aus dem Abgang von Anlagen", "revenue", "9060", "Sonstige Erträge"),
  A("4800", "Sonstige betriebliche Erträge", "revenue", "9090", "Sonstige Erträge"),
  // 5 Material
  A("5000", "Wareneinsatz / Materialaufwand", "expense", "9100", "Material"),
  A("5100", "Rohstoffe", "expense", "9100", "Material"),
  A("5700", "Fremdleistungen / Fremdpersonal", "expense", "9110", "Material"),
  // 6 Personal
  A("6000", "Löhne", "expense", "9120", "Personal"),
  A("6200", "Gehälter", "expense", "9120", "Personal"),
  A("6500", "Gesetzlicher Sozialaufwand (Dienstgeberanteile)", "expense", "9120", "Personal"),
  A("6700", "Freiwilliger Sozialaufwand", "expense", "9120", "Personal"),
  // 7 Abschreibungen & sonstige Aufwendungen
  A("7010", "Abschreibungen auf Sachanlagen (AfA)", "expense", "9130", "Abschreibungen"),
  A("7020", "Abschreibungen auf immaterielle Vermögensgegenstände", "expense", "9130", "Abschreibungen"),
  A("7030", "Geringwertige Wirtschaftsgüter (GWG)", "expense", "9130", "Abschreibungen"),
  A("7090", "Abschreibungen vom Umlaufvermögen / Forderungsausfälle", "expense", "9140", "Abschreibungen"),
  A("7100", "Sonstige Steuern, Gebühren, Kammerumlage", "expense", "9230", "Sonstige"),
  A("7200", "Instandhaltung Gebäude", "expense", "9150", "Instandhaltung"),
  A("7210", "Instandhaltung und Reparaturen sonstige", "expense", "9230", "Instandhaltung"),
  A("7220", "Reinigung", "expense", "9230", "Instandhaltung"),
  A("7300", "Fahrtkosten / Kilometergeld", "expense", "9160", "Reise/Kfz"),
  A("7320", "Kfz-Aufwand (Versicherung, Service, Maut)", "expense", "9170", "Reise/Kfz"),
  A("7330", "Treibstoff", "expense", "9170", "Reise/Kfz"),
  A("7340", "Reisekosten, Diäten, Nächtigung", "expense", "9160", "Reise/Kfz"),
  A("7350", "Öffi-Ticket (50 % pauschal)", "expense", "9165", "Reise/Kfz"),
  A("7400", "Miete und Pacht", "expense", "9180", "Raum"),
  A("7410", "Betriebskosten", "expense", "9230", "Raum"),
  A("7420", "Leasingaufwand", "expense", "9180", "Raum"),
  A("7450", "Energie (Strom, Gas, Heizung)", "expense", "9230", "Raum"),
  A("7500", "Provisionen an Dritte", "expense", "9190", "Vertrieb"),
  A("7510", "Lizenzgebühren", "expense", "9190", "Vertrieb"),
  A("7580", "Telefon, Internet", "expense", "9230", "Büro"),
  A("7590", "Porto, Versand", "expense", "9230", "Büro"),
  A("7600", "Büromaterial", "expense", "9230", "Büro"),
  A("7610", "Fachliteratur, Zeitschriften", "expense", "9230", "Büro"),
  A("7620", "Aus- und Weiterbildung", "expense", "9230", "Büro"),
  A("7650", "Werbung, Marketing, Repräsentation", "expense", "9200", "Werbung"),
  A("7660", "Bewirtungsaufwand", "expense", "9200", "Werbung"),
  A("7670", "Spenden", "expense", "9200", "Werbung"),
  A("7680", "Trinkgelder", "expense", "9200", "Werbung"),
  A("7700", "Versicherungen (betrieblich)", "expense", "9230", "Verwaltung"),
  A("7710", "Pflichtversicherung SVS", "expense", "9225", "Verwaltung"),
  A("7750", "Rechts- und Beratungsaufwand", "expense", "9230", "Verwaltung"),
  A("7760", "Steuerberatung, Buchhaltung", "expense", "9230", "Verwaltung"),
  A("7780", "Bankspesen, Zahlungsgebühren", "expense", "9230", "Verwaltung"),
  A("7790", "Software, EDV-Dienstleistungen, Hosting", "expense", "9230", "Verwaltung"),
  A("7800", "Buchwert abgegangener Anlagen", "expense", "9210", "Sonstige"),
  A("7900", "Arbeitsplatzpauschale", "expense", "9215", "Sonstige"),
  A("7905", "Ergonomisches Mobiliar", "expense", "9216", "Sonstige"),
  A("7910", "Arbeitszimmer", "expense", "9275", "Sonstige"),
  A("7990", "Übrige betriebliche Aufwendungen", "expense", "9230", "Sonstige"),
  // 8 Finanz
  A("8000", "Zinserträge", "revenue", "9090", "Finanzerträge"),
  A("8050", "Sonstige Finanzerträge", "revenue", "9090", "Finanzerträge"),
  A("8280", "Zinsen und ähnliche Aufwendungen", "expense", "9220", "Finanzaufwand"),
  A("8500", "Einkommensteuer (privat, nicht abzugsfähig)", "expense", undefined, "Steuern"),
  // 9 Eigenkapital
  A("9000", "Eigenkapital / Kapitalkonto", "equity", undefined, "Eigenkapital"),
  A("9600", "Privatentnahmen", "equity", undefined, "Eigenkapital"),
  A("9610", "Privateinlagen", "equity", undefined, "Eigenkapital"),
  A("9800", "Eröffnungsbilanzkonto", "closing", undefined, "Abschluss"),
  A("9850", "Schlussbilanzkonto", "closing", undefined, "Abschluss"),
  A("9890", "Gewinn- und Verlustkonto", "closing", undefined, "Abschluss"),
];

export const ACCOUNT_INDEX: Record<string, Account> = Object.fromEntries(CHART_OF_ACCOUNTS.map((a) => [a.number, a]));

export function accountName(number: string): string {
  return ACCOUNT_INDEX[number]?.name ?? `Konto ${number}`;
}

export function accountType(number: string): AccountType {
  const a = ACCOUNT_INDEX[number];
  if (a) return a.type;
  const cls = number.charAt(0);
  if (cls === "0" || cls === "1" || cls === "2") return "asset";
  if (cls === "3") return "liability";
  if (cls === "4") return "revenue";
  if (cls === "5" || cls === "6" || cls === "7") return "expense";
  if (cls === "8") return "revenue";
  return "equity";
}

/** Standard accounts used by the posting engine. */
export const STD = {
  receivables: "2000",
  payables: "3300",
  inputVat: "2500",
  inputVatIg: "2520",
  inputVatRc: "2530",
  cash: "2700",
  bank: "2800",
  paypal: "2810",
  card: "2820",
  outputVat: "3500",
  outputVatIg: "3510",
  outputVatRc: "3520",
  vatPayable: "3530",
  taxOffice: "3540",
  otherLiabilities: "3800",
  privateWithdrawal: "9600",
  privateDeposit: "9610",
  afa: "7010",
  gwg: "7030",
  assetBga: "0600",
  bookValueDisposed: "7800",
  assetDisposalRevenue: "4600",
  otherExpense: "7990",
  otherRevenue: "4800",
  revenue20: "4000",
  revenue10: "4001",
  revenue13: "4002",
  revenue0: "4003",
  equity: "9000",
  opening: "9800",
  closing: "9850",
  pnl: "9890",
} as const;
