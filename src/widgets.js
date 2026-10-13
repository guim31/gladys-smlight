// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `slzb`.
//
// The use case: "Zigbee2MQTT lost its devices: is the coordinator alive?" at a
// glance from the wall tablet: temperatures, uptime, whether the Zigbee client
// is connected, the network link, the firmware and its updates, and the two
// restarts, behind a confirmation.
//
// One coordinator per widget: the one chosen in the widget settings, else the
// first one added to Gladys. Budget (8 components, 6 tiles, 2 texts, 1 status,
// 4 buttons): a heading, three tiles (the temperatures are bound to the
// device features, so they follow the states live), one status list, and up to
// four buttons (the coordinator, then each radio it can restart).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, coordinatorName, deviceIds, radioKey } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_KINDS } from './smlight/client.js';
import { networkLink, usableRadios } from './smlight/model.js';
import { pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  RESTART: 'restart_coordinator',
  RESTART_RADIO: 'restart_radio', // + `_1`, `_2`, `_3`: the radio number
});

const RADIO_ACTION = new RegExp(`^${ACTIONS.RESTART_RADIO}_(\\d)$`);

export const TEXT = {
  noDevice: {
    en: 'Add your SLZB coordinator in Gladys: Integrations, SMLIGHT SLZB, Discover tab.',
    fr: 'Ajoutez votre coordinateur SLZB dans Gladys : Intégrations, SMLIGHT SLZB, onglet Découverte.',
    de: 'Füge deinen SLZB-Koordinator in Gladys hinzu: Integrationen, SMLIGHT SLZB, Tab „Entdecken“.',
    es: 'Añada su coordinador SLZB en Gladys: Integraciones, SMLIGHT SLZB, pestaña Descubrir.',
  },
  unknown: {
    en: 'This coordinator is no longer in Gladys: choose another one in the widget settings.',
    fr: "Ce coordinateur n'est plus dans Gladys : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieser Koordinator ist nicht mehr in Gladys: Wähle einen anderen in den Widget-Einstellungen.',
    es: 'Este coordinador ya no está en Gladys: elija otro en la configuración del widget.',
  },
  waiting: {
    en: 'Waiting for the first reading of the coordinator…',
    fr: 'En attente de la première lecture du coordinateur…',
    de: 'Warte auf die erste Abfrage des Koordinators…',
    es: 'Esperando la primera lectura del coordinador…',
  },
  core: { en: 'ESP32', fr: 'ESP32', de: 'ESP32', es: 'ESP32' },
  zigbee: { en: 'Zigbee chip', fr: 'Puce Zigbee', de: 'Zigbee-Chip', es: 'Chip Zigbee' },
  uptime: { en: 'Uptime', fr: 'En marche', de: 'Laufzeit', es: 'Encendido' },
  state: { en: 'Coordinator', fr: 'Coordinateur', de: 'Koordinator', es: 'Coordinador' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  loginRefused: {
    en: 'Login refused',
    fr: 'Connexion refusée',
    de: 'Anmeldung abgelehnt',
    es: 'Acceso rechazado',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  client: {
    en: 'Zigbee client',
    fr: 'Client Zigbee',
    de: 'Zigbee-Client',
    es: 'Cliente Zigbee',
  },
  connected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  noClient: { en: 'None', fr: 'Aucun', de: 'Keiner', es: 'Ninguno' },
  network: { en: 'Network', fr: 'Réseau', de: 'Netzwerk', es: 'Red' },
  mode: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
  coreFirmware: {
    en: 'Core firmware',
    fr: 'Firmware du cœur',
    de: 'Core-Firmware',
    es: 'Firmware del núcleo',
  },
  radioFirmware: {
    en: 'Zigbee firmware',
    fr: 'Firmware Zigbee',
    de: 'Zigbee-Firmware',
    es: 'Firmware Zigbee',
  },
  radioNFirmware: {
    en: 'Radio {n} firmware',
    fr: 'Firmware radio {n}',
    de: 'Firmware Funk {n}',
    es: 'Firmware radio {n}',
  },
  custom: { en: 'Custom', fr: 'Personnalisé', de: 'Eigene', es: 'Personalizado' },
  internet: { en: 'Internet', fr: 'Internet', de: 'Internet', es: 'Internet' },
  internetOk: { en: 'Reachable', fr: 'Joignable', de: 'Erreichbar', es: 'Accesible' },
  internetKo: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  none: { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' },
  restart: { en: 'Restart', fr: 'Redémarrer', de: 'Neustart', es: 'Reiniciar' },
  restartZigbee: {
    en: 'Restart Zigbee',
    fr: 'Redém. Zigbee',
    de: 'Zigbee neu starten',
    es: 'Reiniciar Zigbee',
  },
  restartRadio: {
    en: 'Restart radio {n}',
    fr: 'Redém. radio {n}',
    de: 'Funk {n} neu starten',
    es: 'Reiniciar radio {n}',
  },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  restart: {
    en: 'Restarting: the coordinator is back in about 20 seconds.',
    fr: 'Redémarrage : le coordinateur revient dans 20 secondes environ.',
    de: 'Neustart: Der Koordinator ist in etwa 20 Sekunden zurück.',
    es: 'Reiniciando: el coordinador vuelve en unos 20 segundos.',
  },
  restartRadio: {
    en: 'Radio restarted: Zigbee2MQTT reconnects on its own.',
    fr: 'Radio redémarrée : Zigbee2MQTT se reconnecte tout seul.',
    de: 'Funkmodul neu gestartet: Zigbee2MQTT verbindet sich selbst wieder.',
    es: 'Radio reiniciada: Zigbee2MQTT se vuelve a conectar solo.',
  },
};

const LINKS = { ethernet: 'Ethernet', wifi: 'Wi-Fi', lte: 'LTE' };
const MODES = { eth: 'Ethernet', wifi: 'Wi-Fi', usb: 'USB', ppp: 'LTE' };
const UPTIME_UNITS = {
  en: { d: 'd', h: 'h', min: 'min' },
  fr: { d: 'j', h: 'h', min: 'min' },
  de: { d: 'T', h: 'h', min: 'min' },
  es: { d: 'd', h: 'h', min: 'min' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** `3 d 4 h`, `5 h 12 min`, `7 min`: at most 12 characters. */
export function formatUptime(seconds, language) {
  const units = UPTIME_UNITS[language] ?? UPTIME_UNITS.fr;
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) {
    return `${days} ${units.d} ${hours} ${units.h}`;
  }
  if (hours > 0) {
    return `${hours} ${units.h} ${minutes % 60} ${units.min}`;
  }
  return `${minutes} ${units.min}`;
}

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The feature external ids Gladys knows for a device (the widget binds only to those). */
function createdFeatures(hub, mac) {
  const id = deviceIds(hub.gladys, mac).device;
  const device = (hub.gladys.devices ?? []).find((candidate) => candidate.external_id === id);
  return new Set((device?.features ?? []).map((feature) => feature.external_id));
}

/** A temperature tile: live through the device feature when Gladys has it. */
function temperatureTile(hub, record, key, value, label, icon) {
  const externalId = deviceIds(hub.gladys, record.mac).feature(key);
  if (createdFeatures(hub, record.mac).has(externalId)) {
    return { type: 'value', label, icon, device_feature: externalId };
  }
  if (typeof value !== 'number') {
    return null;
  }
  return { type: 'value', label, icon, value: Math.round(value * 10) / 10, unit: '°C' };
}

function stateRow(record, language) {
  const label = t(TEXT.state, language);
  if (!record.error) {
    return {
      label,
      icon: 'check-circle',
      value: t(TEXT.online, language),
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  const value =
    record.error.kind === ERROR_KINDS.UNREACHABLE
      ? TEXT.unreachable
      : record.error.kind === ERROR_KINDS.AUTH
        ? TEXT.loginRefused
        : TEXT.error;
  return { label, icon: 'alert-triangle', value: t(value, language), color: WIDGET_COLORS.DANGER };
}

function firmwareRow(label, installed, latest) {
  const update = latest !== null && latest !== undefined;
  return {
    label,
    icon: update ? 'download' : 'cpu',
    value: fit(update ? `${installed} → ${latest}` : installed, 40),
    color: update ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
  };
}

/** The buttons: the coordinator, then each radio it can restart (as the device features). */
export function buttons(record, language) {
  const { info } = record.snapshot;
  const radios = usableRadios(info);
  const restartable = info.uDevice ? radios : radios.slice(0, 1);
  const list = [];
  restartable.slice(0, 3).forEach((radio, position) => {
    list.push({
      type: 'button',
      label: fit(
        restartable.length > 1
          ? t(TEXT.restartRadio, language).replace('{n}', String(position + 1))
          : t(TEXT.restartZigbee, language),
        24,
      ),
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: `${ACTIONS.RESTART_RADIO}_${position + 1}`, confirm: true },
    });
  });
  list.push({
    type: 'button',
    label: t(TEXT.restart, language),
    icon: 'power',
    style: 'danger',
    action: { key: ACTIONS.RESTART, confirm: true },
  });
  return list;
}

/** Pick the coordinator of a widget: the chosen one, else the first added one. */
function chosen(hub, settings) {
  const records = hub.view(settings?.device || null);
  return records[0] ?? null;
}

async function get(hub, { settings, language = 'fr' }) {
  if (hub.records.size === 0) {
    return message(TEXT.noDevice, language);
  }
  const record = chosen(hub, settings);
  if (!record) {
    return message(TEXT.unknown, language);
  }
  if (!record.snapshot) {
    return { ...message(TEXT.waiting, language), ttl_seconds: 30 };
  }
  const { info, sensors, firmware, internet } = record.snapshot;
  const radios = usableRadios(info);
  const components = [{ type: 'text', variant: 'heading', text: fit(coordinatorName(info), 40) }];

  const tiles = [
    temperatureTile(
      hub,
      record,
      FEATURE_KEYS.CORE_TEMPERATURE,
      sensors.coreTemperature,
      t(TEXT.core, language),
      'cpu',
    ),
    temperatureTile(
      hub,
      record,
      radioKey(FEATURE_KEYS.RADIO_TEMPERATURE, 0),
      sensors.zigbeeTemperature,
      t(TEXT.zigbee, language),
      'thermometer',
    ),
  ].filter(Boolean);
  if (typeof sensors.uptime === 'number') {
    tiles.push({
      type: 'value',
      label: t(TEXT.uptime, language),
      icon: 'clock',
      value: formatUptime(sensors.uptime, language),
    });
  }
  components.push(...tiles);

  const items = [stateRow(record, language)];
  // The Zigbee socket only matters when Zigbee2MQTT or ZHA connect over the network.
  if (typeof sensors.socketUptime === 'number' && info.coordinatorMode !== 'usb') {
    items.push(
      sensors.socketUptime > 0
        ? {
            label: t(TEXT.client, language),
            icon: 'link',
            value: `${t(TEXT.connected, language)} · ${formatUptime(sensors.socketUptime, language)}`,
            color: WIDGET_COLORS.SUCCESS,
          }
        : {
            label: t(TEXT.client, language),
            icon: 'link-2',
            value: t(TEXT.noClient, language),
            color: WIDGET_COLORS.WARNING,
          },
    );
  }
  const link = networkLink(sensors);
  items.push({
    label: t(TEXT.network, language),
    icon: link === 'wifi' ? 'wifi' : 'globe',
    value: LINKS[link] ?? t(TEXT.none, language),
    color: WIDGET_COLORS.NEUTRAL,
  });
  if (info.coordinatorMode) {
    items.push({
      label: t(TEXT.mode, language),
      icon: 'sliders',
      value: MODES[info.coordinatorMode],
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const updates = firmware?.updates ?? [];
  const latestOf = (component, position) =>
    updates.find((u) => u.component === component && u.position === position)?.latest;
  items.push(
    firmwareRow(t(TEXT.coreFirmware, language), info.coreVersion ?? '?', latestOf('core', 0)),
  );
  radios.slice(0, 3).forEach((radio, position) => {
    const label =
      radios.length > 1
        ? t(TEXT.radioNFirmware, language).replace('{n}', String(position + 1))
        : t(TEXT.radioFirmware, language);
    const installed = radio.custom ? t(TEXT.custom, language) : (radio.version ?? '?');
    items.push(firmwareRow(label, installed, latestOf('zigbee', position)));
  });
  if (typeof internet === 'boolean') {
    items.push({
      label: t(TEXT.internet, language),
      icon: 'globe',
      value: t(internet ? TEXT.internetOk : TEXT.internetKo, language),
      color: internet ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }
  components.push({ type: 'status', items: items.slice(0, 10) });
  if (!record.error) {
    components.push(...buttons(record, language));
  }
  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey, settings }) {
  const record = chosen(hub, settings);
  if (!record || !record.snapshot) {
    throw new Error(t(TEXT.unknown, hub.config?.language));
  }
  if (actionKey === ACTIONS.RESTART) {
    await hub.restart(record);
    return { message: DONE_TEXT.restart };
  }
  const match = actionKey.match(RADIO_ACTION);
  if (match) {
    await hub.restartRadio(record, Number(match[1]) - 1);
    return { message: DONE_TEXT.restartRadio };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
