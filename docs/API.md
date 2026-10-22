# Ordo-Schnittstellen (API `ordo.v1`)

Ordo spricht mit anderen Programmen auf drei Wegen: **Dateien** (BMD, ebInterface, CSV/Excel), **Live-Abruf** (SAP Business One, REST/JSON) und die **lokale Schnittstelle mit Webhooks** (Desktop). Daten gehen dabei direkt zwischen dem Gerät und dem anderen Programm – nie über den Ordo-Betreiber. Einrichten in der App unter **Einstellungen → Schnittstellen** oder mit Atlas.

Code: `packages/core/src/interfaces/` (Formate, API-Formen, Verbindungen), `packages/app/src/services/integrations/` (lokale API, Webhooks, SAP, REST, Taktgeber), `apps/desktop/src-tauri/src/api.rs` und `net.rs` (HTTP-Server auf 127.0.0.1, ausgehendes HTTP).

## Lokale Schnittstelle (Desktop)

- Adresse `http://127.0.0.1:47110` (Port einstellbar), nur von diesem Computer erreichbar; der Host-Header muss `127.0.0.1` oder `localhost` sein (Schutz vor DNS-Rebinding), es gibt keine CORS-Header – Webseiten können die Schnittstelle nicht benutzen.
- Nur solange Ordo offen und entsperrt ist (sonst `423`).
- Schlüssel: `Authorization: Bearer <Schlüssel>` oder `X-Ordo-Key: <Schlüssel>`. Jeder Schlüssel gehört zu einem Profil und hat Rechte (`scopes`). Rust prüft den Schlüssel in konstanter Zeit, die App prüft die Rechte.
- JSON, Beträge in Euro mit zwei Nachkommastellen, Datum `YYYY-MM-DD`.
- `externalId` macht Aufrufe wiederholbar: gleiche `externalId` → Aktualisierung statt Duplikat (intern `legacyRef = api:<Schlüssel-id>:<externalId>`).
- Listen: `limit` (≤ 1000, Standard 200), `offset`, `changedSince` (ISO-Zeitpunkt, liefert dann auch gelöschte Einträge mit `deleted: true`).

| Aufruf | Recht | Bedeutung |
| --- | --- | --- |
| `GET /v1/status` | – | Version, Profil, Rechte des Schlüssels |
| `GET /v1/contacts?q=` | `contacts:read` | Kontakte |
| `POST /v1/contacts` | `contacts:write` | anlegen/aktualisieren (Abgleich über externalId, UID, Name) |
| `GET /v1/transactions?from=&to=` | `transactions:read` | Einnahmen & Ausgaben |
| `POST /v1/transactions` | `transactions:write` | anlegen; `dueDate` ohne `paidDate` = offener Posten |
| `GET /v1/invoices` | `invoices:read` | ausgehende Rechnungen |
| `POST /v1/invoices` | `invoices:write` | Entwurf anlegen (nummeriert wie von Hand; fertigstellen bleibt bei der Person) |
| `GET /v1/invoices/{id}/ebinterface` | `invoices:read` | ebInterface-6.1-XML |
| `POST /v1/incoming` | `incoming:write` | Datei einliefern: `{fileName, mimeType?, contentBase64, direction?}` – PDF, Bild, ebInterface/XRechnung/ZUGFeRD |
| `GET /v1/products` | `products:read` | Artikel mit Lagerstand (Modul Produkte & Lager) |
| `GET/POST /v1/stock-moves` | `products:read` / `stock:write` | Lagerbewegungen (`productId` oder `sku`, `quantity` ±) |
| `GET /v1/projects` | `projects:read` | Projekte (Modul Projekte) |
| `GET/POST /v1/time-entries` | `projects:read` / `time:write` | Zeiten (`projectId` oder `projectNumber`, `minutes`) |
| `GET /v1/export/bmd?from=&to=&encoding=` | `export:read` | BMD-Buchungen als Base64 |

Fehler: `{"error": "…"}` mit `401` (Schlüssel), `403` (Recht), `404`, `409` (falsches Profil offen bei `/incoming`), `413`, `422` (Felder), `423` (gesperrt), `504` (Ordo hat nicht rechtzeitig geantwortet).

```bash
curl http://127.0.0.1:47110/v1/transactions \
  -H "Authorization: Bearer ordo_…" -H "Content-Type: application/json" \
  -d '{"kind":"expense","date":"2026-10-22","amount":119.90,"vatRate":20,"description":"Druckerpapier","contactName":"Muster GmbH","externalId":"ER-4711"}'
```

Eingabefelder (zod-Schemas in `packages/core/src/interfaces/api.ts`):

