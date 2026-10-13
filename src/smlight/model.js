// -----------------------------------------------------------------------------
// What the SLZB answers, turned into plain objects the rest of the code reads
// without guessing: `/ha_info` (identity, firmware, radios) and `/ha_sensors`
// (temperatures, memory, uptime, links, LED settings).
//
// Ported from pysmlight (https://github.com/smlight-tech/pysmlight,
// Apache-2.0, by SMLIGHT and contributors): models.py (Info, Radio, Sensors)
// and const.py (modes, radio types, device ids). Only what this integration
// uses is ported.
// -----------------------------------------------------------------------------

// Coordinator modes (`coord_mode`): how the Zigbee radio is offered to
// Zigbee2MQTT or ZHA. pysmlight MODE_LIST.
export const COORDINATOR_MODES = Object.freeze({ 0: 'eth', 1: 'wifi', 2: 'usb', 3: 'ppp' });

// Radio firmware types (`zb_type`). pysmlight ZB_TYPES.
export const RADIO_TYPES = Object.freeze({
  [-1]: 'unknown',
  0: 'coordinator',
  1: 'router',
  2: 'thread',
  4: 'zhub',
  5: 'zwave',
  6: 'zwave',
  7: 'zwave',
  8: 'otbr',
});

// Model ids of the SMLIGHT firmware catalog (pysmlight const.Devices).
export const DEVICE_IDS = Object.freeze({
  'SLZB-06': 0,
  'SLZB-06M': 1,
  'SLZB-06Mg24': 2,
  'SLZB-06p7': 3,
  'SLZB-06p10': 4,
  'SLZB-06p7V2': 5,
  'SLZB-MR1': 6,
  'SLZB-MR2': 10,
  'SLZB-MR3': 11,
  'SLZB-MRW10': 12,
  'SLZB-06Mg26': 13,
  'SLZB-MR4': 14,
  'SLZB-MR1U': 15,
  'SLZB-06U': 16,
  'SLZB-06p7U': 17,
  'SLZB-06p10U': 18,
  'SLZB-06MU': 19,
  'SLZB-06Mg24U': 20,
  'SLZB-06Mg26U': 21,
  'SLZB-MR2U': 22,
  'SLZB-MR3U': 23,
  'SLZB-MR4U': 24,
  'SLZB-MRW10U': 25,
  'SLZB-Ultima4': 26,
  'SLZB-Ultima3': 27,
  'SLZB-MR5U': 28,
  'SMHUB-MG21': 65,
  'SMHUB-CCP1': 66,
  'SMHUB-MG24': 67,
  'SMHUB-MG26': 68,
  'SMHUB-CCP7': 69,
  'SMHUB-CCP10': 70,
  'SMHUB-ZG23': 71,
  'SMHUB-MG301': 72,
});

/** Catalog id of a model, case-insensitive; null when unknown. */
export function deviceIdOf(model) {
  if (typeof model !== 'string') {
    return null;
  }
  const wanted = model.toLowerCase();
  const found = Object.entries(DEVICE_IDS).find(([name]) => name.toLowerCase() === wanted);
  return found ? found[1] : null;
}

const finite = (value) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};
const bool = (value) => (typeof value === 'boolean' ? value : null);
const text = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : finite(value)?.toString();

/** `aa:bb:cc:dd:ee:ff`, or null when the value is not a MAC address. */
export function normalizeMac(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 12 || /^0+$/.test(hex)) {
    return null;
  }
  return hex.match(/../g).join(':');
}

/**
 * Normalize the core firmware version like pysmlight does: factory builds
 * may end in `.plus` (an invalid version), dev builds in `.dev`.
 */
export function normalizeCoreVersion(value) {
  const version = text(value);
  if (!version) {
    return null;
  }
  if (version.includes('plus')) {
    return version.replace(/\.plus(\d*)$/, (_, digits) => `.${digits || '1'}`);
  }
  return version.endsWith('.dev') ? `${version}0` : version;
}

