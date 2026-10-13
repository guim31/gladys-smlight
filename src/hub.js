// -----------------------------------------------------------------------------
// The SLZB hub: finds the coordinators (addresses typed in the configuration,
// mDNS through Gladys), reads the ones the user added to Gladys on a timer of
// the container, publishes their states when they change, fires the scene
// events on transitions, and runs the commands of the device features and of
// the widget.
//
// Refresh: the devices are published with should_poll and a poll frequency
// Gladys accepts, but the core cannot be trusted to call onPoll (a device
// created without should_poll is never polled, GladysAssistant/Gladys#3198):
// the timer of the container reads every added coordinator at the interval of
// the configuration (30 or 60 s), and onPoll only reads a coordinator the
// timer has not read for most of a period. Only the coordinators added to
// Gladys are read: Gladys drops the states of a device it does not know, and
// the triggers and the widget only offer added devices.
//
// Each reading is two small GET requests (/ha_info, /ha_sensors). The
// firmware catalog of SMLIGHT is asked once a day per coordinator (on the
// Internet, like the SLZB web interface does), and only when the option is on.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { formatHost, parseHost } from './config.js';
import {
  FEATURE_KEYS,
  HOST_PARAM,
  buildDevice,
  coordinatorName,
  deviceIds,
  featureKeyOf,
  featureStates,
  macOfDevice,
  radioKey,
} from './devices.js';
import { createIssueLog } from './issues.js';
import { ERROR_KINDS, LED_SETTINGS, PAGE_LED, SlzbClient } from './smlight/client.js';
import { EVENT_TYPES, EventStream, ledChanges } from './smlight/events.js';
import {
  catalogUrl,
  coreQuery,
  isNewer,
  latestCore,
  latestRadio,
  radioQuery,
} from './smlight/firmware.js';
import { usableRadios } from './smlight/model.js';
import {
  COMMAND_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  byLanguage,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'smlight-hub' });

export const WIDGET_KEY = 'slzb';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  UPDATE: 'firmware_update_available',
  UNREACHABLE: 'coordinator_unreachable',
  RECOVERED: 'coordinator_recovered',
  RESTARTED: 'coordinator_restarted',
});

// Who restarted a coordinator (`origin` filter and variable).
export const ORIGINS = Object.freeze({ GLADYS: 'gladys', OTHER: 'other' });

// Firmware components (`component` filter and variable of the update trigger).
export const COMPONENTS = Object.freeze({ CORE: 'core', ZIGBEE: 'zigbee' });

export const HUB_TIMINGS = {
  // A coordinator that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before a coordinator counts as down (scene event).
  downAfterFailures: 2,
  // The firmware catalog: once a day, again after an hour when it failed.
  firmwareMs: 24 * 60 * 60_000,
  firmwareRetryMs: 60 * 60_000,
  // The Internet state (an event of the stream): asked every 15 minutes, like
  // Home Assistant does.
  internetMs: 15 * 60_000,
  // A coordinator that is down is looked for again by mDNS (new DHCP lease?)
  // at most this often.
  rediscoverMs: 15 * 60_000,
  // A restart seen this long after a restart command is Gladys' own.
  ownRestartMs: 3 * 60_000,
  // Unchanged values are sent again this often: Gladys shows "no recent value"
  // after 48 hours.
  heartbeatMs: 6 * 60 * 60_000,
  // An uptime this much lower than the previous reading means a restart.
  uptimeSlackSeconds: 30,
  mdnsTimeoutSeconds: 5,
};

const signature = (config) => JSON.stringify([config.username, config.password]);

/**
 * The first IPv4 address of an mDNS answer, else the first address. The web
 * interface is on port 80 whatever port the service announces (the
 * `_slzb-06._tcp` service is the one Zigbee2MQTT and ZHA use to find the
 * Zigbee socket, port 6638).
 */
function mdnsAddress(service) {
  const addresses = Array.isArray(service.addresses) ? service.addresses : [];
  const ipv4 = addresses.find((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address));
  const address = ipv4 ?? addresses[0];
  if (typeof address !== 'string' || address === '') {
    return null;
  }
  return { host: address, port: 80 };
}

