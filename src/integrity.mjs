import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXTENSION_DIRS, SPICETIFY_CONFIG_DIR } from './paths.mjs';
import { findExtensions } from './extensions.mjs';

export function enabledExtensions() {
  const ini = readFileSync(join(SPICETIFY_CONFIG_DIR, 'config-xpui.ini'), 'utf8');
  const line = ini.match(/^\s*extensions\s*=\s*(.*)$/m);
  return new Set((line?.[1] ?? '').split('|').map(s => s.trim()).filter(Boolean));
}

function headSize(dir, file) {
  try {
    return Number(execFileSync('git', ['-C', dir, 'cat-file', '-s', `HEAD:${file}`], { encoding: 'utf8', stdio: 'pipe' }).trim());
  } catch {
    return null;
  }
}

function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

// Everything judge() needs to know about one extension, gathered without changing anything.
export function gatherFacts(ext, { dirs = EXTENSION_DIRS, enabled = enabledExtensions() } = {}) {
  const repoFile = join(ext.dir, ext.main);
  const working = existsSync(repoFile) ? readFileSync(repoFile) : null;
  const copies = dirs
    .map(dir => join(dir, ext.main))
    .filter(path => { try { lstatSync(path); return true; } catch { return false; } })
    .map(path => {
      const symlink = lstatSync(path).isSymbolicLink();
      const size = sizeOf(path);
      let matchesWorkingTree = false;
      if (size !== null && working) {
        try { matchesWorkingTree = readFileSync(path).equals(working); } catch { /* unreadable */ }
      }
      return { path, symlink, target: symlink ? readlinkSync(path) : null, size, matchesWorkingTree };
    });
  return {
    id: ext.id,
    main: ext.main,
    repoDir: ext.dir,
    workingSize: working ? working.length : null,
    headSize: headSize(ext.dir, ext.main),
    enabled: enabled.has(ext.main),
    copies,
  };
}

// Returns a list of { level: 'FAIL' | 'WARN', message } for one extension; [] means healthy.
//
// facts = {
//   id, main, repoDir,
//   workingSize,   bytes of the repo's main file in the working tree (null if missing)
//   headSize,      bytes of the same file at HEAD (null if untracked or not a git repo)
//   enabled,       listed in config-xpui.ini `extensions`
//   copies: [{ path, symlink, target, size, matchesWorkingTree }]
//                  every copy Spotify could load; size is null for a dangling symlink
// }
//
// The hard part is telling a truncated or stale file apart from work in progress.
// On Oct 20, `spicetify apply` left 4 working-tree files at 0 bytes while HEAD was fine.
export function judge(facts) {
  const findings = [];
  const fail = message => findings.push({ level: 'FAIL', message });
  const warn = message => findings.push({ level: 'WARN', message });

  // An edited file still has content; only an emptied one next to a non-empty HEAD is truncation.
  if (facts.workingSize === 0 && facts.headSize > 0) {
    fail(`${facts.main} is empty in the working tree but ${facts.headSize} bytes at HEAD (truncated; git restore it)`);
  }
  for (const copy of facts.copies) {
    if (copy.size === null) fail(`${copy.path} is a dangling symlink`);
    else if (copy.size === 0) fail(`${copy.path} is empty`);
    else if (!copy.matchesWorkingTree) {
      warn(copy.symlink
        ? `${copy.path} links to ${copy.target}, not this repo's working tree`
        : `${copy.path} is a stale copy (${copy.size} bytes vs ${facts.workingSize} in the repo)`);
    }
  }
  if (facts.enabled && !facts.copies.length) fail(`enabled in config-xpui.ini but not installed`);
  if (!facts.enabled && facts.copies.length) warn(`installed but not enabled in config-xpui.ini`);
  return findings;
}

export function runIntegrity(config) {
  let ok = true;
  const enabled = enabledExtensions();
  for (const ext of findExtensions(config.projectsDir)) {
    const findings = judge(gatherFacts(ext, { enabled }));
    const failed = findings.some(f => f.level === 'FAIL');
    if (failed) ok = false;
    const status = failed ? 'FAIL' : findings.length ? 'WARN' : 'ok';
    console.log(`${status.padEnd(5)} ${ext.id}`);
    for (const f of findings) console.log(`      ${f.level.padEnd(5)} ${f.message}`);
  }
  return ok;
}
