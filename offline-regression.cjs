const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const root = __dirname + '/';
const prox = JSON.parse(fs.readFileSync(root + 'Proxmox_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json', 'utf8'));
const cerbo = JSON.parse(fs.readFileSync(root + 'Cerbo_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json', 'utf8'));
const ids = ['692655268340957204', '1550470058139062405'];
function store(initial = {}) {
  return { values: structuredClone(initial), get(k) { return this.values[k]; }, set(k, v) { this.values[k] = v; } };
}
function run(nodes, id, msg = {}, global = store(), flow = store(), context = store()) {
  const node = nodes.find(n => n.id === id);
  assert.ok(node, id);
  // Node-RED exposes context in the outer sandbox; user code may shadow it.
  const fixed = global.get('__testNow');
  const TestDate = fixed ? class extends Date {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return new Date(fixed).getTime(); }
  } : Date;
  const fn = new Function('global', 'flow', 'context', 'node', 'Date', 'return function(msg) {\n' + node.func + '\n};');
  return fn(global, flow, context, { status() {}, warn() {}, error() {}, send() {} }, TestDate)(msg);
}
test('both flow graphs have unique IDs, resolvable wires, and compilable functions', () => {
  for (const nodes of [prox, cerbo]) {
    assert.equal(new Set(nodes.map(n => n.id)).size, nodes.length);
    for (const n of nodes) {
      for (const group of n.wires || []) for (const target of group) assert.ok(nodes.some(x => x.id === target), `${n.id} -> ${target}`);
      if (n.type === 'function') {
        assert.doesNotThrow(() => new Function('global', 'flow', 'context', 'node',
          'return function(msg) {\n' + n.func + '\n};'), n.id);
      }
    }
  }
});
test('update gate accepts all 2xx including empty 204 and blocks errors/non-success', () => {
  for (const statusCode of [200, 201, 202, 204, 299, '204']) {
    const g = store();
    const out = run(prox, 'update_notify_cerbo', { statusCode, payload: '' }, g);
    assert.ok(out[0], String(statusCode));
    assert.equal(g.get('discord_notify_update_done'), true);
  }
  for (const msg of [{}, { statusCode: 0 }, { statusCode: 302 }, { statusCode: 400 }, { statusCode: 500 }, { statusCode: 'ENOTFOUND' }, { statusCode: 204, error: { message: 'timeout' } }]) {
    const g = store({ discord_notify_update_done: true });
    const out = run(prox, 'update_notify_cerbo', { payload: 'truthy body', ...msg }, g);
    assert.equal(out[0], null);
    assert.equal(g.get('discord_notify_update_done'), false);
    assert.ok(out[1].payload);
  }
});
test('strict text sender authorization preserves all informational commands', () => {
  const commands = ['!auto', '!inv', '!ess', '!stop', '!update', '!limit 1,5', '!solaxlimit 2.5'];
  for (const relay of [1, 2]) for (const mode of ['on', 'off', 'auto']) commands.push(`!rele${relay} ${mode}`);
  for (const payload of commands) {
    for (const id of ids) assert.ok(run(prox, '0a72e3abad5c8d2d', { payload, author: { id } })[payload === '!update' ? 2 : 1]);
    for (const author of [undefined, {}, { id: '999' }, { id: Number(ids[0]) }, { id: ids[0] + ' ' }]) {
      const out = run(prox, '0a72e3abad5c8d2d', { payload, author, user: { id: ids[0] }, member: { user: { id: ids[0] } } });
      assert.deepEqual(out.slice(1), [null, null]);
    }
  }
  for (const payload of ['!status', '!bms', '!graf', '!panel', '!ceny', '!help', '!prikazy']) {
    const out = run(prox, '0a72e3abad5c8d2d', { payload, author: { id: '999' } });
    assert.ok(out[0]);
    assert.deepEqual(out.slice(1), [null, null]);
  }
  assert.equal(run(prox, '0a72e3abad5c8d2d', { payload: '!auto', author: { id: ids[0], bot: true } }), null);
});
test('buttons use clicking user only, keep info public, and acknowledge deferred interaction', () => {
  assert.equal(prox.find(n => n.id === 'int_listener').responseType, 'reply');
  assert.equal(prox.find(n => n.id === 'int_listener').interactionType, 'button');
  const commands = ['cmd_auto', 'cmd_ess', 'cmd_stop', 'cmd_rele1_on', 'cmd_rele1_auto', 'cmd_rele2_on', 'cmd_rele2_auto', 'cmd_update'];
  for (const customId of commands) {
    for (const id of ids) {
      const out = run(prox, 'int_router', { payload: { id: 'interaction-id', customId, user: { id }, member: { user: { id: '999' } } } });
      assert.ok(out[customId === 'cmd_update' ? 2 : 1]);
      assert.equal(out[0].interactionId, 'interaction-id');
      assert.equal(out[0].action, 'edit');
    }
    for (const user of [undefined, {}, { id: '999' }, { id: Number(ids[0]) }]) {
      const out = run(prox, 'int_router', { payload: { id: 'interaction-id', customId, user, member: { user: { id: ids[0] } }, message: { author: { id: ids[0] } } } });
      assert.deepEqual(out.slice(1), [null, null, null]);
      assert.equal(out[0].interactionId, 'interaction-id');
    }
  }
  for (const customId of ['cmd_status', 'cmd_graf']) {
    const out = run(prox, 'int_router', { payload: { id: 'interaction-id', customId, user: { id: '999' } } });
    assert.ok(out[3]);
    assert.deepEqual(out.slice(1, 3), [null, null]);
  }
  assert.deepEqual(run(prox, 'int_router', {}), [null, null, null, null]);
});
test('graphs preserve a complete URL and all points outside Discord content limit', () => {
  const chartData = { labels: [], soc: [], pv: [], load: [] };
  const prices = [];
  for (let i = 0; i < 192; i++) {
    chartData.labels.push(`${Math.floor(i / 4)}:${(i % 4) * 15}`);
    chartData.soc.push(80); chartData.pv.push(12345); chartData.load.push(2345);
    prices.push({ datetime: new Date(Date.UTC(2026, 9, 7, 22, i * 15)).toISOString(), finalKcKwh: i === 0 ? 0 : 2 });
  }
  const g = store({ __testNow: '2026-10-08T07:00:00Z', daily_chart_data: chartData, enerspotPrices15: prices });
  for (const [raw, expected] of [[run(prox, '6539e707c2443a77', {}, g), 192], [run(prox, '0a72e3abad5c8d2d', { payload: '!graf' }, g)[0], 96]]) {
    const out = run(prox, 'discord_chart_format', raw);
    assert.ok(out.payload.length <= 2000);
    assert.equal(out.attachments.length, 1);
    const config = JSON.parse(new URL(out.attachments[0]).searchParams.get('c'));
    assert.equal(config.data.labels.length, expected);
    for (const series of config.data.datasets) assert.equal(series.data.length, expected);
  }
  const priceOut = run(prox, 'discord_chart_format', run(prox, '0a72e3abad5c8d2d', { payload: '!graf' }, g)[0]);
  assert.equal(JSON.parse(new URL(priceOut.attachments[0]).searchParams.get('c')).data.datasets[0].data[0], 0);
  assert.equal(g.get('daily_chart_data').labels.length, 0);
  for (const id of ['6539e707c2443a77', '0a72e3abad5c8d2d']) assert.deepEqual(prox.find(n => n.id === id).wires[0], ['discord_chart_format']);
});
function energyState(soc = 80, price = 3) {
  const now = new Date().toISOString();
  return store({ jkBmsByInstance: { '1': { ts: now, soc, voltage: 52, current: 0, power: 0, connected: 1, allowCharge: 1, allowDischarge: 1, maxChargeA: 40 } },
    enerspotPrices15: [{ datetime: now, datetimeTo: new Date(Date.now() + 900000).toISOString(), priceKcMWh: price * 1000 + 300, finalKcKwh: price }],
    enerspotLastFetchTs: now, enerspotLastFetchOk: true, houseLoadW: 1000, chargeBelowFinalPriceKcKwh: 1 });
}
test('Cerbo price calculation, high price, overload hold/return, and low-SOC latch', () => {
  const g = energyState();
  run(cerbo, '252b7ebcd48a5c07', {}, g);
  assert.equal(g.get('lastDecisionSummary').finalPriceKwh, 3);
  assert.equal(g.get('vebusDesiredMode'), 2);
  g.set('houseLoadW', 7000);
  run(cerbo, '252b7ebcd48a5c07', {}, g);
  assert.equal(g.get('vebusDesiredMode'), 3);
  g.set('houseLoadW', 1000);
  run(cerbo, '252b7ebcd48a5c07', {}, g);
  assert.equal(g.get('vebusDesiredMode'), 3);
  g.set('overloadEssHoldUntilMs', Date.now() - 1);
  run(cerbo, '252b7ebcd48a5c07', {}, g);
  assert.equal(g.get('vebusDesiredMode'), 2);
  const low = energyState(5);
  run(cerbo, '252b7ebcd48a5c07', {}, low);
  assert.equal(low.get('vebusDesiredMode'), 1);
  low.set('vebusInstance', 'test-instance');
  const out = run(cerbo, 'd4ac0d33a81d4bcc', {}, low);
  assert.equal(out[0].payload.value, 1);
  assert.equal(low.get('vebusChargeControl').managerStale, false);
  low.values.jkBmsByInstance['1'].soc = 25;
  run(cerbo, '252b7ebcd48a5c07', {}, low);
  assert.equal(low.get('lowSocForceChargeLatch'), false);
});
test('Proxmox price parser passes spot minus fee to Cerbo command handler', () => {
  const g = store({ processFeeCzkMWh: 300 });
  const msg = run(prox, 'prox_enerspot_parse', { statusCode: 200, payload: [{ datetime: new Date().toISOString(), priceKcMWh: 1000 }] }, g);
  assert.equal(msg.payload.prices[0].finalKcKwh, 0.7);
  const target = store();
  const out = run(cerbo, 'v139_dashboard_command_handler', msg, target);
  assert.equal(out[0].payload.ok, true);
  assert.equal(target.get('enerspotPrices15')[0].finalKcKwh, 0.7);
  assert.equal(target.get('enerspotLastFetchOk'), true);
});
module.exports = { run, store, energyState, prox, cerbo };
test('download gate stops invalid Cerbo flow responses and matches bridge protocol', () => {
  for (const msg of [{ statusCode: 404, payload: cerbo }, { statusCode: 200, payload: {} }, { statusCode: 200, payload: [] }, { statusCode: 200, payload: [null] }, { statusCode: 200, payload: cerbo, error: 'timeout' }]) {
    assert.equal(run(prox, 'update_prep_cerbo', msg)[0], null);
  }
  for (const [settings, expected] of [[{}, 'https://192.168.0.124:1881/flows'], [{ cerboPort: 1880 }, 'http://192.168.0.124:1880/flows'], [{ cerboProtocol: 'http', cerboHost: 'test-host', cerboPort: 1234 }, 'http://test-host:1234/flows']]) {
    const out = run(prox, 'update_prep_cerbo', { statusCode: 200, payload: cerbo }, store(settings));
    assert.equal(out[0].url, expected);
    assert.equal(out[1], null);
  }
});
test('watchdog rejects stale manager/BMS, denied charge, zero CCL, and safe mode', () => {
  for (const mutate of [g => g.values.lastDecisionSummary.ts = '2000-01-01', g => g.values.jkBmsControlStatus.ts = '2000-01-01', g => g.values.jkBmsControlStatus.chargeAllowed = false, g => g.values.jkBmsControlStatus.maxChargeA = 0, g => g.set('safeMode', true)]) {
    const g = energyState(5);
    run(cerbo, '252b7ebcd48a5c07', {}, g);
    mutate(g);
    const out = run(cerbo, 'd4ac0d33a81d4bcc', {}, g);
    assert.notEqual(out[0].payload.value, 1);
  }
});
test('VE.Bus writer emits only Mode and readbacks, suppresses duplicates and non-Mode writes', () => {
  const g = store({ venusPortalId: 'synthetic-portal', vebusInstance: 'synthetic-instance' });
  const msg = { payload: { path: 'Mode', value: 2 } };
  const out = run(cerbo, 'e454e2f6f17be356', msg, g);
  assert.equal(out[0][0].topic, 'W/synthetic-portal/vebus/synthetic-instance/Mode');
  assert.equal(out[0][0].payload.value, 2);
  assert.equal(out[0].length, 5);
  assert.ok(out[0].slice(1).every(m => m.topic.startsWith('R/')));
  assert.equal(run(cerbo, 'e454e2f6f17be356', msg, g), null);
  assert.equal(run(cerbo, 'e454e2f6f17be356', { payload: { path: 'Other', value: 1 } }, g), null);
});
test('authorized Discord controls reach Cerbo through the existing command bridge', () => {
  for (const [command, expected] of [['!inv', 2], ['!ess', 3]]) {
    const routed = run(prox, '0a72e3abad5c8d2d', { payload: command, author: { id: ids[0] } });
    const prepared = run(prox, 'prox_dash_send_fn_v131', routed[1]);
    const g = store();
    const out = run(cerbo, 'v139_dashboard_command_handler', prepared, g);
    assert.equal(out[0].payload.ok, true);
    assert.equal(out[1].payload.value, expected);
  }
});
test('Relay2 preserves SOC hysteresis and blocks missing BMS/safe mode in automatic controller', () => {
  const g = energyState(92);
  assert.equal(run(cerbo, 'cf8f5daf57e22e76', {}, g).payload, 1);
  g.values.jkBmsByInstance['1'].soc = 90;
  assert.equal(run(cerbo, 'cf8f5daf57e22e76', {}, g).payload, 1);
  g.values.jkBmsByInstance['1'].soc = 88;
  assert.equal(run(cerbo, 'cf8f5daf57e22e76', {}, g).payload, 0);
  g.values.jkBmsByInstance['1'].soc = 92;
  g.set('safeMode', true);
  assert.equal(run(cerbo, 'cf8f5daf57e22e76', {}, g).payload, 0);
  g.set('safeMode', false);
  g.values.jkBmsByInstance['1'].ts = '2000-01-01';
  assert.equal(run(cerbo, 'cf8f5daf57e22e76', {}, g).payload, 0);
});
test('dashboard fallback subtracts fee and publishes source timestamp and zero temperature', () => {
  const now = new Date().toISOString();
  const g = store({ processFeeCzkMWh: 300, enerspotPrices15: [{ datetime: now, priceKcMWh: 1000 }] });
  run(prox, 'prox_poll_route_v131', { statusCode: 200, payload: { ok: true, ts: now, battery: { tempC: 0 } } }, g);
  assert.equal(g.get('latest_telemetry').currentPrice.final, 0.7);
  assert.equal(g.get('latest_telemetry').ts, now);
  assert.equal(g.get('latest_telemetry').batteryTempC, 0);
});
test('Discord status distinguishes missing numbers and relays from real zero/OFF', () => {
  const g = store({ latest_telemetry: { soc: null, grid: null, load: null, pvPower: null, cerboRelay1Actual: null, cerboRelay2Actual: 0, currentPrice: { final: null } } });
  const out = run(prox, '0a72e3abad5c8d2d', { payload: '!status' }, g)[0];
  assert.match(out.payload, /Baterie:\*\* —/);
  assert.match(out.payload, /Výroba FV:\*\* —/);
  assert.match(out.payload, /Relé 1.*Neznámý/);
  assert.match(out.payload, /Relé 2.*VYPNUTO/);
  const bms = run(prox, '0a72e3abad5c8d2d', { payload: '!bms' }, store({ latest_telemetry: { batteryTempC: 0, temp: 99 } }))[0];
  assert.match(bms.payload, /Teplota: 0,0/);
});
test('limit syntax rejects missing, nondecimal, extra and out-of-range values without actions', () => {
  for (const command of ['!limit', '!solaxlimit']) {
    for (const value of ['', 'abc', '0x10', 'Infinity', '11', '-51', '1 extra', '1,2,3']) {
      const out = run(prox, '0a72e3abad5c8d2d', { payload: command + ' ' + value, author: { id: ids[0] } });
      assert.ok(out[0]);
      assert.match(out[0].payload, /Neplatný limit/);
      assert.deepEqual(out.slice(1), [null, null]);
    }
    for (const value of ['0', '-50', '10', '1,5']) assert.ok(run(prox, '0a72e3abad5c8d2d', { payload: command + ' ' + value, author: { id: ids[0] } })[1]);
  }
});
test('morning report retains zero limit and uses Prague day instead of host day', () => {
  const g = store({ __testNow: '2026-10-07T22:10:00Z', chargeBelowFinalPriceKcKwh: 0, enerspotPrices15: [
    { datetime: '2026-10-07T22:15:00Z', finalKcKwh: 0.5 }, { datetime: '2026-10-07T22:30:00Z', finalKcKwh: 0 }
  ] });
  const out = run(prox, '17fa2b0f4f9548af', {}, g);
  assert.match(out.payload, /limit \(0 Kč\).*00:30/);
});
test('Prague chart and price grouping includes year and handles DST day boundaries', () => {
  const g = store({ __testNow: '2026-10-25T00:30:00Z', enerspotPrices15: [
    { datetime: '2025-10-25T08:00:00Z', finalKcKwh: -99 },
    { datetime: '2026-10-24T22:00:00Z', finalKcKwh: 0 },
    { datetime: '2026-10-25T22:45:00Z', finalKcKwh: 2 },
    { datetime: '2026-10-25T23:00:00Z', finalKcKwh: 4 }
  ] });
  const graph = run(prox, 'discord_chart_format', run(prox, '0a72e3abad5c8d2d', { payload: '!graf' }, g)[0]);
  assert.deepEqual(JSON.parse(new URL(graph.attachments[0]).searchParams.get('c')).data.datasets[0].data, [0, 2]);
  const prices = run(prox, '0a72e3abad5c8d2d', { payload: '!ceny' }, g)[0];
  assert.ok(!prices.payload.includes('-99'));
  assert.match(prices.payload, /ZÍTŘEK.*26\.10/);
  assert.match(prices.payload, /Min: 4\.00/);
});
test('outage transitions use actual telemetry keys and ignore failed bridge polls', () => {
  const g = store({ latest_telemetry: { activeInConnected: 1, load: 1000 } });
  const ctx = store();
  assert.equal(run(prox, '3854ea343df02d3d', {}, g, store(), ctx), null);
  g.set('latest_telemetry', { _bridgeError: true, activeInConnected: 0 });
  assert.equal(run(prox, '3854ea343df02d3d', {}, g, store(), ctx), null);
  g.set('latest_telemetry', { activeInConnected: 0, load: 7000 });
  const alert = run(prox, '3854ea343df02d3d', {}, g, store(), ctx);
  assert.match(alert.payload, /odpojen/);
  assert.match(alert.payload, /7000/);
  assert.equal(run(prox, '3854ea343df02d3d', {}, g, store(), ctx), null);
});
test('watchdog handles source timestamps and reports failures without claiming PV-only operation', () => {
  const g = store({ latest_telemetry: { ts: new Date().toISOString(), priceStatus: { ok: false, ageMin: 181 }, solaxDashboard: { ok: false, ageMin: 61 } } });
  const out = run(prox, 'sys_watchdog_v1', {}, g);
  assert.equal(out[0].length, 2);
  assert.ok(!JSON.stringify(out).includes('čistě solární'));
  const failed = run(prox, 'sys_watchdog_v1', {}, store({ latest_telemetry: { _bridgeError: true } }));
  assert.match(failed[0][0].payload, /CERBO/);
});
test('monthly reports select previous Prague month and preserve source records and archive', () => {
  const stats = [{ date: '30. 9. 2026', yield: 1, import: 2, export: 3, net: 4 }, { date: '1. 10. 2026', yield: 100, import: 100, export: 100, net: 100 }];
  const g = store({ __testNow: '2026-10-01T06:00:00Z', discord_monthly_stats: stats });
  const before = structuredClone(g.get('discord_monthly_stats'));
  const out = run(prox, '5c27a322bc99b435', {}, g);
  assert.match(out.payload, /1\.0 kWh/);
  assert.deepEqual(g.get('discord_monthly_stats'), before);
  assert.equal(g.get('discord_monthly_archive')['2026-09'].length, 1);
  run(prox, '5c27a322bc99b435', {}, g);
  assert.deepEqual(g.get('discord_monthly_stats'), before);
});
test('daily archive is idempotent per Prague date and does not turn absent values into zero', () => {
  const g = store({ __testNow: '2026-09-30T22:10:00Z', latest_telemetry: { solarYield: { todayKwh: 0 }, soldEnergy: { todayKwh: 3, todayKc: 4 } } });
  run(prox, 'e537c26bb1e8cdb0', {}, g);
  run(prox, 'e537c26bb1e8cdb0', {}, g);
  const rows = g.get('discord_monthly_stats');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dateKey, '2026-10-01');
  assert.equal(rows[0].yield, 0);
  assert.equal(rows[0].import, null);
});
test('Proxmox update download gate rejects failures, malformed graphs and bad functions', () => {
  for (const msg of [{ statusCode: 404, payload: prox }, { statusCode: 200, payload: {} }, { statusCode: 200, payload: [] }, { statusCode: 200, payload: [{ id: 'bad', type: 'function', func: '}' }] }, { statusCode: 200, payload: [{ id: 'a', type: 'function', func: '', wires: [['missing']] }] }, { statusCode: 200, payload: prox, error: 'timeout' }]) {
    assert.equal(run(prox, 'update_validate_prox', msg)[0], null);
  }
  assert.ok(run(prox, 'update_validate_prox', { statusCode: 200, payload: prox })[0]);
  assert.deepEqual(prox.find(n => n.id === 'update_fetch_prox').wires[0], ['update_validate_prox']);
});
test('Proxmox deploy response accepts empty 204 but never claims verified version', () => {
  for (const statusCode of [200, 204]) {
    const out = run(prox, 'update_prox_result', { statusCode, payload: '' });
    assert.match(out.payload, /přijalo/);
    assert.ok(!out.payload.includes('nejnovější'));
  }
  const g = store({ discord_notify_update_done: true });
  assert.match(run(prox, 'update_prox_result', { statusCode: 500 }, g).payload, /Chyba/);
  assert.equal(g.get('discord_notify_update_done'), false);
});
test('STOP labels describe manual-charge stop and AUTO while retaining emergency priority', () => {
  const text = run(prox, '0a72e3abad5c8d2d', { payload: '!stop', author: { id: ids[0] } });
  assert.match(text[0].payload, /ruční.*AUTO/);
  assert.equal(text[1].payload.action, 'force_charge_off');
  const button = run(prox, 'int_router', { payload: { id: 'i', customId: 'cmd_stop', user: { id: ids[0] } } });
  assert.match(button[0].payload, /ruční.*AUTO/);
});
