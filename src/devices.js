// -----------------------------------------------------------------------------
// One Gladys device per SLZB coordinator.
//
// Identity: the MAC address the coordinator reports (`/ha_info`), not its IP
// address: a new DHCP lease keeps the device and its history. The address is
// a device param (`HOST`), upserted by each discovery.
//
// Features (couples of the core table, see test/gladys-rules.test.js), only
// those the coordinator offers:
//   - ESP32 core and radio chip temperatures: device-temperature-sensor/decimal;
//   - RAM and file system used: data/size in kilobytes, bounded by the totals;
//   - uptime, and how long the Zigbee client (Zigbee2MQTT, ZHA) has been
//     connected to the coordinator socket: duration/decimal in hours (one
//     decimal: a new value every 6 minutes, not every reading);
//   - network link (Ethernet, Wi-Fi, LTE), coordinator mode (Ethernet, Wi-Fi,
//     USB, LTE), installed and latest firmware versions: text/text;
//   - firmware update available, Internet reachable: input/binary (the
//     couple the maintainer notes recommend for a plain yes/no);
//   - LEDs off, LED night mode: switch/binary, writable, when the firmware
//     offers them;
//   - restart the coordinator, restart a radio: button/push (the "Push"
//     button of the dashboard sends 1).
// No firmware flashing, no mode change: a mistake there takes the Zigbee
// network down (the SLZB web interface stays the place for that).
//
// Gladys polls at most once a minute: the devices are published with
// should_poll and EVERY_MINUTES, but the container reads the coordinators on
// its own timer (src/hub.js, GladysAssistant/Gladys#3198); onPoll is a fallback.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { formatHost } from './config.js';
import { networkLink, usableRadios } from './smlight/model.js';

export const DEVICE_TYPE = 'slzb';
export const HOST_PARAM = 'HOST';
export const POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

// Suffixes of the feature external ids: permanent once published. The radios
// after the first one take `_2`, `_3`... (`radioKey`).
export const FEATURE_KEYS = Object.freeze({
  CORE_TEMPERATURE: 'core_temperature',
  RADIO_TEMPERATURE: 'zigbee_temperature',
  RAM: 'ram_used',
  FS: 'fs_used',
  UPTIME: 'uptime',
  SOCKET_UPTIME: 'socket_uptime',
  NETWORK: 'network',
  MODE: 'coordinator_mode',
  CORE_FIRMWARE: 'core_firmware',
  CORE_LATEST: 'core_firmware_latest',
  RADIO_FIRMWARE: 'zigbee_firmware',
  RADIO_LATEST: 'zigbee_firmware_latest',
  UPDATE: 'update_available',
  INTERNET: 'internet',
  DISABLE_LEDS: 'disable_leds',
  NIGHT_MODE: 'night_mode',
  RESTART: 'restart',
  RADIO_RESTART: 'zigbee_restart',
});

