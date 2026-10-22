# Architektur

Ordo ist eine lokale App mit Modulen. Alle Daten liegen in einem verschlüsselten Tresor; Desktop (Tauri) und Web/PWA teilen denselben Code. Summa ist das Buchhaltungsmodul, Atlas der KI-Assistent. Leitfaden für Modul-Arbeit: [`ORDO-BUILD.md`](ORDO-BUILD.md).

```
┌──────────────────────────────────────────────────────────────────────────┐
│  packages/app (@ordo/app, React)                                         │
│  Module (src/modules, registry.ts):                                      │
│    basis      Übersicht · Atlas · Kontakte · Dateien · Team · Export     │
│    summa      Rechnungen · Buchungen · Kontoabgleich · Steuern · …       │
│    projekte · produkte · produktion   (installierbar unter „Module“)     │
│  Atlas (src/atlas): Chat, Einstellungen, Werkzeuge mit Rollenprüfung     │
│  State: zustand (Session/Tresor-Snapshot, Toasts, Import-Queue)          │
│  Platform-Adapter: tauri.ts (invoke/Events) | web.ts (IndexedDB, Files)  │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ importiert
┌───────────────▼──────────────────────────────────────────────────────────┐
│  packages/core (@ordo/core, reine TypeScript-Logik, Node + Browser)      │
│  model/        Zod-Schemas (Vault, Transaction, Document, Invoice, Bank…)│
│  erp/          Schemas + Logik für Projekte, Angebote, Lager, Produktion,│
│                Nummernkreise, Rollen & Rechte                            │
│  vault/        Krypto (Argon2id/AES-GCM), StorageAdapter, VaultStore     │
│  accounting/   EKR-Kontenplan, Buchungssätze, Journal/Saldenliste/GuV/   │
│                Bilanz, AfA                                               │
│  tax/at/       Kennzahlen-Kataloge, UVA, E1a/EÜR, L1, Tarif, Fristen     │
│  extraction/   Text (pdf.js/Tesseract/ExcelJS) → Regelparser →           │
│                KI-Provider (OpenAI, Anthropic, Ollama, Codex-Bridge) →   │
│                Merge → Kategorie                                         │
│  bank/         Kontoauszug-Parser (CSV/CAMT/PDF/KI) + Abgleich           │
│  exports/      CSV, XLSX, JSON, PDF (Berichte, Rechnungen), ZIP          │
│  recurring/, analytics/, notifications/, demo/                           │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ Chiffrat
┌───────────────▼──────────────────────────────────────────────────────────┐
│  apps/desktop/src-tauri (@ordo/desktop, Rust)                            │
│  storage.rs  vault.summa + blobs/ + backups/ (atomar, rotierend)         │
│  watch.rs    Ordnerüberwachung (notify) → Event "summa://file-added"     │
│  codex.rs    `codex exec --json --output-schema … -i bild.png`           │
└──────────────────────────────────────────────────────────────────────────┘
```

Technische Namen aus der Summa-Zeit bleiben bewusst stehen, damit bestehende Tresore, Konten und Installationen weiterlaufen: Dateiformat `SUMMA\x01`, Tresordatei `vault.summa`, interne Tresor-Backups `*.summa-backup`, Tauri-`identifier` `at.summa.app`, Supabase-Tabellen `summa_*` und Bucket `summa`. Gespeicherte Komplettsicherungen heißen seit Oktober 2026 `*.ordo`; ältere `*.summa`-Dateien lassen sich weiterhin wiederherstellen (gleiches Format).

## Module

Jedes Modul ist ein Manifest (`OrdoModule`, `packages/app/src/modules/types.ts`) in `modules/<id>/index.tsx` und steht in `modules/registry.ts`. Ein Manifest liefert Navigation, Routen, Schnellaktionen („+ Neu“), Widgets für die Übersicht, Einstellungs-Tabs, Demo-Daten und Kontext für Atlas. Sidebar, Router, Modul-Übersicht (`/module`) und Einstellungen lesen das automatisch.

- Installiert ist, was in `vault.settings.modules` steht (Standard: Basis + Summa). Entfernen blendet nur aus; die Daten bleiben im Tresor.
- Welche Module ein Konto überhaupt nutzen darf, kommt bei Sync-Konten vom Server (`summa_settings.module_access`, pro Konto `summa_users.modules`); offline ist alles erlaubt.
- Projekte, Lager und Produktion gibt es für Firmen-Profile; Produktion braucht Produkte & Lager.