- **Kontakt:** `name`*, `kind` (customer/vendor/both), `uid`, `email`, `phone`, `street`, `zip`, `city`, `country` (2 Buchstaben), `iban`, `notes`, `externalId`
- **Buchung:** `kind`* (income/expense), `date`*, `amount`* (brutto), `vatRate` (0/10/13/20) oder `vat: [{rate, net, vat}]`, `vatTreatment`, `description`, `contactId` oder `contactName`, `category` (Name), `paymentMethod`, `invoiceNumber`, `reference`, `dueDate`, `paidDate`, `projectId`, `externalId`
- **Rechnung:** `customerId` oder `customer {name, uid, street, zip, city, country, email}`, `issueDate`, `dueDate`, `lines: [{description, quantity, unit, unitNet, vatRate, discountPct}]`*, `reference`, `introText`, `footerText`, `projectId`, `externalId`

## Webhooks

- `POST` an die gewählte Adresse, ein paar Sekunden nach einer Änderung, höchstens 50 Ereignisse pro Nachricht (Datensätze mit gleichem Zeitstempel werden nie getrennt). Ein Zeiger (`cursor` = letzter zugestellter `updatedAt`) liegt bei der Verbindung; was nicht zugestellt wurde, geht beim nächsten Versuch mit (Backoff 1, 2, 4 … bis 60 Minuten).
- Ereignisse: `contact`, `transaction`, `invoice`, `document` (gebuchte eingehende Rechnung), `product`, `stock`, `project`, `time` – jeweils `.created`, `.updated`, `.deleted`.
- Kopfzeilen: `X-Ordo-Event`, `X-Ordo-Delivery`, `X-Ordo-Signature: sha256=<HMAC-SHA256(Signatur-Schlüssel, Inhalt) hex>`.
- Automatisch sendet nur das Gerät, auf dem die Verbindung eingerichtet wurde (`deviceId`), damit zwei offene Geräte nicht doppelt senden; „Jetzt senden“ geht überall.

```json
{ "api": "ordo.v1", "sentAt": "2026-10-22T09:15:00.000Z", "profile": { "id": "prf_…", "name": "Muster Design e.U." },
  "events": [{ "event": "invoice.created", "id": "inv_…", "at": "2026-10-22T09:14:57.120Z", "data": { "number": "RE-2026-0007", "gross": 324.0 } }] }
```

```js
const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
```

## Live-Abruf

- **SAP Business One** (Service Layer, `/b1s/v1` oder `/b1s/v2`): `POST /Login {CompanyDB, UserName, Password}` → Cookie `B1SESSION` (+ `ROUTEID`), Seiten über `@odata.nextLink`, `Prefer: odata.maxpagesize=200`. Geschäftspartner → Kontakte (ohne Interessenten), `Invoices` → offene Einnahmen, `PurchaseInvoices` → offene Ausgaben (ohne Storno, nur EUR, ab Datum). Steuer pro Satz aus `DocumentLines.TaxPercentagePerRow`. Ordo schreibt nie in SAP; Zahlungen ordnet der Kontoabgleich mit dem echten Zahlungsdatum zu.
- **REST-Abruf:** `GET` einer JSON-Liste mit Schlüssel im frei wählbaren Header, Pfad zur Liste (sonst automatisch), Feldzuordnung „Ordo-Feld → Pfad im Datensatz“. Atlas liest die Felder eines Beispiel-Datensatzes (`integration_probe`) und schlägt die Zuordnung vor.
- Im Browser nur, wenn das andere Programm CORS erlaubt; in der Desktop-App gehen alle Anfragen über die Shell (`net_fetch`, ohne CSP- und CORS-Grenzen).

## Dateien

- **BMD NTCS** (`bmdBuchungen`): `satzart;konto;buchdat;gkto;belegnr;belegdat;mwst;steucod;bucod;betrag;steuer;periode;text;symbol;extbelegnr`, Semikolon, Dezimalkomma, `JJJJMMTT`, Windows-1252 (oder UTF-8). `bucod` 1 = Soll, 2 = Haben; `betrag` + bei Soll, − bei Haben; `steuer` mit umgekehrtem Vorzeichen. Steuercodes (Standard 03 Soll-USt, 01 Ist-USt, 00 Vorsteuer/keine, 09 ig. Erwerb, 19 Reverse Charge) und Buchungssymbole (AR, ER, BK, KA, SO) sind pro Kanzlei einstellbar. Gebucht wird auf die EKR-Sammelkonten (2000/3300).
- **ebInterface 6.1** (`buildEbInterface` / `parseEbInterface`): ausgehend für das Unternehmensserviceportal, eingehend zusammen mit XRechnung/PEPPOL (UBL) und ZUGFeRD/Factur-X (CII), auch als eigenständige XML-Datei.

## Atlas

Werkzeuge in `packages/app/src/atlas/tools-integrations.ts`: `integrations_overview` (Katalog + Verbindungen ohne Geheimnisse), `integration_setup`, `integration_update`, `integration_test`, `integration_probe`, `integration_run`. Alle außer der Übersicht fragen **immer** vor dem Ausführen (`alwaysConfirm`), auch wenn Atlas sonst ohne Rückfrage ändern darf. Passwörter und Schlüssel nimmt kein Werkzeug an und keines gibt sie zurück. Bereich in Einstellungen → Atlas: „Schnittstellen“; Pull-Ziele nur in Bereichen, die für Atlas offen sind.
