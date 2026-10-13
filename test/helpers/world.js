// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake SLZB coordinators on a
// fake network, a fake firmware catalog, a temporary /data and a manual
// clock, with the integration wired on top through registerHandlers. No timer
// runs unless `timers: true` (with node:test mock timers): the tests read the
// coordinators with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeSlzb, createCatalog, createNetwork, fixture } from './fakeSlzb.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const HOST_1 = '192.0.2.10';
export const HOST_2 = '192.0.2.20';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 13, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** An mDNS answer of the core for a coordinator at `address`. */
export const mdnsService = (address, name = 'SLZB-06p7') => ({
  name: `${name}._slzb-06._tcp.local`,
  host: `${name.toLowerCase()}.local`,
  addresses: [address],
  port: 80,
  txt: [],
});

/**
 * @param {object} [options]
 * @param {Record<string, FakeSlzb>} [options.coordinators] by host
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {Array} [options.mdns] raw mDNS results of the core
 * @param {boolean} [options.create] add every discovered device, as the user would
 */
export async function createWorld({
  clock = createClock(),
  coordinators,
  config = { hosts: HOST_1, language: 'en' },
  devices = [],
  mdns = [],
  catalog = createCatalog(),
  connect = true,
  create = false,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-smlight-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(coordinators ?? { [HOST_1]: new FakeSlzb() });
  const gladys = createFakeGladys({ config, devices, scanResults: { mdns } });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, {
    store,
    request: network.request,
    openStream: network.openStream,
    fetchJson: catalog.fetchJson,
    timers,
    timings,
    now: clock.now,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    network,
    catalog,
    app,
    hub: app.hub,
    clock,
    dataDir,
    store,
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  if (create) {
    await createAll(world);
  }
  return world;
}

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** Let the queued microtasks (fake events) and their handlers run. */
export async function settle() {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** External ids of a coordinator of the world. */
export const ids = (gladys, coordinator) =>
  gladys.externalIds('slzb', coordinator.mac.replace(/:/g, ''));

export { FakeSlzb, createCatalog, fixture };
