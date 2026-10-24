// Since Spotify 1.2.64 most of xpui's webpack modules live in v8_context_snapshot.bin,
// stored as UTF-16LE text. The span can start on an odd byte, so search bytes, not decoded text.
const START = Buffer.from('var __webpack_modules__={', 'utf16le');
const END = Buffer.from('xpui-modules.js.map', 'utf16le');

export function extractModules(snapshot) {
  const start = snapshot.indexOf(START);
  if (start < 0) return null;
  const end = snapshot.indexOf(END, start);
  if (end < 0) return null;
  return snapshot.subarray(start, end).toString('utf16le');
}
