// -----------------------------------------------------------------------------
// Configuration normalization: addresses, defaults, intervals.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, formatHost, normalizeConfig, parseHost } from '../src/config.js';

test('addresses: an IP, a name, a port, a URL copied from the browser, IPv6', () => {
  assert.deepEqual(parseHost('192.0.2.5'), { host: '192.0.2.5', port: 80 });
  assert.deepEqual(parseHost(' slzb-06.lan:8080 '), { host: 'slzb-06.lan', port: 8080 });
  assert.deepEqual(parseHost('http://192.0.2.5/#/dashboard'), { host: '192.0.2.5', port: 80 });
  assert.deepEqual(parseHost('fe80::1'), { host: 'fe80::1', port: 80 });
  assert.deepEqual(parseHost('[fe80::1]:81'), { host: 'fe80::1', port: 81 });
  assert.equal(parseHost('https://192.0.2.5'), null, 'the SLZB serves plain HTTP');
  assert.equal(parseHost('http://admin:secret@192.0.2.5'), null, 'no login in the address');
  assert.equal(parseHost(''), null);
  assert.equal(formatHost({ host: 'fe80::1', port: 8080 }), '[fe80::1]:8080');
  assert.equal(formatHost({ host: '192.0.2.5', port: 80 }), '192.0.2.5');
});

test('normalization', () => {
  const config = normalizeConfig({
    hosts: '192.0.2.5, 192.0.2.6;192.0.2.5  bad_host!, http://u:p@192.0.2.7',
    username: ' admin ',
    password: ' spaced ',
    poll_interval: '30',
    firmware_check: false,
    language: 'de',
  });
  assert.deepEqual(config.hosts.map(formatHost), ['192.0.2.5', '192.0.2.6']);
  assert.deepEqual(config.invalidHosts, ['bad_host!', 'http://…@192.0.2.7']);
  assert.equal(config.username, 'admin');
  assert.equal(config.password, ' spaced ', 'a password is kept as typed');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.firmwareCheck, false);
  assert.equal(config.language, 'de');

  const defaults = normalizeConfig({});
  assert.deepEqual(defaults.hosts, []);
  assert.equal(defaults.pollIntervalMs, Number(DEFAULT_CONFIG.poll_interval) * 1000);
  assert.equal(defaults.firmwareCheck, true);
  assert.equal(defaults.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollIntervalMs, 60_000);
});
