import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// Local extension repos: any <projectsDir>/spicetify-*/manifest.json with a `main` file.
export function findExtensions(projectsDir) {
  const found = [];
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('spicetify-')) continue;
    const dir = join(projectsDir, entry.name);
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (typeof manifest.main !== 'string' || !manifest.main.endsWith('.js')) continue;
    found.push({
      id: basename(manifest.main, '.js'),
      title: manifest.name ?? entry.name,
      dir,
      main: manifest.main,
    });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}
