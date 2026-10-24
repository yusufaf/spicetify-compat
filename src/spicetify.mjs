// Spicetify declares supported Spotify versions only in release-note prose:
//   - Spotify for **Windows/Microsoft Store**: `1.2.14` -> `1.3.6`
const COMPAT_LINE = /Spotify for \*\*([^*]+)\*\*:\s*`([\d.]+)`\s*->\s*`([\d.]+)`/g;

export function parseCompatibility(body) {
  const support = {};
  for (const [, platform, min, max] of (body || '').matchAll(COMPAT_LINE)) {
    const key = /windows/i.test(platform) ? 'windows' : /mac/i.test(platform) ? 'macos' : /linux/i.test(platform) ? 'linux' : platform;
    support[key] = { min, max };
  }
  return support;
}

function versionParts(v) {
  return String(v).split('.').map(Number);
}

// Spicetify names three components (1.3.6); Spotify builds have four or more (1.3.6.1921.g7086c071a617).
export function supports(range, spotifyVersion) {
  if (!range) return null;
  const v = versionParts(spotifyVersion).slice(0, 3);
  const cmp = (a, b) => {
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  return cmp(v, versionParts(range.min)) >= 0 && cmp(v, versionParts(range.max)) <= 0;
}

const API = 'https://api.github.com/repos/spicetify/cli';

export async function fetchReleases(token) {
  const headers = { Accept: 'application/vnd.github+json', ...(token && { Authorization: `Bearer ${token}` }) };
  const res = await fetch(`${API}/releases?per_page=30`, { headers });
  if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`);
  const releases = await res.json();
  return {
    stable: releases.find(r => !r.prerelease && !r.draft) ?? null,
    prerelease: releases.find(r => r.prerelease && !r.draft) ?? null,
  };
}

export async function fetchCssMap(tag) {
  const res = await fetch(`https://raw.githubusercontent.com/spicetify/cli/${tag}/css-map.json`);
  if (!res.ok) throw new Error(`css-map.json at ${tag}: HTTP ${res.status}`);
  return res.json();
}
