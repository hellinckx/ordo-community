# Zu Ordo beitragen

Danke für dein Interesse an Ordo. Dieses Repository ist die unabhängige Community-Ausgabe unter GNU AGPL-3.0.

## Lokal entwickeln

Node.js ab Version 22 und pnpm installieren, dann:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Die App läuft unter <http://localhost:5174/app/>. Nutze die Demo oder eigene Testdaten. Für einen optionalen Geräteabgleich verbindest du deine eigene Datenbank, siehe [SELFHOST.md](SELFHOST.md).

## Änderungen prüfen

```sh
pnpm typecheck
pnpm test
pnpm build:app
```

Beschreibe im Pull Request das Problem, das geänderte Verhalten und die durchgeführten Prüfungen. Bei Änderungen an der Oberfläche helfen Screenshots mit Demo-Daten. Deutsche Texte verwenden echte Umlaute und ß.

## Fehler und Ideen

Bitte nenne Version, Betriebssystem, Schritte zur Reproduktion sowie erwartetes und tatsächliches Verhalten. Prüfe vorher, ob es bereits ein passendes Issue gibt.

Keine echten Rechnungen, persönlichen Daten, Passwörter, Schlüssel oder unbereinigten Protokolle veröffentlichen. Sicherheitsprobleme zuerst vertraulich mit den Verantwortlichen des Projekts klären.
