// -----------------------------------------------------------------------------
// The hub against fake coordinators: discovery, readings, scene events,
// commands, the event stream, and what happens when an address changes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../src/devices.js';
import { ORIGINS, TRIGGERS } from '../src/hub.js';
import {
  FakeSlzb,
  HOST_1,
  HOST_2,
  createAll,
  createWorld,
  ids,
  mdnsService,
  settle,
} from './helpers/world.js';

const MINUTE = 60_000;

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const featureOf = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`));
const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);

test('a coordinator typed in the configuration is discovered with its MAC address as identity', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb } });
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.external_id, ids(w.gladys, slzb).device);
  assert.equal(device.name, 'SLZB-06p7');
  assert.equal(device.model, 'SLZB-06p7');
  assert.deepEqual(device.params, [{ name: 'HOST', value: HOST_1 }]);
});

test('mDNS finds the coordinators; a typed address wins for the same one', async (t) => {
  const first = new FakeSlzb();
  const second = new FakeSlzb({ info: 'info-slzb-mr1-v2.7.1.json' });
  const w = await world(t, {
    coordinators: { [HOST_1]: first, '192.0.2.99': first, [HOST_2]: second },
    config: { hosts: HOST_1, language: 'en' },
    mdns: [
      mdnsService('192.0.2.99'), // the same coordinator, at another address
      // IPv4 preferred; the announced port is the Zigbee socket's, not the web one.
      { ...mdnsService(HOST_2, 'SLZB-MR1'), addresses: ['fe80::1', HOST_2], port: 6638 },
    ],
  });
  const devices = w.fake.discoveredDevices;
  assert.equal(devices.length, 2);
  assert.deepEqual(devices.map((device) => device.params[0].value).sort(), [HOST_1, HOST_2].sort());
});

test('only the coordinators added to Gladys are read', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb } });
  const reads = () => slzb.calls.filter((call) => call.path === '/ha_sensors').length;
  const afterDiscovery = reads();
  await w.hub.pollAll({ force: true });
  assert.equal(reads(), afterDiscovery, 'not added: not read');
  assert.equal(w.fake.states.length, 0);

  await createAll(w);
  assert.ok(reads() > afterDiscovery, 'added: read at once');
  const id = ids(w.gladys, slzb);
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.CORE_TEMPERATURE)), 39.4);
  assert.equal(w.fake.lastState(id.feature('zigbee_temperature')), 35.8);
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.RAM)), 91);
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.UPTIME)), 0.2); // 700 s
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.NETWORK)), 'Ethernet');
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.MODE)), 'Ethernet');
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.CORE_FIRMWARE)), 'v2.3.6');
  assert.equal(w.fake.lastState(id.feature('zigbee_firmware')), '20240314');
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.DISABLE_LEDS)), 0);
});

test('only the values that changed are sent again', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  await settle();
  const before = w.fake.states.length;
  await w.hub.pollAll({ force: true });
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');

  slzb.sensors.esp32_temp = '41.06';
  await w.hub.pollAll({ force: true });
  const sent = w.fake.states.slice(before);
  assert.deepEqual(
    sent.map((state) => [state.device_feature_external_id.split(':').pop(), state.state]),
    [['core_temperature', 41.1]],
  );
});

test('a device added in Gladys gets all its states again (Gladys dropped the earlier ones)', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  await settle();
  const before = w.fake.states.length;
  const [device] = w.fake.discoveredDevices;
  await w.fake.deviceUpdated(device);
  assert.ok(w.fake.states.length - before >= 10, 'everything sent again');
  assert.ok(w.fake.widgetRefreshes.includes('slzb'));
});

test('unreachable after two failed readings, back with the outage length; logged as transitions', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  slzb.online = false;
  await w.hub.pollAll({ force: true });
  assert.equal(events(w, TRIGGERS.UNREACHABLE).length, 0, 'one failure is a blip');
  w.clock.advance(15_000);
  await w.hub.pollAll({ force: true });
  const [down] = events(w, TRIGGERS.UNREACHABLE);
  assert.deepEqual(down.data, {
    device: ids(w.gladys, slzb).device,
    coordinator: 'SLZB-06p7',
    error: 'does not answer',
  });
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  w.clock.advance(5 * MINUTE);
  await w.hub.pollAll({ force: true });
  assert.equal(events(w, TRIGGERS.UNREACHABLE).length, 1, 'once per outage');

  slzb.online = true;
  w.clock.advance(MINUTE);
  await w.hub.pollAll({ force: true });
  const [back] = events(w, TRIGGERS.RECOVERED);
  assert.equal(back.data.down_minutes, 6);
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a lower uptime is a restart; its origin says whether Gladys asked for it', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  w.clock.advance(MINUTE);
  slzb.tick(60);
  await w.hub.pollAll({ force: true });
  assert.equal(events(w, TRIGGERS.RESTARTED).length, 0, 'a growing uptime is no restart');

  // Restarted by hand (or a power cut): uptime back to a few seconds.
  w.clock.advance(MINUTE);
  slzb.sensors.uptime = 12;
  await w.hub.pollAll({ force: true });
  const [other] = events(w, TRIGGERS.RESTARTED);
  assert.equal(other.data.origin, ORIGINS.OTHER);
  assert.equal(other.data.previous_uptime_hours, 0.2);

  // Restarted from the device feature.
  const [device] = w.fake.discoveredDevices;
  const ack = await w.fake.setValue(device, featureOf(device, FEATURE_KEYS.RESTART), 1);
  assert.deepEqual(ack, { success: true });
  assert.equal(slzb.restarted, 1);
  w.clock.advance(MINUTE);
  slzb.sensors.uptime = 20;
  await w.hub.pollAll({ force: true });
  assert.equal(events(w, TRIGGERS.RESTARTED).at(-1).data.origin, ORIGINS.GLADYS);
});

test('a restart during an outage is seen too', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  slzb.online = false;
  w.clock.advance(30 * MINUTE);
  await w.hub.pollAll({ force: true });
  slzb.online = true;
  slzb.sensors.uptime = 600; // up 10 minutes, after 30 minutes of silence
  w.clock.advance(MINUTE);
  await w.hub.pollAll({ force: true });
  assert.equal(events(w, TRIGGERS.RESTARTED).length, 1);
});

test('a firmware update is announced once per version, even across a restart', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  const id = ids(w.gladys, slzb);
  const updates = events(w, TRIGGERS.UPDATE);
  assert.deepEqual(
    updates.map((event) => event.data),
    [
      {
        device: id.device,
        coordinator: 'SLZB-06p7',
        component: 'zigbee',
        installed_version: '20240314',
        latest_version: '20240716',
      },
    ],
  );
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.UPDATE)), 1);
  assert.equal(w.fake.lastState(id.feature('zigbee_firmware_latest')), '20240716');
  // The ESP32 catalog of the fixture is older than the installed v2.3.6.
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.CORE_LATEST)), 'v2.0.18');

  // A day later: the catalog is asked again, nothing new is announced.
  const asked = w.catalog.calls.length;
  w.clock.advance(24 * 60 * MINUTE);
  await w.hub.pollAll({ force: true });
  assert.ok(w.catalog.calls.length > asked);
  assert.equal(events(w, TRIGGERS.UPDATE).length, 1);

  // A new integration process, same /data: not announced again.
  await w.app.stop();
  const again = await world(t, {
    coordinators: { [HOST_1]: slzb },
    dataDir: w.dataDir,
    devices: w.fake.devices,
  });
  assert.equal(events(again, TRIGGERS.UPDATE).length, 0);

  // Updated from the SLZB interface: the binary goes back to 0.
  slzb.info.radios[0].zb_version = 20240716;
  slzb.info.zb_version = '20240716';
  await again.hub.pollAll({ force: true });
  assert.equal(again.fake.lastState(id.feature(FEATURE_KEYS.UPDATE)), 0);
});

test('the firmware catalog is asked once a day, only when the option is on', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  const asked = w.catalog.calls.length;
  assert.equal(asked, 2, 'the core list and the radio list');
  for (let i = 0; i < 10; i += 1) {
    w.clock.advance(MINUTE);
    await w.hub.pollAll({ force: true });
  }
  assert.equal(w.catalog.calls.length, asked);
  assert.match(w.catalog.calls[1], /type=ZB&format=slzb&device=3&idx=0&ch=1/);

  const off = await world(t, {
    coordinators: { [HOST_1]: new FakeSlzb() },
    config: { hosts: HOST_1, firmware_check: false },
    create: true,
  });
  assert.equal(off.catalog.calls.length, 0);
  const features = off.fake.discoveredDevices[0].features.map((f) =>
    f.external_id.split(':').pop(),
  );
  assert.ok(!features.includes(FEATURE_KEYS.UPDATE));
  assert.ok(!features.includes(FEATURE_KEYS.CORE_LATEST));
});

test('a failing catalog is asked again an hour later, not at every reading', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb } });
  w.catalog.failing = true;
  await createAll(w);
  const asked = w.catalog.calls.length;
  assert.equal(asked, 1);
  for (let i = 0; i < 30; i += 1) {
    w.clock.advance(MINUTE);
    await w.hub.pollAll({ force: true });
  }
  assert.equal(w.catalog.calls.length, 1);
  w.catalog.failing = false;
  w.clock.advance(31 * MINUTE);
  await w.hub.pollAll({ force: true });
  assert.equal(w.catalog.calls.length, 3);
});

test('the radios of an SLZB-MR1 and an Ultima are restarted by their index', async (t) => {
  const mr1 = new FakeSlzb({ info: 'info-slzb-mr1-v2.7.1.json' });
  const ultima = new FakeSlzb({
    info: 'info-slzb-ultima3-v3.2.6.dev2.json',
    sensors: 'sensors-slzb-ultima.json',
  });
  const w = await world(t, {
    coordinators: { [HOST_1]: mr1, [HOST_2]: ultima },
    config: { hosts: `${HOST_1}, ${HOST_2}`, language: 'en' },
    create: true,
  });
  const device = (slzb) =>
    w.fake.discoveredDevices.find((d) => d.external_id === ids(w.gladys, slzb).device);
  const keys = (slzb) => device(slzb).features.map((f) => f.external_id.split(':').pop());

  // The MR1 (ESP32) restarts its first radio only, like its web interface.
  assert.ok(keys(mr1).includes('zigbee_restart'));
  assert.ok(!keys(mr1).includes('zigbee_restart_2'));
  assert.equal(featureOf(device(mr1), 'zigbee_restart').name, 'Restart radio 1');
  // The Ultima (ESP32-S3) restarts each radio; its empty Z-Wave slot is not one.
  assert.ok(keys(ultima).includes('zigbee_restart_2'));
  assert.ok(!keys(ultima).includes('zigbee_restart_3'));

  await w.fake.setValue(device(mr1), featureOf(device(mr1), 'zigbee_restart'), 1);
  await w.fake.setValue(device(ultima), featureOf(device(ultima), 'zigbee_restart_2'), 1);
  assert.deepEqual(mr1.radioRestarts, [0]);
  assert.deepEqual(ultima.radioRestarts, [1]);
  const mr1Call = mr1.calls.find((call) => call.query.cmd === '1');
  assert.equal(mr1Call.query.idx, undefined, 'the first radio takes no index');
});

test('the LED switches write the setting and show it at once', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  const [device] = w.fake.discoveredDevices;
  const id = ids(w.gladys, slzb);
  const ack = await w.fake.setValue(device, featureOf(device, FEATURE_KEYS.NIGHT_MODE), 1);
  assert.deepEqual(ack, { success: true });
  const post = slzb.calls.find((call) => call.method === 'POST');
  assert.equal(post.path, '/settings/saveParams');
  assert.equal(post.body, 'pageId=8&nightMode=on&ha=True');
  assert.equal(slzb.sensors.night_mode, true);
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.NIGHT_MODE)), 1);
});

test('a LED setting changed in the SLZB interface arrives by the event stream', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  await settle();
  const id = ids(w.gladys, slzb);
  slzb.emit(
    'SAVE_PARAMS',
    '{"page":8,"origin":"web","changes":{"disableLeds":true},"needReboot":false}',
  );
  await settle();
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.DISABLE_LEDS)), 1);
  // Another page of settings changes nothing here.
  slzb.emit('SAVE_PARAMS', '{"page":7,"changes":{"enabled":true}}');
  await settle();
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.DISABLE_LEDS)), 1);
});

test('the Internet state comes from the event stream, asked every 15 minutes', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  await settle();
  const id = ids(w.gladys, slzb);
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.INTERNET)), 1);
  assert.equal(slzb.streams.size, 1);
  // Firmware v2.3.6: the stream before it moved to port 81 (v2.6.8.dev26).
  assert.equal([...slzb.streams][0].url, 'http://192.0.2.10/events');

  slzb.internet = false;
  const asks = () => slzb.calls.filter((call) => call.query.param === 'inetState').length;
  const before = asks();
  w.clock.advance(5 * MINUTE);
  await w.hub.pollAll({ force: true });
  assert.equal(asks(), before, 'not before 15 minutes');
  w.clock.advance(10 * MINUTE);
  await w.hub.pollAll({ force: true });
  await settle();
  assert.equal(asks(), before + 1);
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.INTERNET)), 0);
});

test('without an event stream, no Internet state is sent', async (t) => {
  const slzb = new FakeSlzb({ events: false });
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  await settle();
  w.clock.advance(16 * MINUTE);
  await w.hub.pollAll({ force: true });
  const id = ids(w.gladys, slzb);
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.INTERNET)), undefined);
  assert.equal(w.fake.lastState(id.feature(FEATURE_KEYS.CORE_TEMPERATURE)), 39.4);
});

test('a coordinator with a new address is found again by mDNS', async (t) => {
  const slzb = new FakeSlzb();
  const coordinators = { [HOST_1]: slzb };
  const w = await world(t, {
    coordinators,
    config: { hosts: '', language: 'en' },
    mdns: [mdnsService(HOST_1)],
    create: true,
  });
  // New DHCP lease.
  delete coordinators[HOST_1];
  coordinators[HOST_2] = slzb;
  w.fake.scanResults.mdns = [mdnsService(HOST_2)];
  await w.hub.pollAll({ force: true });
  w.clock.advance(15_000);
  await w.hub.pollAll({ force: true }); // down: look for it
  await settle();
  assert.deepEqual(w.fake.discoveredDevices[0].params, [{ name: 'HOST', value: HOST_2 }]);
  await w.hub.pollAll({ force: true });
  assert.equal(events(w, TRIGGERS.RECOVERED).length, 1);
  assert.equal(w.hub.records.get(slzb.mac).address.host, HOST_2);
});

test('a refused login is a configuration problem, not an outage', async (t) => {
  const slzb = new FakeSlzb({ login: { username: 'admin', password: 'right-one' } });
  const w = await world(t, {
    coordinators: { [HOST_1]: slzb },
    config: { hosts: HOST_1, username: 'admin', password: 'wrong-one', language: 'en' },
  });
  assert.equal(w.fake.discoveredDevices.length, 0);
  assert.deepEqual(w.fake.connectionStatus, {
    connected: false,
    message: {
      en: '192.0.2.10: login refused: check the username and password.',
      fr: "192.0.2.10 : connexion refusée : vérifiez l'identifiant et le mot de passe.",
      de: '192.0.2.10: Anmeldung abgelehnt: Prüfe Benutzername und Passwort.',
      es: '192.0.2.10: inicio de sesión rechazado: compruebe el usuario y la contraseña.',
    },
  });
  await w.fake.configUpdated({ hosts: HOST_1, username: 'admin', password: 'right-one' });
  assert.equal(w.fake.discoveredDevices.length, 1);
  assert.equal(w.fake.connectionStatus.connected, true);
  const authorized = slzb.calls.at(-1).authorization;
  assert.equal(authorized, `Basic ${Buffer.from('admin:right-one').toString('base64')}`);
});

test('the connection status explains what is missing', async (t) => {
  const nothing = await world(t, { coordinators: {}, config: { hosts: '' } });
  assert.equal(nothing.fake.connectionStatus.connected, false);
  assert.match(nothing.fake.connectionStatus.message.fr, /onglet Découverte/);

  const typo = await world(t, { coordinators: {}, config: { hosts: 'http://user:pw@192.0.2.1' } });
  assert.match(typo.fake.connectionStatus.message.en, /Address not understood/);
  assert.ok(!JSON.stringify(typo.fake.connectionStatus).includes('pw@'), 'never the credentials');
});

test('a firmware without /ha_info is reported, not added', async (t) => {
  const old = new FakeSlzb();
  old.handle = async () => ({ status: 404, headers: {}, body: 'URL NOT FOUND' });
  const w = await world(t, { coordinators: { [HOST_1]: old } });
  assert.equal(w.fake.discoveredDevices.length, 0);
  assert.match(w.fake.connectionStatus.message.en, /firmware older than v2\.3\.6/);
});

test('"Test the connection" says what answers', async (t) => {
  const w = await world(t, {
    coordinators: { [HOST_1]: new FakeSlzb() },
    config: { hosts: `${HOST_1}, ${HOST_2}`, language: 'en' },
  });
  const ack = await w.fake.action('test_connection');
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    '1 coordinator(s) found. SLZB-06p7 (192.0.2.10): firmware v2.3.6. 192.0.2.20: does not answer.',
  );
});

test('a command on a coordinator Gladys does not know is refused with a message', async (t) => {
  const w = await world(t, {
    coordinators: { [HOST_1]: new FakeSlzb() },
    config: { hosts: HOST_1 },
  });
  const [device] = w.fake.discoveredDevices;
  const ack = await w.fake.setValue(device, featureOf(device, FEATURE_KEYS.RESTART), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /onglet Découverte/);
});

test('onPoll is only a fallback: a coordinator just read by the timer is not read again', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  const reads = () => slzb.calls.filter((call) => call.path === '/ha_sensors').length;
  const [device] = w.fake.discoveredDevices;
  const before = reads();
  assert.deepEqual(await w.fake.poll(device), { success: true });
  assert.equal(reads(), before);
  w.clock.advance(MINUTE);
  await w.fake.poll(device);
  assert.equal(reads(), before + 1);
});

test('a firmware update that moves the event stream to port 81 is followed', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  await settle();
  assert.deepEqual(
    [...slzb.streams].map((stream) => stream.url),
    ['http://192.0.2.10/events'],
  );
  slzb.info.sw_version = 'v2.7.1';
  await w.hub.pollAll({ force: true });
  await settle();
  assert.deepEqual(
    [...slzb.streams].map((stream) => stream.url),
    ['http://192.0.2.10:81/'],
  );
});
