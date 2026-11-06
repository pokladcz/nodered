// Embedded into Function nodes by build-flows.cjs; not a standalone module.
function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function fresh(ts, maxMs = 30000) {
  const age = Date.now() - new Date(ts || 0).getTime();
  return Number.isFinite(age) && age >= 0 && age <= maxMs;
}
function dataDir() {
  return global.get('automationDataDir') ||
    (typeof env !== 'undefined' && env.get('VICTRON_AUTOMATION_DIR')) ||
    path.join(os.homedir(), '.victron-automation');
}
async function readRecord(name) {
  try { return JSON.parse(await fs.promises.readFile(path.join(dataDir(), name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeRecord(name, value) {
  await fs.promises.mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const filename = path.join(dataDir(), name);
  const temp = filename + '.tmp';
  const handle = await fs.promises.open(temp, 'w', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  await fs.promises.rename(temp, filename);
  if (os.platform() !== 'win32') {
    const directory = await fs.promises.open(dataDir(), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
function finalPrice(row) {
  const fee = finite(global.get('processFeeCzkMWh')) ?? 300;
  const raw = finite(row.priceKcMWh ?? row.priceCZKMWh ?? row.priceK);
  if (raw !== null) return (raw - fee) / 1000;
  const kwh = finite(row.priceKcKwh ?? row.price);
  if (kwh !== null) return kwh - fee / 1000;
  return finite(row.finalKcKwh ?? row.final ?? row.priceFinalKwh ?? row.finalPriceKwh);
}
function makePlan(soc) {
  const day = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' });
  const now = Date.now();
  const method = ['A', 'B', 'C'].includes(global.get('chargeMethod')) ? global.get('chargeMethod') : 'A';
  const limit = finite(global.get('chargeBelowFinalPriceKcKwh')) ?? 4.9;
  const count = Math.max(1, Math.min(100, Math.floor(finite(global.get('cheapestIntervalsCount')) ?? 16)));
  const unique = new Map();
  for (const p of global.get('enerspotPrices15') || []) {
    if (!p || typeof p !== 'object') continue;
    const start = new Date(p.datetime || p.dateTime || p.time || '').getTime();
    const price = finalPrice(p);
    if (!Number.isFinite(start) || price === null) continue;
    const end = new Date(p.datetimeTo || p.dateTimeTo || p.end || '').getTime();
    // Prices are quarter-hour products; a missing row must never extend the previous slot.
    unique.set(start, { start, end: end > start && end <= start + 900000 ? end : start + 900000, price, day: day(start) });
  }
  const all = [...unique.values()].sort((a, b) => a.start - b.start);
  const groups = new Map();
  for (const p of all) { if (!groups.has(p.day)) groups.set(p.day, []); groups.get(p.day).push(p); }
  const chosen = new Set();
  if (method === 'C') for (const rows of groups.values()) {
    for (const p of rows.slice().sort((a, b) => a.price - b.price || a.start - b.start).slice(0, count)) chosen.add(p.start);
  }
  const enabled = global.get('priceChargeEnabled') !== false && ['both', 'victron'].includes(global.get('cheapPriceBatteryMode') || 'both');
  const intervals = all.map(p => {
    let targetSoc = 100;
    let selected = p.price <= limit;
    if (method === 'B') {
      targetSoc = 0;
      for (let i = 1; i <= 5; i++) {
        const price = finite(global.get('chargeTier' + i + 'Price'));
        const target = finite(global.get('chargeTier' + i + 'Soc'));
        if (price !== null && target !== null && p.price <= price) targetSoc = Math.max(targetSoc, target);
      }
      selected = targetSoc > 0;
    } else if (method === 'C') selected = chosen.has(p.start);
    return { from: new Date(p.start).toISOString(), to: new Date(p.end).toISOString(), day: p.day,
      finalKcKwh: p.price, targetSoc, selected, eligible: enabled && selected && soc !== null && soc < targetSoc,
      active: now >= p.start && now < p.end };
  });
  const priceFresh = global.get('enerspotLastFetchOk') === true && fresh(global.get('enerspotLastFetchTs'), (finite(global.get('enerspotMaxAgeMin')) ?? 90) * 60000);
  const current = intervals.find(p => p.active) || null;
  return { ts: new Date().toISOString(), method, sourceFresh: priceFresh, permissionOnly: true,
    note: 'Povoleni ESS pro prebytky FV, nikoli slib toku nebo nabijeni ze site. Zimni rezim a BMS maji prednost.',
    current: current ? { ...current, eligible: current.eligible && priceFresh } : null,
    days: [...groups].map(([date, rows]) => ({ date, availableIntervals: rows.length, selectedIntervals: method === 'C' ? Math.min(count, rows.length) : intervals.filter(p => p.day === date && p.selected).length })),
    intervals: intervals.filter(p => new Date(p.to).getTime() > now).slice(0, 300) };
}
