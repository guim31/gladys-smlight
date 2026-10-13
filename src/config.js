// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60'];

export const DEFAULT_CONFIG = {
  hosts: '',
  username: '',
  password: '',
  poll_interval: '60',
  firmware_check: true,
  language: 'fr',
};

const MAX_HOSTS = 10;
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * Parse one address typed by the user: an IP address or a host name, with an
 * optional port, or the URL copied from the browser (`http://192.0.2.5/`).
 * @returns {{ host: string, port: number }|null} null when unusable
 */
export function parseHost(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  // A bare IPv6 address has several colons: it needs brackets in a URL.
  const bracketed =
    !text.includes('/') && (text.match(/:/g) ?? []).length > 1 && !text.startsWith('[')
      ? `[${text}]`
      : text;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(bracketed) ? bracketed : `http://${bracketed}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // The SLZB web interface is plain HTTP; credentials go in their own fields
  // (in the address they would end up in the device params).
  if (url.protocol !== 'http:' || !url.hostname || url.username || url.password) {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // A host name or an IPv4 address (the URL parser lets through characters no
  // name has), or an IPv6 address.
  if (!host.includes(':') && !HOST_NAME.test(host)) {
    return null;
  }
  return { host, port: url.port ? Number(url.port) : 80 };
}

/** `host` or `host:port`, as shown to the user and stored in the device params. */
export const formatHost = ({ host, port }) => {
  const shown = host.includes(':') ? `[${host}]` : host;
  return port === 80 ? shown : `${shown}:${port}`;
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const hosts = [];
  const invalidHosts = [];
  for (const entry of text('hosts').split(/[\s,;]+/)) {
    if (!entry) {
      continue;
    }
    const parsed = parseHost(entry);
    if (!parsed) {
      // Shown in the connection status: never the credentials of an address.
      invalidHosts.push(entry.replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^@/]*@/i, '$1…@').slice(0, 60));
    } else if (!hosts.some((known) => formatHost(known) === formatHost(parsed))) {
      hosts.push(parsed);
    }
  }

  const firmware = source.firmware_check;
  return {
    hosts: hosts.slice(0, MAX_HOSTS),
    invalidHosts,
    username: text('username'),
    // Kept as typed: spaces may be part of a password.
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    firmwareCheck:
      firmware === undefined || firmware === null
        ? DEFAULT_CONFIG.firmware_check
        : firmware === true || firmware === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
