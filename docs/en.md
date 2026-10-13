# SMLIGHT SLZB

Keep an eye on your [SMLIGHT](https://smlight.tech) SLZB Zigbee coordinators
(SLZB-06, SLZB-06M, SLZB-06p7, SLZB-07, SLZB-MR1, Ultima…) from Gladys, over
your local network: their temperatures and memory, whether Zigbee2MQTT is
connected to them, their network link, their firmware and its updates, and
restart them or their Zigbee chip when the Zigbee network misbehaves.

> **Developed without the hardware: feedback welcome.** This integration was
> built and tested against real answers of SLZB coordinators published by the
> pysmlight library and the Home Assistant integration, not against a
> coordinator on a desk. If something does not work as described, please say
> so on the [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-smlight/issues).

This integration is not affiliated with SMLIGHT.

## What you need

- Gladys Assistant 5.1.0 or later.
- An SLZB coordinator with **firmware v2.3.6 or later** (SLZB-OS), on the same
  network as Gladys. Older firmware has no local API to read: update it from
  the SLZB web interface first.
- If you protected the SLZB web interface with a login (**Settings** →
  **Security**), its username and password.

The integration reads the coordinator; it does not replace Zigbee2MQTT or ZHA,
which keep driving your Zigbee devices through it.

## Set up

1. Install **SMLIGHT SLZB** from the Gladys catalog (or **Integrations** →
   **Install from GitHub** with `https://github.com/guim31/gladys-smlight`).
2. Open the **Discover** tab: the coordinators on the network of Gladys are
   found automatically (mDNS). One is missing? Enter its IP address in **Configuration** (**Coordinator IP addresses**) (the SLZB web interface shows it on its **Network** page),
   for example `192.168.1.50`; several addresses are separated by commas.
3. Login: fill in **Username** and **Password** only if the web interface of
   the SLZB asks for one. The same login is used for every coordinator.
4. Click **Test the connection**: the message under the button lists the
   coordinators found and what failed.
5. In **Discover**, click **Add to Gladys** on each coordinator, pick a room,
   save.

Options:

- **Refresh interval**: 30 seconds or 1 minute (default).
- **Check for firmware updates**: on by default. Once a day, the integration
  asks the SMLIGHT update server, on the Internet, for the latest firmware of
  each coordinator, like the SLZB web interface does. Turn it off to stay fully
  local: the features of the latest versions and of the update are then not
  created.
- **Language of the feature names**: English, French (default), German or
  Spanish. The names are given when a device is added.

## The device of each coordinator

Each coordinator is one device, named after its host name. Only the features
the coordinator offers are created.

| Feature                                      | What it is                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESP32 core temperature                       | Temperature of the ESP32 chip that runs the coordinator, in °C                                                                                                                          |
| Zigbee chip temperature                      | Temperature of the Zigbee radio chip, in °C (Radio 1 temperature, Radio 2 temperature on models with two radios)                                                                        |
| RAM used, File system used                   | Memory used by the coordinator, in kilobytes (the gauge goes up to the total)                                                                                                           |
| Uptime                                       | Time since the coordinator started, in hours                                                                                                                                            |
| Zigbee client connected for                  | Time since Zigbee2MQTT or ZHA connected to the coordinator over the network, in hours; 0: no client connected                                                                           |
| Network link                                 | Ethernet, Wi-Fi or LTE                                                                                                                                                                  |
| Coordinator mode                             | How the Zigbee radio is offered: Ethernet, Wi-Fi or USB                                                                                                                                 |
| Core firmware, Zigbee firmware               | Installed versions (Radio 1 firmware, Radio 2 firmware on models with several radios)                                                                                                   |
| Latest core firmware, Latest Zigbee firmware | Latest versions on the SMLIGHT update server, on the firmware channel chosen in the SLZB web interface (Latest radio 1 firmware, Latest radio 2 firmware on models with several radios) |
| Firmware update available                    | On when a newer core or Zigbee firmware exists                                                                                                                                          |
| Internet reachable                           | Whether the coordinator reaches the Internet (asked every 15 minutes)                                                                                                                   |
| LEDs off, LED night mode                     | Switches: turn the LEDs of the coordinator off, or dim them at night, when the firmware offers it                                                                                       |
| Restart coordinator                          | “Push” button: restarts the whole coordinator (about 20 seconds without Zigbee)                                                                                                         |
| Restart Zigbee chip                          | “Push” button: restarts the Zigbee radio only (Restart radio 1, Restart radio 2 on the Ultima and U models)                                                                             |

The values are read every 30 or 60 seconds, and only the ones that changed are
sent to Gladys. The integration **never flashes a firmware and never changes
the coordinator mode**: a mistake there would leave your Zigbee network without
its coordinator. Use the SLZB web interface for that.

## Dashboard widget

Add the **SLZB coordinator** widget to a dashboard (**Edit**, then **Add** in
a column). Choose the coordinator in its settings; empty, it shows the first
one. It shows:

- the ESP32 and Zigbee chip temperatures (live) and the uptime;
- the state of the coordinator (online, unreachable, login refused), whether a
  Zigbee client is connected, the network link and the mode;
- the installed firmware, with the new version next to it when there is one;
- whether the coordinator reaches the Internet;
- the buttons **Restart Zigbee** (**Restart radio 1**, **Restart radio 2** on
  the models that restart each radio) and **Restart**, each asking for a
  confirmation.

## Scenes

### Triggers

- **SLZB firmware update available**: a new core or Zigbee firmware is out for
  a coordinator. Once per version, even across restarts. Filters: the
  coordinator, the firmware (_Core (ESP32)_ or _Zigbee chip_). Variables: the
  coordinator name, the firmware (`core`, `zigbee`), the installed version and
  the new version.
- **SLZB coordinator unreachable**: a coordinator stopped answering, two
  readings in a row (the second one 15 seconds after the first). Variable: what
  happened.
- **SLZB coordinator back**: it answers again. Variable: the minutes without
  answer.
- **SLZB coordinator restarted**: its uptime went back to zero (power cut,
  crash, firmware update, restart command), even when the restart was too quick
  to be seen as an outage. Filter and variable: the origin, `gladys` when
  Gladys asked for the restart in the previous 3 minutes, `other` otherwise.
  Variable: the uptime before the restart, in hours.

### Scene ideas

- _SLZB coordinator unreachable_ → send a message "The Zigbee coordinator no
  longer answers: Zigbee devices are offline", and turn on a light of the
  hallway that is not Zigbee.
- _SLZB coordinator restarted_ with origin _Not from Gladys_ → send a message
  with the previous uptime: a coordinator that restarts on its own often has a
  power supply problem.
- _SLZB firmware update available_ → send a message "Firmware
  {{triggerEvent.data.latest_version}} is out for
  {{triggerEvent.data.coordinator}}" and update it from the SLZB web interface
  when it suits you.

## Troubleshooting

- **No coordinator in Discover**: mDNS may not cross your network (VLAN,
  Docker without host network for Gladys…). Enter the IP address of the
  coordinator in the configuration, then click **Test the connection**.
- **Login refused**: the SLZB web interface is protected; enter its username
  and password in the configuration.
- **"not an SLZB, or firmware older than v2.3.6"**: update the firmware from
  the SLZB web interface (or the SMLIGHT web flasher), or check the address.
- **Internet reachable stays empty**: the state comes from the event stream of
  the coordinator (port 81 since firmware v2.6.8); without it, the integration
  sends no Internet state rather than a wrong one.
- **The latest firmware stays empty**: the coordinator model is not in the
  SMLIGHT catalog, or Gladys cannot reach `updates.smlight.tech`; the
  integration tries again every hour.
- Debug logs: set `LOG_LEVEL=debug` in the container environment.

## Limits

- No firmware update, no mode change, no Wi-Fi or network settings from
  Gladys, by design.
- The Bluetooth proxy, the infrared, the buzzer and the ambient light of the
  Ultima are not supported.
- Firmware older than v2.3.6 is not supported.
- Requests: two small HTTP requests per coordinator every 30 or 60 seconds,
  one Internet state request every 15 minutes, and, with the option on, one
  request per firmware (core and each radio) per day to the SMLIGHT update
  server. Nothing else leaves your network.
- The login is the same for every coordinator.
- The feature names are chosen when the device is added; a coordinator whose
  radios change (Thread instead of Zigbee, a new chip) offers an **Update** in
  the Discover tab.
