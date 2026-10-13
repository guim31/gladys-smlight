# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One Gladys device per SMLIGHT SLZB coordinator (SLZB-06, -06M, -06p7,
  -06p10, -07, -MR, Ultima…), found by the mDNS discovery of Gladys or by its
  IP address, identified by its MAC address: ESP32 and Zigbee chip
  temperatures, RAM and file system used, uptime, Zigbee client connection
  time, network link, coordinator mode, installed and latest firmware, firmware
  update available, Internet reachable.
- Commands: restart the coordinator, restart the Zigbee chip (each radio on the
  ESP32-S3 models), LEDs off and LED night mode when the firmware offers them.
- Scene triggers: firmware update available (once per version), coordinator
  unreachable, coordinator back, coordinator restarted.
- Dashboard widget "SLZB coordinator": temperatures, uptime, state, Zigbee
  client, network, firmware and updates, and the restarts behind a
  confirmation.
- Optional login of the SLZB web interface, refresh every 30 or 60 seconds,
  optional daily firmware check on the SMLIGHT update server, feature names in
  English, French, German or Spanish.
- A "Test the connection" button and a connection status that says what is
  wrong.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-smlight/commits/main
