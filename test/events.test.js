// -----------------------------------------------------------------------------
// The event stream: parsing, LED changes, and reconnection with a growing delay.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventStream, createEventParser, ledChanges } from '../src/smlight/events.js';

test('events are parsed whatever the chunks', () => {
  const events = [];
  const parse = createEventParser((event) => events.push(event));
  const stream =
    ': hello\n\nevent: LOG_STR\ndata: ConfigHelper|write config\n\nevent: EVENT_INET_STATE\r\ndata: ok\r\n\r\n' +
    'event: SAVE_PARAMS\ndata: {"page":8,\ndata: "changes":{}}\n\n';
  for (const chunk of stream.match(/.{1,7}/gs)) {
    parse(chunk);
  }
  assert.deepEqual(events, [
    { type: 'LOG_STR', data: 'ConfigHelper|write config' },
    { type: 'EVENT_INET_STATE', data: 'ok' },
    { type: 'SAVE_PARAMS', data: '{"page":8,\n"changes":{}}' },
  ]);
});

test('LED changes of a SAVE_PARAMS event', () => {
  assert.deepEqual(
    ledChanges(
      '{"page":8,"origin":"ha","changes":{"disableLeds":true,"nightMode":0},"needReboot":false}',
      8,
    ),
    { disableLeds: true, nightMode: false },
  );
  assert.equal(ledChanges('{"page":7,"changes":{"enabled":true}}', 8), null);
  assert.equal(ledChanges('not json', 8), null);
});

test('a dropped stream opens again after 5 s, then 10 s, 20 s...', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const opened = [];
  const statuses = [];
  const stream = new EventStream({
    url: 'http://192.0.2.9:81/',
    open: (url, options) => {
      opened.push(options);
      return { close() {} };
    },
    onEvent: () => {},
    onStatus: (connected) => statuses.push(connected),
  });
  stream.start();
  assert.equal(opened.length, 1);
  opened[0].onEnd(new Error('ECONNREFUSED'));
  t.mock.timers.tick(4_999);
  assert.equal(opened.length, 1);
  t.mock.timers.tick(1);
  assert.equal(opened.length, 2);
  opened[1].onEnd(new Error('ECONNREFUSED'));
  t.mock.timers.tick(10_000);
  assert.equal(opened.length, 3);
  // Data arrives: connected, and the delay starts again from 5 s.
  opened[2].onChunk(': hi\n\n');
  assert.deepEqual(statuses, [false, false, true]);
  opened[2].onEnd(null);
  t.mock.timers.tick(5_000);
  assert.equal(opened.length, 4);
  stream.stop();
  opened[3].onEnd(new Error('closed'));
  t.mock.timers.tick(60_000);
  assert.equal(opened.length, 4, 'stopped: never again');
});
