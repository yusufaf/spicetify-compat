// Turns Spotify's vanilla xpui code into a small index of names and hashes.
// The index is what gets committed under state/builds/, so it must never contain Spotify code.

const GRAPHQL = /"(\w+)","(query|mutation|subscription)","([0-9a-f]{64})"/g;
// JSX compiles data-testid props to this form. A bare "tracklist-row" string can outlive the element.
const TESTID = /"data-testid":"([^"\\]+)"/g;
const CSS_CLASS = /\.(-?[A-Za-z_][\w-]*)/g;

export function buildIndex({ js, css }) {
  const graphql = {};
  const testids = new Set();
  const cssClasses = new Set();
  for (const text of js) {
    for (const [, name, kind, hash] of text.matchAll(GRAPHQL)) graphql[name] = { kind, hash };
    for (const [, id] of text.matchAll(TESTID)) testids.add(id);
  }
  for (const text of css) {
    for (const [, cls] of text.matchAll(CSS_CLASS)) cssClasses.add(cls);
  }
  return {
    graphql: Object.fromEntries(Object.entries(graphql).sort(([a], [b]) => a.localeCompare(b))),
    testids: [...testids].sort(),
    cssClasses: [...cssClasses].sort(),
  };
}

// Share of css-map hashes that exist in this build. Spicetify only renames a class
// to its readable main-* name when the hash is still there.
export function cssMapHitRate(cssMap, index) {
  const present = new Set(index.cssClasses);
  const keys = Object.keys(cssMap);
  const hits = keys.filter(k => present.has(k)).length;
  return { hits, total: keys.length, rate: keys.length ? hits / keys.length : 0 };
}

export function diffGraphql(before, after) {
  const removed = [];
  const changed = [];
  for (const [name, op] of Object.entries(before.graphql)) {
    const next = after.graphql[name];
    if (!next) removed.push(name);
    else if (next.hash !== op.hash) changed.push(name);
  }
  const added = Object.keys(after.graphql).filter(name => !before.graphql[name]);
  return { removed, changed, added };
}
