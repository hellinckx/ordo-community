# Sicherheitskonzept

Gilt für Ordo mit allen Modulen – Basis, Summa (Buchhaltung), Projekte, Lager, Produktion – und den Assistenten Atlas.

## Ziele

1. Geschäftsdaten – Rechnungen und Kassenbons, Buchungen, Kontakte, Projekte, Zeiten, Team, Dateien, Atlas-Gespräche – sind persönliche Daten. Sie bleiben auf dem Gerät und sind dort im Ruhezustand immer verschlüsselt.
2. Ohne Konto gilt: ohne Passwort (oder Wiederherstellungsschlüssel) kein Zugang – auch nicht für den Entwickler, auch nicht aus einer Sicherung. Mit Konto ist der Tresor-Schlüssel für das Zurücksetzen per E-Mail serverseitig hinterlegt (siehe Sync); dort ist der Betreiber technisch in der Lage zu entschlüsseln.
3. Keine Analyse-Tools, kein Tracking, keine Konten-Pflicht, keine Cloud-Pflicht. Was ein Server sieht, schaltet der Nutzer selbst ein (Sync, Cloud-KI, Atlas) – siehe Abschnitte Sync, KI-Anbieter und Atlas.

## Tresor

- **Masterschlüssel:** 256 Bit, zufällig (`crypto.getRandomValues`).
- **Passwort → Key-Encryption-Key:** Argon2id (64 MiB Speicher, 3 Durchläufe, 16-Byte-Salt) via `hash-wasm`.
- **Umhüllung:** Der Masterschlüssel wird mit AES-256-GCM durch den KEK verschlüsselt (Passwort) und optional ein zweites Mal durch einen zufälligen Wiederherstellungsschlüssel (160 Bit, Crockford-Base32, einmal angezeigt).
- **Daten:** Vault-JSON (gzip) und jeder Anhang werden einzeln mit AES-256-GCM und frischer 96-Bit-Nonce verschlüsselt; Anhänge mit AAD `att:<id>`, Vault mit AAD `summa-vault-v1`.
- **Dateiformat:** `SUMMA\x01` + Header-Länge + Header-JSON (nur Salts, KDF-Parameter, umhüllte Schlüssel, optionaler Passworthinweis) + Chiffrat.
- **Passwortänderung:** nur Neu-Umhüllung des Masterschlüssels – keine Re-Verschlüsselung der Daten.
- **Sperren:** Masterschlüssel wird aus dem Speicher entfernt (`Uint8Array.fill(0)`), nach konfigurierbarer Inaktivität automatisch (Standard 10 Minuten) oder per Strg+L.

## Biometrisches Entsperren (Passkey)

- Optional pro Gerät: WebAuthn-Credential mit **PRF-Erweiterung** (Windows Hello, Touch ID/Face ID, Android-Biometrie). Der Authenticator liefert erst nach Nutzerverifikation ein geheimes PRF-Ergebnis; daraus wird per HKDF ein AES-256-Schlüssel abgeleitet, der den Masterschlüssel umhüllt.
- Gespeichert wird nur die Credential-ID, das PRF-Salt und der umhüllte Masterschlüssel (`localStorage`). Ohne Biometrie am selben Gerät ist dieser Datensatz wertlos.
- Das Passwort bleibt Master-Zugang; der Passkey kann jederzeit in den Einstellungen widerrufen werden.

## Desktop (Tauri)

