// -----------------------------------------------------------------------------
// Firmware versions and the SMLIGHT catalog, on the real catalog answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogUrl,
  compareVersions,
  coreQuery,
  isNewer,
  latestCore,
  latestRadio,
  radioQuery,
} from '../src/smlight/firmware.js';
import { parseInfo } from '../src/smlight/model.js';
import { fixture } from './helpers/fakeSlzb.js';

test('versions compare like the SLZB firmware numbers them', () => {
  assert.ok(compareVersions('v2.7.1', 'v2.7.0') > 0);
  assert.ok(compareVersions('v2.10.0', 'v2.9.9') > 0);
  assert.ok(compareVersions('v3.0.0', '0.9.9') > 0);
  assert.equal(compareVersions('v2.7.1', '2.7.1'), 0);
  assert.ok(compareVersions('v2.6.8.dev25', 'v2.6.8') < 0, 'a dev build comes before its release');
  assert.ok(compareVersions('v2.6.8.dev26', 'v2.6.8.dev25') > 0);
  assert.ok(compareVersions('20240716', '20240510') > 0, 'Zigbee firmware dates');
  assert.equal(compareVersions('custom', 'v1'), null);
  assert.equal(isNewer('v2.0.0', null), false, 'never on an unreadable version');
});

test('the core catalog: newest release, or newest build on the dev channel', () => {
  const release = { firmwareChannel: 'release' };
  const dev = { firmwareChannel: 'dev' };
  assert.equal(latestCore(fixture('catalog-esp.json'), release), 'v2.0.18');
  assert.equal(latestCore(fixture('catalog-esp-s3.json'), dev), 'v3.0.0');
  const withDev = {
    fw: [
      { ver: 'v2.1.0.dev3', dev: true },
      { ver: 'v2.0.18', dev: false },
    ],
  };
  assert.equal(latestCore(withDev, release), 'v2.0.18');
  assert.equal(latestCore(withDev, dev), 'v2.1.0.dev3');
  assert.throws(() => latestCore({}, release), /Unexpected/);
});

test('the radio catalog: the newest firmware of the type installed', () => {
  const coordinator = { type: 0 };
  const router = { type: 1 };
  const thread = { type: 2 };
  assert.equal(latestRadio(fixture('catalog-zigbee-06m.json'), coordinator), '20240510');
  assert.equal(latestRadio(fixture('catalog-zigbee-06m.json'), router), '20231130');
  assert.equal(latestRadio(fixture('catalog-zigbee-06m.json'), thread), '20241105');
  assert.equal(latestRadio(fixture('catalog-zigbee-06p7.json'), coordinator), '20240716');
  assert.equal(latestRadio([], coordinator), null);
});

test('catalog queries follow pysmlight', () => {
  const p7 = parseInfo(fixture('info-slzb-06p7-radios-v2.3.6.json').Info);
  assert.deepEqual(coreQuery(p7), { type: 'ESP' });
  assert.equal(
    catalogUrl(radioQuery(p7, p7.radios[0])),
    'https://updates.smlight.tech/services/api/slzb-06x-ota.php?type=ZB&format=slzb&device=3&idx=0&ch=1',
  );
  const ultima = parseInfo(fixture('info-slzb-ultima3-v3.2.6.dev2.json').Info);
  assert.deepEqual(coreQuery(ultima), { type: 'ESPs3' });
  assert.equal(radioQuery(ultima, ultima.radios[1]).idx, '1');
  assert.equal(radioQuery({ model: 'Unknown' }, { index: 0 }), null);
});
