# SMLIGHT SLZB

Behalte deine Zigbee-Koordinatoren [SMLIGHT](https://smlight.tech) SLZB
(SLZB-06, SLZB-06M, SLZB-06p7, SLZB-07, SLZB-MR1, Ultima…) in Gladys im Blick,
über dein lokales Netzwerk: ihre Temperaturen und ihren Speicher, ob
Zigbee2MQTT mit ihnen verbunden ist, ihre Netzwerkverbindung, ihre Firmware und
deren Updates, und starte sie oder ihren Zigbee-Chip neu, wenn das
Zigbee-Netzwerk spinnt.

> **Ohne die Hardware entwickelt: Rückmeldungen willkommen.** Diese
> Integration wurde mit echten Antworten von SLZB-Koordinatoren gebaut und
> getestet, die die Bibliothek pysmlight und die Home-Assistant-Integration
> veröffentlichen, nicht mit einem Koordinator auf dem Schreibtisch. Wenn etwas
> nicht wie beschrieben funktioniert, sag es bitte im
> [Gladys-Forum](https://community.gladysassistant.com) oder in den
> [Issues](https://github.com/guim31/gladys-smlight/issues).

Diese Integration steht in keiner Verbindung zu SMLIGHT.

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Einen SLZB-Koordinator mit **Firmware v2.3.6 oder neuer** (SLZB-OS) im
  selben Netzwerk wie Gladys. Ältere Firmware hat keine lokale API zum Lesen:
  Aktualisiere sie zuerst über die SLZB-Weboberfläche.
- Wenn du die SLZB-Weboberfläche mit einer Anmeldung geschützt hast
  (**Settings** → **Security**), deren Benutzername und Passwort.

Die Integration liest den Koordinator; sie ersetzt weder Zigbee2MQTT noch ZHA,
die deine Zigbee-Geräte weiterhin über ihn steuern.

## Einrichtung

1. Installiere **SMLIGHT SLZB** aus dem Gladys-Katalog (oder **Integrationen**
   → **Von GitHub installieren** mit `https://github.com/guim31/gladys-smlight`).
2. Öffne den Tab **Entdecken**: Die Koordinatoren im Netzwerk von Gladys werden
   automatisch gefunden (mDNS). Fehlt einer? Gib seine IP-Adresse in der **Konfiguration** (**IP-Adressen der Koordinatoren**) ein (die SLZB-Weboberfläche zeigt sie auf ihrer Seite
   **Network**), zum Beispiel `192.168.1.50`; mehrere Adressen trennst du mit
   Kommas.
3. Anmeldung: Fülle **Benutzername** und **Passwort** nur aus, wenn die
   Weboberfläche des SLZB eine Anmeldung verlangt. Dieselbe Anmeldung gilt für
   alle Koordinatoren.
4. Klicke auf **Verbindung testen**: Die Meldung unter der Schaltfläche listet
   die gefundenen Koordinatoren und was fehlgeschlagen ist.
5. Klicke in **Entdecken** bei jedem Koordinator auf **Zu Gladys hinzufügen**,
   wähle einen Raum und speichere.

Optionen:

- **Aktualisierungsintervall**: 30 Sekunden oder 1 Minute (Standard).
- **Nach Firmware-Updates suchen**: standardmäßig an. Einmal am Tag fragt die
  Integration beim Update-Server von SMLIGHT im Internet nach der neuesten
  Firmware jedes Koordinators, wie es die SLZB-Weboberfläche tut. Schalte es
  aus, um ganz lokal zu bleiben: Die Funktionen der neuesten Versionen und des
  Updates werden dann nicht angelegt.
- **Sprache der Funktionsnamen**: Englisch, Französisch (Standard), Deutsch
  oder Spanisch. Die Namen werden beim Hinzufügen des Geräts vergeben.

## Das Gerät jedes Koordinators

Jeder Koordinator ist ein Gerät, benannt nach seinem Hostnamen. Es werden nur
die Funktionen angelegt, die der Koordinator anbietet.

| Funktion                                       | Was es ist                                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temperatur ESP32-Kern                          | Temperatur des ESP32-Chips, auf dem der Koordinator läuft, in °C                                                                                                                                              |
| Temperatur Zigbee-Chip                         | Temperatur des Zigbee-Funkchips, in °C (Temperatur Funkmodul 1, Temperatur Funkmodul 2 bei Modellen mit zwei Funkmodulen)                                                                                     |
| Belegter Arbeitsspeicher, Belegtes Dateisystem | Vom Koordinator belegter Speicher, in Kilobyte (die Anzeige reicht bis zur Gesamtgröße)                                                                                                                       |
| Betriebszeit                                   | Zeit seit dem Start des Koordinators, in Stunden                                                                                                                                                              |
| Zigbee-Client verbunden seit                   | Zeit, seit sich Zigbee2MQTT oder ZHA über das Netzwerk mit dem Koordinator verbunden hat, in Stunden; 0: kein Client                                                                                          |
| Netzwerkverbindung                             | Ethernet, Wi-Fi oder LTE                                                                                                                                                                                      |
| Koordinator-Modus                              | Wie das Zigbee-Funkmodul angeboten wird: Ethernet, Wi-Fi oder USB                                                                                                                                             |
| Core-Firmware, Zigbee-Firmware                 | Installierte Versionen (Firmware Funkmodul 1, Firmware Funkmodul 2 bei Modellen mit mehreren Funkmodulen)                                                                                                     |
| Neueste Core-Firmware, Neueste Zigbee-Firmware | Neueste Versionen auf dem Update-Server von SMLIGHT, im in der SLZB-Weboberfläche gewählten Firmware-Kanal (Neueste Firmware Funkmodul 1, Neueste Firmware Funkmodul 2 bei Modellen mit mehreren Funkmodulen) |
| Firmware-Update verfügbar                      | An, wenn eine neuere Core- oder Zigbee-Firmware existiert                                                                                                                                                     |
| Internet erreichbar                            | Ob der Koordinator das Internet erreicht (alle 15 Minuten abgefragt)                                                                                                                                          |
| LEDs aus, LED-Nachtmodus                       | Schalter: die LEDs des Koordinators ausschalten oder nachts dimmen, wenn die Firmware es anbietet                                                                                                             |
| Koordinator neu starten                        | Schaltfläche „Schieben“: startet den ganzen Koordinator neu (etwa 20 Sekunden ohne Zigbee)                                                                                                                    |
| Zigbee-Chip neu starten                        | Schaltfläche „Schieben“: startet nur das Zigbee-Funkmodul neu (Funkmodul 1 neu starten, Funkmodul 2 neu starten beim Ultima und den U-Modellen)                                                               |

Die Werte werden alle 30 oder 60 Sekunden gelesen, und nur die geänderten
werden an Gladys gesendet. Die Integration **flasht nie eine Firmware und
ändert nie den Koordinator-Modus**: Ein Fehler dabei würde dein Zigbee-Netzwerk
ohne Koordinator lassen. Nutze dafür die SLZB-Weboberfläche.

## Dashboard-Widget

Füge das Widget **SLZB-Koordinator** zu einem Dashboard hinzu (**Bearbeiten**,
dann **Hinzufügen** in einer Spalte). Wähle den Koordinator in seinen
Einstellungen; leer zeigt es den ersten. Es zeigt:

- die Temperaturen des ESP32 und des Zigbee-Chips (live) und die Laufzeit;
- den Zustand des Koordinators (online, nicht erreichbar, Anmeldung
  abgelehnt), ob ein Zigbee-Client verbunden ist, die Netzwerkverbindung und
  den Modus;
- die installierte Firmware, daneben die neue Version, wenn es eine gibt;
- ob der Koordinator das Internet erreicht;
- die Schaltflächen **Zigbee neu starten** (bei den Modellen, die jedes
  Funkmodul neu starten: **Funk 1 neu starten**, **Funk 2 neu starten**) und
  **Neustart**, die jeweils um Bestätigung bitten.

## Szenen

### Auslöser

- **SLZB-Firmware-Update verfügbar**: Eine neue Core- oder Zigbee-Firmware ist
  für einen Koordinator erschienen. Einmal pro Version, auch nach einem
  Neustart. Filter: der Koordinator, die Firmware (_Core (ESP32)_ oder
  _Zigbee-Chip_). Variablen: der Name des Koordinators, die Firmware (`core`,
  `zigbee`), die installierte und die neue Version.
- **SLZB-Koordinator nicht erreichbar**: Ein Koordinator antwortet nicht mehr,
  zwei Abfragen in Folge (die zweite 15 Sekunden nach der ersten). Variable:
  was passiert ist.
- **SLZB-Koordinator wieder da**: Er antwortet wieder. Variable: die Minuten
  ohne Antwort.
- **SLZB-Koordinator neu gestartet**: Seine Betriebszeit ging auf null zurück
  (Stromausfall, Absturz, Firmware-Update, Neustartbefehl), auch wenn der
  Neustart zu schnell war, um als Ausfall zu gelten. Filter und Variable: der
  Ursprung, `gladys`, wenn Gladys den Neustart in den 3 Minuten davor verlangt
  hat, sonst `other`. Variable: die Betriebszeit vor dem Neustart, in Stunden.

### Szenen-Ideen

- _SLZB-Koordinator nicht erreichbar_ → eine Nachricht senden „Der
  Zigbee-Koordinator antwortet nicht mehr: Die Zigbee-Geräte sind offline“, und
  eine Flurlampe einschalten, die nicht über Zigbee läuft.
- _SLZB-Koordinator neu gestartet_ mit dem Ursprung _Nicht von Gladys_ → eine
  Nachricht mit der vorherigen Betriebszeit senden: Ein Koordinator, der von
  selbst neu startet, hat oft ein Problem mit der Stromversorgung.
- _SLZB-Firmware-Update verfügbar_ → eine Nachricht senden „Firmware
  {{triggerEvent.data.latest_version}} ist für
  {{triggerEvent.data.coordinator}} erschienen“, und sie über die
  SLZB-Weboberfläche aktualisieren, wenn es dir passt.

## Fehlerbehebung

- **Kein Koordinator in Entdecken**: mDNS kommt vielleicht nicht durch dein
  Netzwerk (VLAN, Docker ohne Host-Netzwerk für Gladys…). Gib die IP-Adresse
  des Koordinators in der Konfiguration ein und klicke dann auf **Verbindung
  testen**.
- **Anmeldung abgelehnt**: Die SLZB-Weboberfläche ist geschützt; gib ihren
  Benutzernamen und ihr Passwort in der Konfiguration ein.
- **„kein SLZB, oder Firmware älter als v2.3.6“**: Aktualisiere die Firmware
  über die SLZB-Weboberfläche (oder den Web-Flasher von SMLIGHT), oder prüfe
  die Adresse.
- **Internet erreichbar bleibt leer**: Der Zustand kommt aus dem
  Ereignisstrom des Koordinators (Port 81 seit Firmware v2.6.8); ohne ihn
  sendet die Integration lieber keinen Internet-Zustand als einen falschen.
- **Die neueste Firmware bleibt leer**: Das Modell des Koordinators ist nicht
  im Katalog von SMLIGHT, oder Gladys erreicht `updates.smlight.tech` nicht;
  die Integration versucht es jede Stunde erneut.
- Ausführliche Protokolle: Setze `LOG_LEVEL=debug` in der Umgebung des
  Containers.

## Grenzen

- Kein Firmware-Update, kein Moduswechsel, keine WLAN- oder
  Netzwerkeinstellungen über Gladys, mit Absicht.
- Der Bluetooth-Proxy, das Infrarot, der Summer und das Ambientelicht des
  Ultima werden nicht unterstützt.
- Firmware älter als v2.3.6 wird nicht unterstützt.
- Anfragen: zwei kleine HTTP-Anfragen pro Koordinator alle 30 oder 60
  Sekunden, eine Abfrage des Internet-Zustands alle 15 Minuten und, mit der
  Option, eine Anfrage pro Firmware (Core und jedes Funkmodul) und Tag an den
  Update-Server von SMLIGHT. Sonst verlässt nichts dein Netzwerk.
- Die Anmeldung ist für alle Koordinatoren dieselbe.
- Die Funktionsnamen werden beim Hinzufügen des Geräts gewählt; ein
  Koordinator, dessen Funkmodule sich ändern (Thread statt Zigbee, ein neuer
  Chip), bietet im Tab Entdecken ein **Update** an.
