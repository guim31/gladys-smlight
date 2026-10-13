// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: SLZB-06p7 (firmware v2.3.6, with and without a radio list),
// SLZB-06p10 (v2.5.2), SLZB-MR1 (two radios), SLZB-Ultima3 (ESP32-S3, three
// radios, a dev firmware) — in every feature-name language, with and without
// the firmware check.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeSlzb, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** Five coordinators, one per fixture, on five addresses. */
function fleet() {
  return {
    '192.0.2.11': new FakeSlzb({ info: 'info-slzb-06p10-v2.5.2.json' }),
    '192.0.2.12': new FakeSlzb({ info: 'info-slzb-mr1-v2.7.1.json' }),
    '192.0.2.13': new FakeSlzb({
      info: 'info-slzb-ultima3-v3.2.6.dev2.json',
      sensors: 'sensors-slzb-ultima.json',
    }),
    '192.0.2.14': new FakeSlzb({ info: 'info-slzb-06p7-v2.3.6.json' }),
    '192.0.2.15': new FakeSlzb({
      info: 'info-slzb-06p7-radios-v2.3.6.json',
      sensors: 'sensors-slzb-06p7-ha.json',
    }),
  };
}
const HOSTS = Object.keys(fleet()).join(', ');

const scenarios = [
  { label: 'English names', config: { hosts: HOSTS, language: 'en' } },
  { label: 'French names (default)', config: { hosts: HOSTS } },
  { label: 'German names', config: { hosts: HOSTS, language: 'de' } },
  { label: 'Spanish names', config: { hosts: HOSTS, language: 'es' } },
  { label: 'no firmware check', config: { hosts: HOSTS, language: 'en', firmware_check: false } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { fake, app } = await createWorld({ coordinators: fleet(), config: scenario.config });
    try {
      const devices = fake.discoveredDevices;
      assert.equal(devices.length, 5, 'one device per fixture coordinator');

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await app.stop();
    }
  });
}