## Datenfluss „Rechnung → Buchung“ (Summa)

1. Datei kommt an (Drop, Dialog, Kamera, überwachter Ordner) → `importer.ts` prüft SHA-256 (Duplikate) → verschlüsselter Anhang + `Document` (Status `processing`).
2. `extractDocument` (core): Text lokal (PDF-Textebene, sonst Seiten rendern → OCR) → `parseReceiptText` (Regeln) → optional KI mit JSON-Schema → `mergeExtractions` (KI gewinnt bei hoher Sicherheit, Regeln füllen Lücken und prüfen Betrag/Datum) → `suggestCategory` (Kontakt-Gedächtnis > KI-Vorschlag > Stichwörter).
3. Entwurfs-`Transaction` (ungeprüft) wird gespeichert → Prüfansicht links/rechts → Bestätigen setzt `reviewed`, verknüpft die Datei, lernt Kontakt → Standardkategorie.

## Datenfluss „Kontoauszug → Abgleich“

1. Datei → Format erkennen (CSV-Header-Heuristik für AT/DE-Banken, CAMT-XML, PDF-Text; KI-Fallback bei Scans).
2. Zeilen mit Fingerprint dedupliziert → `reconcile`: Betrag identisch, Datumsnähe, Kontaktname/IBAN/Rechnungsnummer im Text → automatisch (≥ 85 % und eindeutig) oder Vorschlag.
3. Offene Zeilen → „Buchen“ (Entwurf aus Zeile mit Kategorie-Rat), „Zuordnen“, „Ignorieren“. Umgekehrt: Bank-Buchungen ohne Umsatz werden gelistet.

## Atlas

1. Einstellungen in `vault.settings.atlas`: Anbieter (`none` / `claude` / `codex`), Modell, Berechtigung (`read` = nur lesen, `confirm` = vor jeder Änderung fragen, Standard; `auto`), Zustimmung zur Datenübertragung (`consent`), eigene Anweisungen.
2. Eine Nachricht geht mit dem Gesprächsverlauf und dem Kontext der installierten Module (`atlasContext` der Manifeste) an den Anbieter – Claude direkt über die Anthropic-API, ChatGPT in der Desktop-App über die Codex-Bridge.
3. Der Anbieter ruft Werkzeuge auf (`src/atlas/tools.ts`: `AtlasTool` mit Zod-Eingabe, `kind` read/write, `area` für die Rollenprüfung). Werkzeuge laufen lokal gegen den `VaultStore`, mit der Rolle der Person – Atlas hat nie mehr Rechte als sie. Ergebnisse gehen kompakt zurück, optional mit Diagramm, Tabelle oder Link für die Anzeige.
4. Gespräche liegen im Tresor (`atlasChats`).

## Steuer-Engine

- `computeUva(profile, period, tx)` – Ist-/Sollbesteuerung, alle U-30-Kennzahlen, Reverse Charge, ig. Erwerb, Kleinunternehmer.
- `computeE1a(profile, year, tx, assets)` – Zu-/Abfluss, Netto-/Bruttosystem, Korrekturen (Bewirtung 50 %, Kfz), AfA aus Anlagenverzeichnis, Basis-/Kleinunternehmerpauschalierung, Gewinnfreibetrag, ESt-Schätzung.
- `computeL1(profile, year, tx, employee)` – Werbungskosten/Sonderausgaben/agB-Kennzahlen mit Deckelungen, Selbstbehalt, Grenzsteuersatz, Erstattungsschätzung.
- `deriveJournal` – jede Transaktion wird regelbasiert in Buchungssätze (EKR) übersetzt; manuelle Sätze werden gemischt. Journal, Saldenliste, GuV, Bilanz sind reine Funktionen über diese Liste.

## Persistenz

Ein Vault = ein JSON-Dokument (alle Entitäten mit `id/createdAt/updatedAt/deletedAt`, Geschäftsdaten mit `profileId`) → gzip → AES-GCM → Speicheradapter. Soft-Delete + `revision` ermöglichen Merge (Import/Sync). Anhänge und Dateien sind separate verschlüsselte Blobs. Neben den Summa-Sammlungen (`contacts, transactions, invoices, documents, …`) enthält der Tresor die Ordo-Sammlungen `members, projects, tasks, milestones, timeEntries, offers, products, stockMoves, workOrders, folders, files, atlasChats`.
