# Anlageverzeichnis und Rechnungsintegration

Stand: 27. Oktober 2026. Die gemeinsame Web- und Desktop-Oberfläche liegt unter **Buchhaltung → Anlagen & Abschreibung**.

## Ablauf

Beim Lesen eingehender Rechnungen erkennt Summa anhand der Beschreibung und Positionen mögliche Anlagenkäufe. Auch eine bekannte Standardkategorie des Lieferanten verhindert diese Erkennung nicht. Reparaturen, Wartung, Miete und Leasing werden anhand dieser Begriffe von der Anschaffung unterschieden. Die Erkennung ist ein Vorschlag; Anlagen und GWG bleiben vor dem Buchen zur Prüfung offen.

Im Buchungsformular erscheinen Inbetriebnahme, Nutzungsdauer, Abschreibungsmethode, Privatanteil und Anlagekonto. Beim Buchen entsteht eine verknüpfte Anlage. Erneutes Speichern aktualisiert diese Anlage. Lieferant und Anschrift werden aus Kontakt oder Rechnung übernommen; fehlende Angaben sind im Verzeichnis erkennbar.

Der Betrag einer Rechnung ist kein zuverlässiges Kriterium für die Zahl selbständiger Wirtschaftsgüter. Gemischte Rechnungen, mehrere Stück und wirtschaftliche Einheiten müssen geprüft und gegebenenfalls getrennt erfasst werden. Die Erkennung zerlegt solche Rechnungen nicht automatisch in rechtlich verbindliche Einzelanlagen.

## Berechnung und Buchhaltung

- Die Anschaffungskosten enthalten nicht abziehbare Umsatzsteuer. Kleinunternehmer, anteiliger Vorsteuerabzug, Reverse Charge und innergemeinschaftlicher Erwerb werden in der Kostenbasis berücksichtigt.
- Die AfA beginnt mit der eingetragenen Inbetriebnahme. Unterstützt werden lineare AfA, degressive AfA mit Wechsel zur linearen Restabschreibung, GWG sowie nicht abnutzbare Anlagen ohne AfA. Die Halbjahresregel wird im selben Jahr nicht doppelt angewendet.
- Die historische GWG-Grenze wird nach Anschaffungsjahr geprüft: 400 Euro bis 2019, 800 Euro von 2020 bis 2022, 1.000 Euro ab 2023; maßgeblich sind die Kosten einschließlich nicht abziehbarer Umsatzsteuer.
- Eine verknüpfte Anschaffung wird auf dem Anlagekonto aktiviert. Die AfA wird gegen kumulierte Abschreibungen gebucht. Privatanteile werden als Privatentnahme korrigiert. Ein bereits als Aufwand gebuchter GWG-Kauf erzeugt keine zweite AfA-Aufwandsbuchung.
- Bei Abgang werden ursprüngliche Kosten und kumulierte Abschreibungen ausgebucht; ein Restbuchwert wird Aufwand. Die AfA des Abgangsjahres wird zum Abgangsdatum erfasst. Ein Verkauf wird mit seiner Einnahmenbuchung verknüpft, damit Erlös und Umsatzsteuer in der Buchhaltung und im Steuerbericht nur einmal vorkommen.
- Bei Einnahmen-Ausgaben-Rechnung berücksichtigt die steuerliche GWG-Auswertung das Zahlungsjahr, bei doppelter Buchführung das Anschaffungsjahr.
- Der investitionsbedingte Gewinnfreibetrag wird nicht allein aus Kosten und Nutzungsdauer abgeleitet. Die Begünstigung muss im Anlageverzeichnis ausdrücklich als geprüft markiert werden. Eine automatische Prüfung sämtlicher Ausschlüsse und einer späteren Nachversteuerung findet nicht statt.

Nicht jede AfA-Methode ist für jedes Wirtschaftsgut zulässig. Insbesondere gebrauchte Wirtschaftsgüter, Fahrzeuge, Gebäude, Zuschüsse, beschleunigte Gebäudeabschreibung, Sonderabschreibungen, Investitionsfreibetrag und Nachversteuerungen brauchen eine gesonderte fachliche Prüfung. Die üblichen Rechenverfahren ersetzen diese Einzelfallentscheidung nicht.

## Import und Export

**CSV importieren** bietet eine Vorlage, Dateiablage per Drag-and-drop, Validierung und Vorschau. Bis zur Bestätigung entstehen keine Anlagen. Pflichtspalten sind Bezeichnung, Anschaffungsdatum, Kosten EUR, Nutzungsdauer und Methode. Exportierte IDs aktualisieren vorhandene Anlagen; fremde Profile, doppelte Zuordnungen und ungültige Daten werden abgewiesen.

Altanlagen ohne Anschaffungsbuchung können zum 1. Jänner nach ihrem Anschaffungsjahr mit einer Eröffnungsbuchung übernommen werden. Dabei werden ursprüngliche Kosten und bisherige AfA gegen Eigenkapital (9000) angesetzt; es entstehen keine neue Zahlung und kein erneuter Vorsteuerabzug. Bereits separat gebuchte Anlagen ohne solche Übernahme müssen mit der passenden Buchung verknüpft oder mit den manuellen Buchungen abgestimmt werden.

Der CSV-Export enthält Stammdaten, Berechnungsparameter, Lieferantenanschrift, AfA und Restbuchwert des gewählten Jahres und kann wieder eingelesen werden. Der vorhandene Excel-Gesamtexport enthält ebenfalls die erweiterten Anlagendaten, AfA und Buchwerte. Anschaffungs- und Verkaufsbuchungen selbst werden über die Buchhaltung importiert beziehungsweise exportiert; ihre IDs werden im Verzeichnis referenziert.

## Fachliche Grundlagen

- [USP/BMF: Anlageverzeichnis bei Einnahmen-Ausgaben-Rechnung](https://www.usp.gv.at/themen/steuern-finanzen/steuerliche-gewinnermittlung/einnahmen-ausgaben-rechnung.html)
- [USP/BMF: Abschreibung und Rechenbeispiele](https://www.usp.gv.at/themen/steuern-finanzen/steuerliche-gewinnermittlung/weitere-informationen-zur-steuerlichen-gewinnermittlung/betriebseinnahmen-und-ausgaben/abschreibung.html)
- [USP/BMF: Geringwertige Wirtschaftsgüter](https://www.usp.gv.at/themen/steuern-finanzen/steuerliche-gewinnermittlung/weitere-informationen-zur-steuerlichen-gewinnermittlung/betriebseinnahmen-und-ausgaben/geringwertige-wirtschaftsgueter.html)
- [BMF: Historische GWG-Grenzen, EStR Rz 3894](https://findok.bmf.gv.at/findok/volltext?dokumentId=a67dcb38-0ab9-4dbc-a992-b6fb396242d5&indexName=findok-bmf&segmentId=17dfcce9-fac5-4b17-85d0-99f3f0706a22)
- [USP/BMF: Gewinnfreibetrag und Ausschlüsse](https://www.usp.gv.at/themen/steuern-finanzen/steuerliche-gewinnermittlung/weitere-informationen-zur-steuerlichen-gewinnermittlung/betriebseinnahmen-und-ausgaben/gewinnfreibetrag.html)
