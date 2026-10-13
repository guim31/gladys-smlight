# SMLIGHT SLZB for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that supervises [SMLIGHT](https://smlight.tech) SLZB Zigbee/Thread coordinators
(SLZB-06, -06M, -06p7, -06p10, -07, -MR1, Ultima…) through their local HTTP
API, over the local network. Many Zigbee2MQTT users run their Zigbee network on
one: this integration tells Gladys whether the coordinator is healthy, and
restarts it when it is not.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against real answers of SLZB coordinators recorded in the
> test fixtures of [pysmlight](https://github.com/smlight-tech/pysmlight) and
> of the Home Assistant `smlight` integration, not against a coordinator on a
> desk. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-smlight/issues).

## Features

- **One device per coordinator**, identified by its MAC address (a new IP
  address keeps the device): ESP32 core and Zigbee chip **temperatures**,
  **RAM** and **file system** used, **uptime**, how long the **Zigbee client**
  (Zigbee2MQTT, ZHA) has been connected, **network link** (Ethernet, Wi-Fi,
  LTE), **coordinator mode** (Ethernet, Wi-Fi, USB), **installed and latest
  firmware** of the core and of each radio, **firmware update available**,
  **Internet reachable**.
- **Commands**: restart the coordinator, restart the Zigbee chip (each radio
  on the ESP32-S3 models), **LEDs off** and **LED night mode** when the
  firmware offers them. No firmware flashing and no mode change: a mistake
  there would take the Zigbee network down.
- **Scene triggers**: _SLZB firmware update available_ (once per version,
  across restarts, with both versions), _SLZB coordinator unreachable_, _SLZB
  coordinator back_ (with the outage length), _SLZB coordinator restarted_
  (its uptime went back to zero, even between two readings; from Gladys or
  not).
- **Dashboard widget** "SLZB coordinator": live temperatures, uptime, state,
  Zigbee client, network, mode, firmware with its updates, Internet, and the
  restart buttons behind a confirmation.
- **Discovery** through the mDNS of Gladys (`_slzb-06._tcp`), or by IP address;
  a coordinator that stops answering is looked for again by mDNS (new DHCP
  lease).
- A **Test the connection** button, a connection status that names the
  coordinator and the problem, and a **transport badge** per device.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets and scene triggers).
- An SLZB coordinator with firmware **v2.3.6** or later (the `/ha_info` and
  `/ha_sensors` endpoints). Older firmware is detected and reported.
- The login of the SLZB web interface, if you set one.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-smlight`
   (or install **SMLIGHT SLZB** from the catalog once it is listed).
2. Open the **Discover** tab: the coordinators found by mDNS are listed. If
   one is missing, enter its IP address in **Configuration**, and the login of
   its web interface if it has one. Click **Test the connection**.
3. Add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- `GET /ha_info` (identity, firmware, radios) and `GET /ha_sensors` (readings)
  every 30 or 60 seconds, for the coordinators added to Gladys only. The
  devices are published with `should_poll` and a one-minute poll frequency,
  but the integration reads them on its own timer (Gladys 5.2 may never poll a
  device, GladysAssistant/Gladys#3198); `onPoll` is a fallback that skips a
  coordinator read less than a period ago. Only the values that changed are
  sent, all of them again when a device is added or Gladys reconnects, and an
  unchanged value every 6 hours.
- Commands are `GET /api2?action=4&cmd=3` (restart), `cmd=1[&idx=n]` (radio
  restart) and `POST /settings/saveParams` (`pageId=8`, `disableLeds` /
  `nightMode`), as pysmlight sends them. A login is sent as HTTP Basic.
- The Server-Sent Events stream of the coordinator (port 81 since firmware
  v2.6.8.dev26, `/events` before) brings the LED settings changed elsewhere
  and the Internet state, asked every 15 minutes
  (`GET /api2?action=1&param=inetState`). Without the stream, no Internet state
  is sent.
- With the option on (default), the SMLIGHT update catalog
  (`updates.smlight.tech`, on the Internet) is asked once a day per
  coordinator, for the core and for each radio, on the firmware channel set in
  the SLZB. An update is announced once per version: `/data/smlight-state.json`
  remembers the versions already announced and the last address of each
  coordinator. Nothing else is stored; the password stays in the Gladys
  configuration and never reaches the logs.
- A coordinator is "unreachable" after two failed readings in a row (the second
  one 15 seconds after the first); a refused login is a configuration problem,
  shown in the connection status. A restart is an uptime lower than the
  previous one plus the time elapsed since.

## Checked, and what was not

- Checked by the tests: the parsing of the real `/ha_info` and `/ha_sensors`
  answers of five coordinators (SLZB-06p7 v2.3.6 with and without a radio list,
  SLZB-06p10 v2.5.2, SLZB-MR1 v2.7.1, SLZB-Ultima3 v3.2.6.dev2) and of four
  firmware catalog answers; the requests sent, compared with those of
  pysmlight; every device against the table of the couples the Gladys front
  knows (`test/gladys-rules.test.js`); the refresh without `onPoll`; the logs.
- Not checked, for lack of the hardware and of a Gladys instance: a real
  coordinator, the mDNS service type (`_slzb-06._tcp`, the one the Home
  Assistant integration matches), the event stream of a real firmware (the
  `PING` events and its authentication), the answer of the Internet state
  request on a coordinator without Internet (anything but `ok` counts as no
  Internet), and the widget in a real dashboard.

## Limitations

- Firmware older than v2.3.6 is not supported.
- No firmware update, no mode change, no network settings; the Bluetooth proxy,
  infrared, buzzer and ambient light of the Ultima are not supported.
- One login for every coordinator.
- Names ending in `.local` do not resolve inside the integration container: use
  IP addresses or names your DNS resolves (mDNS discovery gives addresses).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`),
an in-memory coordinator and firmware catalog (`test/helpers/fakeSlzb.js`)
built from the fixtures of `test/fixtures/smlight/`. See [`CLAUDE.md`](CLAUDE.md)
for the project rules. Versions are published by the Release workflow
(**Actions → Release**), which also writes the GitHub Release from
[`CHANGELOG.md`](CHANGELOG.md).

## Credits

- [pysmlight](https://github.com/smlight-tech/pysmlight) by SMLIGHT and
  contributors (Apache-2.0): the API (endpoints, commands, events, firmware
  catalog) is ported from it, and its test fixtures are the answers the tests
  replay.
- Home Assistant's [`smlight`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/smlight)
  integration (Apache-2.0): the choice of sensors, the update and Internet
  logic, its test fixtures, the mDNS service type.
- The architecture and the conformity tests follow
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by SMLIGHT.
"SMLIGHT" and "SLZB" are trademarks of their owner.

## License

Apache-2.0
