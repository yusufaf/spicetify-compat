import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../src/integrity.mjs';

const healthy = {
  id: 'album-length',
  main: 'album-length.js',
  repoDir: 'C:/Projects/spicetify-album-length',
  workingSize: 45008,
  headSize: 45008,
  enabled: true,
  copies: [{ path: 'Extensions/album-length.js', symlink: true, target: 'repo', size: 45008, matchesWorkingTree: true }],
};

const levels = facts => judge(facts).map(f => f.level).sort();

test('healthy symlinked extension has no findings', () => {
  assert.deepEqual(judge(healthy), []);
});

test('uncommitted edits are work in progress, not a problem', () => {
  assert.deepEqual(judge({ ...healthy, workingSize: 46000, copies: [{ ...healthy.copies[0], size: 46000 }] }), []);
});

test('working tree emptied while HEAD has content is a FAIL', () => {
  assert.ok(levels({ ...healthy, workingSize: 0, copies: [{ ...healthy.copies[0], size: 0 }] }).includes('FAIL'));
});

test('an empty loaded copy is a FAIL even if the repo is fine', () => {
  assert.ok(levels({ ...healthy, copies: [{ ...healthy.copies[0], symlink: false, size: 0, matchesWorkingTree: false }] }).includes('FAIL'));
});

test('a dangling symlink is a FAIL', () => {
  assert.ok(levels({ ...healthy, copies: [{ ...healthy.copies[0], size: null, matchesWorkingTree: false }] }).includes('FAIL'));
});

test('enabled but never installed is a FAIL', () => {
  assert.ok(levels({ ...healthy, copies: [] }).includes('FAIL'));
});

test('a plain copy that drifted from the repo is a WARN', () => {
  assert.deepEqual(levels({ ...healthy, copies: [{ ...healthy.copies[0], symlink: false, size: 3545, matchesWorkingTree: false }] }), ['WARN']);
});

test('installed but not enabled in config-xpui.ini is a WARN', () => {
  assert.deepEqual(levels({ ...healthy, enabled: false }), ['WARN']);
});

test('not enabled and not installed is fine (e.g. a retired extension)', () => {
  assert.deepEqual(judge({ ...healthy, enabled: false, copies: [] }), []);
});
