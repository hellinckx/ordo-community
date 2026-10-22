/**
 * Programs Austrian firms use, and the best way to connect each with Ordo today. Shown in Einstellungen →
 * Schnittstellen and given to Atlas, so it can explain and set up the right way instead of guessing.
 * "way" = how data moves: file (export/import), live (Ordo talks to the program's API), api (the other program or a
 * middleware like n8n talks to Ordo's local API / webhooks).
 */
export type CatalogWay = "file" | "live" | "api";

export interface CatalogEntry {
  id: string;
  name: string;
  /** Who uses it in Austria, in a few words. */
  who: string;
  ways: CatalogWay[];
  /** Plain steps, for the person and for Atlas. */
  steps: string[];
  /** Connection kind Ordo can create for it, if any. */
  setup?: "sap_b1" | "rest_pull" | "webhook" | "api_key";
  /** Poll option to vote for a better connection. */
  pollId?: string;
  docs?: string;
}

export const CATALOG: CatalogEntry[] = [
  {
    id: "bmd",
    name: "BMD NTCS",
    who: "Viele Steuerberatungskanzleien in Österreich",
    ways: ["file"],
    steps: [
      "Export & Sicherung → „BMD-Buchungen“ wählen, Jahr oder Zeitraum angeben, Datei speichern.",
      "Die Datei der Kanzlei schicken; dort: Buchen → Buchungen importieren (oder Vorerfassung → Extras → Buchungen importieren).",
      "Buchungssymbole und Steuercodes sind in jeder Kanzlei anders angelegt – beim ersten Mal kurz abstimmen und im Export-Dialog eintragen.",
    ],
    pollId: "bmd",
  },
  {
    id: "rzl",
    name: "RZL",
    who: "Verbreitete Kanzleisoftware in Österreich",
    ways: ["file"],
    steps: [
      "Ein eigenes RZL-Format gibt es in Ordo noch nicht. Frag deine Kanzlei, ob sie den BMD-Export oder den Steuerberater-Export (CSV mit Konto und Gegenkonto) einlesen kann.",
      "Unter Pläne & Abstimmung für einen RZL-Export stimmen – dann bauen wir ihn als Nächstes.",
    ],
    pollId: "rzl",
  },
  {
    id: "sap_b1",
    name: "SAP Business One",
    who: "Kleine und mittlere Firmen mit SAP",
    ways: ["live", "api"],
    steps: [
      "Einstellungen → Schnittstellen → „SAP Business One“ hinzufügen.",
      "Adresse des Service Layer eintragen (z. B. https://sap-server:50000/b1s/v2), Firmendatenbank (CompanyDB) und einen SAP-Benutzer nur mit Leserechten.",
      "Wählen, was nach Ordo kommt: Geschäftspartner → Kontakte, Ausgangsrechnungen → Einnahmen, Eingangsrechnungen → Ausgaben.",
      "„Testen“ meldet sich an und zählt die Datensätze; „Jetzt abgleichen“ holt sie. Am besten in der Desktop-App im Firmennetz.",
    ],
    setup: "sap_b1",
    pollId: "sap_b1",
  },
  {
    id: "sap_s4",
    name: "SAP S/4HANA",
    who: "Größere Firmen und Konzerne",
    ways: ["api"],
    steps: [
      "S/4HANA spricht OData-Schnittstellen, die eine Kommunikationsvereinbarung in SAP brauchen – das richtet die SAP-Betreuung ein.",
      "Für Kontakte oder Rechnungen aus S/4: „REST-Abruf“ mit der OData-Adresse und einem technischen Benutzer anlegen; Atlas schlägt die Feldzuordnung vor.",
      "In die andere Richtung: Ordo-Webhooks an die SAP Integration Suite oder an n8n schicken.",
    ],
    setup: "rest_pull",
    pollId: "sap_b1",
  },
  {
    id: "business_central",
    name: "Microsoft Dynamics 365 Business Central",
    who: "Mittelstand mit Microsoft",
    ways: ["api"],
    steps: [
      "Business Central nutzt eine REST-API mit Microsoft-Anmeldung (Entra ID). Am einfachsten über Power Automate oder n8n:",
      "Power Automate/n8n liest aus Business Central und schickt an die lokale Ordo-Schnittstelle (Desktop) – oder empfängt Ordo-Webhooks und schreibt nach Business Central.",
    ],
    setup: "api_key",
    pollId: "business_central",
  },
  {
    id: "e_rechnung",
    name: "E-Rechnung (ebInterface, XRechnung, ZUGFeRD, PEPPOL)",
    who: "Rechnungen an den Bund und an große Firmen",
    ways: ["file"],
    steps: [
      "Eingehend: E-Rechnungen als XML oder PDF wie jede Rechnung hineinziehen oder in den überwachten Ordner legen – Ordo liest ebInterface, XRechnung/PEPPOL (UBL) und ZUGFeRD ohne KI.",
      "Ausgehend: bei einer Rechnung „Als E-Rechnung (ebInterface)“ speichern und im Unternehmensserviceportal (USP) hochladen.",
    ],
    pollId: "e_rechnung",
  },
  {
    id: "datev",
    name: "DATEV",
    who: "Kanzleien mit deutschen Mandanten",
    ways: ["file"],
    steps: ["Den Steuerberater-Export (CSV mit Konto/Gegenkonto) nehmen; ein eigener DATEV-Export kommt, wenn genug Leute dafür stimmen."],
  },
  {
    id: "mesonic",
    name: "Mesonic WinLine",
    who: "Österreichisches ERP im Mittelstand",
    ways: ["file", "api"],
    steps: ["Kunden und Artikel als CSV/Excel aus WinLine exportieren und unter Einstellungen → Daten übernehmen einlesen.", "Live: über n8n oder ein Skript an die lokale Ordo-Schnittstelle."],
    setup: "api_key",
  },
  {
    id: "sevdesk",
    name: "sevDesk, lexoffice, FreeFinance & Co.",
    who: "Online-Buchhaltung für Kleinunternehmen",
    ways: ["live", "file"],
    steps: ["Diese Programme haben REST-APIs mit API-Schlüssel: „REST-Abruf“ anlegen, Schlüssel eintragen, Atlas schlägt die Feldzuordnung vor.", "Oder einmalig als CSV/Excel exportieren und einlesen."],
    setup: "rest_pull",
  },
  {
    id: "n8n",
    name: "n8n, Make, Zapier, Power Automate",
    who: "Automatisierung ohne Programmieren",
    ways: ["api"],
    steps: ["Webhook anlegen: Ordo schickt Änderungen (neue Rechnung, Zahlung, Lagerbewegung) an die Adresse des Ablaufs.", "In der Desktop-App: API-Schlüssel anlegen – der Ablauf kann dann Kontakte, Buchungen, Rechnungen und Zeiten in Ordo anlegen."],
    setup: "webhook",
  },
  {
    id: "other",
    name: "Eigenes Programm oder Skript",
    who: "Alles mit HTTP und JSON",
    ways: ["api", "live"],
    steps: ["Lokale Schnittstelle (Desktop): http://127.0.0.1:47110/v1/… mit API-Schlüssel – Beschreibung unter ordo-app.at/schnittstellen/.", "Webhooks für Änderungen, REST-Abruf für Daten aus deinem Programm."],
    setup: "api_key",
  },
];

export const WAY_LABEL: Record<CatalogWay, string> = { file: "Datei", live: "Live-Abruf", api: "Schnittstelle" };