/** The model as SMLIGHT writes it in its catalog: SLZB-06P7 → SLZB-06p7. */
const normalizeModel = (model) =>
  typeof model === 'string' ? model.replace(/P/g, 'p').replace(/MG/g, 'Mg') : null;

function parseRadio(raw, index) {
  const version = raw.zb_version;
  // -1: a custom firmware the SLZB cannot read the version of.
  const custom = version === -1 || version === '-1';
  return {
    index: finite(raw.chip_index) ?? index,
    chip: text(raw.zb_hw) ?? null,
    version: custom ? null : (text(version) ?? null),
    custom,
    type: finite(raw.zb_type) ?? -1,
    channel: finite(raw.zb_channel),
  };
}

/**
 * `/ha_info` → the identity of the coordinator.
 * @param {object} raw the `Info` object of the answer
 */
export function parseInfo(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Unexpected answer: no device information');
  }
  const model = normalizeModel(raw.model);
  const addons = raw.addons && typeof raw.addons === 'object' ? raw.addons : {};
  let radios = Array.isArray(raw.radios) && raw.radios.length > 0 ? raw.radios : null;
  if (!radios) {
    // Firmware before v2.5.0 describes its single radio at the top level.
    radios = [
      {
        chip_index: 0,
        zb_hw: raw.zb_hw,
        zb_version: raw.zb_version,
        zb_type: raw.zb_type,
        zb_channel: raw.zb_channel,
      },
    ];
  }
  // The Z-Wave radio of the Ultima is optional: absent unless the add-on says so.
  if (model && model.includes('Ultima') && addons.zwave !== true) {
    radios = radios.slice(0, 2);
  }
  return {
    mac: normalizeMac(raw.MAC),
    model,
    hostname: text(raw.hostname) ?? null,
    ip: text(raw.device_ip) ?? null,
    coreVersion: normalizeCoreVersion(raw.sw_version),
    firmwareChannel: typeof raw.fw_channel === 'string' ? raw.fw_channel : null,
    coordinatorMode: COORDINATOR_MODES[finite(raw.coord_mode)] ?? null,
    ramTotal: finite(raw.ram_total),
    fsTotal: finite(raw.fs_total),
    // ESP32-S3 devices ("U" models, Ultima) use another core firmware.
    uDevice:
      typeof raw.u_device === 'boolean'
        ? raw.u_device
        : Boolean(model && (model.endsWith('U') || model.toLowerCase().includes('ultima'))),
    radios: radios.map(parseRadio),
  };
}

/**
 * `/ha_sensors` → the readings.
 * @param {object} raw the `Sensors` object of the answer
 */
export function parseSensors(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Unexpected answer: no sensor readings');
  }
  return {
    coreTemperature: finite(raw.esp32_temp),
    zigbeeTemperature: finite(raw.zb_temp),
    zigbeeTemperature2: finite(raw.zb_temp2),
    uptime: finite(raw.uptime),
    // 0: no client connected to the Zigbee socket (Zigbee2MQTT, ZHA).
    socketUptime: finite(raw.socket_uptime),
    ramUsed: finite(raw.ram_usage),
    fsUsed: finite(raw.fs_used),
    ethernet: bool(raw.ethernet),
    wifi: bool(raw.wifi_connected),
    // PPP_USB_STATE_CONNECTED: the LTE modem of the Ultima is online.
    lte: raw.lte_state === 3 ? true : raw.lte_detect === true ? false : null,
    // LED settings: absent on firmware that does not offer them.
    disableLeds: bool(raw.disable_leds),
    nightMode: bool(raw.night_mode),
  };
}

/** The network link of the coordinator: `ethernet`, `wifi`, `lte` or `none`. */
export function networkLink(sensors) {
  if (sensors.ethernet) {
    return 'ethernet';
  }
  if (sensors.wifi) {
    return 'wifi';
  }
  if (sensors.lte) {
    return 'lte';
  }
  return 'none';
}

/** The radios shown in Gladys: a firmware is installed (not an empty Z-Wave slot). */
export const usableRadios = (info) => info.radios.filter((radio) => radio.type !== -1);
