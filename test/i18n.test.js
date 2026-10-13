// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names and values, and the four documentation files, with
// the same sections. German says "du", never the polite "Sie"; Spanish says
// "usted". (Adapted from guim31/gladys-wled and guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES, VALUES } from '../src/devices.js';
import { ERROR_KINDS } from '../src/smlight/client.js';
import {
  COMMAND_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  INIT_FAILED,
  REPORT_TEXT,
} from '../src/texts.js';
import { DONE_TEXT, TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;
// The familiar Spanish forms the texts must not use ("usted" is the rule).
const FAMILIAR_SPANISH =
  /(?<!\p{L})(tú|tu|tus|te|ti|contigo|puedes|quieres|tienes|eliges|abre|elige|introduce|añade|comprueba)(?!\p{L})/iu;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  status: 40,
  short: 24,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  if (lang === 'es' && FAMILIAR_SPANISH.test(text)) {
    found.push(`${path} uses the familiar form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

/** A feature name as created: `{n}` is a radio number. */
const featureName = (name, n = 2) => name.replace('{n}', String(n));

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 60, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, the catalog description long enough', () => {
  assert.equal(typeof manifest.name, 'string', 'one name: a brand is not translated');
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every message table of the code has the four languages', () => {
  // Widget texts shown as tiles, rows or buttons are short; the others are messages.
  const longWidgetTexts = new Set(['noDevice', 'unknown', 'waiting']);
  const statusTexts = new Set(['coreFirmware', 'radioFirmware', 'radioNFirmware', 'loginRefused']);
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...Object.entries(COMMAND_TEXT).flatMap(([key, value]) =>
      problems(value, `COMMAND_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(ERROR_TEXT).flatMap(([key, value]) =>
      problems(value, `ERROR_TEXT.${key}`, 100),
    ),
    ...Object.entries(DONE_TEXT).flatMap(([key, value]) =>
      problems(value, `DONE_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(
        Object.fromEntries(Object.entries(value).map(([lang, text]) => [lang, featureName(text)])),
        `TEXT.${key}`,
        longWidgetTexts.has(key) ? MAX.message : statusTexts.has(key) ? MAX.status : MAX.short,
      ),
    ),
  ];
  assert.deepEqual(found, []);
  assert.deepEqual(sorted(Object.keys(ERROR_TEXT)), sorted(Object.values(ERROR_KINDS)));
});

test('the feature names and values exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName, featureName), []);
  assert.deepEqual(tableProblems(VALUES, 'VALUES', MAX.status), []);
  for (const lang of LANGS) {
    const names = Object.values(NAMES[lang]).map((name) => featureName(name, 3));
    assert.equal(new Set(names).size, names.length, `NAMES.${lang}: two features share a name`);
  }
});

test('the connection texts and the test report exist in every language', () => {
  const render = (value) =>
    typeof value === 'function' ? value('SLZB-06p7 (192.0.2.10)', 'v2.7.1', 'x') : value;
  assert.deepEqual(tableProblems(CONNECTION_TEXT, 'CONNECTION_TEXT', MAX.message, render), []);
  assert.deepEqual(tableProblems(REPORT_TEXT, 'REPORT_TEXT', MAX.message, render), []);
});

test('the guard catches a missing language, an empty text and the wrong forms', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre IP', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'Abre la pestaña' }, 'x', 60).length, 1);
  assert.deepEqual(problems({ en: 'a', fr: 'a', de: 'a', es: 'Abra la pestaña' }, 'x', 60), []);
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_triggers[0].fields[1].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_triggers[0].fields[1].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 9);
});

test('the documentation names every trigger, feature and widget button', () => {
  for (const lang of LANGS) {
    const doc = docs[lang];
    for (const item of manifest.scene_triggers) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: trigger "${item.label[lang]}"`);
    }
    for (const option of manifest.scene_triggers.flatMap((trigger) =>
      trigger.fields.flatMap((field) => field.options ?? []),
    )) {
      if (option.value !== 'gladys') {
        assert.ok(
          doc.includes(option.label[lang]),
          `docs/${lang}.md: filter "${option.label[lang]}"`,
        );
      }
    }
    for (const name of Object.values(NAMES[lang])) {
      for (const n of name.includes('{n}') ? [1, 2] : [1]) {
        assert.ok(
          doc.includes(featureName(name, n)),
          `docs/${lang}.md: feature "${featureName(name, n)}"`,
        );
      }
    }
    for (const key of ['restart', 'restartZigbee']) {
      assert.ok(
        doc.includes(`**${TEXT[key][lang]}**`),
        `docs/${lang}.md: button "${TEXT[key][lang]}"`,
      );
    }
    for (const n of [1, 2]) {
      assert.ok(
        doc.includes(featureName(TEXT.restartRadio[lang], n)),
        `docs/${lang}.md: radio button ${n}`,
      );
    }
    assert.ok(doc.includes(manifest.widgets[0].label[lang]), `docs/${lang}.md: widget name`);
    for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
      assert.ok(doc.includes(field.label[lang]), `docs/${lang}.md: option "${field.label[lang]}"`);
    }
    assert.ok(doc.includes(manifest.actions[0].label[lang]), `docs/${lang}.md: action button`);
  }
});

test('the German documentation says "du", the Spanish one "usted"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
  const familiar = docs.es.split('\n').filter((line) => FAMILIAR_SPANISH.test(line));
  assert.deepEqual(familiar, []);
});

test('the documentation says it was developed without the hardware, and not by SMLIGHT', () => {
  assert.match(docs.en, /Developed without the hardware: feedback welcome/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /github\.com\/guim31\/gladys-smlight\/issues/);
    assert.match(docs[lang], /SMLIGHT\./, `docs/${lang}.md: not affiliated with SMLIGHT`);
  }
});
