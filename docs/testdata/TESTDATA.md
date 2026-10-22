# Testdaten

Erzeugt mit `python make_testdata.py`.

| Datei | Zweck |
| --- | --- |
| `kassenbon_billa.png` | Foto-ähnlicher Kassenbon (zwei Steuersätze, Bankomat) – testet OCR + Regelparser |
| `rechnung_mustermann.pdf` | B2B-Rechnung mit Textebene (UID, IBAN, Zahlungsziel) – testet PDF-Textpfad |
| `kontoauszug_george.csv` | CSV-Export im George-Stil – testet Kontoabgleich (eine Zeile passt zur Rechnung, eine zum Bon) |

Entwicklungs-Tresor im Browser (nur lokal, IndexedDB): Passwort `summa-test-2026!`