- Der Rust-Prozess sieht ausschließlich Chiffrat; Vault und Blobs liegen unter `%APPDATA%\at.summa.app\` (der Tauri-`identifier` bleibt auch nach der Umbenennung in Ordo gleich, damit vorhandene Tresore gefunden werden).
- Atomare Schreibvorgänge (temp + rename) und rotierende Backups der letzten 10 Versionen.
- Content-Security-Policy ohne `unsafe-eval`, keine Remote-Skripte; Netzwerkzugriff nur zu den konfigurierten KI-APIs, Supabase (eigenes Projekt) und `localhost` (Ollama).
- Tauri-Capabilities sind auf Dialoge, Benachrichtigungen, Öffnen von URLs und die eigenen Commands beschränkt.
- Codex-Bridge: `codex exec` läuft als Kindprozess im Modus `read-only` mit `--ephemeral` in einem temporären Verzeichnis, das nur die Bilder der Rechnungen und das Schema enthält. Web-Suche ist deaktiviert.

## Browser / PWA

- Speicherung in IndexedDB (verschlüsselt wie oben). Die Service-Worker-Caches enthalten nur App-Code und OCR-Modelle.
- API-Keys werden ausschließlich im verschlüsselten Tresor gehalten.

## KI-Anbieter (Lesen von Rechnungen)

- Standard ist **„Ohne KI“** (vollständig lokal).
- Cloud-Anbieter erfordern einen expliziten Schalter („Rechnungen zum Lesen an den KI-Anbieter senden“, `settings.ai.cloudConsent`). Übertragen werden nur das jeweilige Bild bzw. der Text der Rechnung und die Kategorieliste – niemals der Tresor, Kontakte oder andere Buchungen.
- Ollama ist lokal und offline.

## Atlas

- Standard ist **aus** (`settings.atlas.provider = "none"`). Atlas sendet erst etwas, wenn ein Anbieter gewählt **und** die Zustimmung zur Datenübertragung gegeben ist (`settings.atlas.consent`).
- Übertragen werden die Nachricht, der Verlauf des Gesprächs, der Modul-Kontext und die Daten, die Atlas über Werkzeuge aus dem Tresor liest – anders als bei der Rechnungserkennung also auch Kontakte, Buchungen, Projekte usw., soweit die Frage es braucht. Die Verbindung geht direkt vom Gerät zum Anbieter: Claude über die Anthropic-API mit dem eigenen API-Key, ChatGPT in der Desktop-App über die Codex-Bridge mit dem eigenen ChatGPT-Konto. Kein Umweg über unseren Server.
- Werkzeuge (`src/atlas/tools.ts`) sind `read` oder `write` und haben einen Bereich (`area`); sie laufen mit der Rolle der Person (`can(role, area, …)`) – Atlas hat nie mehr Rechte als sie. Schreibende Werkzeuge folgen der Einstellung `permission`: `read` (nur lesen), `confirm` (vor jeder Änderung fragen, Standard) oder `auto`.
- API-Keys und Gespräche (`atlasChats`) liegen nur im verschlüsselten Tresor.

## Sync (optional)

- Supabase Storage erhält nur die versiegelte Tresordatei und verschlüsselte Blobs (die technischen Namen `summa_*` bleiben); Row-Level-Security beschränkt jeden Nutzer auf seinen Ordner.
- Das Passwort wird nie an Supabase übertragen; das Konto-Login ist ein daraus abgeleiteter Wert (`deriveAccountSecret`, Argon2id mit e-mail-gebundenem Salt).
- **Schlüsselhinterlegung (seit 0.2.3, Entscheidung des Betreibers):** Bei jedem ersten Abgleich einer Sitzung legt der Client den Masterschlüssel per `summa_escrow_put` in Supabase Vault ab (ein Secret pro Konto, `summa_escrow_<uid>`). `summa_escrow_get` gibt ihn nur dem angemeldeten Konto selbst zurück; anonym ist beides gesperrt. Beim Zurücksetzen meldet der E-Mail-Code (OTP, `type: recovery`) an, der Client lädt den Tresor, öffnet ihn mit dem hinterlegten Schlüssel und umhüllt ihn mit dem neuen Passwort. Folge: Mit Konto ist der Sync **nicht** Ende-zu-Ende-verschlüsselt – wer die Datenbank (inkl. Vault) kontrolliert, kann entschlüsseln. Beim Löschen des Kontos entfernt ein Trigger das Secret.
- Metadaten, die der Server bei aktivem Sync kennt: E-Mail des Sync-Kontos, App-Version, Plattform (Desktop/Web/Handy), Geräte-ID, Revision und Byte-Größen des Tresors sowie ein Sync-Protokoll (Zeitpunkt, Aktion, Erfolg). Außerdem kennt der Server Tarif und freigeschaltete Module eines Kontos (`summa_users.plan`, `summa_users.modules`).

## Was Ordo *nicht* schützt

- Ein kompromittiertes Betriebssystem (Keylogger, Speicherauslese bei entsperrtem Tresor).
- Schwache Passwörter – die App zeigt eine Stärkeanzeige; empfohlen sind lange Passphrasen.
- Ohne Konto: Verlust von Passwort **und** Wiederherstellungsschlüssel macht die Daten endgültig unlesbar (beabsichtigt). Mit Konto hilft der E-Mail-Code.
