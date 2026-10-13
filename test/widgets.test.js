// -----------------------------------------------------------------------------
// The "SLZB coordinator" widget: the content fits the core vocabulary and
// budget in every state, the tiles bind to features the device really has,
// and the buttons restart what they say.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ACTIONS, formatUptime } from '../src/widgets.js';
import { FakeSlzb, HOST_1, HOST_2, createWorld, ids, settle } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet('slzb', { settings, language });
  assert.equal(ack.success, true, ack.error);
  const { content: body } = ack.data;
  assert.deepEqual(validateWidgetContent(body), [], 'rendered exactly as sent');
  return body;
}

const LANGS = ['en', 'fr', 'de', 'es'];

test('nothing added yet: a message that says what to do', async (t) => {
  const w = await world(t, { coordinators: { [HOST_1]: new FakeSlzb() } });
  for (const language of LANGS) {
    const body = await content(w, {}, language);
    assert.equal(body.components.length, 1);
    assert.equal(body.components[0].type, 'text');
  }
});

test('a coordinator: heading, live temperature tiles, status, restarts', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  await settle();
  for (const language of LANGS) {
    const body = await content(w, {}, language);
    const types = body.components.map((component) => component.type);
    assert.deepEqual(types, ['text', 'value', 'value', 'value', 'status', 'button', 'button']);
    // The tiles bound to a feature reference one the device has.
    const [device] = w.fake.devices;
    const known = new Set(device.features.map((feature) => feature.external_id));
    for (const tile of body.components.filter((c) => c.device_feature)) {
      assert.ok(known.has(tile.device_feature), tile.device_feature);
    }
  }
  const body = await content(w);
  const rows = Object.fromEntries(body.components[4].items.map((item) => [item.label, item.value]));
  assert.deepEqual(rows, {
    Coordinator: 'Online',
    'Zigbee client': 'None',
    Network: 'Ethernet',
    Mode: 'Ethernet',
    'Core firmware': 'v2.3.6',
    'Zigbee firmware': '20240314 → 20240716',
    Internet: 'Reachable',
  });
  assert.equal(body.components[3].value, '11 min');
});

test('the widget shows the coordinator chosen in its settings', async (t) => {
  const first = new FakeSlzb();
  const second = new FakeSlzb({ info: 'info-slzb-mr1-v2.7.1.json' });
  const w = await world(t, {
    coordinators: { [HOST_1]: first, [HOST_2]: second },
    config: { hosts: `${HOST_1}, ${HOST_2}`, language: 'en' },
    create: true,
  });
  const body = await content(w, { device: ids(w.gladys, second).device });
  assert.equal(body.components[0].text, 'SLZB-MR1');
  const labels = body.components[body.components.findIndex((c) => c.type === 'status')].items.map(
    (item) => item.label,
  );
  assert.ok(labels.includes('Radio 1 firmware') && labels.includes('Radio 2 firmware'));
  const gone = await content(w, { device: 'ext:test-integration:slzb:000000000000' });
  assert.equal(gone.components[0].type, 'text');
});

test('an Ultima stays within the budget: four buttons at most', async (t) => {
  const ultima = new FakeSlzb({
    info: 'info-slzb-ultima3-v3.2.6.dev2.json',
    sensors: 'sensors-slzb-ultima.json',
  });
  const w = await world(t, { coordinators: { [HOST_1]: ultima }, create: true });
  const body = await content(w);
  const buttons = body.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action.key),
    ['restart_radio_1', 'restart_radio_2', 'restart_coordinator'],
  );
  assert.ok(
    buttons.every((b) => b.action.confirm === true),
    'a restart is always confirmed',
  );
  assert.ok(body.components.length <= 8);
});

test('an unreachable coordinator shows it, without the restart buttons', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  slzb.online = false;
  await w.hub.pollAll({ force: true });
  const body = await content(w, {}, 'fr');
  const status = body.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items[0], {
    label: 'Coordinateur',
    icon: 'alert-triangle',
    value: 'Injoignable',
    color: 'danger',
  });
  assert.equal(body.components.filter((c) => c.type === 'button').length, 0);
});

test('the buttons restart the coordinator and the radio', async (t) => {
  const slzb = new FakeSlzb();
  const w = await world(t, { coordinators: { [HOST_1]: slzb }, create: true });
  await content(w);
  const radio = await w.fake.widgetAction(
    'slzb',
    `${ACTIONS.RESTART_RADIO}_1`,
    {},
    { settings: {} },
  );
  assert.equal(radio.success, true);
  assert.deepEqual(slzb.radioRestarts, [0]);
  assert.match(radio.data.message.fr, /Zigbee2MQTT/);
  const restart = await w.fake.widgetAction('slzb', ACTIONS.RESTART, {}, { settings: {} });
  assert.equal(restart.success, true);
  assert.equal(slzb.restarted, 1);
  for (const message of [radio.data.message, restart.data.message]) {
    for (const language of LANGS) {
      assert.ok(message[language].length <= 200);
    }
  }
});

test('uptime fits a tile in every language', () => {
  for (const language of LANGS) {
    for (const seconds of [0, 59, 3600, 86_399, 86_400 * 3 + 7200, 86_400 * 9999]) {
      assert.ok(formatUptime(seconds, language).length <= 12, `${language} ${seconds}`);
    }
  }
  assert.equal(formatUptime(86_400 * 3 + 7200, 'fr'), '3 j 2 h');
  assert.equal(formatUptime(5 * 3600 + 12 * 60, 'en'), '5 h 12 min');
});
