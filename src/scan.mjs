import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extractModules } from './snapshot.mjs';
import { buildIndex, cssMapHitRate, diffGraphql } from './bundle.mjs';
import { extensionDeps, judgeDeps } from './deps.mjs';
import { fetchReleases, fetchCssMap, parseCompatibility, supports } from './spicetify.mjs';
import { findExtensions } from './extensions.mjs';
import { BUILDS_DIR, STATE_DIR, INSTALLERS_DIR, SPOTIFY_DIR, SPICETIFY_CONFIG_DIR } from './paths.mjs';

const INSTALLER_URL = 'https://download.scdn.co/SpotifyFullSetupX64.exe';
const KEEP_INSTALLERS = 3;

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
}

const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;

export function productVersion(exe) {
  return powershell(`(Get-Item -LiteralPath ${psQuote(exe)}).VersionInfo.ProductVersion`);
}

// Builds are keyed by the first four components; the installed Spotify.exe omits the g-hash.
export function buildId(version) {
  return version.split('.').slice(0, 4).join('.');
}

function assertSpotifySigned(exe) {
  const out = powershell(`$s = Get-AuthenticodeSignature -LiteralPath ${psQuote(exe)}; "$($s.Status)|$($s.SignerCertificate.Subject)"`);
  const [status, subject] = out.split('|');
  if (status !== 'Valid' || !/O=Spotify AB/.test(subject)) {
    throw new Error(`Installer signature check failed: ${status} ${subject}`);
  }
}

