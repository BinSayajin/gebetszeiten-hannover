# Gebetszeiten Hannover

Ein verschiebbares Desktop-Widget für Windows und macOS. Es zeigt die heutigen Gebets- und Jama’ah-Zeiten für Hannover, markiert das aktuelle Gebet dezent und zählt bis zum nächsten herunter.

## Installieren und benutzen

- **Windows x64** – Setup-EXE öffnen und anschließend **Gebetszeiten Hannover** über die Desktop-Verknüpfung oder das Startmenü starten.
- **macOS** – DMG für **Apple Silicon (arm64)** oder **Intel (x64)** öffnen und die App nach **Programme** ziehen. Das Projekt erstellt macOS-Pakete ohne Developer-ID-Signatur und Notarisierung.
- Ziehe das Fenster an der Kopfzeile an die gewünschte Position. Ziehe einen Rand oder eine Ecke, um die Größe zu ändern. Querformat zeigt die Übersicht und die Tabelle nebeneinander. In der kleinsten Ansicht stehen das aktuelle Gebet und seine Beginnzeit.
- Unter **⋯ → Design** kannst du zwischen **Klassisch** und **Glas** wechseln. Die App merkt sich Größe, Position und Design. Im selben Menü findest du **Immer im Vordergrund**, **Beim Anmelden starten** und die Asr-Methode.
- Das Mondsymbol im Windows-Infobereich oder in der macOS-Menüleiste holt das ausgeblendete Widget zurück. Auf macOS kann der Autostart bei einem nicht notarisierten Build ausbleiben.

## Kalender und Hervorhebung

- Die App verwendet Hannover-Zeit (`Europe/Berlin`). Die Internetabfrage nutzt dieselbe Tagesquelle wie die [Website von Lichter der Erkenntnis](https://lichterdererkenntnis.de/#gebetszeiten). Jama’ah zeigt die veröffentlichten Uhrzeiten. Ob die Gebete vor Ort stattfinden, steht auf der Website.
- Bei einem Verbindungsproblem greift das Widget auf die gespeicherten Tagesdaten oder den mitgelieferten Hannover-Jahreskalender **2026** zurück. Der Jahreskalender enthält die Beginnzeiten. Ab 2027 braucht die App zum ersten Laden eines Tages eine Verbindung zur Website, solange für das Jahr kein Offline-Kalender ergänzt wurde.
- Die Markierung folgt den Beginnzeiten und pausiert zwischen Schuruq (Sonnenaufgang) und Thuhr. Standardmäßig gilt **Asr Mithl 2 (Hanafi)** für die Markierung und den Countdown. Ist an einem Sommertag im Kalender für Ischa nur Haraj verfügbar, verwendet das Widget den gekennzeichneten Haraj-Eintrag. Ein `⁺` markiert eine Uhrzeit nach Mitternacht am folgenden Kalendertag.

## Aus dem Quellcode starten

Mit Node.js 24 und npm im Projektordner ausführen.

```sh
npm ci
npm start
npm test
```

## Installationspakete für GitHub

Unter Windows baut `npm run dist:win -- --x64` die Setup-EXE. Unter macOS baut `npm run dist:mac -- --arm64` das DMG für Apple Silicon. Für Intel lautet das Argument `--x64`. Die Dateien liegen in `dist/`.

Nach dem Push zu GitHub kannst du unter **Actions → Installationspakete bauen → Run workflow** die drei Pakete bauen lassen. Ein Push eines Tags wie `v1.1.0` startet denselben Build. Lade die Dateien aus den Workflow-Artefakten herunter und hänge sie an deinen GitHub-Release an, damit Freunde sie herunterladen können.

## Weiteres Jahr offline hinterlegen

Mit Python 3 und `pdfplumber` lässt sich ein Hannover-Jahres-PDF mit demselben Tabellenaufbau umwandeln. Das Ergebnis unter `data/` wird beim nächsten Build automatisch aufgenommen.

```sh
python -m pip install pdfplumber
python scripts/import-calendar.py /pfad/zum/jahreskalender.pdf
npm test
```
