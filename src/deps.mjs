// What an extension's source says it needs from Spotify, for the checks that static analysis can judge.
// ARIA and data-* attribute selectors are left to the live health check.

const GRAPHQL = /GraphQL\.Definitions(?:\.(\w+)|\[\s*["'](\w+)["']\s*\])/g;
// Exact [data-testid="x"] / [data-testid=x] only; ^= and *= are fuzzy and can't be checked.
const TESTID = /data-testid\s*=\s*\\?["']?([\w-]+)/g;
// Ends on a word character so prefix patterns like `main-trackList-${x}` are skipped.
const MAPPED_CLASS = /\.((?:main|Root)(?:-|__)[\w-]*\w)(?![\w-])/g;

export function extensionDeps(source) {
  const graphql = new Set();
  const testids = new Set();
  const classes = new Set();
  for (const [, dotted, bracketed] of source.matchAll(GRAPHQL)) graphql.add(dotted || bracketed);
  for (const [, id] of source.matchAll(TESTID)) testids.add(id);
  for (const [, cls] of source.matchAll(MAPPED_CLASS)) classes.add(cls);
  return { graphql: [...graphql].sort(), testids: [...testids].sort(), classes: [...classes].sort() };
}

// Per dependency: OK when the new build has it, BROKEN when it disappeared since the baseline,
// DEAD when neither build has it (the selector already matches nothing).
export function judgeDeps(deps, { baseline, current, cssMap }) {
  const status = (inBase, inNow) => (inNow ? 'OK' : inBase ? 'BROKEN' : 'DEAD');
  const keysFor = cls => Object.keys(cssMap).filter(k => cssMap[k] === cls);
  const baseClasses = new Set(baseline.cssClasses);
  const currentClasses = new Set(current.cssClasses);
  const has = (classes, keys) => keys.some(k => classes.has(k));

  return [
    ...deps.graphql.map(name => ({
      kind: 'graphql', name, status: status(name in baseline.graphql, name in current.graphql),
    })),
    ...deps.testids.map(name => ({
      kind: 'testid', name, status: status(baseline.testids.includes(name), current.testids.includes(name)),
    })),
    ...deps.classes.map(name => {
      const keys = keysFor(name);
      if (!keys.length) return { kind: 'class', name, status: 'UNMAPPED' };
      return { kind: 'class', name, status: status(has(baseClasses, keys), has(currentClasses, keys)) };
    }),
  ];
}
