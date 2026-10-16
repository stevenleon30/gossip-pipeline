import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  ensureDisclosure,
  validateResearch,
  validateScript,
  validateVisuals,
} from './validate.js';

const goodResearch = {
  product: 'Test Cream',
  factsKnownToYou: ['It smells nice'],
  angles: [{ angle: 'The smell', hook: 'Strangers keep asking' }],
};

const goodScript = {
  script: 'wait wait wait',
  scenes: [{ time: '0:00-0:05', text: 'hook', emotion: 'incredulous', visual: 'bedroom' }],
  caption: 'story time #ad',
  hashtags: ['#storytime', '#ad'],
};

const goodVisuals = {
  scenePrompts: [{ sceneIndex: 0, duration: 6, prompt: 'vertical 9:16 UGC video', voiceoverText: 'hi' }],
};

test('validateResearch accepts a well-formed object', () => {
  assert.deepEqual(validateResearch(goodResearch), goodResearch);
});

test('validateResearch rejects missing angles with a useful path', () => {
  assert.throws(
    () => validateResearch({ ...goodResearch, angles: [] }),
    (err: unknown) => err instanceof ValidationError && err.message.includes('research.angles')
  );
});

test('validateResearch rejects non-objects and wrong types', () => {
  assert.throws(() => validateResearch(null), ValidationError);
  assert.throws(() => validateResearch('{"product":"x"}'), ValidationError);
  assert.throws(
    () => validateResearch({ ...goodResearch, angles: [{ angle: 5, hook: 'h' }] }),
    /angles\[0\]\.angle/
  );
});

test('validateResearch allows an empty facts list', () => {
  assert.equal(validateResearch({ ...goodResearch, factsKnownToYou: [] }).factsKnownToYou.length, 0);
});

test('validateScript accepts a well-formed object unchanged', () => {
  assert.deepEqual(validateScript(goodScript), goodScript);
});

test('validateScript rejects an empty scene list and blank strings', () => {
  assert.throws(() => validateScript({ ...goodScript, scenes: [] }), /script\.scenes/);
  assert.throws(() => validateScript({ ...goodScript, caption: '   ' }), /script\.caption/);
});

test('validateScript adds the #ad disclosure when the model forgets it', () => {
  const out = validateScript({ ...goodScript, caption: 'story time', hashtags: ['#storytime'] });
  assert.match(out.caption, /#ad$/);
  assert.ok(out.hashtags.includes('#ad'));
});

test('ensureDisclosure is idempotent and case-insensitive', () => {
  const once = ensureDisclosure('so good #AD', ['#Ad']);
  assert.equal(once.caption, 'so good #AD');
  assert.deepEqual(once.hashtags, ['#Ad']);
});

test('ensureDisclosure does not treat #adorable as a disclosure', () => {
  const out = ensureDisclosure('so #adorable', ['#adorable']);
  assert.match(out.caption, /#ad$/);
  assert.ok(out.hashtags.includes('#ad'));
});

test('validateVisuals accepts a well-formed object', () => {
  assert.deepEqual(validateVisuals(goodVisuals), goodVisuals);
});

test('validateVisuals rejects non-numeric duration and NaN', () => {
  const bad = (duration: unknown) => ({ scenePrompts: [{ ...goodVisuals.scenePrompts[0], duration }] });
  assert.throws(() => validateVisuals(bad('6')), /duration/);
  assert.throws(() => validateVisuals(bad(Number.NaN)), /duration/);
});
