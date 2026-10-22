# Ordo – Community Edition

**Buchhaltung, Projekte und Lager an einem Ort. Lokal, verschlüsselt, für Selbstständige und kleine Firmen in Österreich.**

*Ordo is local-first business software for Austrian sole traders and small companies – bookkeeping with VAT returns, projects and time tracking, stock and production, and the AI assistant Atlas. The interface is German. This is the open-source edition under the GNU AGPL-3.0: run it entirely on your own device or with your own database.*

---

## Was Ordo kann

- **Summa – Buchhaltung:** Rechnungen einlesen (PDF, Foto, E-Mail, überwachte Ordner), automatisch erkennen und buchen, Umsatzsteuer-Voranmeldung (U 30), Einnahmen-Ausgaben-Rechnung (E 1a), Arbeitnehmerveranlagung (L 1), Kontoauszüge abgleichen, Ausgangsrechnungen schreiben, Export für die Steuerberatung (BMD, CSV, Excel, PDF).
- **Projekte & Zeiten:** Aufgaben, Zeitplan, Stoppuhr, Angebote, aus dem Angebot wird mit einem Klick die Rechnung.
- **Produkte & Lager:** Artikel, Bestand, Mindestmengen, Lagerwert.
- **Produktion:** Stücklisten und Fertigungsaufträge.
- **Atlas:** ein KI-Assistent, der Fragen mit deinen Zahlen beantwortet – mit deinem eigenen KI-Schlüssel oder lokal mit Ollama.
- **Schnittstellen:** BMD, ebInterface, E-Rechnung, SAP Business One, REST, Webhooks und eine lokale Schnittstelle für andere Programme am selben Computer (siehe [docs/API.md](docs/API.md)).

## Was diese Ausgabe ausmacht

- **Kein Betreiber dazwischen.** Es ist kein Server vorkonfiguriert. Ordo läuft entweder **ohne Konto** (alles bleibt verschlüsselt auf dem Gerät) oder mit **deiner eigenen Datenbank** (ein Supabase-Projekt, gratis oder selbst betrieben) – dann gleichen alle deine Geräte und dein Team darüber ab. Anleitung: [SELFHOST.md](SELFHOST.md).
- **Verschlüsselt.** Der Tresor wird mit deinem Passwort verschlüsselt (Argon2id, AES-256-GCM), bevor er das Gerät verlässt. Details: [docs/SECURITY.md](docs/SECURITY.md).
- **Keine Telemetrie.** Kein Tracking, keine Analyse, keine Werbung. Daten gehen nur dorthin, wo du sie selbst hinschickst (deine Datenbank, dein KI-Anbieter, deine Schnittstellen).
- Nicht enthalten sind die Teile des gehosteten Ordo, die nur für dessen Betrieb da sind: Admin-Bereich, Umfragen, Rückmeldungen an den Betreiber, Bezahlfunktionen und Updates aus dessen Kanal.

## Schnell starten

Voraussetzungen: [Node.js](https://nodejs.org) 22 oder neuer und pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev
```

Dann <http://localhost:5174/app/> öffnen. Unter Windows geht auch ein Doppelklick auf `Start-Ordo.cmd` (Web-App, Desktop-App, Tests).

- **Web-App bauen:** `pnpm build:app` – das Ergebnis liegt in `packages/app/dist` und ist eine statische Seite (App unter `/app/`). Mit Docker: siehe [SELFHOST.md](SELFHOST.md).
- **Windows-App bauen:** [Rust](https://rustup.rs) installieren, dann `pnpm desktop:build`. Der Installer liegt danach in `apps/desktop/src-tauri/target/release/bundle/nsis`.
- **Tests:** `pnpm test`, Typprüfung: `pnpm typecheck`.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `packages/core` | Datenmodell, Verschlüsselung, Buchhaltung, Steuern (AT), Erkennung, Exporte – ohne UI |
| `packages/app` | Web-App und Oberfläche der Desktop-App (React, Vite) |
| `apps/desktop` | Windows-App (Tauri, Rust): Dateien, Ordnerüberwachung, lokale Schnittstelle |
| `supabase` | Datenbank-Schema für den Abgleich über deine eigene Datenbank |
| `docs` | Architektur, Sicherheit, Steuern, Schnittstellen |

Mehr dazu in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Hinweis

Ordo ist ein Werkzeug zur Vorbereitung – keine Steuerberatung und kein Ersatz für die Prüfung durch Fachleute. Steuerwerte und Formulare entsprechen dem Stand der jeweiligen Version (siehe [docs/STEUERN.md](docs/STEUERN.md)).

## Lizenz

Copyright © 2026 Hellinckx Process Simulation e.U. – <https://ordo-app.at>

Dieses Programm ist freie Software: Du kannst es unter den Bedingungen der **GNU Affero General Public License, Version 3**, weitergeben und verändern ([LICENSE](LICENSE)). Wer eine veränderte Fassung anderen über ein Netzwerk zur Verfügung stellt, muss ihnen auch den geänderten Quellcode zugänglich machen.

Diese Ausgabe erscheint mit jeder Version von Ordo neu.
