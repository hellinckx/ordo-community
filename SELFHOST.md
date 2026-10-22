# Ordo selbst betreiben

Ordo braucht keinen Server: Ohne Konto bleibt alles verschlüsselt auf dem Gerät. Einen Server brauchst du erst, wenn mehrere Geräte oder ein Team dieselben Daten sehen sollen. Dafür nutzt Ordo eine **eigene Datenbank** – ein Supabase-Projekt, das dir gehört.

| | Datenbank | App |
| --- | --- | --- |
| **A. Gratis-Projekt bei Supabase** (am einfachsten) | dein Projekt auf supabase.com | Web-App oder Windows-App aus diesem Quellcode |
| **B. Supabase selbst betreiben** | Supabase auf deinem Server (Docker) | wie A |
| **C. Web-App selbst hosten** | A oder B | die Web-App auf deinem Webserver, auf Wunsch mit eingebauter Datenbank-Adresse |

In jedem Fall liegen auf dem Server nur verschlüsselte Daten: der versiegelte Tresor und verschlüsselte Dateien.

## A. Eigenes Projekt bei Supabase

In der App auf **„Kostenlos mit eigener Datenbank“** (Startbildschirm oder Einstellungen → Konto). Der Assistent erklärt jeden Schritt.

1. Auf [supabase.com](https://supabase.com) ein Gratis-Projekt anlegen, am besten in der Region **Central EU (Frankfurt)**.
2. Im **SQL Editor** das Ordo-SQL einspielen – der Assistent kopiert `supabase/schema.sql` und `supabase/own-project.sql` in einem Stück. Am Ende steht „Ordo ist eingerichtet – Schema-Version …“.
3. **Authentication → Sign In / Providers → Email:** „Confirm email“ ausschalten. Der eingebaute Mailversand von Supabase schickt nur wenige Mails. Für „Passwort vergessen“ per E-Mail einen eigenen SMTP-Versand eintragen (Authentication → SMTP).
4. **Project URL** und **Publishable key** (nie den geheimen Schlüssel) in Ordo eintragen, „Verbindung prüfen“, Konto anlegen.
5. Weitere Geräte und das Team: Einstellungen → Konto → **Verbindungscode** (`ORDO-DB1:…`, enthält nur Adresse und öffentlichen Schlüssel) beim Anmelden unter „Eigene Datenbank“ einfügen.

`own-project.sql` stellt ein: bis 50 Konten, etwa 900 MB pro Person, alle Mitglieder sehen den Verbrauch. Läuft man es erneut, ändert es nichts. Grenzen ändern: Tabelle `summa_settings` (`max_accounts`, `plans`, `signups_enabled`).

Ordo zeigt laufend den Stand gegen den Gratis-Plan (Dateien 1 GB, Datenbank 500 MB, Datenverkehr 5 GB im Monat, geschätzt aus dem Abgleich-Protokoll) und warnt ab 80 %. Gratis-Projekte pausieren nach 7 Tagen ohne Nutzung; dann im Dashboard „Restore project“ drücken – oder täglich einmal die Funktion `summa_ping` aufrufen lassen, zum Beispiel mit einem geplanten Job:

```bash
curl -s -X POST "https://<projekt>.supabase.co/rest/v1/rpc/summa_ping" -H "apikey: <publishable key>" -H "Content-Type: application/json" -d "{}"
```

Wenn eine neue Ordo-Version ein neueres Schema braucht, sagt die App das. Dann `schema.sql` noch einmal einspielen – die Datei ist so geschrieben, dass sie beliebig oft laufen darf.

### Was der Server macht

- **Abgleich in Echtzeit:** Speichert ein Gerät, erfahren die anderen Geräte desselben Kontos das sofort (Supabase Realtime). Ohne Realtime gleicht Ordo alle zwei Minuten ab.
- **Passwort vergessen:** Der Schlüssel des Tresors wird verschlüsselt in Supabase Vault hinterlegt, damit ein Code per E-Mail zum Zurücksetzen reicht. Wer die Datenbank kontrolliert, könnte damit technisch entschlüsseln – bei deinem eigenen Projekt bist das du. Details in [docs/SECURITY.md](docs/SECURITY.md).
- **Zwei-Faktor-Anmeldung:** Mit eingeschalteter Authenticator-App gibt der Server die verschlüsselten Daten und den hinterlegten Schlüssel nur nach dem Code heraus.
- **Konto löschen:** Einstellungen → Konto entfernt die Dateien und das Konto vom Server; die Daten auf dem Gerät bleiben.

## B. Supabase selbst betreiben

1. Supabase nach der offiziellen Anleitung mit Docker betreiben ([supabase.com/docs/guides/self-hosting/docker](https://supabase.com/docs/guides/self-hosting/docker)), hinter HTTPS.
2. `supabase/schema.sql` und `supabase/own-project.sql` mit `psql` oder im Studio einspielen; SMTP in der Auth-Konfiguration eintragen.
3. In Ordo „Eigene Datenbank“ mit deiner Adresse (z. B. `https://supabase.deine-firma.at`) und dem anon- bzw. Publishable-Schlüssel verbinden. Die Windows-App erreicht eigene Domains über ihre eingebaute Netzwerkbrücke; im Browser muss deine Instanz CORS für die Adresse der Web-App erlauben (bei Supabase Standard).

## C. Die Web-App selbst hosten

Die Web-App ist eine statische Seite unter `/app/`. Mit Docker:

```bash
docker build -t ordo-web \
  --build-arg VITE_SUMMA_SYNC_URL=https://abcdefghijklmnopqrst.supabase.co \
  --build-arg VITE_SUMMA_SYNC_ANON_KEY=sb_publishable_… \
  --build-arg VITE_SUMMA_WEB_URL=https://ordo.deine-firma.at/app/ \
  .
docker run -p 8080:8080 ordo-web
```

- `VITE_SUMMA_SYNC_URL` / `VITE_SUMMA_SYNC_ANON_KEY` (optional): eine Datenbank, die deine Installation von Haus aus verwendet – dann melden sich alle direkt mit E-Mail und Passwort an, ohne Verbindungscode.
- `VITE_SUMMA_WEB_URL` (optional): Adresse der App für Links in Bestätigungs-Mails; in Supabase unter Authentication → URL Configuration erlauben. Ohne Angabe gilt die Site URL des Projekts.
- Ohne Docker: `pnpm install && pnpm build:app`, dann `packages/app/dist` ausliefern. Regeln wie in `deploy/selfhost/nginx.conf`: Service Worker und Manifest nie zwischenspeichern, `/app/*` auf `/app/index.html` leiten.
- Der Build lädt einmalig die Sprachdaten für die Texterkennung (`packages/app/scripts/prepare-assets.mjs`); danach liefert deine Installation sie selbst aus.

## Windows-App aus dem Quellcode

[Rust](https://rustup.rs) installieren, dann `pnpm desktop:build`. Diese Ausgabe hat eine eigene App-Kennung (`at.ordo.community`) und sucht nicht nach Updates. Wer eigene Updates verteilen will: einen Signaturschlüssel erzeugen (`pnpm --filter @ordo/desktop tauri signer generate`), in `apps/desktop/src-tauri/tauri.conf.json` unter `plugins.updater` den öffentlichen Schlüssel und die Adresse der eigenen `latest.json` eintragen und `bundle.createUpdaterArtifacts` einschalten.

## Was nach außen geht

- KI (Rechnungen lesen, Atlas) nur, wenn eingeschaltet – direkt an den gewählten Anbieter, oder lokal mit Ollama.
- Schnittstellen nur dorthin, wo du sie hinzeigst.
- Sonst nichts: Diese Ausgabe kennt keinen Betreiber und schickt keine Nutzungsdaten.
