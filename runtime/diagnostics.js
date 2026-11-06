function redact(value, depth = 0) {
  if (depth > 12) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 320).map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    if (value.address === 0) return { ts: value.ts || null, address: 0, redacted: true };
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/token|password|passwd|secret|authorization|cookie|headers|credentials|payload|raw|url|endpoint|values|lastError|message|queue/i.test(k)) continue;
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/Heslo\s+R0=\S+/gi, 'Heslo R0=[redacted]').replace(/([?&](?:key|token|password)=)[^&\s]+/gi, '$1[redacted]').slice(0, 1000);
  return value;
}
const files = ['events.3.jsonl', 'events.2.jsonl', 'events.1.jsonl', 'events.jsonl'];
const ts = new Date().toISOString();
if (msg._downloadDiagnostics || msg.payload?.action === 'diagnostics_download') {
  try {
    const lines = [];
    for (const filename of files) {
      try { lines.push(await fs.promises.readFile(path.join(dataDir(), filename), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const events = [];
    for (const line of lines.join('\n').split('\n').filter(Boolean)) {
      try { events.push(redact(JSON.parse(line))); }
      catch (error) { events.push({ ts, type: 'invalid-log-record' }); }
    }
    msg.statusCode = 200;
    msg.headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="victron-diagnostics.json"' };
    msg.payload = JSON.stringify({ version: 174, exportedAt: ts, status: global.get('diagnosticsStatus') || null, events });
    return msg;
  } catch (error) {
    msg.statusCode = 500; msg.payload = { ok: false, error: error.code || 'LOG_DOWNLOAD_FAILED' }; return msg;
  }
}
if (context.get('busy')) { global.set('diagnosticsDropped', (global.get('diagnosticsDropped') || 0) + 1); return null; }
context.set('busy', true);
try {
  const p = msg.payload || {};
  const snapshot = {};
   for (const key of ['bridge', 'victron', 'battery', 'bms', 'grid', 'relays', 'price', 'solax', 'winterControl', 'chargePlan', 'persistence', 'runtime', 'transport', 'event']) {
    if (p[key] !== undefined) snapshot[key] = redact(p[key]);
  }
  if (msg.error) snapshot.error = { code: msg.error.code || 'NODE_ERROR', source: msg.error.source?.id || null };
  if (msg.status) snapshot.transport = { source: msg.status.source?.id || null, fill: msg.status.fill || null, shape: msg.status.shape || null };
  const key = JSON.stringify({ bridge: snapshot.bridge, decision: snapshot.victron?.decision, winter: snapshot.winterControl,
    chargeFault: snapshot.victron?.chargeControlFault, error: snapshot.error, transport: snapshot.transport,
    event: snapshot.event });
  const changed = key !== context.get('lastKey');
  const heartbeat = Date.now() - (context.get('lastSnapshot') || 0) >= 60000;
  if (!changed && !heartbeat) return null;
  let record = { version: 174, ts, type: changed ? 'change' : 'snapshot', proxmoxHostUptimeSec: os.uptime(), ...snapshot };
  let line = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(line) > 128 * 1024) {
     record = { version: 174, ts, type: 'snapshot-size-limit', originalBytes: Buffer.byteLength(line), maxRecordBytes: 128 * 1024 };
    line = JSON.stringify(record) + '\n';
  }
  await fs.promises.mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const filename = path.join(dataDir(), 'events.jsonl');
  let size = 0;
  try { size = (await fs.promises.stat(filename)).size; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (size + Buffer.byteLength(line) > 1024 * 1024) {
    await fs.promises.rm(path.join(dataDir(), files[0]), { force: true });
    for (let i = 1; i < files.length; i++) {
      try { await fs.promises.rename(path.join(dataDir(), files[i]), path.join(dataDir(), files[i - 1])); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const handle = await fs.promises.open(filename, 'a', 0o600);
  try { await handle.writeFile(line); await handle.sync(); }
  finally { await handle.close(); }
  context.set('lastKey', key); context.set('lastSnapshot', Date.now());
  global.set('diagnosticsStatus', { ok: true, ts, storage: 'Proxmox atomic append + fsync', maxFiles: 4, maxFileBytes: 1048576, dropped: global.get('diagnosticsDropped') || 0 });
  return null;
} catch (error) {
  global.set('diagnosticsStatus', { ok: false, ts, error: error.code || 'LOG_WRITE_FAILED' });
  node.error('Diagnosticky zapis selhal: ' + (error.code || 'LOG_WRITE_FAILED')); return null;
} finally { context.set('busy', false); }
