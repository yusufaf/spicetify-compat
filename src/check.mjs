import { execFileSync } from 'node:child_process';
import { findExtensions } from './extensions.mjs';
import { enabledExtensions, runIntegrity } from './integrity.mjs';
import { connect, waitForTarget } from './cdp.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SETTLE_MS = 8000;
const ROUTE_MS = 4000;

async function waitForSpicetify(conn, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await conn.evaluate('!!(window.Spicetify?.Platform?.History && window.Spicetify?.Player)')) return;
    } catch { /* page navigating */ }
    await sleep(1000);
  }
  throw new Error('Spicetify did not become ready');
}

// Console errors and uncaught exceptions, so failures can be pinned on an extension.
function captureErrors(conn) {
  const errors = [];
  conn.onEvent(m => {
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(`${d.exception?.description ?? d.text} (${d.url ?? ''})`);
    }
  });
  return errors;
}

const readHealth = (conn, id) => conn.evaluate(`(async () => {
  const hook = window.__spicetifyHealth?.[${JSON.stringify(id)}];
  if (typeof hook !== 'function') return null;
  try { return await hook(); } catch (e) { return { ready: false, errors: [String(e)] }; }
})()`);

function verdict(r) {
  const problems = [];
  if (r.errors.length) problems.push(`${r.errors.length} console error(s)`);
  if (!r.hook) return { status: problems.length ? 'FAIL' : 'NO-HOOK', problems };
  if (!r.ready) problems.push('not ready');
  if (r.hookErrors.length) problems.push(...r.hookErrors);
  for (const [route, anchors] of Object.entries(r.routes)) {
    const total = Object.values(anchors ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    if (total === 0) problems.push(`found nothing on ${route}`);
  }
  return { status: problems.length ? 'FAIL' : 'PASS', problems };
}

export async function runCheck(config, { restart = true } = {}) {
  let ok = true;
  console.log('Integrity');
  try {
    ok = runIntegrity(config);
  } catch (e) {
    ok = false;
    console.log(`  error: ${e.message}`);
  }

  const enabled = enabledExtensions();
  const extensions = findExtensions(config.projectsDir).filter(ext => enabled.has(ext.main));

  if (restart) {
    console.log('\nRestarting Spotify…');
    execFileSync('spicetify', ['restart'], { stdio: 'ignore' });
  }
  const conn = await connect(await waitForTarget(config.cdpPort));
  try {
    await waitForSpicetify(conn);
    // Reload with listeners attached so start-up errors are captured too.
    const errors = captureErrors(conn);
    await conn.send('Runtime.enable');
    await conn.send('Page.enable');
    await conn.send('Page.reload', { ignoreCache: true });
    await sleep(1000);
    await waitForSpicetify(conn);
    await sleep(SETTLE_MS);

    const results = {};
    for (const ext of extensions) {
      const health = await readHealth(conn, ext.id);
      results[ext.id] = {
        hook: !!health,
        ready: !!health?.ready,
        hookErrors: health?.errors ?? [],
        routes: {},
        errors: errors.filter(e => e.includes(ext.main) || e.includes(`[${ext.title}]`) || e.includes(`[${ext.id}]`)),
      };
    }

    const original = await conn.evaluate('Spicetify.Platform.History.location.pathname');
    // Sidebar extensions render nothing while Your Library is collapsed, so open it for the run.
    const openedSidebar = await conn.evaluate(`(() => {
      const open = document.querySelector('#Desktop_LeftSidebar_Id button[aria-label="Open Your Library"]');
      open?.click();
      return !!open;
    })()`);
    if (openedSidebar) await sleep(2000);
    for (const [route, path] of Object.entries(config.routes)) {
      const wanted = extensions.filter(ext => results[ext.id].hook && (config.expect[ext.id] ?? []).includes(route));
      if (!wanted.length) continue;
      await conn.evaluate(`Spicetify.Platform.History.push(${JSON.stringify(path)})`);
      await sleep(ROUTE_MS);
      for (const ext of wanted) results[ext.id].routes[route] = (await readHealth(conn, ext.id))?.anchors ?? {};
    }
    await conn.evaluate(`Spicetify.Platform.History.push(${JSON.stringify(original)})`);
    if (openedSidebar) {
      await conn.evaluate(`document.querySelector('#Desktop_LeftSidebar_Id button[aria-label="Collapse Your Library"]')?.click()`);
    }

    console.log('\nLive health');
    for (const ext of extensions) {
      const { status, problems } = verdict(results[ext.id]);
      if (status === 'FAIL') ok = false;
      console.log(`  ${status.padEnd(8)} ${ext.id}${problems.length ? ` — ${problems.join('; ')}` : ''}`);
      for (const e of results[ext.id].errors.slice(0, 3)) console.log(`           ${e.slice(0, 200)}`);
    }
    const skipped = findExtensions(config.projectsDir).filter(ext => !enabled.has(ext.main));
    if (skipped.length) console.log(`  (not enabled, skipped: ${skipped.map(e => e.id).join(', ')})`);
  } finally {
    conn.close();
  }
  return ok;
}
