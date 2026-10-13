// -----------------------------------------------------------------------------
// Parsing of /ha_info and /ha_sensors, on the real answers of the fixtures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceIdOf,
  networkLink,
  normalizeCoreVersion,
  normalizeMac,
  parseInfo,
  parseSensors,
  usableRadios,
} from '../src/smlight/model.js';
import { fixture } from './helpers/fakeSlzb.js';

const info = (name) => parseInfo(fixture(name).Info);
const sensors = (name) => parseSensors(fixture(name).Sensors);

test('an SLZB-06p10 of firmware v2.5.2 describes its single radio at the top level', () => {
  const parsed = info('info-slzb-06p10-v2.5.2.json');
  assert.equal(parsed.mac, '02:5a:6c:00:00:01');
  assert.equal(parsed.model, 'SLZB-06p10', 'P → p, as the catalog writes it');
  assert.equal(parsed.coreVersion, 'v2.5.2');
  assert.equal(parsed.coordinatorMode, 'eth');
  assert.equal(parsed.uDevice, false);
  assert.deepEqual(parsed.radios, [
    { index: 0, chip: 'CC2674P10', version: '20240315', custom: false, type: 0, channel: null },
  ]);
});

test('an SLZB-MR1 lists two radios', () => {
  const parsed = info('info-slzb-mr1-v2.7.1.json');
  assert.deepEqual(
    parsed.radios.map((radio) => [radio.index, radio.chip, radio.version]),
    [
      [0, 'EFR32MG21', '20240510'],
      [1, 'CC2652P7', '20240716'],
    ],
  );
  assert.equal(usableRadios(parsed).length, 2);
});

test('an Ultima3 is an ESP32-S3 device; its empty Z-Wave slot is not a usable radio', () => {
  const parsed = info('info-slzb-ultima3-v3.2.6.dev2.json');
  assert.equal(parsed.model, 'SLZB-Ultima3');
  assert.equal(parsed.uDevice, true);
  assert.equal(parsed.radios.length, 3, 'the Z-Wave add-on is present');
  assert.deepEqual(
    usableRadios(parsed).map((radio) => radio.type),
    [8, 2],
  );
  // Without the add-on, the third slot is dropped (pysmlight).
  const raw = fixture('info-slzb-ultima3-v3.2.6.dev2.json').Info;
  raw.addons.zwave = false;
  assert.equal(parseInfo(raw).radios.length, 2);
});

test('a custom Zigbee firmware (-1) has no version', () => {
  const raw = fixture('info-slzb-06p7-radios-v2.3.6.json').Info;
  raw.radios[0].zb_version = -1;
  const [radio] = parseInfo(raw).radios;
  assert.equal(radio.custom, true);
  assert.equal(radio.version, null);
});

test('sensor readings: strings and numbers, LED settings, links', () => {
  const plain = sensors('sensors-slzb-06.json');
  assert.equal(plain.coreTemperature, 39.44);
  assert.equal(plain.zigbeeTemperature, 35.76);
  assert.equal(plain.uptime, 700);
  assert.equal(plain.socketUptime, 0);
  assert.equal(plain.disableLeds, false);
  assert.equal(networkLink(plain), 'ethernet');

  const ultima = sensors('sensors-slzb-ultima.json');
  assert.equal(ultima.lte, true, 'lte_state 3: connected');
  assert.equal(networkLink({ ...ultima, ethernet: false }), 'lte');
  assert.equal(networkLink({ ethernet: false, wifi: true }), 'wifi');
  assert.equal(networkLink({}), 'none');

  // Firmware that does not offer the LED settings.
  const bare = parseSensors({ esp32_temp: 40, uptime: 1 });
  assert.equal(bare.disableLeds, null);
  assert.equal(bare.zigbeeTemperature, null);
});

test('helpers', () => {
  assert.equal(normalizeMac('02-5A-6C-00-00-01'), '02:5a:6c:00:00:01');
  assert.equal(normalizeMac('00:00:00:00:00:00'), null);
  assert.equal(normalizeMac('nope'), null);
  assert.equal(normalizeCoreVersion('v2.3.1.plus'), 'v2.3.1.1');
  assert.equal(normalizeCoreVersion('v2.3.1.plus2'), 'v2.3.1.2');
  assert.equal(normalizeCoreVersion('v2.7.0.dev'), 'v2.7.0.dev0');
  assert.equal(deviceIdOf('slzb-06P7'), 3);
  assert.equal(deviceIdOf('SLZB-unknown'), null);
  assert.throws(() => parseInfo(null), /no device information/);
});
