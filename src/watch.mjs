// Runs in GitHub Actions: notices new Spotify / Spicetify releases and keeps one issue per combination.
// Without GITHUB_TOKEN it prints what it would do.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchReleases, parseCompatibility, supports } from './spicetify.mjs';
import { STATE_DIR } from './paths.mjs';

const INSTALLER_URL = 'https://download.scdn.co/SpotifyFullSetupX64.exe';
// Scoop's checkver reads the installer's ProductVersion about an hour after each release.
const SCOOP_MANIFEST = 'https://raw.githubusercontent.com/ScoopInstaller/Extras/master/bucket/spotify.json';
const STATE = join(STATE_DIR, 'watch.json');

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY ?? 'yusufaf/spicetify-compat';

async function github(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function observe() {
  const head = await fetch(INSTALLER_URL, { method: 'HEAD' });
  const scoop = await (await fetch(SCOOP_MANIFEST)).json();
  const { stable, prerelease } = await fetchReleases(token);
  return {
    installerLastModified: head.headers.get('last-modified'),
    spotify: scoop.version,
    spicetify: stable.tag_name,
    prerelease: prerelease && prerelease.published_at > stable.published_at ? prerelease.tag_name : null,
    support: parseCompatibility(stable.body).windows ?? null,
  };
}

function issueBody(seen, verified) {
  const covered = supports(seen.support, seen.spotify);
  const range = seen.support ? `\`${seen.support.min}\` -> \`${seen.support.max}\`` : 'unparseable release notes';
  const next = covered
    ? 'Spicetify claims support. Run `compat scan`, then follow the update runbook in the README and finish with `compat check --record`.'
    : covered === false
      ? `Wait: Spicetify ${seen.spicetify} doesn't cover Spotify ${seen.spotify} yet.`
      : "Couldn't read Spicetify's compatibility notes; check the release page before updating.";
  return [
    `| | |`,
    `|---|---|`,
    `| Spotify (Windows GA) | \`${seen.spotify}\` |`,
    `| Installer last modified | ${seen.installerLastModified} |`,
    `| Spicetify | [${seen.spicetify}](https://github.com/spicetify/cli/releases/tag/${seen.spicetify}), Windows ${range} |`,
    `| Your last-known-good | \`${verified?.build ?? 'none recorded'}\` |`,
    seen.prerelease ? `| Pre-release (report only) | [${seen.prerelease}](https://github.com/spicetify/cli/releases/tag/${seen.prerelease}) |` : null,
    '',
    `**Next:** ${next}`,
  ].filter(line => line !== null).join('\n');
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const verifiedPath = join(STATE_DIR, 'verified.json');
const verified = existsSync(verifiedPath) ? JSON.parse(readFileSync(verifiedPath, 'utf8')) : null;
const seen = await observe();
const key = `${seen.spotify}|${seen.spicetify}`;
const changed = ['installerLastModified', 'spotify', 'spicetify', 'prerelease']
  .filter(field => state.seen?.[field] !== seen[field]);

if (!changed.length) {
  console.log(`No change (Spotify ${seen.spotify}, Spicetify ${seen.spicetify})`);
  process.exit(0);
}
console.log(`Changed: ${changed.join(', ')}`);

const title = `Spotify ${seen.spotify.split('.').slice(0, 4).join('.')} · Spicetify ${seen.spicetify}`;
const body = issueBody(seen, verified);
let issue = state.issue ?? null;

if (!token) {
  console.log(`[dry run] ${issue?.key === key ? `would update #${issue.number}` : 'would open'}: ${title}\n\n${body}`);
} else if (issue?.key === key) {
  await github('PATCH', `/issues/${issue.number}`, { body });
  if (changed.includes('prerelease') && seen.prerelease) {
    await github('POST', `/issues/${issue.number}/comments`, { body: `Spicetify pre-release ${seen.prerelease} is out (report only).` });
  }
} else {
  const created = await github('POST', '/issues', { title, body });
  if (issue) {
    await github('POST', `/issues/${issue.number}/comments`, { body: `Superseded by #${created.number}.` });
    await github('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'not_planned' });
  }
  issue = { number: created.number, key };
  console.log(`Opened #${created.number}: ${title}`);
}

if (token) writeFileSync(STATE, JSON.stringify({ seen, issue }, null, 2) + '\n');
