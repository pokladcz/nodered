const assert = require('node:assert/strict');
const { test } = require('node:test');
const { run, fixture, prox, cerbo } = require('./winter-regression.cjs');

test('settings save returns a durable reply on the original API response output', async () => {
  const g = fixture();
  await run(cerbo, 'automation_settings_v174', g, { _runtimeInit: true });
  const result = await run(cerbo, 'v139_dashboard_command_handler', g, {
    payload: { action: 'save_settings', settings: { chargeMethod: 'C' } }
  });
  // Existing installations have three API outputs; saving must not need a new fourth wire.
  const reply = Array.isArray(result) ? result[0] : result;
  assert.equal(reply?.statusCode, 200);
  assert.equal(reply.payload.persistence.ok, true);
  assert.equal(reply.payload.saved.chargeMethod, 'C');
  assert.equal(g.get('chargeMethod'), 'C');
});

test('both settings endpoints share one disk-write lock', async () => {
  const g = fixture();
  await run(cerbo, 'automation_settings_v174', g, { _runtimeInit: true });
  g.set('settingsWriteBusyV174', true);
  for (const id of ['automation_settings_v174', 'v139_dashboard_command_handler']) {
    const result = await run(cerbo, id, g, { payload: { action: 'save_settings', settings: { chargeMethod: 'B' } } });
    const reply = Array.isArray(result) ? result[0] : result;
    assert.equal(reply?.statusCode, 503);
    assert.notEqual(g.get('chargeMethod'), 'B');
  }
});

function component() {
  const source = prox.find(n => n.id === 'b0adaf6e2547060f').format;
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  let now = Date.parse('2026-11-06T20:00:00Z');
  class Clock extends Date { static now() { return now; } }
  const options = new Function('Date', script.replace('export default', 'return'))(Clock);
  const vm = { ...options.data(), send(message) { this.sent = message; } };
  for (const [key, fn] of Object.entries(options.methods)) vm[key] = fn.bind(vm);
  for (const [key, fn] of Object.entries(options.computed)) Object.defineProperty(vm, key, { get: fn.bind(vm) });
  const payload = { cfg: { chargeMethod: 'A', winterModeEnabled: false }, settingsSchema: [
    { key: 'chargeMethod', type: 'select', def: 'A', options: ['A', 'B', 'C'].map(value => ({ value })) },
    { key: 'winterModeEnabled', type: 'bool', def: false }
  ], persistence: { ok: true, ts: '2026-11-06T19:34:00Z' } };
  function receive(p) { vm.msg = { payload: p }; options.watch.msg.handler.call(vm); }
  receive(payload);
  return { vm, payload, receive, advance(seconds) { now += seconds * 1000; } };
}

test('save remains pending and polling cannot discard edited values after five seconds', () => {
  const { vm, payload, receive, advance } = component();
  vm.draft.chargeMethod = 'C'; vm.editing = true; vm.save();
  advance(6);
  receive({ ...payload, cfg: { chargeMethod: 'A', winterModeEnabled: true } });
  assert.equal(vm.draft.chargeMethod, 'C');
  assert.equal(vm.editing, true);
  assert.match(vm.saveInfo, /Čekám/);
});

test('HTTP validation failure stays correlated and reaches the settings form through polling', async () => {
  const g = fixture();
  const request = await run(prox, 'prox_dash_send_fn_v131', g, {
    payload: { action: 'save_settings', requestId: 'save-1', settings: { chargeMethod: 'C' } }
  });
  assert.equal(request._settingsSaveRequestId, 'save-1');
  await run(prox, 'prox_command_status_v131', g, { ...request, statusCode: 400,
    payload: JSON.stringify({ ok: false, text: 'forceChargeToSoc: mimo povoleny rozsah' }) });
  const result = g.get('settingsSaveResult');
  assert.equal(result.requestId, 'save-1'); assert.equal(result.ok, false);
  const poll = await run(prox, 'prox_poll_route_v131', g, { statusCode: 200, payload: {
    ok: true, settings: { chargeMethod: 'A' }, persistence: { ok: true, ts: '2026-11-06T19:34:00Z' }
  } });
  assert.deepEqual(poll[2][0].payload.settingsSaveResult, result);
  assert.equal(poll[2][0].payload.settingsLastSaveTs, '2026-11-06T19:34:00Z');
});

