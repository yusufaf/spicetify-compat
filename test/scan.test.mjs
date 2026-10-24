import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractModules } from '../src/snapshot.mjs';
import { buildIndex, cssMapHitRate, diffGraphql } from '../src/bundle.mjs';
import { extensionDeps, judgeDeps } from '../src/deps.mjs';
import { buildId } from '../src/scan.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('extractModules finds a UTF-16LE span that starts on an odd byte', () => {
  const body = 'var __webpack_modules__={1:function(){}}//# sourceMappingURL=xpui-modules.js.map';
  const snapshot = Buffer.concat([Buffer.from([0x00, 0x11, 0x22]), Buffer.from(body, 'utf16le'), Buffer.from([0x33])]);
  assert.equal(extractModules(snapshot), 'var __webpack_modules__={1:function(){}}//# sourceMappingURL=');
});

test('extractModules returns null without the markers', () => {
  assert.equal(extractModules(Buffer.from('nothing here', 'utf16le')), null);
});

test('buildIndex keeps GraphQL tuples, live testids and CSS classes only', () => {
  const index = buildIndex({
    js: [`new x("getAlbum","query","${HASH_A}",null);a={"data-testid":"tracklist-row"};b="dead-string"`],
    css: ['.Xy12abCdEfGhIjKlMnOp{color:red}.main-topBar-container .foo{}'],
  });
  assert.deepEqual(index.graphql, { getAlbum: { kind: 'query', hash: HASH_A } });
  assert.deepEqual(index.testids, ['tracklist-row']);
  assert.ok(index.cssClasses.includes('Xy12abCdEfGhIjKlMnOp'));
  assert.ok(index.cssClasses.includes('main-topBar-container'));
});

test('diffGraphql separates removed, hash-changed and added operations', () => {
  const before = { graphql: { getAlbum: { hash: HASH_A }, queryTrackCreditsModal: { hash: HASH_A } } };
  const after = { graphql: { getAlbum: { hash: HASH_B }, queryTrackCreditsGroupedModal: { hash: HASH_A } } };
  assert.deepEqual(diffGraphql(before, after), {
    removed: ['queryTrackCreditsModal'], changed: ['getAlbum'], added: ['queryTrackCreditsGroupedModal'],
  });
});

test('cssMapHitRate counts css-map hashes present in the build', () => {
  const rate = cssMapHitRate({ k1: 'main-a', k2: 'main-b' }, { cssClasses: ['k1', 'other'] });
  assert.deepEqual(rate, { hits: 1, total: 2, rate: 0.5 });
});

test('extensionDeps reads GraphQL ops, exact testids and mapped classes', () => {
  const deps = extensionDeps(`
    Spicetify.GraphQL.Definitions.getAlbum; GraphQL.Definitions["queryArtistOverview"];
    q('[data-testid="tracklist-row"], [data-testid^="prefix"], .main-trackList-trackListRow, .Root__main-view');
    q(\`.main-trackList-\${col}\`);
  `);
  assert.deepEqual(deps, {
    graphql: ['getAlbum', 'queryArtistOverview'],
    testids: ['tracklist-row'],
    classes: ['Root__main-view', 'main-trackList-trackListRow'],
  });
});

test('judgeDeps: OK, BROKEN when lost since baseline, DEAD when never present, UNMAPPED', () => {
  const baseline = { graphql: { getAlbum: {}, gone: {} }, testids: ['row'], cssClasses: ['hashRow'] };
  const current = { graphql: { getAlbum: {} }, testids: [], cssClasses: [] };
  const cssMap = { hashRow: 'main-row', hashOld: 'main-old' };
  const deps = { graphql: ['getAlbum', 'gone', 'never'], testids: ['row'], classes: ['main-row', 'main-old', 'main-mine'] };
  const byName = Object.fromEntries(judgeDeps(deps, { baseline, current, cssMap }).map(r => [r.name, r.status]));
  assert.deepEqual(byName, {
    getAlbum: 'OK', gone: 'BROKEN', never: 'DEAD', row: 'BROKEN', 'main-row': 'BROKEN', 'main-old': 'DEAD', 'main-mine': 'UNMAPPED',
  });
});

test('buildId keeps the first four version components', () => {
  assert.equal(buildId('1.3.6.1921.g7086c071a617'), '1.3.6.1921');
  assert.equal(buildId('1.3.3.264'), '1.3.3.264');
});