async function downloadInstaller() {
  mkdirSync(INSTALLERS_DIR, { recursive: true });
  const tmp = join(INSTALLERS_DIR, `download-${Date.now()}.exe`);
  const res = await fetch(INSTALLER_URL);
  if (!res.ok) throw new Error(`Installer download: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  return tmp;
}

// Keep the newest installers for rollback; older ones are deleted.
function keepInstaller(source, version, { move }) {
  mkdirSync(INSTALLERS_DIR, { recursive: true });
  const target = join(INSTALLERS_DIR, `SpotifyFullSetupX64-${version}.exe`);
  if (source !== target) {
    copyFileSync(source, target);
    if (move) rmSync(source);
  }
  const saved = readdirSync(INSTALLERS_DIR)
    .filter(f => /^SpotifyFullSetupX64-.+\.exe$/.test(f))
    .map(f => ({ f, t: statSync(join(INSTALLERS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of saved.slice(KEEP_INSTALLERS)) rmSync(join(INSTALLERS_DIR, f));
  return target;
}

function extractInstaller(exe, outDir) {
  const result = spawnSync(exe, ['/extract', outDir], { timeout: 180_000 });
  if (result.status !== 0) throw new Error(`Installer /extract exited with ${result.status ?? result.error}`);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// Reads xpui.spa (a zip; Windows tar can unpack it) plus the snapshot's module span.
export function indexBuild({ spa, snapshot }) {
  const dir = mkdtempSync(join(tmpdir(), 'compat-xpui-'));
  try {
    // Windows' bsdtar reads zips; a GNU tar from Git Bash earlier on PATH does not.
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', spa, '-C', dir], { stdio: 'pipe' });
    const files = walk(dir);
    const js = files.filter(f => extname(f) === '.js').map(f => readFileSync(f, 'utf8'));
    const css = files.filter(f => extname(f) === '.css').map(f => readFileSync(f, 'utf8'));
    const modules = extractModules(readFileSync(snapshot));
    if (!modules) throw new Error(`No webpack module span in ${snapshot}`);
    js.push(modules);
    const index = buildIndex({ js, css });
    // Guard against a format change being reported as "everything broke".
    if (Object.keys(index.graphql).length < 100 || index.testids.length < 100) {
      throw new Error(`Index looks wrong (${Object.keys(index.graphql).length} GraphQL ops, ${index.testids.length} testids); the bundle format may have changed`);
    }
    return index;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function saveIndex(id, index) {
  mkdirSync(BUILDS_DIR, { recursive: true });
  writeFileSync(join(BUILDS_DIR, `${id}.json`), JSON.stringify(index, null, 1) + '\n');
}

export function loadIndex(id) {
  const path = join(BUILDS_DIR, `${id}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

const VERIFIED = join(STATE_DIR, 'verified.json');

export function readVerified() {
  return existsSync(VERIFIED) ? JSON.parse(readFileSync(VERIFIED, 'utf8')) : null;
}

export function writeVerified(record) {
  writeFileSync(VERIFIED, JSON.stringify(record, null, 2) + '\n');
}

// Index the build that's installed right now. Spicetify's Backup\xpui.spa is the vanilla copy;
// the snapshot is never patched.
export function indexInstalled() {
  const version = productVersion(join(SPOTIFY_DIR, 'Spotify.exe'));
  const index = indexBuild({
    spa: join(SPICETIFY_CONFIG_DIR, 'Backup', 'xpui.spa'),
    snapshot: join(SPOTIFY_DIR, 'v8_context_snapshot.bin'),
  });
  return { version, id: buildId(version), index };
}

export async function indexLatestInstaller({ installer } = {}) {
  const downloaded = installer ?? await downloadInstaller();
  assertSpotifySigned(downloaded);
  const version = productVersion(downloaded);
  const saved = keepInstaller(downloaded, version, { move: !installer });
  const out = mkdtempSync(join(tmpdir(), 'compat-installer-'));
  try {
    extractInstaller(saved, out);
    const index = indexBuild({ spa: join(out, 'Apps', 'xpui.spa'), snapshot: join(out, 'v8_context_snapshot.bin') });
    return { version, id: buildId(version), index, installer: saved };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

export async function compare({ baselineId, current, projectsDir }) {
  const baseline = loadIndex(baselineId);
  if (!baseline) throw new Error(`No index for baseline ${baselineId}; run \`compat baseline\` first`);
  const { stable, prerelease } = await fetchReleases(process.env.GITHUB_TOKEN);
  const cssMap = await fetchCssMap(stable.tag_name);
  const support = parseCompatibility(stable.body).windows;

  const extensions = findExtensions(projectsDir).map(ext => {
    const deps = extensionDeps(readFileSync(join(ext.dir, ext.main), 'utf8'));
    const results = judgeDeps(deps, { baseline, current: current.index, cssMap });
    return { ...ext, results };
  });

  return {
    baselineId,
    current: { version: current.version, id: current.id },
    spicetify: { tag: stable.tag_name, support, supportsCurrent: supports(support, current.version) },
    prerelease: prerelease && prerelease.published_at > stable.published_at ? prerelease.tag_name : null,
    cssMap: { baseline: cssMapHitRate(cssMap, baseline), current: cssMapHitRate(cssMap, current.index) },
    graphql: diffGraphql(baseline, current.index),
    extensions,
  };
}

const pct = r => `${r.hits}/${r.total} (${Math.round(r.rate * 100)}%)`;

export function formatReport(report, { verbose = false } = {}) {
  const { spicetify: s } = report;
  const supportText = s.support
    ? `${s.support.min} -> ${s.support.max} (${s.supportsCurrent ? 'covers' : 'does NOT cover'} ${report.current.id})`
    : 'unparseable release notes';
  const lines = [
    `Spotify ${report.current.version} vs baseline ${report.baselineId}`,
    `Spicetify ${s.tag} Windows support: ${supportText}`,
  ];
  if (report.prerelease) lines.push(`Pre-release ${report.prerelease} exists (report-only)`);
  lines.push(
    `css-map hashes present (${s.tag} map): baseline ${pct(report.cssMap.baseline)}, new ${pct(report.cssMap.current)}`,
    `GraphQL: ${report.graphql.removed.length} removed, ${report.graphql.changed.length} hash changed, ${report.graphql.added.length} added`,
  );
  if (report.graphql.removed.length) lines.push(`  removed: ${report.graphql.removed.join(', ')}`);
  lines.push('', 'Extension dependencies (static only; ARIA and data-* selectors are judged by `compat check`):');
  for (const ext of report.extensions) {
    const count = st => ext.results.filter(r => r.status === st).length;
    const broken = ext.results.filter(r => r.status === 'BROKEN');
    lines.push(`  ${ext.id.padEnd(20)} ${(broken.length ? 'BROKEN' : 'ok').padEnd(7)} ok ${count('OK')}, broken ${broken.length}, dead ${count('DEAD')}, unmapped ${count('UNMAPPED')}`);
    const shown = verbose ? ext.results.filter(r => r.status !== 'OK') : broken;
    for (const r of shown) lines.push(`      ${r.status.padEnd(8)} ${r.kind.padEnd(7)} ${r.name}`);
  }
  if (!verbose) lines.push('', 'dead = already matches nothing on the baseline build (stale fallback selectors); --verbose lists them.');
  return lines.join('\n');
}
