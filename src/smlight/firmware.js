// -----------------------------------------------------------------------------
// Firmware versions: the SMLIGHT update catalog (the server the SLZB web
// interface asks too), and the comparison of versions.
//
// Read only: this integration tells that an update exists, it never installs
// one. Flashing from Gladys could leave the Zigbee network without its
// coordinator; the SLZB web interface stays the place to do it.
//
// Ported from pysmlight (https://github.com/smlight-tech/pysmlight,
// Apache-2.0): catalog.py (query parameters, filters) and the Home Assistant
// `smlight` integration (Apache-2.0): update.py (the first entry of the list
// is the latest version).
// -----------------------------------------------------------------------------

import { deviceIdOf } from './model.js';

export const CATALOG_URL = 'https://updates.smlight.tech/services/api/slzb-06x-ota.php';

const PRE_RELEASE = /^(dev|alpha|a|beta|b|rc)(\d*)$/i;

/**
 * Parse a core version (`v2.7.1`, `v3.2.6.dev2`, `0.9.9`) or a Zigbee
 * firmware date (`20240510`) into comparable parts; null when unreadable.
 */
export function parseVersion(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const parts = String(value).trim().replace(/^v/i, '').split('.');
  const numbers = [];
  let pre = null;
  for (const part of parts) {
    if (/^\d+$/.test(part) && pre === null) {
      numbers.push(Number(part));
      continue;
    }
    const match = part.match(PRE_RELEASE);
    if (match && pre === null && numbers.length > 0) {
      pre = Number(match[2] || 0);
      continue;
    }
    return null;
  }
  return numbers.length > 0 ? { numbers, pre } : null;
}

/**
 * @returns {number|null} < 0 when a is older than b, 0 when equal, > 0 when
 *   newer; null when either cannot be read.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    return null;
  }
  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  // A pre-release comes before its release: 2.6.8.dev25 < 2.6.8.
  if (left.pre === null || right.pre === null) {
    return (left.pre === null ? 1 : 0) - (right.pre === null ? 1 : 0);
  }
  return left.pre - right.pre;
}

/** True when `latest` is strictly newer than `installed` (never on unreadable versions). */
export function isNewer(latest, installed) {
  const comparison = compareVersions(latest, installed);
  return comparison !== null && comparison > 0;
}

/** Firmware channel of the catalog: the one chosen in the SLZB web interface. */
const channelOf = (info) =>
  ['release', 'dev'].includes(info.firmwareChannel) ? info.firmwareChannel : 'release';

/** Query of the core firmware list (ESP32, or ESP32-S3 for the "U" models). */
export function coreQuery(info) {
  return { type: info.uDevice ? 'ESPs3' : 'ESP' };
}

/** Query of the firmware list of one radio; null for a model the catalog does not know. */
export function radioQuery(info, radio) {
  const device = deviceIdOf(info.model);
  if (device === null) {
    return null;
  }
  return {
    type: 'ZB',
    format: 'slzb',
    device: String(device),
    idx: String(radio.index),
    ch: channelOf(info) === 'dev' ? '1' : '0',
  };
}

/** Catalog URL of a query. */
export const catalogUrl = (query) => `${CATALOG_URL}?${new URLSearchParams(query)}`;

/**
 * Latest core version of the answer to `coreQuery`: `{ fw: [{ ver, dev, ... }] }`,
 * newest first in practice. On the release channel the dev builds are skipped; on the dev
 * channel the newest build counts, dev or not (pysmlight keeps only the dev
 * builds there, which offers nothing once a release overtakes them).
 */
export function latestCore(answer, info) {
  if (!answer || !Array.isArray(answer.fw)) {
    throw new Error('Unexpected firmware catalog answer');
  }
  const dev = channelOf(info) === 'dev';
  return newest(
    answer.fw
      .filter((item) => item && typeof item.ver === 'string' && (dev || !item.dev))
      .map((item) => item.ver.trim()),
  );
}

/**
 * Latest firmware of a radio in the answer to `radioQuery`:
 * `[{ type, rev, prod, ... }]`; only the firmware of the type
 * installed (coordinator, router, Thread...).
 */
export function latestRadio(answer, radio) {
  if (!Array.isArray(answer)) {
    throw new Error('Unexpected firmware catalog answer');
  }
  return newest(
    answer
      .filter((item) => item && Number(item.type) === radio.type && item.rev !== undefined)
      .map((item) => String(item.rev).trim()),
  );
}

/** The newest readable version of a list (the catalog lists them newest first, but says nothing). */
function newest(versions) {
  let best = null;
  for (const version of versions) {
    if (parseVersion(version) && (best === null || compareVersions(version, best) > 0)) {
      best = version;
    }
  }
  return best;
}
