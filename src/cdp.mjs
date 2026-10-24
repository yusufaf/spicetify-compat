// Minimal Chrome DevTools Protocol client for the Spotify desktop client.
// Adapted from spicetify-agent-skills/skills/spicetify-live-test/cdp.mjs.

export async function xpuiTarget(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page' && /xpui/.test(t.url || ''));
  return page?.webSocketDebuggerUrl ?? null;
}

export async function waitForTarget(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const url = await xpuiTarget(port);
      if (url) return url;
    } catch { /* Spotify still starting */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`No xpui page on :${port} after ${timeoutMs / 1000}s (is Spotify launched with --remote-debugging-port?)`);
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const handlers = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    for (const h of handlers) h(m);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise(r => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return {
    send,
    onEvent: h => handlers.push(h),
    close: () => ws.close(),
    // Evaluates an expression in the page and returns its JSON value.
    async evaluate(expression) {
      const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'evaluate failed');
      return m.result?.result?.value;
    },
  };
}