/** Key of a per-radio feature: the first radio keeps the bare key. */
export const radioKey = (key, index) => (index === 0 ? key : `${key}_${index + 1}`);

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
// `{n}`: the radio number, on coordinators with several radios.
export const NAMES = {
  en: {
    core_temperature: 'ESP32 core temperature',
    zigbee_temperature: 'Zigbee chip temperature',
    radio_temperature: 'Radio {n} temperature',
    ram_used: 'RAM used',
    fs_used: 'File system used',
    uptime: 'Uptime',
    socket_uptime: 'Zigbee client connected for',
    network: 'Network link',
    coordinator_mode: 'Coordinator mode',
    core_firmware: 'Core firmware',
    core_firmware_latest: 'Latest core firmware',
    zigbee_firmware: 'Zigbee firmware',
    radio_firmware: 'Radio {n} firmware',
    zigbee_firmware_latest: 'Latest Zigbee firmware',
    radio_firmware_latest: 'Latest radio {n} firmware',
    update_available: 'Firmware update available',
    internet: 'Internet reachable',
    disable_leds: 'LEDs off',
    night_mode: 'LED night mode',
    restart: 'Restart coordinator',
    zigbee_restart: 'Restart Zigbee chip',
    radio_restart: 'Restart radio {n}',
  },
  fr: {
    core_temperature: 'Température du cœur ESP32',
    zigbee_temperature: 'Température de la puce Zigbee',
    radio_temperature: 'Température de la radio {n}',
    ram_used: 'Mémoire vive utilisée',
    fs_used: 'Système de fichiers utilisé',
    uptime: 'Temps de fonctionnement',
    socket_uptime: 'Client Zigbee connecté depuis',
    network: 'Connexion réseau',
    coordinator_mode: 'Mode du coordinateur',
    core_firmware: 'Firmware du cœur',
    core_firmware_latest: 'Dernier firmware du cœur',
    zigbee_firmware: 'Firmware Zigbee',
    radio_firmware: 'Firmware de la radio {n}',
    zigbee_firmware_latest: 'Dernier firmware Zigbee',
    radio_firmware_latest: 'Dernier firmware de la radio {n}',
    update_available: 'Mise à jour du firmware disponible',
    internet: 'Internet joignable',
    disable_leds: 'LED éteintes',
    night_mode: 'Mode nuit des LED',
    restart: 'Redémarrer le coordinateur',
    zigbee_restart: 'Redémarrer la puce Zigbee',
    radio_restart: 'Redémarrer la radio {n}',
  },
  de: {
    core_temperature: 'Temperatur ESP32-Kern',
    zigbee_temperature: 'Temperatur Zigbee-Chip',
    radio_temperature: 'Temperatur Funkmodul {n}',
    ram_used: 'Belegter Arbeitsspeicher',
    fs_used: 'Belegtes Dateisystem',
    uptime: 'Betriebszeit',
    socket_uptime: 'Zigbee-Client verbunden seit',
    network: 'Netzwerkverbindung',
    coordinator_mode: 'Koordinator-Modus',
    core_firmware: 'Core-Firmware',
    core_firmware_latest: 'Neueste Core-Firmware',
    zigbee_firmware: 'Zigbee-Firmware',
    radio_firmware: 'Firmware Funkmodul {n}',
    zigbee_firmware_latest: 'Neueste Zigbee-Firmware',
    radio_firmware_latest: 'Neueste Firmware Funkmodul {n}',
    update_available: 'Firmware-Update verfügbar',
    internet: 'Internet erreichbar',
    disable_leds: 'LEDs aus',
    night_mode: 'LED-Nachtmodus',
    restart: 'Koordinator neu starten',
    zigbee_restart: 'Zigbee-Chip neu starten',
    radio_restart: 'Funkmodul {n} neu starten',
  },
  es: {
    core_temperature: 'Temperatura del núcleo ESP32',
    zigbee_temperature: 'Temperatura del chip Zigbee',
    radio_temperature: 'Temperatura de la radio {n}',
    ram_used: 'Memoria RAM usada',
    fs_used: 'Sistema de archivos usado',
    uptime: 'Tiempo de funcionamiento',
    socket_uptime: 'Cliente Zigbee conectado desde hace',
    network: 'Conexión de red',
    coordinator_mode: 'Modo del coordinador',
    core_firmware: 'Firmware del núcleo',
    core_firmware_latest: 'Último firmware del núcleo',
    zigbee_firmware: 'Firmware Zigbee',
    radio_firmware: 'Firmware de la radio {n}',
    zigbee_firmware_latest: 'Último firmware Zigbee',
    radio_firmware_latest: 'Último firmware de la radio {n}',
    update_available: 'Actualización de firmware disponible',
    internet: 'Internet accesible',
    disable_leds: 'LED apagados',
    night_mode: 'Modo nocturno de los LED',
    restart: 'Reiniciar el coordinador',
    zigbee_restart: 'Reiniciar el chip Zigbee',
    radio_restart: 'Reiniciar la radio {n}',
  },
};

// The texts published in the text/text features (never empty: Gladys ignores
// an empty text). Ethernet, Wi-Fi, USB and LTE are not translated.
export const VALUES = {
  en: { none: 'None', custom: 'Custom', unknown: 'Unknown' },
  fr: { none: 'Aucune', custom: 'Personnalisé', unknown: 'Inconnu' },
  de: { none: 'Keine', custom: 'Benutzerdefiniert', unknown: 'Unbekannt' },
  es: { none: 'Ninguna', custom: 'Personalizado', unknown: 'Desconocido' },
};

const LINKS = { ethernet: 'Ethernet', wifi: 'Wi-Fi', lte: 'LTE' };
const MODES = { eth: 'Ethernet', wifi: 'Wi-Fi', usb: 'USB', ppp: 'LTE' };

// Display bounds (the core never applies them on write).
const TEMPERATURE_MIN = -40;
const TEMPERATURE_MAX = 125;
const UPTIME_MAX_HOURS = 87_600; // ten years

