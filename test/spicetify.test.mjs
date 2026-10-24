import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompatibility, supports } from '../src/spicetify.mjs';

// Compatibility section of the real v2.46.2 release notes.
const V2_46_2 = `## Compatibility
- Spotify for **macOS**: \`1.2.14\` -> \`1.3.6\`
- Spotify for **Linux**: \`1.2.14\` -> \`1.3.4\`
- Spotify for **Windows/Microsoft Store**: \`1.2.14\` -> \`1.3.6\`
\t- You may need to apply spicetify every time you close **Microsoft Store** version of Spotify
`;

test('parseCompatibility reads every platform range', () => {
  assert.deepEqual(parseCompatibility(V2_46_2), {
    macos: { min: '1.2.14', max: '1.3.6' },
    linux: { min: '1.2.14', max: '1.3.4' },
    windows: { min: '1.2.14', max: '1.3.6' },
  });
});

test('parseCompatibility returns nothing for notes without the section', () => {
  assert.deepEqual(parseCompatibility('### Fixes\n- something'), {});
  assert.deepEqual(parseCompatibility(undefined), {});
});

test('supports compares only the first three components of a Spotify build', () => {
  const range = { min: '1.2.14', max: '1.3.6' };
  assert.equal(supports(range, '1.3.6.1921.g7086c071a617'), true);
  assert.equal(supports(range, '1.3.7.100'), false);
  assert.equal(supports(range, '1.2.9.1'), false);
  assert.equal(supports(range, '1.2.14.0'), true);
  assert.equal(supports(undefined, '1.3.6'), null);
});
