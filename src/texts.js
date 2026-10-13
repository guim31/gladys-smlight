// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, the "Test the connection" report, the scene event error
// text, the errors of the commands. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './smlight/client.js';

export const LANGS = ['en', 'fr', 'de', 'es'];

/** The text of `table` in `language`, French by default (the configuration default). */
export const pick = (table, language) => table[language] ?? table.fr ?? table.en;

/** A multi-language object: `{ en: build('en'), fr: build('fr'), ... }`. */
export const byLanguage = (build) => Object.fromEntries(LANGS.map((lang) => [lang, build(lang)]));

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// One short explanation per error kind (src/smlight/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'login refused: check the username and password',
    fr: "connexion refusée : vérifiez l'identifiant et le mot de passe",
    de: 'Anmeldung abgelehnt: Prüfe Benutzername und Passwort',
    es: 'inicio de sesión rechazado: compruebe el usuario y la contraseña',
  },
  [ERROR_KINDS.UNSUPPORTED]: {
    en: 'not an SLZB, or firmware older than v2.3.6',
    fr: 'pas un SLZB, ou firmware antérieur à la v2.3.6',
    de: 'kein SLZB, oder Firmware älter als v2.3.6',
    es: 'no es un SLZB, o firmware anterior a la v2.3.6',
  },
  [ERROR_KINDS.INVALID]: {
    en: 'unexpected answer',
    fr: 'réponse inattendue',
    de: 'unerwartete Antwort',
    es: 'respuesta inesperada',
  },
};

// Connection status of the Configuration screen (≤ 200 characters).
export const CONNECTION_TEXT = {
  en: {
    none: () =>
      'No coordinator yet: open the Discover tab, or enter its address in the configuration.',
    invalid: (hosts) => `Address not understood: ${hosts}.`,
    failing: (name, error) => `${name}: ${error}.`,
  },
  fr: {
    none: () =>
      "Aucun coordinateur pour l'instant : ouvrez l'onglet Découverte, ou saisissez son adresse dans la configuration.",
    invalid: (hosts) => `Adresse incomprise : ${hosts}.`,
    failing: (name, error) => `${name} : ${error}.`,
  },
  de: {
    none: () =>
      'Noch kein Koordinator: Öffne den Tab „Entdecken“ oder gib seine Adresse in der Konfiguration ein.',
    invalid: (hosts) => `Adresse nicht verstanden: ${hosts}.`,
    failing: (name, error) => `${name}: ${error}.`,
  },
  es: {
    none: () =>
      'Todavía no hay coordinador: abra la pestaña Descubrir o introduzca su dirección en la configuración.',
    invalid: (hosts) => `Dirección no válida: ${hosts}.`,
    failing: (name, error) => `${name}: ${error}.`,
  },
};

// "Test the connection" report, one line per coordinator.
export const REPORT_TEXT = {
  en: {
    found: (count) => `${count} coordinator(s) found.`,
    nothing: () =>
      'No coordinator found: enter its IP address in the configuration (SLZB web interface, Network page).',
    line: (name, host, version) => `${name} (${host}): firmware ${version}.`,
    failed: (host, error) => `${host}: ${error}.`,
    mdnsOff: () => 'Automatic discovery (mDNS) is not available: typed addresses only.',
  },
  fr: {
    found: (count) => `${count} coordinateur(s) trouvé(s).`,
    nothing: () =>
      'Aucun coordinateur trouvé : saisissez son adresse IP dans la configuration (interface web du SLZB, page Network).',
    line: (name, host, version) => `${name} (${host}) : firmware ${version}.`,
    failed: (host, error) => `${host} : ${error}.`,
    mdnsOff: () =>
      "La découverte automatique (mDNS) n'est pas disponible : adresses saisies seulement.",
  },
  de: {
    found: (count) => `${count} Koordinator(en) gefunden.`,
    nothing: () =>
      'Kein Koordinator gefunden: Gib seine IP-Adresse in der Konfiguration ein (SLZB-Weboberfläche, Seite Network).',
    line: (name, host, version) => `${name} (${host}): Firmware ${version}.`,
    failed: (host, error) => `${host}: ${error}.`,
    mdnsOff: () =>
      'Die automatische Erkennung (mDNS) ist nicht verfügbar: nur eingegebene Adressen.',
  },
  es: {
    found: (count) => `${count} coordinador(es) encontrado(s).`,
    nothing: () =>
      'No se ha encontrado ningún coordinador: introduzca su dirección IP en la configuración (interfaz web del SLZB, página Network).',
    line: (name, host, version) => `${name} (${host}): firmware ${version}.`,
    failed: (host, error) => `${host}: ${error}.`,
    mdnsOff: () =>
      'El descubrimiento automático (mDNS) no está disponible: solo direcciones introducidas.',
  },
};

// Errors of the commands (device features, widget buttons): thrown, so Gladys
// shows one string, in the language of the configuration.
export const COMMAND_TEXT = {
  unknown: {
    en: 'This coordinator is not known (yet): open the Discover tab.',
    fr: "Ce coordinateur n'est pas (encore) connu : ouvrez l'onglet Découverte.",
    de: 'Dieser Koordinator ist (noch) nicht bekannt: Öffne den Tab „Entdecken“.',
    es: 'Este coordinador no es conocido (todavía): abra la pestaña Descubrir.',
  },
  failed: {
    en: 'The coordinator did not accept the command.',
    fr: "Le coordinateur n'a pas accepté la commande.",
    de: 'Der Koordinator hat den Befehl nicht angenommen.',
    es: 'El coordinador no ha aceptado el comando.',
  },
};