/** External ids of the device of a coordinator, by MAC address. */
export const deviceIds = (gladys, mac) => gladys.externalIds(DEVICE_TYPE, mac.replace(/:/g, ''));

/** The MAC address of one of our device external ids, null otherwise. */
export function macOfDevice(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, 'x').device.slice(0, -1);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const hex = externalId.slice(prefix.length);
  return /^[0-9a-f]{12}$/.test(hex) ? hex.match(/../g).join(':') : null;
}

const names = (language) => NAMES[language] ?? NAMES.fr;
const values = (language) => VALUES[language] ?? VALUES.fr;

/** The name of a coordinator: its host name (the model by default), else its model. */
export const coordinatorName = (info) => info.hostname || info.model || 'SLZB';

/**
 * The features of a coordinator, from what it answered: `{ key, name, definition, value }`.
 * `value(snapshot, language)` → a number, `{ text }` or null (nothing to publish).
 */
export function featureSpecs(snapshot, { language = 'fr', firmwareCheck = true } = {}) {
  const { info, sensors } = snapshot;
  const n = names(language);
  const radios = usableRadios(info);
  const several = radios.length > 1;
  const radioName = (single, numbered, position) =>
    several ? n[numbered].replace('{n}', String(position + 1)) : n[single];
  const specs = [];

  const temperature = (key, name, read) => ({
    key,
    name,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: TEMPERATURE_MIN,
      max: TEMPERATURE_MAX,
    },
    value: (s) => round(read(s.sensors), 1),
  });
  const size = (key, total, read) => ({
    key,
    name: n[key],
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.DATA,
      type: DEVICE_FEATURE_TYPES.DATA.SIZE,
      unit: DEVICE_FEATURE_UNITS.KILOBYTE,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: total,
    },
    value: (s) => read(s.sensors),
  });
  const duration = (key, read) => ({
    key,
    name: n[key],
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.HOURS,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: UPTIME_MAX_HOURS,
    },
    value: (s) => {
      const seconds = read(s.sensors);
      return typeof seconds === 'number' ? round(seconds / 3600, 1) : null;
    },
  });
  const textFeature = (key, name, read) => ({
    key,
    name,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: false,
      // NOT NULL in Gladys, even for a text (422 on "Add" otherwise).
      min: 0,
      max: 0,
    },
    value: (s, lang) => {
      const text = read(s, lang);
      return typeof text === 'string' && text !== '' ? { text: text.slice(0, 100) } : null;
    },
  });
  const binary = (key, read) => ({
    key,
    name: n[key],
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.INPUT,
      type: DEVICE_FEATURE_TYPES.INPUT.BINARY,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 1,
    },
    value: (s) => {
      const on = read(s);
      return typeof on === 'boolean' ? Number(on) : null;
    },
  });
  const toggle = (key, read) => ({
    key,
    name: n[key],
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
    value: (s) => {
      const on = read(s.sensors);
      return typeof on === 'boolean' ? Number(on) : null;
    },
  });
  const button = (key, name) => ({
    key,
    name,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      read_only: false,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 1,
    },
    value: () => null,
  });

  // Temperatures: the ESP32, then one per radio chip the coordinator measures.
  specs.push(
    temperature(FEATURE_KEYS.CORE_TEMPERATURE, n.core_temperature, (r) => r.coreTemperature),
  );
  const radioTemperatures = [(r) => r.zigbeeTemperature, (r) => r.zigbeeTemperature2];
  radioTemperatures.forEach((read, index) => {
    // The second temperature is the second radio's (SLZB-MR, Ultima).
    if (typeof read(sensors) === 'number' && (index === 0 || several)) {
      specs.push(
        temperature(
          radioKey(FEATURE_KEYS.RADIO_TEMPERATURE, index),
          index === 0 && !several
            ? n.zigbee_temperature
            : n.radio_temperature.replace('{n}', String(index + 1)),
          read,
        ),
      );
    }
  });

  specs.push(size(FEATURE_KEYS.RAM, info.ramTotal ?? 512, (r) => r.ramUsed));
  specs.push(size(FEATURE_KEYS.FS, info.fsTotal ?? 4096, (r) => r.fsUsed));
  specs.push(duration(FEATURE_KEYS.UPTIME, (r) => r.uptime));
  if (typeof sensors.socketUptime === 'number') {
    specs.push(duration(FEATURE_KEYS.SOCKET_UPTIME, (r) => r.socketUptime));
  }

  specs.push(
    textFeature(FEATURE_KEYS.NETWORK, n.network, (s, lang) => {
      const link = networkLink(s.sensors);
      return LINKS[link] ?? values(lang).none;
    }),
    textFeature(FEATURE_KEYS.MODE, n.coordinator_mode, (s, lang) =>
      s.info.coordinatorMode ? MODES[s.info.coordinatorMode] : values(lang).unknown,
    ),
    textFeature(
      FEATURE_KEYS.CORE_FIRMWARE,
      n.core_firmware,
      (s, lang) => s.info.coreVersion ?? values(lang).unknown,
    ),
  );
  radios.forEach((radio, position) => {
    specs.push(
      textFeature(
        radioKey(FEATURE_KEYS.RADIO_FIRMWARE, position),
        radioName('zigbee_firmware', 'radio_firmware', position),
        (s, lang) => {
          const current = usableRadios(s.info)[position];
          if (!current) {
            return null;
          }
          return current.custom ? values(lang).custom : (current.version ?? values(lang).unknown);
        },
      ),
    );
  });

  if (firmwareCheck) {
    specs.push(
      textFeature(
        FEATURE_KEYS.CORE_LATEST,
        n.core_firmware_latest,
        (s) => s.firmware?.core ?? null,
      ),
    );
    radios.forEach((radio, position) => {
      specs.push(
        textFeature(
          radioKey(FEATURE_KEYS.RADIO_LATEST, position),
          radioName('zigbee_firmware_latest', 'radio_firmware_latest', position),
          (s) => s.firmware?.radios?.[position] ?? null,
        ),
      );
    });
    specs.push(
      binary(FEATURE_KEYS.UPDATE, (s) => (s.firmware ? s.firmware.updates.length > 0 : null)),
    );
  }
  specs.push(
    binary(FEATURE_KEYS.INTERNET, (s) => (typeof s.internet === 'boolean' ? s.internet : null)),
  );

  if (typeof sensors.disableLeds === 'boolean') {
    specs.push(toggle(FEATURE_KEYS.DISABLE_LEDS, (r) => r.disableLeds));
  }
  if (typeof sensors.nightMode === 'boolean') {
    specs.push(toggle(FEATURE_KEYS.NIGHT_MODE, (r) => r.nightMode));
  }

  specs.push(button(FEATURE_KEYS.RESTART, n.restart));
  // One restart per radio on the ESP32-S3 models, the first radio only on the
  // others (what the SLZB web interface and Home Assistant offer).
  (info.uDevice ? radios : radios.slice(0, 1)).forEach((radio, position) => {
    specs.push(
      button(
        radioKey(FEATURE_KEYS.RADIO_RESTART, position),
        radioName('zigbee_restart', 'radio_restart', position),
      ),
    );
  });
  return specs;
}

