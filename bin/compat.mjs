#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadLocalConfig } from '../src/paths.mjs';
import {
  indexInstalled, indexLatestInstaller, saveIndex, loadIndex, readVerified, writeVerified, compare, formatReport,
} from '../src/scan.mjs';

const USAGE = `Usage: compat <command>

  baseline            index the installed (vanilla) Spotify build and record it as last-known-good
  scan [--installer <path>] [--verbose]
                      download the current Spotify installer (or use <path>), keep it for rollback,
                      and compare it with the last-known-good build
  integrity           check the extension files Spotify loads against your repos
  check [--no-restart] [--record]
                      integrity + cold-start Spotify + read every extension's health hook;
                      --record marks the installed build last-known-good when nothing fails
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    installer: { type: 'string' },
    'no-restart': { type: 'boolean' },
    record: { type: 'boolean' },
    verbose: { type: 'boolean', short: 'v' },
    help: { type: 'boolean', short: 'h' },
  },
});

const config = loadLocalConfig();
const [command] = positionals;

switch (command) {
  case 'baseline': {
    const { version, id, index } = indexInstalled();
    saveIndex(id, index);
    writeVerified({ build: id, version, recordedAt: new Date().toISOString(), by: 'baseline' });
    console.log(`Indexed installed Spotify ${version}: ${Object.keys(index.graphql).length} GraphQL ops, ${index.testids.length} testids, ${index.cssClasses.length} CSS classes`);
    break;
  }
  case 'scan': {
    const verified = readVerified();
    if (!verified) throw new Error('No last-known-good build yet; run `compat baseline` first');
    const current = await indexLatestInstaller({ installer: values.installer });
    if (!loadIndex(current.id)) saveIndex(current.id, current.index);
    console.log(`Installer kept at ${current.installer}\n`);
    console.log(formatReport(await compare({ baselineId: verified.build, current, projectsDir: config.projectsDir }), { verbose: values.verbose }));
    break;
  }
  case 'integrity': {
    const { runIntegrity } = await import('../src/integrity.mjs');
    process.exitCode = runIntegrity(config) ? 0 : 1;
    break;
  }
  case 'check': {
    const { runCheck } = await import('../src/check.mjs');
    const ok = await runCheck(config, { restart: !values['no-restart'] });
    process.exitCode = ok ? 0 : 1;
    if (ok && values.record) {
      const { version, id, index } = indexInstalled();
      if (!loadIndex(id)) saveIndex(id, index);
      writeVerified({ build: id, version, recordedAt: new Date().toISOString(), by: 'check' });
      console.log(`\nRecorded ${id} as last-known-good in state/verified.json; commit and push it.`);
    }
    break;
  }
  default:
    console.log(USAGE);
    process.exitCode = command && !values.help ? 1 : 0;
}
