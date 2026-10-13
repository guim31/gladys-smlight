// -----------------------------------------------------------------------------
// The container refreshes the states by itself, on its own timer, without
// any onPoll from Gladys (GladysAssistant/Gladys#3198: a device created
// without should_poll is never polled, even once the core is fixed).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeSlzb, HOST_1, createWorld, ids, settle } from './helpers/world.js';

async function timedWorld(t, config) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 13, 10) });
  const slzb = new FakeSlzb();
  const clock = { now: () => Date.now(), advance: (ms) => t.mock.timers.tick(ms) };
  const w = await createWorld({
    clock,
    coordinators: { [HOST_1]: slzb },
    config,
    timers: true,
    create: true,
  });
  t.after(() => w.app.stop());
  const polls = [];
  // Any onPoll from Gladys would go through here: none is expected.
  const original = w.fake.poll.bind(w.fake);
  w.fake.poll = (...args) => {
    polls.push(args);
    return original(...args);
  };
  const reads = () => slzb.calls.filter((call) => call.path === '/ha_sensors').length;
  return { w, slzb, polls, reads };
}

test('the states refresh every minute without any onPoll', async (t) => {
  const { w, slzb, polls, reads } = await timedWorld(t, { hosts: HOST_1, language: 'en' });
  const feature = ids(w.gladys, slzb).feature('core_temperature');
  assert.equal(w.fake.lastState(feature), 39.4);
  const before = reads();

  slzb.sensors.esp32_temp = '45.02';
  t.mock.timers.tick(59_999);
  await settle();
  assert.equal(reads(), before, 'not before the interval');
  t.mock.timers.tick(1);
  await settle();
  assert.equal(reads(), before + 1);
  assert.equal(w.fake.lastState(feature), 45);

  slzb.sensors.esp32_temp = '46.5';
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(w.fake.lastState(feature), 46.5);
  assert.equal(polls.length, 0, 'no onPoll involved');
});

test('the 30-second interval of the configuration is followed', async (t) => {
  const { reads } = await timedWorld(t, { hosts: HOST_1, poll_interval: '30' });
  const before = reads();
  for (let i = 0; i < 4; i += 1) {
    t.mock.timers.tick(30_000);
    await settle();
  }
  assert.equal(reads(), before + 4);
});

test('an unchanged value is sent again within 12 hours (heartbeat)', async (t) => {
  const { w, slzb } = await timedWorld(t, { hosts: HOST_1 });
  const feature = ids(w.gladys, slzb).feature('ram_used');
  const sent = () => w.fake.states.filter((s) => s.device_feature_external_id === feature).length;
  const first = sent();
  for (let minute = 0; minute < 12 * 60; minute += 1) {
    t.mock.timers.tick(60_000);
    await settle();
  }
  assert.ok(sent() > first, 'the RAM did not change, yet it was sent again');
});