function round(value, decimals) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * The discovery payload of a coordinator.
 * @param {object} gladys SDK client
 * @param {object} snapshot `{ mac, address: { host, port }, info, sensors, firmware?, internet? }`
 * @param {{ language: string, firmwareCheck: boolean }} options
 */
export function buildDevice(gladys, snapshot, options) {
  const ids = deviceIds(gladys, snapshot.mac);
  return {
    name: coordinatorName(snapshot.info),
    external_id: ids.device,
    model: snapshot.info.model ?? undefined,
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    params: [{ name: HOST_PARAM, value: formatHost(snapshot.address) }],
    features: featureSpecs(snapshot, options).map(({ key, name, definition }) => ({
      ...definition,
      name,
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The states of a coordinator, for publishChangedStates.
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function featureStates(gladys, snapshot, options) {
  const ids = deviceIds(gladys, snapshot.mac);
  const states = [];
  for (const spec of featureSpecs(snapshot, options)) {
    const value = spec.value(snapshot, options.language);
    if (value === null || value === undefined) {
      continue;
    }
    const entry = { device_feature_external_id: ids.feature(spec.key) };
    if (typeof value === 'object') {
      entry.text = value.text;
    } else {
      entry.state = value;
    }
    states.push(entry);
  }
  return states;
}

/** The feature key of a feature external id of a coordinator, null otherwise. */
export function featureKeyOf(gladys, mac, externalId) {
  const prefix = `${deviceIds(gladys, mac).device}:`;
  return typeof externalId === 'string' && externalId.startsWith(prefix)
    ? externalId.slice(prefix.length)
    : null;
}
