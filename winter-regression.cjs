const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const cerbo = JSON.parse(fs.readFileSync(path.join(__dirname, 'Cerbo_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json')));
const prox = JSON.parse(fs.readFileSync(path.join(__dirname, 'Proxmox_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json')));
function store(initial = {}) {
  const values = structuredClone(initial);
  return { values, get: k => values[k], set: (k, v) => { values[k] = v; } };
}
async function run(nodes, id, g, msg = {}, ctx = store()) {
  const n = nodes.find(n => n.id === id);
  assert.ok(n, 'missing function ' + id);
  const now = g.get('__now') || Date.now();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const fn = new Function('global', 'flow', 'context', 'node', 'fs', 'path', 'os', 'Date', 'Buffer',
    'return async function(msg){\n' + n.func + '\n}');
  return fn(g, g, ctx, { status() {}, warn() {}, error() {} }, fs, path, os, Clock, Buffer)(msg);
}
function fixture(soc = 24, price = 6) {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const ts = new Date(now).toISOString();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'victron-test-'));
  const g = store({ __now: now, automationDataDir: dir, automationReady: true,
    settingsPersistence: { ok: true }, winterModeEnabled: true, winterSleepSoc: 25,
    winterWakePriceKcKwh: 4.9, winterWakeGraceSec: 180, winterNoChargeSec: 60,
    autoModeEnabled: true, hub4ModeValue: 1, hub4ModeTs: ts, hub4ModePortal: 'test-portal',
    venusPortalId: 'test-portal', vebusInstance: '1', vebusFeedbackInstance: '1',
    vebusActualModeValue: 3, victronActualModeTs: ts,
    vebusByInstance: { '1': { instance: '1', portal: 'test-portal', values: {
      'Hub4/DisableFeedIn': { num: 0, ts }, 'Hub4/DisableCharge': { num: 0, ts }
    } } },
    jkBmsByInstance: { '1': { instance: '1', ts, soc, voltage: 52, current: 0, power: 0,
      connected: 1, allowCharge: 1, allowDischarge: 1, maxChargeA: 40 } },
    jkBmsExpectedCount: 1, nightModeStart: 17, nightModeEnd: 5,
    enerspotLastFetchTs: ts, enerspotLastFetchOk: true,
    enerspotPrices15: [{ datetime: ts, datetimeTo: new Date(now + 900000).toISOString(), priceKcMWh: price * 1000 + 300 }],
    chargeBelowFinalPriceKcKwh: 4.9, chargeMethod: 'A', houseLoadW: 1000 });
  return g;
}
function advance(g, seconds) {
  g.set('__now', g.get('__now') + seconds * 1000);
  const ts = new Date(g.get('__now')).toISOString();
  g.set('hub4ModeTs', ts); g.set('victronActualModeTs', ts);
  g.values.jkBmsByInstance['1'].ts = ts;
  for (const v of Object.values(g.values.vebusByInstance['1'].values)) v.ts = ts;
}
function acknowledge(g, out) {
  for (const m of out?.[0] || []) {
    if (!m.topic.startsWith('W/')) continue;
    const ts = new Date(g.get('__now')).toISOString();
    if (m.topic.includes('/settings/0/')) g.set('hub4ModeValue', m.payload.value);
    else {
      const key = m.topic.split('/vebus/1/')[1];
      assert.ok(['Hub4/DisableCharge', 'Hub4/DisableFeedIn'].includes(key));
      g.values.vebusByInstance['1'].values[key] = { num: m.payload.value, ts };
    }
  }
  if (out?.[1]) {
    assert.equal(out[1].payload.value, 3);
    g.set('vebusActualModeValue', 3);
  }
}
async function tick(g, ack = true) {
  await run(cerbo, '252b7ebcd48a5c07', g);
  const out = await run(cerbo, 'winter_controller_v174', g);
  if (ack) acknowledge(g, out);
  return out;
}
async function sleep(g) {
  await tick(g); advance(g, 65);
  for (let i = 0; i < 5; i++) { await tick(g); advance(g, 10); }
  assert.equal(g.get('winterControl').phase, 'asleep');
}
test('winter enters acknowledged passthru, never Off, and blocks competing Mode writes', async () => {
  const g = fixture(); await sleep(g);
  assert.equal(g.get('hub4ModeValue'), 3);
  assert.equal(g.get('winterOwnsVebus'), true);
  assert.equal(await run(cerbo, 'e454e2f6f17be356', g, { payload: { path: 'Mode', value: 2 } }), null);
  const w = await run(cerbo, 'd4ac0d33a81d4bcc', g);
  assert.deepEqual(w, [null, null]);
});
test('winter waits for real power, low SOC alone is insufficient and stale evidence cannot trigger sleep', async () => {
  for (const change of [g => g.values.jkBmsByInstance['1'].soc = 30,
    g => { g.values.jkBmsByInstance['1'].power = 150; },
    g => { g.values.jkBmsByInstance['1'].powerTs = '2000-01-01'; }]) {
    const g = fixture(); change(g); await tick(g); advance(g, 100); await tick(g);
    assert.notEqual(g.get('winterControl').phase, 'asleep');
    assert.notEqual(g.get('hub4ModeValue'), 3);
  }
});
test('foreign portal feedback, discharge denial, or disconnected AC input cannot initiate winter', async () => {
  for (const change of [g => g.set('hub4ModePortal', 'foreign-portal'),
    g => { g.values.jkBmsByInstance['1'].allowDischarge = 0; },
    g => { g.set('vebusActiveInConnected', 0); g.set('vebusActiveInConnectedTs', new Date(g.get('__now')).toISOString()); }]) {
    const g = fixture(); change(g); await tick(g); advance(g, 20); await tick(g); advance(g, 45); await tick(g);
    assert.notEqual(g.get('winterControl').phase, 'asleep');
    assert.equal(g.get('hub4ModeValue'), 1);
  }
});
test('unacknowledged entry times out without external write and keeps recovery ownership', async () => {
  const g = fixture(); await tick(g); advance(g, 65); await tick(g, false);
  advance(g, 65); const out = await tick(g, false);
  assert.notEqual(g.get('winterControl').phase, 'asleep');
  assert.ok(g.get('winterControl').fault);
  assert.ok(!(out[0] || []).some(m => m.topic.startsWith('W/') && m.topic.includes('/settings/0/') && m.payload.value === 3));
});
test('winter restores exact optimized mode on price edge, grace then resleep without cheap-price retry loop', async () => {
  const g = fixture(); g.set('hub4ModeValue', 2); await sleep(g);
  g.values.enerspotPrices15[0].priceKcMWh = 4000;
  for (let i = 0; i < 5; i++) { await tick(g); advance(g, 10); }
  assert.equal(g.get('hub4ModeValue'), 2);
  assert.equal(g.get('winterControl').phase, 'grace');
  advance(g, 250); await sleep(g);
  for (let i = 0; i < 3; i++) { await tick(g); advance(g, 10); }
  assert.equal(g.get('winterControl').phase, 'asleep');
});
test('emergency 10 to 15 supersedes winter and night, BMS denial never requests Mode1', async () => {
  const g = fixture(); await sleep(g);
  g.values.jkBmsByInstance['1'].soc = 9;
  for (let i = 0; i < 5; i++) { await tick(g); advance(g, 10); }
  assert.equal(g.get('hub4ModeValue'), 1);
  assert.equal(g.get('vebusDesiredMode'), 1);
  g.values.jkBmsByInstance['1'].soc = 15;
  await tick(g);
  assert.equal(g.get('lowSocForceChargeLatch'), false);
  g.values.jkBmsByInstance['1'].soc = 9;
  g.values.jkBmsByInstance['1'].allowCharge = 0;
  await tick(g); assert.notEqual(g.get('vebusDesiredMode'), 1);
});
test('emergency keeps inverter backup available when AC input is explicitly disconnected', async () => {
  const g = fixture(9);
  g.set('vebusActiveInConnected', 0); g.set('vebusActiveInConnectedTs', new Date(g.get('__now')).toISOString());
  await tick(g);
  assert.equal(g.get('lowSocForceChargeLatch'), true);
  assert.equal(g.get('vebusDesiredMode'), 3);
  assert.equal(g.get('victronChargeIntentActive'), false);
});
test('explicitly disconnected BMS cannot authorize emergency charging or winter sleep', async () => {
  const g = fixture(9); g.values.jkBmsByInstance['1'].connected = 0;
  await tick(g); advance(g, 100); await tick(g);
  assert.equal(g.get('jkBmsControlStatus').dataFresh, false);
  assert.notEqual(g.get('vebusDesiredMode'), 1);
  assert.equal(g.get('winterControl').owned, false);
});
test('unacknowledged external entry aborts to restore; restart restores owned settings before normal decisions', async () => {
  const g = fixture(); await sleep(g);
  g.set('automationReady', false);
  await run(cerbo, 'automation_settings_v174', g, { _runtimeInit: true });
  assert.equal(g.get('winterOwnsVebus'), true);
  for (let i = 0; i < 5; i++) { await tick(g); advance(g, 10); }
  assert.equal(g.get('hub4ModeValue'), 1);
  assert.notEqual(g.get('winterControl').phase, 'asleep');
});
test('settings acknowledge only atomic durable save and hydrate zero/false/method/forecast after restart', async () => {
  const g = fixture();
  await run(cerbo, 'automation_settings_v174', g, { _runtimeInit: true });
  const s = { winterModeEnabled: true, chargeBelowFinalPriceKcKwh: 0, cheapPriceBoilerRelayEnabled: false,
    chargeMethod: 'C', cheapestIntervalsCount: 16, solarForecastRoofKwp: 13, forceChargeToSoc: 15 };
  const result = await run(cerbo, 'automation_settings_v174', g, { payload: { action: 'save_settings', settings: s } });
  assert.equal(result.payload.ok, true); assert.equal(result.payload.persistence.ok, true);
  const next = fixture(); next.set('automationDataDir', g.get('automationDataDir'));
  await run(cerbo, 'automation_settings_v174', next, { _runtimeInit: true });
  for (const [k, v] of Object.entries(s)) assert.equal(next.get(k), v, k);
  const invalid = await run(cerbo, 'automation_settings_v174', g, { payload: { settings: { winterSleepSoc: 'oops' } } });
  assert.equal(invalid.statusCode, 400);
  const unknown = await run(cerbo, 'automation_settings_v174', g, { payload: { settings: { nodeRedMustNotWriteSettingsEss: false } } });
  assert.equal(unknown.statusCode, 400);
});
test('real legacy startup cannot reset durable settings and disk failure cannot acknowledge a save', async () => {
  const g = fixture();
  const boot = await run(cerbo, '3a4bfaa60e6694e1', g);
  assert.equal(boot._runtimeInit, true);
  await run(cerbo, 'automation_settings_v174', g, boot);
  assert.equal(g.get('automationReady'), true);
  const saved = await run(cerbo, 'automation_settings_v174', g, { payload: { settings: { winterSleepSoc: 23, chargeMethod: 'C', forceChargeToSoc: 15, solaxChargeBelowFinalPriceKcKwh: -7 } } });
  assert.equal(saved.statusCode, 200);
  const reboot = await run(cerbo, '3a4bfaa60e6694e1', g);
  await run(cerbo, 'automation_settings_v174', g, reboot);
  assert.equal(g.get('winterSleepSoc'), 23); assert.equal(g.get('forceChargeToSoc'), 15);
  const blocker = path.join(g.get('automationDataDir'), 'not-a-directory'); fs.writeFileSync(blocker, 'fixture');
  g.set('automationDataDir', blocker);
  const failed = await run(cerbo, 'automation_settings_v174', g, { payload: { settings: { winterSleepSoc: 22 } } });
  assert.equal(failed.statusCode, 500); assert.equal(failed.payload.ok, false); assert.equal(g.get('winterSleepSoc'), 23);
});
test('dashboard save reaches durable Cerbo route and Proxmox changes only after disk acknowledgement', async () => {
  const g = fixture(); await run(cerbo, 'automation_settings_v174', g, { _runtimeInit: true });
  const pg = fixture(); pg.set('winterSleepSoc', 25);
  const request = await run(prox, 'prox_dash_send_fn_v131', pg, { payload: { action: 'save_settings', settings: { winterSleepSoc: 22 } } });
  assert.equal(pg.get('winterSleepSoc'), 25);
  const routed = await run(cerbo, 'v139_dashboard_command_handler', g, request);
  const answer = await run(cerbo, 'automation_settings_v174', g, routed[3]);
  assert.equal(answer.statusCode, 200);
  await run(prox, 'prox_command_status_v131', pg, answer);
  assert.equal(pg.get('winterSleepSoc'), 22);
  await run(prox, 'prox_command_status_v131', pg, { statusCode: 500, payload: { ok: false, action: 'save_settings', saved: { winterSleepSoc: 99 } } });
  assert.equal(pg.get('winterSleepSoc'), 22);
});
test('writer rejects non-emergency Mode1 requests from alternate callers', async () => {
  const g = fixture(); await tick(g);
  const result = await run(cerbo, 'e454e2f6f17be356', g, { topic: 'dashboard manual command', payload: { path: 'Mode', value: 1 } });
  assert.equal(result, null);
});
test('planner B honors reached tiers; planner C uses Prague days, stable ties and all DST intervals', async () => {
  const g = fixture(75, 4);
  g.set('chargeMethod', 'B');
  for (const [i, price, soc] of [[1,4.9,60],[2,4,80],[3,3.5,90],[4,3,95],[5,2,100]]) {
    g.set('chargeTier'+i+'Price', price); g.set('chargeTier'+i+'Soc', soc);
  }
  await run(cerbo, '252b7ebcd48a5c07', g);
  assert.equal(g.get('chargePlan').current.targetSoc, 80);
  g.values.jkBmsByInstance['1'].soc = 80;
  await run(cerbo, '252b7ebcd48a5c07', g);
  assert.equal(g.get('chargePlan').current.eligible, false);
  g.set('chargeMethod', 'C'); g.set('cheapestIntervalsCount', 2);
  const start = Date.parse('2026-10-24T22:00:00Z');
  g.set('enerspotPrices15', Array.from({ length: 100 }, (_, i) => ({ datetime: new Date(start+i*900000).toISOString(), priceKcMWh: 1000 })));
  g.set('__now', start); g.set('enerspotLastFetchTs', new Date(start).toISOString());
  g.values.jkBmsByInstance['1'].ts = new Date(start).toISOString();
  await run(cerbo, '252b7ebcd48a5c07', g);
  const plan = g.get('chargePlan');
  assert.equal(plan.days[0].availableIntervals, 100);
  assert.equal(plan.intervals.filter(p => p.selected).length, 2);
  assert.equal(plan.current.selected, true);
});
test('Proxmox diagnostics persist bounded redacted events and download survives a new context', async () => {
  const g = fixture();
  const secret = 'SYNTHETIC_SECRET_MUST_NOT_APPEAR';
  await run(prox, 'diagnostics_store_v174', g, { payload: { bridge: { online: true },
    settings: { discordToken: secret }, raw: { Authorization: secret }, victron: { mode: 3 },
    solax: { modbus: { events: [{ address: 0, value: secret, text: 'Heslo R0='+secret }] } },
    error: { message: 'Bearer '+secret } } });
  const out = await run(prox, 'diagnostics_download_v174', g, { payload: { action: 'diagnostics_download' } });
  assert.equal(out.statusCode, 200);
  const serialized = typeof out.payload === 'string' ? out.payload : JSON.stringify(out.payload);
  assert.ok(!serialized.includes(secret));
  assert.ok(serialized.includes('victron'));
  assert.ok(g.get('diagnosticsStatus').ok);
});
test('diagnostics rotate at 1 MiB without exceeding four files', async () => {
  const g = fixture(), ctx = store();
  for (const name of ['events.jsonl', 'events.1.jsonl', 'events.2.jsonl', 'events.3.jsonl']) {
    const record = '{"old":true}\n';
    fs.writeFileSync(path.join(g.get('automationDataDir'), name), record.repeat(Math.floor(1048576 / Buffer.byteLength(record))));
  }
  await run(prox, 'diagnostics_store_v174', g, { payload: { bridge: { online: false }, event: { type: 'test-rotation' } } }, ctx);
  const files = fs.readdirSync(g.get('automationDataDir')).filter(f => /^events.*jsonl$/.test(f));
  assert.equal(files.length, 4);
  assert.ok(files.every(f => fs.statSync(path.join(g.get('automationDataDir'), f)).size <= 1048576));
  assert.ok(fs.readFileSync(path.join(g.get('automationDataDir'), 'events.jsonl'), 'utf8').includes('test-rotation'));
});
test('oversized diagnostics become a bounded marker rather than breaking the storage limit', async () => {
  const g = fixture();
  await run(prox, 'diagnostics_store_v174', g, { payload: { victron: { details: Array(320).fill('x'.repeat(2000)) } } });
  const record = fs.readFileSync(path.join(g.get('automationDataDir'), 'events.jsonl'), 'utf8');
  assert.ok(Buffer.byteLength(record) <= 128 * 1024);
  assert.equal(JSON.parse(record).type, 'snapshot-size-limit');
});
module.exports = { run, fixture, store, tick, advance, acknowledge, cerbo, prox };
