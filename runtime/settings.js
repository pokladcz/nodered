/* SETTINGS_SCHEMA is inserted by the flow builder. Only public operational settings belong here. */
function validateSettings(input, base) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('settings musi byt objekt');
  const next = { ...base };
  for (const [key, value] of Object.entries(input)) {
    const field = SETTINGS_SCHEMA.find(f => f.key === key);
    if (!field) throw new Error('Nepovolene nastaveni: ' + key);
    if (field.type === 'bool' && typeof value !== 'boolean') throw new Error(key + ': ocekavana boolean hodnota');
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max)) throw new Error(key + ': mimo povoleny rozsah');
    if (field.type === 'select' && !field.options.some(o => o.value === value)) throw new Error(key + ': nepovolena volba');
    if (field.type === 'text' && (typeof value !== 'string' || value.length > 200)) throw new Error(key + ': neplatny text');
    next[key] = value;
  }
  if (next.forceChargeToSoc <= next.forceChargeBelowSoc) throw new Error('Nouzovy cil musi byt vyssi nez zapinaci SOC');
  return next;
}
const iso = new Date().toISOString();
if (context.get('busy')) {
  msg.statusCode = 503; msg.payload = { ok: false, text: 'Ukladani probiha, opakujte pozdeji' }; return msg;
}
context.set('busy', true);
try {
  if (msg._runtimeInit) {
    global.set('automationReady', false);
    global.set('automationBootTs', iso);
    const defaults = Object.fromEntries(SETTINGS_SCHEMA.map(f => [f.key, f.def]));
    const disk = await readRecord('settings.json');
    if (disk && (disk.version !== 174 || !disk.settings)) throw new Error('Nepodporovany soubor nastaveni');
    const legacy = global.get('settingsStartupProfileV138') || {};
    const initial = disk ? disk.settings : Object.fromEntries(SETTINGS_SCHEMA.filter(f => legacy[f.key] !== undefined).map(f => [f.key, legacy[f.key]]));
    // One explicit emergency policy change; do not silently reapply migrations on every boot.
    if (!disk) { initial.forceChargeBelowSoc = 10; initial.forceChargeToSoc = 15; initial.victronCheapPriceMode = 'ess_surplus'; }
    const settings = validateSettings(initial, defaults);
    if (!disk) await writeRecord('settings.json', { version: 174, savedAt: iso, settings });
    for (const [k, v] of Object.entries(settings)) global.set(k, v);
    global.set('automationSettings', settings);
    global.set('automationSettingsSchema', SETTINGS_SCHEMA);
    const winter = await readRecord('winter.json');
    if (winter && winter.version !== 174) throw new Error('Nepodporovany zimni zaznam');
    if (winter?.owned) {
      if (![1, 2].includes(winter.originalMode) || !/^[a-zA-Z0-9_-]+$/.test(winter.portal) || !/^\d+$/.test(winter.instance)) throw new Error('Neplatny vlastnik zimniho rezimu');
      winter.phase = 'restoring'; winter.restoreNext = 'awake'; winter.since = Date.now(); winter.lastWrite = 0;
    }
    global.set('winterRuntime', winter || { version: 174, phase: 'awake', owned: false, highSeen: false });
    global.set('winterOwnsVebus', winter?.owned === true);
    global.set('automationReady', true);
    global.set('settingsPersistence', { ok: true, loaded: !!disk, ts: iso, storage: 'atomic-file' });
    return null;
  }
  if (!global.get('automationReady')) { msg.statusCode = 503; msg.payload = { ok: false, text: 'Uloziste nastaveni neni pripravene' }; return msg; }
  let body = msg.payload;
  if (typeof body === 'string') body = JSON.parse(body);
  const incoming = body?.settings || body;
  let settings;
  try { settings = validateSettings(incoming, global.get('automationSettings') || {}); }
  catch (error) { msg.statusCode = 400; msg.payload = { ok: false, text: error.message }; return msg; }
  await writeRecord('settings.json', { version: 174, savedAt: iso, settings });
  for (const [k, v] of Object.entries(settings)) global.set(k, v);
  global.set('automationSettings', settings);
  global.set('settingsStartupProfileV138', settings);
  global.set('settingsLastSaveTs', iso);
  const persistence = { ok: true, ts: iso, storage: 'atomic-file' };
  global.set('settingsPersistence', persistence);
  const soc = finite((global.get('lastDecisionSummary') || {}).soc);
  const chargePlan = makePlan(soc);
  global.set('chargePlan', chargePlan);
  msg.statusCode = 200; msg.payload = { ok: true, action: 'save_settings', text: 'Nastaveni potvrzena na disku Cerba', saved: incoming, persistence, chargePlan, ts: iso };
  return msg;
} catch (error) {
  global.set('settingsPersistence', { ok: false, ts: iso, error: error.code || 'INVALID_STORE' });
  node.error('Uloziste nastaveni selhalo: ' + (error.code || 'INVALID_STORE'));
  if (msg._runtimeInit) return null;
  msg.statusCode = 500; msg.payload = { ok: false, text: 'Nastaveni NEBYLA potvrzena na disku', persistence: global.get('settingsPersistence') }; return msg;
} finally {
  context.set('busy', false);
  msg.headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
}
