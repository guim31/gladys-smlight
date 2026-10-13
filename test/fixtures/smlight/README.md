# SLZB answers used by the tests

Real answers of SLZB coordinators and of the SMLIGHT firmware catalog, taken
from the test fixtures of two Apache-2.0 projects:

| File                                 | Source                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| `info-slzb-06p10-v2.5.2.json`        | pysmlight `tests/fixtures/slzb-06-info.json` (one radio, top level) |
| `info-slzb-mr1-v2.7.1.json`          | pysmlight `tests/fixtures/slzb-06-info-radios.json` (two radios)    |
| `info-slzb-ultima3-v3.2.6.dev2.json` | pysmlight `tests/fixtures/slzb-ultima-info.json` (ESP32-S3, Z-Wave) |
| `info-slzb-06p7-v2.3.6.json`         | Home Assistant `tests/components/smlight/fixtures/info-2.3.6.json`  |
| `info-slzb-06p7-radios-v2.3.6.json`  | Home Assistant `tests/components/smlight/fixtures/info.json`        |
| `sensors-slzb-06.json`               | pysmlight `tests/fixtures/slzb-06-sensors.json`                     |
| `sensors-slzb-ultima.json`           | pysmlight `tests/fixtures/slzb-ultima-sensors.json`                 |
| `sensors-slzb-06p7-ha.json`          | Home Assistant `tests/components/smlight/fixtures/sensors.json`     |
| `catalog-esp.json`                   | pysmlight `tests/fixtures/slzb-06-esp-fw.json` (core, ESP32)        |
| `catalog-esp-s3.json`                | pysmlight `tests/fixtures/slzb-06U-esp-fw.json` (core, ESP32-S3)    |
| `catalog-zigbee-06m.json`            | pysmlight `tests/fixtures/slzb-06-zb-fw.json` (EFR32 radio)         |
| `catalog-zigbee-06p7.json`           | pysmlight `tests/fixtures/slzb-06-zb2-fw.json` (CC2652P7 radio)     |

- [pysmlight](https://github.com/smlight-tech/pysmlight), by SMLIGHT and
  contributors, Apache-2.0.
- [Home Assistant](https://github.com/home-assistant/core), `smlight`
  integration, Apache-2.0.

The Home Assistant fixtures hold the inner object only (the library parsed it):
they are wrapped here in `{ "Info": ... }` / `{ "Sensors": ... }`, as the
coordinator answers. Anonymized: MAC addresses replaced by invented ones
(`02:5A:6C:00:00:0x`), IP addresses by documentation addresses (`192.0.2.x`).
