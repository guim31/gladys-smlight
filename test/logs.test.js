// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a password.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeSlzb, HOST_1, createWorld, settle } from './helpers/world.js';

const PASSWORD = 'Sup3r-Secret-Passw0rd';

/** Capture the lines of the SDK logger at LOG_LEVEL=info. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const slzb = new FakeSlzb({ login: { username: 'admin', password: PASSWORD } });
  const w = await createWorld({
    coordinators: { [HOST_1]: slzb },
    config: { hosts: HOST_1, username: 'admin', password: PASSWORD, language: 'en' },
    create: true,
    ...options,
  });
  t.after(() => w.app.stop());
  return { ...w, slzb };
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await settle();
  assert.ok(
    logs.texts().some((text) => text.includes('connected')),
    'the start is logged',
  );
  logs.clear();

  for (let i = 0; i < 20; i += 1) {
    w.slzb.tick(60);
    w.slzb.sensors.esp32_temp = String(39 + i / 10);
    w.clock.advance(60_000);
    await w.hub.pollAll();
    await settle();
  }
  // A day later: the firmware catalog again, the Internet state again.
  w.clock.advance(24 * 60 * 60_000);
  w.slzb.tick(24 * 3600);
  await w.hub.pollAll();
  await settle();
  assert.deepEqual(logs.texts(), []);
});

test('a coordinator that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await settle();
  logs.clear();

  w.slzb.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.pollAll();
    await settle();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));

  logs.clear();
  w.slzb.online = true;
  w.clock.advance(60_000);
  await w.hub.pollAll();
  await w.hub.pollAll();
  await settle();
  const back = logs.texts().filter((text) => text.includes('answers again'));
  assert.equal(back.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines.filter((line) => line.stream === 'err').length, 0);
});

test('a failing firmware catalog is logged once, not at every reading', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { create: false });
  w.catalog.failing = true;
  await w.fake.deviceCreated(w.fake.discoveredDevices[0]);
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(61 * 60_000);
    await w.hub.pollAll();
  }
  const catalog = logs.texts().filter((text) => text.includes('firmware catalog'));
  assert.equal(catalog.length, 1, logs.texts().join('\n'));
});

test('a user command writes one line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await settle();
  logs.clear();
  const [device] = w.fake.discoveredDevices;
  const feature = device.features.find((f) => f.external_id.endsWith(':night_mode'));
  await w.fake.setValue(device, feature, 1);
  await settle();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /night_mode on \(from Gladys\)/);
});

test('no secret of the configuration ever reaches the logs, even at debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await settle();
  // A wrong password, failures, a recovery, commands: everything is logged.
  await w.fake.configUpdated({ hosts: HOST_1, username: 'admin', password: `${PASSWORD}-old` });
  w.slzb.online = false;
  await w.hub.pollAll({ force: true });
  w.slzb.online = true;
  await w.fake.configUpdated({ hosts: HOST_1, username: 'admin', password: PASSWORD });
  await w.fake.action('test_connection');
  await settle();
  const all = logs.texts().join('\n');
  assert.ok(logs.lines.length > 5, 'debug shows the details');
  assert.ok(!all.includes(PASSWORD), 'never the password');
  assert.ok(!all.includes(Buffer.from(`admin:${PASSWORD}`).toString('base64')), 'never the header');
});
