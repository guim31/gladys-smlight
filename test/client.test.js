// -----------------------------------------------------------------------------
// The requests the client sends, and how it reads the answers and failures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, SlzbClient } from '../src/smlight/client.js';

/** A request seam that answers `reply(url, options)` and records the calls. */
function seam(reply) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, ...options });
    return reply(url, options);
  };
  return { calls, request };
}
const ok = (body) => ({ status: 200, headers: {}, body });

test('readings are two GET requests; the login travels as HTTP Basic', async () => {
  const { calls, request } = seam((url) =>
    ok(
      url.endsWith('/ha_info')
        ? '{"Info":{"MAC":"02:5A:6C:00:00:09"}}'
        : '{"Sensors":{"uptime":5}}',
    ),
  );
  const client = new SlzbClient({
    host: '192.0.2.9',
    username: 'admin',
    password: 'p@ss',
    request,
  });
  assert.equal((await client.getInfo()).mac, '02:5a:6c:00:00:09');
  assert.equal((await client.getSensors()).uptime, 5);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['http://192.0.2.9/ha_info', 'http://192.0.2.9/ha_sensors'],
  );
  assert.equal(
    calls[0].headers.authorization,
    `Basic ${Buffer.from('admin:p@ss').toString('base64')}`,
  );
  const anonymous = seam(() => ok('{"Sensors":{}}'));
  await new SlzbClient({ host: '192.0.2.9', request: anonymous.request }).getSensors();
  assert.equal(anonymous.calls[0].headers.authorization, undefined);
});

test('commands follow pysmlight', async () => {
  const { calls, request } = seam(() => ok('ok'));
  const client = new SlzbClient({ host: '192.0.2.9', port: 8080, request });
  assert.equal(await client.restart(), 'ok');
  await client.restartRadio(0);
  await client.restartRadio(1);
  await client.requestInternetState();
  await client.setLedSetting('disable_leds', true);
  assert.deepEqual(
    calls.map((call) => [call.method, call.url, call.body]),
    [
      ['GET', 'http://192.0.2.9:8080/api2?action=4&cmd=3', undefined],
      ['GET', 'http://192.0.2.9:8080/api2?action=4&cmd=1', undefined],
      ['GET', 'http://192.0.2.9:8080/api2?action=4&cmd=1&idx=1', undefined],
      ['GET', 'http://192.0.2.9:8080/api2?action=1&param=inetState', undefined],
      ['POST', 'http://192.0.2.9:8080/settings/saveParams', 'pageId=8&disableLeds=on&ha=True'],
    ],
  );
  assert.equal(calls[4].headers['content-type'], 'application/x-www-form-urlencoded');
  await assert.rejects(client.setLedSetting('buzzer', true), /Unknown LED setting/);
});

test('failures are sorted by kind', async () => {
  const kindOf = async (reply) => {
    const client = new SlzbClient({ host: '192.0.2.9', request: seam(reply).request });
    try {
      await client.getInfo();
    } catch (err) {
      return err.kind;
    }
    return null;
  };
  assert.equal(
    await kindOf(() => {
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    }),
    ERROR_KINDS.UNREACHABLE,
  );
  assert.equal(await kindOf(() => ({ status: 401, headers: {}, body: '' })), ERROR_KINDS.AUTH);
  assert.equal(
    await kindOf(() => ({ status: 404, headers: {}, body: '' })),
    ERROR_KINDS.UNSUPPORTED,
  );
  assert.equal(await kindOf(() => ok('URL NOT FOUND')), ERROR_KINDS.UNSUPPORTED);
  assert.equal(await kindOf(() => ok('<html>router</html>')), ERROR_KINDS.UNSUPPORTED);
  assert.equal(await kindOf(() => ok('{"Info":{"model":"x"}}')), ERROR_KINDS.UNSUPPORTED, 'no MAC');
  assert.equal(await kindOf(() => ({ status: 500, headers: {}, body: '' })), ERROR_KINDS.INVALID);
});

test('the event stream moved to port 81 with firmware v2.6.8.dev26', () => {
  const client = new SlzbClient({ host: '192.0.2.9', port: 8080, request: async () => ok('') });
  assert.equal(client.eventsUrl('v2.6.8.dev25'), 'http://192.0.2.9:8080/events');
  assert.equal(client.eventsUrl('v2.3.6'), 'http://192.0.2.9:8080/events');
  assert.equal(client.eventsUrl('v2.6.8.dev26'), 'http://192.0.2.9:81/');
  assert.equal(client.eventsUrl('v3.2.6.dev2'), 'http://192.0.2.9:81/');
  const ipv6 = new SlzbClient({ host: 'fe80::1', request: async () => ok('') });
  assert.equal(ipv6.eventsUrl('v2.7.1'), 'http://[fe80::1]:81/');
  assert.equal(ipv6.base, 'http://[fe80::1]');
});