test('API success without durable acknowledgement is not reported as a saved form', async () => {
  const g = fixture();
  const request = await run(prox, 'prox_dash_send_fn_v131', g, {
    payload: { action: 'save_settings', requestId: 'save-2', settings: { chargeMethod: 'C' } }
  });
  await run(prox, 'prox_command_status_v131', g, { ...request, statusCode: 200,
    payload: { ok: true, action: 'save_settings', text: 'Old memory-only reply' } });
  assert.equal(g.get('settingsSaveResult')?.ok, false);
  assert.equal(g.get('settingsLastSaveTs'), undefined);
});

test('inline error preserves the draft and a stale acknowledgement cannot confirm a newer save', () => {
  const { vm, payload, receive } = component();
  vm.draft.chargeMethod = 'C'; vm.editing = true; vm.save();
  const requestId = vm.sent.payload.requestId;
  assert.ok(requestId);
  receive({ ...payload, settingsSaveResult: { requestId: 'unrelated-save', ok: true, savedAt: payload.persistence.ts } });
  assert.equal(vm.editing, true);
  receive({ ...payload, settingsSaveResult: { requestId, ok: false, text: 'HTTP 400: Nouzovy cil musi byt vyssi nez zapinaci SOC' } });
  assert.match(vm.saveInfo, /HTTP 400/); assert.equal(vm.draft.chargeMethod, 'C');
  assert.equal(vm.editing, true);
});

test('success requires the corresponding disk state and a missing reply becomes a visible timeout', () => {
  const { vm, payload, receive, advance } = component();
  vm.draft.chargeMethod = 'C'; vm.editing = true; vm.save();
  const requestId = vm.sent.payload.requestId;
  advance(20); receive(payload);
  assert.match(vm.saveInfo, /potvrzení.*nedorazilo/i);
  assert.equal(vm.draft.chargeMethod, 'C');
  const result = { requestId, ok: true, savedAt: '2026-11-06T20:00:01Z', text: 'Nastaveni potvrzena na disku Cerba' };
  receive({ ...payload, settingsSaveResult: result });
  assert.equal(vm.editing, true);
  receive({ ...payload, cfg: { ...payload.cfg, chargeMethod: 'C' },
    persistence: { ok: true, ts: result.savedAt }, settingsSaveResult: result });
  assert.equal(vm.editing, false); assert.equal(vm.draft.chargeMethod, 'C');
  assert.match(vm.saveInfo, /Uloženo/);
});

test('an older state response cannot roll back an acknowledged draft or its saved time', () => {
  const { vm, payload, receive } = component();
  vm.draft.chargeMethod = 'C'; vm.editing = true; vm.save();
  const result = { requestId: vm.sent.payload.requestId, ok: true, savedAt: '2026-11-06T20:00:01Z' };
  receive({ ...payload, cfg: { ...payload.cfg, chargeMethod: 'C' },
    persistence: { ok: true, ts: result.savedAt }, settingsSaveResult: result });
  const confirmedTime = vm.saveInfo;
  receive(payload);
  assert.equal(vm.draft.chargeMethod, 'C');
  assert.equal(vm.saveInfo, confirmedTime);
});

test('the HTTP save receipt updates the form directly without another state poll', async () => {
  const g = fixture(), { vm, payload, receive } = component();
  await run(prox, 'prox_poll_route_v131', g, { statusCode: 200, payload: {
    ok: true, settings: payload.cfg, settingsSchema: payload.settingsSchema, persistence: payload.persistence
  } });
  vm.draft.chargeMethod = 'C'; vm.editing = true; vm.save();
  const answer = await run(prox, 'prox_command_status_v131', g, {
    _settingsSaveRequestId: vm.sent.payload.requestId, statusCode: 200,
    payload: { ok: true, action: 'save_settings', text: 'Nastaveni potvrzena na disku Cerba',
      saved: { ...payload.cfg, chargeMethod: 'C' }, persistence: { ok: true, ts: '2026-11-06T20:00:01Z' } }
  });
  assert.equal(prox.find(n => n.id === 'prox_command_status_v131').wires[1]?.includes('b0adaf6e2547060f'), true);
  assert.ok(answer[1]?.payload.settingsSaveResult);
  receive(answer[1].payload);
  assert.equal(vm.saveState, 'saved');
  assert.equal(vm.editing, false);
  assert.equal(vm.draft.chargeMethod, 'C');
  assert.match(vm.saveInfo, /Uloženo/);
  assert.equal(vm.schema.length, payload.settingsSchema.length);
});