export class SlzbHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} options.request HTTP seam (src/smlight/http.js httpRequest)
   * @param {Function} options.openStream event stream seam (src/smlight/http.js openEventStream)
   * @param {(url: string) => Promise<unknown>} options.fetchJson firmware catalog seam
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, openStream, fetchJson, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.openStream = openStream;
    this.fetchJson = fetchJson;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    /** Coordinators read on the timer (added to Gladys), by MAC address. */
    this.records = new Map();
    /** What the last discovery found, by MAC address. */
    this.found = new Map();
    this.lastDiscovery = { mdns: 'unknown', failures: [] };
    this.lastRediscovery = -Infinity;
    this.saved = { announced: {}, hosts: {} };
    this.connectionStatus = null;
    this.transports = new Map();
    this.pollTimer = null;
    this.stopped = false;
    this.discovering = null;
    this.issues = createIssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) => (value && typeof value === 'object' ? value : {});
    this.saved = { announced: object(saved.announced), hosts: object(saved.hosts) };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.connectionStatus = null;
    this.transports.clear();
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const credentials = signature(config);
    if (this.signature !== null && this.signature !== credentials) {
      // New login: new clients (and event streams) for every coordinator.
      for (const record of this.records.values()) {
        this.dropRecord(record);
      }
      this.records.clear();
    }
    this.signature = credentials;
    await this.discover();
    await this.pollAll({ force: true });
    this.schedulePoll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      this.dropRecord(record);
    }
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.issues.ok('poll', 'Reading cycle works again');
      } catch (err) {
        this.issues.fail('poll', `Reading cycle failed: ${err.message}`);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Discovery ---------------------------------------------------------------

  /** Concurrent discoveries share one run. */
  discover() {
    this.discovering ??= this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  async runDiscovery() {
    const candidates = new Map(); // "host:port" → { address, source }
    const add = (address, source) => {
      if (address && !candidates.has(formatHost(address))) {
        candidates.set(formatHost(address), { address, source });
      }
    };
    // The typed addresses first: they win over mDNS for the same coordinator.
    for (const address of this.config.hosts) {
      add(address, 'config');
    }
    for (const service of await this.scanMdns()) {
      add(mdnsAddress(service), 'mdns');
    }
    for (const record of this.records.values()) {
      add(record.address, 'known');
    }
    for (const device of this.createdDevices()) {
      add(parseHost(device.params?.find((p) => p.name === HOST_PARAM)?.value ?? ''), 'known');
    }
    for (const host of Object.values(this.saved.hosts)) {
      add(parseHost(host), 'known');
    }

    const probes = await Promise.all(
      [...candidates.values()].map(async ({ address, source }) => {
        try {
          return { address, source, ...(await this.probe(address)) };
        } catch (err) {
          return { address, source, error: err };
        }
      }),
    );

    const found = new Map();
    const failures = [];
    for (const probe of probes) {
      if (probe.error) {
        // Only what the user typed is worth reporting: a stale address is not.
        if (probe.source === 'config') {
          failures.push({
            host: formatHost(probe.address),
            kind: probe.error.kind ?? ERROR_KINDS.INVALID,
          });
        }
        logger.debug(`Discovery: ${formatHost(probe.address)}: ${probe.error.message}`);
        continue;
      }
      if (!found.has(probe.info.mac)) {
        found.set(probe.info.mac, probe);
      }
    }
    this.found = found;
    this.lastDiscovery = { ...this.lastDiscovery, failures };

    let hostsChanged = false;
    for (const [mac, probe] of found) {
      const host = formatHost(probe.address);
      if (this.saved.hosts[mac] !== host) {
        this.saved.hosts[mac] = host;
        hostsChanged = true;
      }
    }
    if (hostsChanged) {
      this.store.save(this.saved);
    }

    const devices = [...found.values()].map((probe) =>
      buildDevice(this.gladys, this.snapshotOf(probe), this.deviceOptions()),
    );
    // Even an empty list: the Discover tab then shows no stale coordinator.
    await this.gladys.publishDiscoveredDevices(devices);
    logger.debug(`Discovery: ${found.size} coordinator(s) found`);
    this.syncRecords();
    return found;
  }

  async scanMdns() {
    try {
      const services = await this.gladys.scanNetwork('mdns', {
        timeoutSeconds: this.timings.mdnsTimeoutSeconds,
      });
      this.issues.ok('mdns', 'mDNS discovery through Gladys works again');
      this.lastDiscovery = { ...this.lastDiscovery, mdns: 'ok' };
      return Array.isArray(services) ? services : [];
    } catch (err) {
      // 403: an older Gladys, or the capture refused. Typed addresses still work.
      this.issues.fail('mdns', `mDNS discovery through Gladys unavailable: ${err.message}`);
      this.lastDiscovery = { ...this.lastDiscovery, mdns: 'unavailable' };
      return [];
    }
  }

  /** Ask one address who it is. */
  async probe(address) {
    const client = this.newClient(address);
    const info = await client.getInfo();
    const sensors = await client.getSensors();
    return { info, sensors };
  }

  newClient(address) {
    return new SlzbClient({
      host: address.host,
      port: address.port,
      username: this.config.username,
      password: this.config.password,
      request: this.request,
    });
  }

  deviceOptions() {
    return { language: this.config.language, firmwareCheck: this.config.firmwareCheck };
  }

  snapshotOf(probe, record) {
    return {
      mac: probe.info.mac,
      address: probe.address,
      info: probe.info,
      sensors: probe.sensors,
      firmware: record?.snapshot?.firmware ?? null,
      internet: record?.snapshot?.internet ?? null,
    };
  }

  /** The devices the user added to Gladys that are coordinators of this integration. */
  createdDevices() {
    return (this.gladys.devices ?? []).filter((device) =>
      macOfDevice(this.gladys, device.external_id),
    );
  }

  /** One record per added coordinator, at the address the last discovery found. */
  syncRecords() {
    const wanted = new Map();
    for (const device of this.createdDevices()) {
      const mac = macOfDevice(this.gladys, device.external_id);
      const found = this.found.get(mac);
      const address =
        found?.address ??
        this.records.get(mac)?.address ??
        parseHost(device.params?.find((p) => p.name === HOST_PARAM)?.value ?? '') ??
        parseHost(this.saved.hosts[mac] ?? '');
      if (address) {
        wanted.set(mac, { address, found });
      }
    }
    for (const [mac, record] of this.records) {
      const next = wanted.get(mac);
      if (!next) {
        this.dropRecord(record);
        this.records.delete(mac);
      } else if (formatHost(next.address) !== formatHost(record.address)) {
        // A new address (DHCP): same record, so an outage in progress ends
        // with its "back" event.
        logger.info(`${record.label}: now at ${formatHost(next.address)}`);
        record.stream?.stop();
        record.stream = null;
        record.address = next.address;
        record.client = this.newClient(next.address);
      }
    }
    for (const [mac, { address, found }] of wanted) {
      if (!this.records.has(mac)) {
        this.records.set(mac, this.newRecord(mac, address, found));
      }
    }
  }

  newRecord(mac, address, found) {
    return {
      mac,
      address,
      label: found
        ? `${coordinatorName(found.info)} (${formatHost(address)})`
        : formatHost(address),
      client: this.newClient(address),
      snapshot: found ? this.snapshotOf(found) : null,
      reachable: null,
      error: null,
      failures: 0,
      down: false,
      downSince: null,
      lastPolledAt: -Infinity,
      previousReadAt: null,
      catalog: null,
      firmwareAt: -Infinity,
      internetAt: -Infinity,
      restartRequestedAt: -Infinity,
      stream: null,
      polling: null,
      retryTimer: null,
      dropped: false,
    };
  }

  dropRecord(record) {
    record.dropped = true;
    clearTimeout(record.retryTimer);
    record.stream?.stop();
    record.stream = null;
  }

  // --- Reading the coordinators --------------------------------------------------

  /**
   * One cycle: every added coordinator not read for half a period (onPoll may
   * have read it).
   */
  async pollAll({ force = false } = {}) {
    if (this.gladys.connected === false) {
      logger.debug('Gladys unreachable: reading skipped');
      return;
    }
    const due = [...this.records.values()].filter(
      (record) => force || this.now() - record.lastPolledAt >= this.config.pollIntervalMs / 2,
    );
    await Promise.all(due.map((record) => this.poll(record)));
    await this.afterChanges();
  }

  /** Gladys asks for a refresh (onPoll): read unless the timer just did. */
  async pollDevice(device) {
    const record = this.records.get(macOfDevice(this.gladys, device.external_id));
    if (!record) {
      return;
    }
    if (this.now() - record.lastPolledAt < this.config.pollIntervalMs * 0.9) {
      logger.debug(
        `${record.label}: read ${this.now() - record.lastPolledAt} ms ago, onPoll skipped`,
      );
      return;
    }
    await this.poll(record);
    await this.afterChanges();
  }

  /** Read one coordinator and apply what changed. Concurrent calls share the read. */
  poll(record) {
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    record.lastPolledAt = this.now();
    let info;
    let sensors;
    try {
      // One after the other: the web server of the ESP32 serves few connections
      // at once, and the event stream holds one.
      info = await record.client.getInfo();
      sensors = await record.client.getSensors();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      await this.applyFailure(record, err);
      return;
    }
    if (info.mac !== record.mac) {
      // Another coordinator answers at this address now: look for ours.
      await this.applyFailure(
        record,
        Object.assign(new Error(`another device (${info.mac}) answers at this address`), {
          kind: ERROR_KINDS.UNREACHABLE,
        }),
      );
      return;
    }
    await this.applySuccess(record, info, sensors);
  }

  async applySuccess(record, info, sensors) {
    if (record.dropped) {
      return;
    }
    const previous = record.snapshot;
    record.label = `${coordinatorName(info)} (${formatHost(record.address)})`;
    if (record.down) {
      const downMinutes = Math.round((this.now() - record.downSince) / 60_000);
      logger.info(`${record.label} answers again after ${downMinutes} min`);
      await this.fire(TRIGGERS.RECOVERED, record, { down_minutes: downMinutes }, info);
    } else if (record.error) {
      logger.info(`${record.label}: connection restored`);
    } else if (record.reachable === null) {
      logger.info(
        `${record.label}: connected (${info.model ?? 'SLZB'}, core ${info.coreVersion ?? '?'})`,
      );
    }
    record.reachable = true;
    record.error = null;
    record.failures = 0;
    record.down = false;
    record.downSince = null;
    clearTimeout(record.retryTimer);

    // An uptime lower than the previous one plus the time elapsed since: the
    // coordinator restarted (even during an outage, or between two readings).
    const before = previous?.sensors?.uptime;
    const expected = before + this.secondsSince(record.previousReadAt);
    if (
      typeof before === 'number' &&
      typeof sensors.uptime === 'number' &&
      sensors.uptime + this.timings.uptimeSlackSeconds < expected
    ) {
      const own = this.now() - record.restartRequestedAt < this.timings.ownRestartMs;
      logger.info(`${record.label} restarted (${own ? 'from Gladys' : 'not from Gladys'})`);
      await this.fire(
        TRIGGERS.RESTARTED,
        record,
        {
          origin: own ? ORIGINS.GLADYS : ORIGINS.OTHER,
          previous_uptime_hours: Math.round(before / 360) / 10,
        },
        info,
      );
    }
    record.previousReadAt = this.now();

    record.snapshot = {
      mac: record.mac,
      address: record.address,
      info,
      sensors,
      firmware: previous?.firmware ?? null,
      internet: previous?.internet ?? null,
    };
    this.ensureStream(record);
    this.askInternet(record);
    await this.publishStates(record);
    // After the readings: the catalog may take a few seconds, once a day.
    await this.checkFirmware(record);
    await this.publishStates(record);
  }

  /** Seconds elapsed since a reading (0 when there was none). */
  secondsSince(at) {
    return typeof at === 'number' ? Math.max(0, (this.now() - at) / 1000) : 0;
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return;
    }
    const wasKind = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.reachable = false;
    // One warning when the problem starts (or changes), not one per reading.
    if (wasKind !== err.kind) {
      logger.warn(`${record.label}: ${err.message}`);
    } else {
      logger.debug(`${record.label}: ${err.message} (again)`);
    }
    // Only silence counts as down: a refused login is a configuration
    // problem, shown in the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      record.failures = 0;
      return;
    }
    record.failures += 1;
    if (record.failures === 1) {
      record.downSince = this.now();
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.fire(TRIGGERS.UNREACHABLE, record, {
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
      this.rediscoverLater();
    }
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then(() => this.afterChanges())
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', `Retry failed: ${err.message}`));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  /** A coordinator is down: maybe it got a new address (DHCP); look for it by mDNS. */
  rediscoverLater() {
    if (this.now() - this.lastRediscovery < this.timings.rediscoverMs) {
      return;
    }
    this.lastRediscovery = this.now();
    this.discover()
      .then(() => this.issues.ok('rediscover', 'Discovery works again'))
      .catch((err) => this.issues.fail('rediscover', `Discovery failed: ${err.message}`));
  }

  // --- Firmware ----------------------------------------------------------------

  /** Ask the SMLIGHT catalog once a day; derive the updates at every reading. */
  async checkFirmware(record) {
    if (!this.config.firmwareCheck) {
      record.snapshot.firmware = null;
      return;
    }
    const { info } = record.snapshot;
    if (this.now() - record.firmwareAt >= this.timings.firmwareMs) {
      const key = `firmware:${record.mac}`;
      try {
        const core = latestCore(await this.fetchJson(catalogUrl(coreQuery(info))), info);
        const radios = [];
        for (const radio of usableRadios(info)) {
          const query = radioQuery(info, radio);
          radios.push(query ? latestRadio(await this.fetchJson(catalogUrl(query)), radio) : null);
        }
        record.catalog = { core, radios };
        record.firmwareAt = this.now();
        this.issues.ok(key, `${record.label}: firmware catalog read again`);
      } catch (err) {
        // Tried again in an hour, not at every reading.
        record.firmwareAt = this.now() - this.timings.firmwareMs + this.timings.firmwareRetryMs;
        this.issues.fail(key, `${record.label}: firmware catalog unavailable (${err.message})`);
      }
    }
    if (!record.catalog) {
      return;
    }
    const updates = [];
    if (record.catalog.core && isNewer(record.catalog.core, info.coreVersion)) {
      updates.push({
        component: COMPONENTS.CORE,
        position: 0,
        installed: info.coreVersion,
        latest: record.catalog.core,
      });
    }
    usableRadios(info).forEach((radio, position) => {
      const latest = record.catalog.radios[position];
      if (latest && !radio.custom && radio.version && isNewer(latest, radio.version)) {
        updates.push({ component: COMPONENTS.ZIGBEE, position, installed: radio.version, latest });
      }
    });
    record.snapshot.firmware = {
      core: record.catalog.core,
      radios: record.catalog.radios,
      updates,
    };
    await this.announceUpdates(record, updates);
  }

  /** Fire the update trigger once per new version, across restarts. */
  async announceUpdates(record, updates) {
    const announced = new Set(this.saved.announced[record.mac] ?? []);
    const current = updates.map((u) => `${u.component}${u.position + 1}:${u.latest}`);
    const fresh = updates.filter((u, index) => !announced.has(current[index]));
    const changed = fresh.length > 0 || [...announced].some((entry) => !current.includes(entry));
    if (!changed) {
      return;
    }
    this.saved.announced[record.mac] = current;
    if (current.length === 0) {
      delete this.saved.announced[record.mac];
    }
    this.store.save(this.saved);
    for (const update of fresh) {
      logger.info(
        `${record.label}: ${update.component} firmware ${update.latest} available (installed ${update.installed})`,
      );
      await this.fire(TRIGGERS.UPDATE, record, {
        component: update.component,
        installed_version: update.installed,
        latest_version: update.latest,
      });
    }
  }

  // --- Event stream ------------------------------------------------------------

  ensureStream(record) {
    if (record.dropped || this.stopped) {
      return;
    }
    const url = record.client.eventsUrl(record.snapshot.info.coreVersion);
    if (record.stream?.url === url) {
      return;
    }
    // None yet, or a firmware update moved it (port 81 since v2.6.8.dev26).
    record.stream?.stop();
    const key = `stream:${record.mac}`;
    record.stream = new EventStream({
      url,
      headers: record.client.headers(),
      open: this.openStream,
      timers: this.timersEnabled,
      onEvent: (event) => {
        this.onStreamEvent(record, event).catch((err) =>
          this.issues.fail(
            `event:${record.mac}`,
            `${record.label}: event not applied (${err.message})`,
          ),
        );
      },
      onStatus: (connected, error) => {
        if (connected) {
          this.issues.ok(key, `${record.label}: event stream open again`);
          logger.debug(`${record.label}: event stream open`);
          record.internetAt = -Infinity;
          this.askInternet(record);
        } else if (error) {
          this.issues.fail(
            key,
            `${record.label}: event stream unavailable (${error.message}): no Internet state`,
          );
        }
      },
    });
    record.stream.start();
  }

  askInternet(record) {
    if (this.now() - record.internetAt < this.timings.internetMs || !record.snapshot) {
      return;
    }
    record.internetAt = this.now();
    if (!record.stream?.connected) {
      // Without the stream, a stale Internet state would be a lie: stop sending it.
      record.snapshot.internet = null;
      return;
    }
    record.client
      .requestInternetState()
      .catch((err) =>
        logger.debug(`${record.label}: Internet state request failed (${err.message})`),
      );
  }

  async onStreamEvent(record, event) {
    if (record.dropped || !record.snapshot) {
      return;
    }
    logger.debug(`${record.label}: event ${event.type}`);
    if (event.type === EVENT_TYPES.INTERNET) {
      const internet = event.data.trim() === 'ok';
      if (record.snapshot.internet === internet) {
        return;
      }
      record.snapshot.internet = internet;
    } else if (event.type === EVENT_TYPES.SETTINGS) {
      const changes = ledChanges(event.data, PAGE_LED);
      if (!changes) {
        return;
      }
      const sensors = { ...record.snapshot.sensors };
      if (typeof changes[LED_SETTINGS.disable_leds] === 'boolean') {
        sensors.disableLeds = changes[LED_SETTINGS.disable_leds];
      }
      if (typeof changes[LED_SETTINGS.night_mode] === 'boolean') {
        sensors.nightMode = changes[LED_SETTINGS.night_mode];
      }
      record.snapshot.sensors = sensors;
    } else {
      return;
    }
    await this.publishStates(record);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Scene events --------------------------------------------------------------

  async fire(key, record, data, info = record.snapshot?.info) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.mac).device,
        coordinator: info ? coordinatorName(info) : formatHost(record.address),
        ...data,
      });
      this.issues.ok('scene-event', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  async publishStates(record) {
    if (!record.snapshot) {
      return;
    }
    const states = featureStates(this.gladys, record.snapshot, this.deviceOptions());
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('states', 'States accepted again');
    } catch (err) {
      this.issues.fail('states', `States of ${record.label} refused: ${err.message}`);
    }
  }

  async afterChanges() {
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (record.reachable === null) {
        continue;
      }
      const transport = record.reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(record.mac) !== transport) {
        entries.push({ external_id: deviceIds(this.gladys, record.mac).device, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(macOfDevice(this.gladys, entry.external_id), entry.transport);
      }
      this.issues.ok('transports', 'Transport badges accepted again');
    } catch (err) {
      this.issues.fail('transports', `Transport badges refused: ${err.message}`);
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The connection status of the Configuration screen: the first problem, if any. */
  connectionState() {
    if (this.config.invalidHosts.length > 0) {
      const hosts = this.config.invalidHosts.join(', ');
      return {
        connected: false,
        message: byLanguage((lang) => CONNECTION_TEXT[lang].invalid(hosts)),
      };
    }
    // A coordinator in trouble, else an address typed in the configuration
    // that does not lead to a coordinator.
    const failing = [...this.records.values()].find((record) => record.error);
    const problem = failing
      ? { name: failing.label, kind: failing.error.kind }
      : this.records.size === 0 && this.lastDiscovery.failures[0]
        ? { name: this.lastDiscovery.failures[0].host, kind: this.lastDiscovery.failures[0].kind }
        : null;
    if (problem) {
      return {
        connected: false,
        message: byLanguage((lang) =>
          CONNECTION_TEXT[lang].failing(problem.name, ERROR_TEXT[problem.kind][lang]),
        ),
      };
    }
    if (this.records.size === 0 && this.found.size === 0) {
      return { connected: false, message: byLanguage((lang) => CONNECTION_TEXT[lang].none()) };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const state = this.connectionState();
    const key = JSON.stringify(state);
    if (key === this.connectionStatus) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(state.connected, state.message);
      this.connectionStatus = key;
    } catch (err) {
      logger.debug(`Connection status refused: ${err.message}`);
    }
  }

  // --- Gladys events -------------------------------------------------------------

  /** "Search" in the Discover tab. */
  async rediscover() {
    await this.discover();
    await this.pollAll({ force: true });
  }

  /** The user added (or updated) a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const mac = macOfDevice(this.gladys, device.external_id);
    if (!mac) {
      return;
    }
    this.syncRecords();
    const record = this.records.get(mac);
    if (!record) {
      return;
    }
    this.gladys.forgetPublishedStates(device.external_id);
    await this.poll(record);
    await this.afterChanges();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async onDeviceDeleted() {
    this.syncRecords();
    await this.afterChanges();
  }

  /** The "Test the connection" action: look for the coordinators now, and say what answers. */
  async testConnection() {
    await this.discover();
    await this.pollAll({ force: true });
    const lines = (lang) => {
      const text = REPORT_TEXT[lang];
      const out = [];
      out.push(this.found.size > 0 ? text.found(this.found.size) : text.nothing());
      for (const probe of this.found.values()) {
        out.push(
          text.line(
            coordinatorName(probe.info),
            formatHost(probe.address),
            probe.info.coreVersion ?? '?',
          ),
        );
      }
      for (const record of this.records.values()) {
        if (record.error && !this.found.has(record.mac)) {
          out.push(text.failed(record.label, ERROR_TEXT[record.error.kind][lang]));
        }
      }
      for (const failure of this.lastDiscovery.failures) {
        out.push(text.failed(failure.host, ERROR_TEXT[failure.kind][lang]));
      }
      if (this.lastDiscovery.mdns === 'unavailable') {
        out.push(text.mdnsOff());
      }
      return out.join(' ');
    };
    return byLanguage(lines);
  }

  // --- Commands ------------------------------------------------------------------

  /** The record of a device, or the error to show. */
  recordOf(externalId) {
    const record = this.records.get(macOfDevice(this.gladys, externalId));
    if (!record || !record.snapshot) {
      throw new Error(pick(COMMAND_TEXT.unknown, this.config.language));
    }
    return record;
  }

  /** onSetValue: a switch or a push button of a coordinator device. */
  async setValue(device, feature, value) {
    const record = this.recordOf(device.external_id);
    const key = featureKeyOf(this.gladys, record.mac, feature.external_id);
    if (key === FEATURE_KEYS.RESTART) {
      await this.restart(record);
      return;
    }
    const radio = this.radioOfKey(record, key);
    if (radio) {
      await this.restartRadio(record, radio.position);
      return;
    }
    if (key === FEATURE_KEYS.DISABLE_LEDS || key === FEATURE_KEYS.NIGHT_MODE) {
      await this.setLed(record, key, Number(value) === 1);
      return;
    }
    throw new Error(`Feature ${key} cannot be controlled`);
  }

  radioOfKey(record, key) {
    const radios = usableRadios(record.snapshot.info);
    for (let position = 0; position < radios.length; position += 1) {
      if (radioKey(FEATURE_KEYS.RADIO_RESTART, position) === key) {
        return { position, radio: radios[position] };
      }
    }
    return null;
  }

  async command(record, run, description) {
    try {
      const answer = await run();
      logger.debug(`${record.label}: ${description} answered ${JSON.stringify(answer ?? '')}`);
    } catch (err) {
      logger.warn(`${record.label}: ${description} failed (${err.message})`);
      throw new Error(`${pick(COMMAND_TEXT.failed, this.config.language)} (${err.message})`, {
        cause: err,
      });
    }
    logger.info(`${record.label}: ${description} (from Gladys)`);
  }

  async restart(record) {
    record.restartRequestedAt = this.now();
    await this.command(record, () => record.client.restart(), 'restart');
  }

  async restartRadio(record, position) {
    const radio = usableRadios(record.snapshot.info)[position];
    if (!radio) {
      throw new Error(pick(COMMAND_TEXT.failed, this.config.language));
    }
    await this.command(
      record,
      () => record.client.restartRadio(radio.index),
      `radio ${position + 1} restart`,
    );
  }

  async setLed(record, key, on) {
    await this.command(
      record,
      () => record.client.setLedSetting(key, on),
      `${key} ${on ? 'on' : 'off'}`,
    );
    const sensors = { ...record.snapshot.sensors };
    if (key === FEATURE_KEYS.DISABLE_LEDS) {
      sensors.disableLeds = on;
    } else {
      sensors.nightMode = on;
    }
    record.snapshot.sensors = sensors;
    await this.publishStates(record);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Widget --------------------------------------------------------------------

  /** The coordinators a widget shows: the chosen one, else every added one. */
  view(deviceExternalId) {
    if (deviceExternalId) {
      const record = this.records.get(macOfDevice(this.gladys, deviceExternalId));
      return record ? [record] : [];
    }
    return [...this.records.values()];
  }
}
