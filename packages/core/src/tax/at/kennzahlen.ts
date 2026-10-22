/**
 * Amtliche Kennzahlen (KZ) der österreichischen Steuerformulare.
 *
 * Quellen (geprüft am 2026-10-20):
 *  - U 30 (Umsatzsteuervoranmeldung) 2026, Version vom 20.08.2025, BMF
 *  - E 2 Ausfüllhilfe 2025 (Erläuterungen zur Beilage E 1a), BMF
 *  - L 1 / L 1ab / L 1d 2025 (FinanzOnline-Masken und BMF "Arbeitnehmerveranlagung 2025")
 *
 * Die Beträge werden in FinanzOnline in Euro und Cent eingetragen; die App zeigt sie
 * im selben Format ("1234,56") zum direkten Übertragen an.
 */

export interface KennzahlDef {
  kz: string;
  label: string;
  section: string;
  /** Bemessungsgrundlage oder Steuerbetrag (nur UVA) */
  kind?: "base" | "tax" | "base+tax" | "amount";
  hint?: string;
}

/* ------------------------------------------------------------------ */
/* UVA – U 30 (2026)                                                   */
/* ------------------------------------------------------------------ */

export const UVA_KENNZAHLEN: KennzahlDef[] = [
  { kz: "000", section: "Lieferungen, sonstige Leistungen und Eigenverbrauch", kind: "base", label: "Gesamtbetrag der Bemessungsgrundlage für Lieferungen und sonstige Leistungen (ohne Eigenverbrauch) einschließlich Anzahlungen (jeweils ohne Umsatzsteuer)" },
  { kz: "001", section: "Lieferungen, sonstige Leistungen und Eigenverbrauch", kind: "base", label: "zuzüglich Eigenverbrauch (§ 1 Abs. 1 Z 2, § 3 Abs. 2 und § 3a Abs. 1a)" },
  { kz: "021", section: "Lieferungen, sonstige Leistungen und Eigenverbrauch", kind: "base", label: "abzüglich Umsätze, für die die Steuerschuld gemäß § 19 Abs. 1 zweiter Satz sowie gemäß § 19 Abs. 1a, 1b, 1c, 1d und 1e auf den Leistungsempfänger übergegangen ist" },
  { kz: "011", section: "Davon steuerfrei MIT Vorsteuerabzug", kind: "base", label: "§ 6 Abs. 1 Z 1 iVm § 7 (Ausfuhrlieferungen)" },
  { kz: "012", section: "Davon steuerfrei MIT Vorsteuerabzug", kind: "base", label: "§ 6 Abs. 1 Z 1 iVm § 8 (Lohnveredelungen)" },
  { kz: "015", section: "Davon steuerfrei MIT Vorsteuerabzug", kind: "base", label: "§ 6 Abs. 1 Z 2 bis 6, § 23 Abs. 5 (Seeschifffahrt, Luftfahrt, grenzüberschreitende Personenbeförderung, Diplomaten, Reisevorleistungen im Drittlandsgebiet usw.), § 28 Abs. 62 (Nullsatz Photovoltaikmodule)" },
  { kz: "017", section: "Davon steuerfrei MIT Vorsteuerabzug", kind: "base", label: "Art. 6 Abs. 1 (innergemeinschaftliche Lieferungen ohne die gesondert anzuführenden Fahrzeuglieferungen)" },
  { kz: "018", section: "Davon steuerfrei MIT Vorsteuerabzug", kind: "base", label: "Art. 6 Abs. 1, sofern Lieferungen neuer Fahrzeuge an Abnehmer ohne UID-Nummer bzw. durch Fahrzeuglieferer gemäß Art. 2 erfolgten" },
  { kz: "019", section: "Davon steuerfrei OHNE Vorsteuerabzug", kind: "base", label: "§ 6 Abs. 1 Z 9 lit. a (Grundstücksumsätze)" },
  { kz: "016", section: "Davon steuerfrei OHNE Vorsteuerabzug", kind: "base", label: "§ 6 Abs. 1 Z 27 (Kleinunternehmer)" },
  { kz: "020", section: "Davon steuerfrei OHNE Vorsteuerabzug", kind: "base", label: "§ 6 Abs. 1 Z … (übrige steuerfreie Umsätze ohne Vorsteuerabzug)" },
  { kz: "022", section: "Davon sind zu versteuern mit", kind: "base+tax", label: "20 % Normalsteuersatz" },
  { kz: "029", section: "Davon sind zu versteuern mit", kind: "base+tax", label: "10 % ermäßigter Steuersatz" },
  { kz: "006", section: "Davon sind zu versteuern mit", kind: "base+tax", label: "13 % ermäßigter Steuersatz" },
  { kz: "037", section: "Davon sind zu versteuern mit", kind: "base+tax", label: "19 % für Jungholz und Mittelberg" },
  { kz: "052", section: "Davon sind zu versteuern mit", kind: "base+tax", label: "10 % Zusatzsteuer für pauschalierte land- und forstwirtschaftliche Betriebe" },
  { kz: "007", section: "Davon sind zu versteuern mit", kind: "base+tax", label: "7 % Zusatzsteuer für pauschalierte land- und forstwirtschaftliche Betriebe" },
  { kz: "056", section: "Weiters zu versteuern", kind: "tax", label: "Steuerschuld gemäß § 11 Abs. 12 und 14, § 16 Abs. 2 sowie gemäß Art. 7 Abs. 4" },
  { kz: "057", section: "Weiters zu versteuern", kind: "tax", label: "Steuerschuld gemäß § 19 Abs. 1 zweiter Satz, § 19 Abs. 1c, 1e sowie gemäß Art. 25 Abs. 5 (Reverse Charge, empfangene Leistungen aus dem Ausland)" },
  { kz: "048", section: "Weiters zu versteuern", kind: "tax", label: "Steuerschuld gemäß § 19 Abs. 1a (Bauleistungen)" },
  { kz: "044", section: "Weiters zu versteuern", kind: "tax", label: "Steuerschuld gemäß § 19 Abs. 1b (Sicherungseigentum, Vorbehaltseigentum und Grundstücke im Zwangsversteigerungsverfahren)" },
  { kz: "032", section: "Weiters zu versteuern", kind: "tax", label: "Steuerschuld gemäß § 19 Abs. 1d (Schrott und Abfallstoffe; Videospielkonsolen, Laptops, Tablet-Computer, Gas und Elektrizität, Metalle, Anlagegold)" },
  { kz: "070", section: "Innergemeinschaftliche Erwerbe", kind: "base", label: "Gesamtbetrag der Bemessungsgrundlagen für innergemeinschaftliche Erwerbe" },
  { kz: "071", section: "Innergemeinschaftliche Erwerbe", kind: "base", label: "Davon steuerfrei gemäß Art. 6 Abs. 2 und § 28 Abs. 62" },
  { kz: "072", section: "Innergemeinschaftliche Erwerbe – zu versteuern mit", kind: "base+tax", label: "20 % Normalsteuersatz" },
  { kz: "073", section: "Innergemeinschaftliche Erwerbe – zu versteuern mit", kind: "base+tax", label: "10 % ermäßigter Steuersatz" },
  { kz: "008", section: "Innergemeinschaftliche Erwerbe – zu versteuern mit", kind: "base+tax", label: "13 % ermäßigter Steuersatz" },
  { kz: "088", section: "Innergemeinschaftliche Erwerbe – zu versteuern mit", kind: "base+tax", label: "19 % für Jungholz und Mittelberg" },
  { kz: "076", section: "Nicht zu versteuernde Erwerbe", kind: "base", label: "Erwerbe gemäß Art. 3 Abs. 8 zweiter Satz, die im Mitgliedstaat des Bestimmungslandes besteuert worden sind" },
  { kz: "077", section: "Nicht zu versteuernde Erwerbe", kind: "base", label: "Erwerbe gemäß Art. 3 Abs. 8 zweiter Satz, die gemäß Art. 25 Abs. 2 im Inland als besteuert gelten" },
  { kz: "060", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Gesamtbetrag der Vorsteuern (ohne die nachstehend gesondert anzuführenden Beträge)" },
  { kz: "061", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Vorsteuern betreffend die entrichtete Einfuhrumsatzsteuer (§ 12 Abs. 1 Z 2 lit. a)" },
  { kz: "083", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Vorsteuern betreffend die geschuldete, auf dem Abgabenkonto verbuchte Einfuhrumsatzsteuer (§ 12 Abs. 1 Z 2 lit. b)" },
  { kz: "065", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Vorsteuern aus dem innergemeinschaftlichen Erwerb" },
  { kz: "066", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Vorsteuern betreffend die Steuerschuld gemäß § 19 Abs. 1 zweiter Satz, § 19 Abs. 1c, 1e sowie gemäß Art. 25 Abs. 5 (Reverse Charge)" },
  { kz: "082", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Vorsteuern betreffend die Steuerschuld gemäß § 19 Abs. 1a (Bauleistungen)" },
  { kz: "087", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Vorsteuern betreffend die Steuerschuld gemäß § 19 Abs. 1b" },
  { kz: "089", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Vorsteuern betreffend die Steuerschuld gemäß § 19 Abs. 1d" },
  { kz: "064", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Vorsteuern für innergemeinschaftliche Lieferungen neuer Fahrzeuge von Fahrzeuglieferern gemäß Art. 2" },
  { kz: "062", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Davon nicht abzugsfähig gemäß § 12 Abs. 3 iVm Abs. 4 und 5" },
  { kz: "063", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Berichtigung gemäß § 12 Abs. 10 und 11" },
  { kz: "067", section: "Berechnung der abziehbaren Vorsteuer", kind: "tax", label: "Berichtigung gemäß § 16" },
  { kz: "090", section: "Sonstige Berichtigungen", kind: "tax", label: "Sonstige Berichtigungen" },
  { kz: "095", section: "Ergebnis", kind: "tax", label: "Vorauszahlung (Zahllast) bzw. Überschuss (Gutschrift)" },
];

/* ------------------------------------------------------------------ */
/* E 1a – Beilage zur Einkommensteuererklärung (2025)                  */
/* ------------------------------------------------------------------ */

export const E1A_KENNZAHLEN: KennzahlDef[] = [
  // Erträge / Betriebseinnahmen
  { kz: "9040", section: "Erträge/Betriebseinnahmen", kind: "amount", label: "Erlöse (Waren-/Leistungserlöse) ohne § 109a EStG 1988, EKR 40 – 44" },
  { kz: "9050", section: "Erträge/Betriebseinnahmen", kind: "amount", label: "Erträge/Betriebseinnahmen, für die eine Mitteilung nach § 109a EStG 1988 ausgestellt wurde, EKR 40 – 44", hint: "Immer ausfüllen, ggf. mit 0." },
  { kz: "9060", section: "Erträge/Betriebseinnahmen", kind: "amount", label: "Anlagenerträge/Entnahmewerte von Anlagevermögen, EKR 460 – 462" },
  { kz: "9070", section: "Erträge/Betriebseinnahmen", kind: "amount", label: "Aktivierte Eigenleistungen, EKR 458 – 459 (nur Bilanzierer)" },
  { kz: "9080", section: "Erträge/Betriebseinnahmen", kind: "amount", label: "Bestandsveränderungen, EKR 450 – 457 (nur Bilanzierer)" },
  { kz: "9090", section: "Erträge/Betriebseinnahmen", kind: "amount", label: "Übrige Erträge/Betriebseinnahmen (inklusive Finanzerträge)" },
  { kz: "9093", section: "Erträge/Betriebseinnahmen", kind: "amount", label: "Vereinnahmte USt bei USt-Bruttosystem (nur Einnahmen-Ausgaben-Rechner)" },
  // Aufwendungen / Betriebsausgaben
  { kz: "9100", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Waren, Rohstoffe, Hilfsstoffe, EKR 500 – 539, 580" },
  { kz: "9110", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Beigestelltes Personal (Fremdpersonal) und Fremdleistungen, EKR 570 – 579, 581, 750 – 753" },
  { kz: "9120", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Personalaufwand („eigenes Personal“), EKR 60 – 68" },
  { kz: "9130", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Abschreibungen auf das Anlagevermögen (z. B. AfA, geringwertige Wirtschaftsgüter), EKR 700 – 708" },
  { kz: "9134", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Degressive Absetzung für Abnutzung (§ 7 Abs. 1a)" },
  { kz: "9135", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Beschleunigte Gebäudeabschreibung (§ 8 Abs. 1a)" },
  { kz: "9140", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Abschreibungen vom Umlaufvermögen, soweit diese die üblichen Abschreibungen übersteigen, EKR 709" },
  { kz: "9142", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Dotierung/Auflösung von pauschalen Wertberichtigungen zu Forderungen" },
  { kz: "9150", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Instandhaltungen (Erhaltungsaufwand) für Gebäude, EKR 72" },
  { kz: "9160", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Reise- und Fahrtspesen inkl. Kilometergeld und Diäten (ohne tatsächliche Kfz-Kosten), EKR 734 – 737" },
  { kz: "9165", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Pauschale von 50 % der Kosten einer Wochen-, Monats- oder Jahreskarte für Massenbeförderungsmittel" },
  { kz: "9170", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Kfz-Kosten (ohne AfA, Leasing und Kilometergeld), EKR 732 – 733" },
  { kz: "9180", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Miet- und Pachtaufwand, Leasing, EKR 740 – 743, 744 – 747" },
  { kz: "9190", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Provisionen an Dritte, Lizenzgebühren, EKR 754 – 757, 748 – 749" },
  { kz: "9200", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Werbe- und Repräsentationsaufwendungen, Spenden, Trinkgelder, EKR 765 – 769" },
  { kz: "9210", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Buchwert abgegangener Anlagen, EKR 782" },
  { kz: "9275", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Arbeitszimmer" },
  { kz: "9215", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Kleines Arbeitsplatzpauschale (300 Euro für ein volles Wirtschaftsjahr)" },
  { kz: "9216", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Ausgaben/Aufwendungen für ergonomisch geeignetes Mobiliar" },
  { kz: "9217", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Großes Arbeitsplatzpauschale (1.200 Euro für ein volles Wirtschaftsjahr)" },
  { kz: "9220", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Zinsen und ähnliche Aufwendungen, EKR 828 – 834" },
  { kz: "9225", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Eigene Pflichtversicherung, Beiträge zu Versorgungs- und Unterstützungseinrichtungen und Beiträge zur Selbstständigenvorsorge" },
  { kz: "9230", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Übrige Betriebsausgaben – Saldo" },
  { kz: "9233", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Verausgabte USt bei USt-Bruttosystem (nur Einnahmen-Ausgaben-Rechner)" },
  { kz: "9259", section: "Aufwendungen/Betriebsausgaben", kind: "amount", label: "Pauschalierte Betriebsausgaben (Basispauschalierung / Kleinunternehmerpauschalierung)" },
  // Gewinnfreibetrag / Investitionsfreibetrag
  { kz: "9221", section: "Gewinnfreibetrag", kind: "amount", label: "Grundfreibetrag (15 % des Gewinns, max. 4.950 Euro)" },
  { kz: "9227", section: "Gewinnfreibetrag", kind: "amount", label: "Investitionsbedingter Gewinnfreibetrag für körperliche Wirtschaftsgüter" },
  { kz: "9229", section: "Gewinnfreibetrag", kind: "amount", label: "Investitionsbedingter Gewinnfreibetrag für Wertpapiere" },
  { kz: "9276", section: "Investitionsfreibetrag", kind: "amount", label: "Investitionsfreibetrag (10 %)" },
  { kz: "9277", section: "Investitionsfreibetrag", kind: "amount", label: "Investitionsfreibetrag (15 %)" },
  // Korrekturen
  { kz: "9240", section: "Korrekturen", kind: "amount", label: "Korrekturen zu Abschreibungen auf das Anlagevermögen – KZ 9130" },
  { kz: "9260", section: "Korrekturen", kind: "amount", label: "Korrekturen zu Kfz-Kosten (z. B. Privatanteil, Luxustangente)" },
  { kz: "9270", section: "Korrekturen", kind: "amount", label: "Korrekturen zu Miet- und Pachtaufwand, Leasing – KZ 9180" },
  { kz: "9280", section: "Korrekturen", kind: "amount", label: "Korrekturen zu Werbe- und Repräsentationsaufwendungen (z. B. 50 % Bewirtung) – KZ 9200" },
  { kz: "9290", section: "Korrekturen", kind: "amount", label: "Sonstige Änderungen – Saldo" },
  { kz: "9010", section: "Korrekturen", kind: "amount", label: "Wechsel der Gewinnermittlung (§ 4 Abs. 10)" },
  { kz: "9020", section: "Korrekturen", kind: "amount", label: "Betriebsveräußerung/-aufgabe" },
  { kz: "9030", section: "Korrekturen", kind: "amount", label: "Höhe eines auszuscheidenden Gewinnes oder Verlustes" },
  // Bilanzposten (nur Bilanzierer)
  { kz: "9300", section: "Bilanzposten (nur Bilanzierer)", kind: "amount", label: "Privatentnahmen (abzüglich Privateinlagen), EKR 96" },
  { kz: "9310", section: "Bilanzposten (nur Bilanzierer)", kind: "amount", label: "Grund und Boden (EKR 020 – 022)" },
  { kz: "9320", section: "Bilanzposten (nur Bilanzierer)", kind: "amount", label: "Gebäude auf eigenem Grund (EKR 030, 031)" },
  { kz: "9330", section: "Bilanzposten (nur Bilanzierer)", kind: "amount", label: "Finanzanlagen (EKR 08 – 09)" },
  { kz: "9340", section: "Bilanzposten (nur Bilanzierer)", kind: "amount", label: "Vorräte (EKR 100 – 199)" },
  { kz: "9350", section: "Bilanzposten (nur Bilanzierer)", kind: "amount", label: "Forderungen aus Lieferungen und Leistungen (EKR 20 – 21)" },
  { kz: "9360", section: "Bilanzposten (nur Bilanzierer)", kind: "amount", label: "Sonstige Rückstellungen, EKR 304 – 309" },
];

/* ------------------------------------------------------------------ */
/* L 1 / L 1ab / L 1d – Arbeitnehmerveranlagung (2025)                 */
/* ------------------------------------------------------------------ */

export const L1_KENNZAHLEN: KennzahlDef[] = [
  { kz: "718", section: "Pendlerpauschale/Pendlereuro (L 1)", kind: "amount", label: "Pendlerpauschale – tatsächlich zustehender Jahresbetrag (abzüglich Kostenersatz Öffi-Ticket)", hint: "Laut Pendlerrechner; nur wenn nicht bereits vom Arbeitgeber berücksichtigt." },
  { kz: "916", section: "Pendlerpauschale/Pendlereuro (L 1)", kind: "amount", label: "Pendlereuro (Absetzbetrag) – tatsächlich zustehender Jahresbetrag" },
  { kz: "717", section: "Werbungskosten (L 1)", kind: "amount", label: "Gewerkschaftsbeiträge und sonstige Beiträge zu Berufsverbänden und Interessensvertretungen (ausgenommen Betriebsratsumlage)" },
  { kz: "274", section: "Werbungskosten (L 1)", kind: "amount", label: "Pflichtbeiträge auf Grund einer geringfügigen Beschäftigung, Pflichtbeiträge für mitversicherte Angehörige sowie selbst einbezahlte SV-Beiträge" },
  { kz: "719", section: "Werbungskosten (L 1)", kind: "amount", label: "Arbeitsmittel" },
  { kz: "169", section: "Werbungskosten (L 1)", kind: "amount", label: "Digitale Arbeitsmittel (Computer, Telefon, Internet – beruflicher Anteil, abzüglich Homeoffice-Pauschale)" },
  { kz: "158", section: "Werbungskosten (L 1)", kind: "amount", label: "Gesamte Ausgaben für ergonomisch geeignetes Mobiliar für Telearbeit (max. 300 Euro/Jahr)" },
  { kz: "159", section: "Werbungskosten (L 1)", kind: "amount", label: "Arbeitszimmer" },
  { kz: "720", section: "Werbungskosten (L 1)", kind: "amount", label: "Fachliteratur (keine allgemein bildenden Werke)" },
  { kz: "721", section: "Werbungskosten (L 1)", kind: "amount", label: "Beruflich veranlasste Reisekosten (ohne Fahrtkosten Wohnung/Arbeitsstätte und Familienheimfahrten)" },
  { kz: "722", section: "Werbungskosten (L 1)", kind: "amount", label: "Fortbildungs-, Ausbildungs- und Umschulungskosten" },
  { kz: "300", section: "Werbungskosten (L 1)", kind: "amount", label: "Kosten für Familienheimfahrten" },
  { kz: "723", section: "Werbungskosten (L 1)", kind: "amount", label: "Kosten für doppelte Haushaltsführung" },
  { kz: "724", section: "Werbungskosten (L 1)", kind: "amount", label: "Sonstige Werbungskosten, die nicht unter die Kennzahlen 719, 720, 721, 722, 300 und 723 fallen (z. B. Betriebsratsumlage)" },
  { kz: "460", section: "Sonderausgaben (L 1d)", kind: "amount", label: "Steuerberatungskosten" },
  { kz: "280", section: "Sonderausgaben (L 1d)", kind: "amount", label: "Renten oder dauernde Lasten" },
  { kz: "458", section: "Sonderausgaben (L 1d)", kind: "amount", label: "Kirchenbeitrag – abweichend von der elektronischen Übermittlung zu berücksichtigender Gesamtbetrag (max. 600 Euro)", hint: "Wird normalerweise automatisch übermittelt." },
  { kz: "281", section: "Sonderausgaben (L 1d)", kind: "amount", label: "Spenden an begünstigte ausländische Organisationen (keine Datenübermittlung)" },
  { kz: "282", section: "Sonderausgaben (L 1d)", kind: "amount", label: "Verpflichtende Beiträge an eine ausländische Kirche oder Religionsgesellschaft" },
  { kz: "455", section: "Sonderausgaben (L 1d)", kind: "amount", label: "Versicherungsprämien und -beiträge (nur Altverträge vor 2016, Topf-Sonderausgaben)" },
  { kz: "456", section: "Sonderausgaben (L 1d)", kind: "amount", label: "Wohnraumschaffung/-sanierung (nur Altfälle, Topf-Sonderausgaben)" },
  { kz: "730", section: "Außergewöhnliche Belastungen mit Selbstbehalt (L 1ab)", kind: "amount", label: "Krankheitskosten (inkl. Zahnersatz)" },
  { kz: "731", section: "Außergewöhnliche Belastungen mit Selbstbehalt (L 1ab)", kind: "amount", label: "Begräbniskosten (soweit nicht durch Nachlassaktiva, Versicherungsleistungen o. ä. gedeckt)" },
  { kz: "734", section: "Außergewöhnliche Belastungen mit Selbstbehalt (L 1ab)", kind: "amount", label: "Kurkosten nach Abzug einer anteiligen Haushaltsersparnis für Verpflegung (5,23 Euro täglich)" },
  { kz: "735", section: "Außergewöhnliche Belastungen mit Selbstbehalt (L 1ab)", kind: "amount", label: "Sonstige außergewöhnliche Belastungen, die nicht unter die Kennzahlen 730, 731 und 734 fallen" },
  { kz: "475", section: "Außergewöhnliche Belastungen ohne Selbstbehalt (L 1ab)", kind: "amount", label: "Katastrophenschäden (abzüglich erhaltener Ersätze oder Vergütungen)" },
  { kz: "476", section: "Außergewöhnliche Belastungen bei Behinderung (L 1ab)", kind: "amount", label: "Unregelmäßige Ausgaben für Hilfsmittel sowie Kosten der Heilbehandlung (bei eigener Behinderung)" },
];

export const KENNZAHL_INDEX: Record<string, KennzahlDef> = Object.fromEntries(
  [...UVA_KENNZAHLEN, ...E1A_KENNZAHLEN, ...L1_KENNZAHLEN].map((k) => [k.kz, k]),
);

export function kzLabel(kz: string): string {
  return KENNZAHL_INDEX[kz]?.label ?? `Kennzahl ${kz}`;
}
