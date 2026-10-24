import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const env = process.env;

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STATE_DIR = join(REPO_ROOT, 'state');
export const BUILDS_DIR = join(STATE_DIR, 'builds');

export const SPOTIFY_DIR = join(env.APPDATA ?? '', 'Spotify');
export const SPICETIFY_CONFIG_DIR = join(env.APPDATA ?? '', 'spicetify');
export const SPICETIFY_INSTALL_DIR = join(env.LOCALAPPDATA ?? '', 'spicetify');
export const INSTALLERS_DIR = join(env.LOCALAPPDATA ?? '', 'spicetify-compat', 'installers');

// Every place a Spicetify extension file can be loaded from.
export const EXTENSION_DIRS = [
  join(SPICETIFY_CONFIG_DIR, 'Extensions'),
  join(SPICETIFY_INSTALL_DIR, 'Extensions'),
  join(SPOTIFY_DIR, 'Apps', 'xpui', 'extensions'),
];

export function loadLocalConfig() {
  const path = join(REPO_ROOT, 'compat.local.json');
  const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return {
    projectsDir: config.projectsDir ?? 'C:/Projects',
    cdpPort: config.cdpPort ?? 9222,
    routes: config.routes ?? {},
    expect: config.expect ?? {},
  };
}
