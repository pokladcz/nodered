if (context.get('busy')) return [null, null];
context.set('busy', true);
const now = Date.now(), ts = new Date().toISOString();
let s = { ...(global.get('winterRuntime') || { version: 174, phase: 'awake', owned: false, highSeen: false }) };
const before = JSON.stringify(s);
const writes = [];
let modeMsg = null;
let reason = '';
const d = global.get('lastDecisionSummary') || {};
const price = d.priceKnown === true ? finite(d.finalPriceKwh) : null;
const limit = finite(global.get('winterWakePriceKcKwh')) ?? 4.9;
const high = price !== null && price > limit;
const low = price !== null && price < limit;
const edge = low && s.highSeen === true;
if (high) s.highSeen = true;
if (low) s.highSeen = false;
const managerFresh = fresh(d.ts, 20000);
const enabled = global.get('winterModeEnabled') === true && global.get('autoModeEnabled') !== false && global.get('safeMode') !== true;
const emergency = global.get('lowSocForceChargeLatch') === true;
const inputLost = fresh(global.get('vebusActiveInConnectedTs')) && finite(global.get('vebusActiveInConnected')) === 0;
const override = !enabled || emergency || global.get('manualChargeEnabled') === true || !managerFresh || d.bmsFresh !== true || d.allowDischarge !== true || inputLost;
const chargingKnown = d.batteryPowerFresh === true && finite(d.batteryPowerW) !== null;
const charging = chargingKnown && d.batteryPowerW >= (finite(global.get('winterChargePowerW')) ?? 50);
const lowSoc = finite(d.soc) !== null && d.soc <= (finite(global.get('winterSleepSoc')) ?? 25);
const inst = s.owned ? s.instance : String(global.get('vebusInstance') || '');
const row = (global.get('vebusByInstance') || {})[inst];
const portal = s.owned ? s.portal : String(row?.portal || global.get('vebusPortalIdDetected') || global.get('venusPortalId') || '');
const sameTarget = row?.portal === portal && String(global.get('vebusFeedbackInstance') || '') === inst;
const feedback = key => {
  const v = row?.values?.[key];
  return sameTarget && v && fresh(v.ts) ? finite(v.num) : null;
};
const hubMode = global.get('hub4ModePortal') === portal && fresh(global.get('hub4ModeTs')) ? finite(global.get('hub4ModeValue')) : null;
const switchMode = sameTarget && fresh(global.get('victronActualModeTs')) ? finite(global.get('vebusActualModeValue')) : null;
const feed = feedback('Hub4/DisableFeedIn'), charge = feedback('Hub4/DisableCharge');
function stage(phase) { s.phase = phase; s.since = now; s.lastWrite = 0; }
function write(service, key, value) {
  const allowed = service === 'settings' ? key === 'Settings/CGwacs/Hub4Mode' && [1, 2, 3].includes(value) : ['Hub4/DisableFeedIn', 'Hub4/DisableCharge'].includes(key) && [0, 1].includes(value);
  if (!allowed || !/^[a-zA-Z0-9_-]+$/.test(portal) || !/^\d+$/.test(inst)) throw new Error('Neplatny zimni MQTT cil');
  writes.push({ topic: 'W/' + portal + '/' + service + '/' + (service === 'settings' ? '0' : inst) + '/' + key, payload: { value }, qos: '1', retain: false });
}
function readback() {
  if (!portal || !inst) return;
  for (const [service, instance, key] of [['settings', '0', 'Settings/CGwacs/Hub4Mode'], ['vebus', inst, 'Hub4/DisableFeedIn'], ['vebus', inst, 'Hub4/DisableCharge'], ['vebus', inst, 'Mode']]) {
    writes.push({ topic: 'R/' + portal + '/' + service + '/' + instance + '/' + key, payload: '' });
  }
}
try {
  if (!global.get('automationReady')) {
    reason = 'Zimni rezim ceka na uloziste; zadny External zapis';
    // If startup failed, never clear an existing ownership lease.
    global.set('winterOwnsVebus', s.owned === true || global.get('winterOwnsVebus') === true);
    return [null, null];
  }
  if (s.owned && (override || (edge && s.phase !== 'restoring'))) {
    if (s.phase !== 'restoring') { stage('restoring'); s.restoreNext = edge && !override ? 'grace' : 'awake'; }
  }
  if (s.owned && s.phase !== 'asleep' && s.phase !== 'restoring' && now - s.since > 60000) {
    s.fault = 'Zimni prechod nepotvrzen do 60 s'; stage('restoring'); s.restoreNext = 'awake';
  }
  if (s.phase === 'grace' && now >= s.graceUntil) stage('awake');
  if (!s.owned && s.phase === 'awake') {
    if (override || !lowSoc || !chargingKnown || charging) s.noChargeSince = 0;
    else if (!s.noChargeSince) s.noChargeSince = now;
    if (!override && !s.fault && s.noChargeSince && now - s.noChargeSince >= (finite(global.get('winterNoChargeSec')) ?? 60) * 1000) {
      if ([1, 2].includes(hubMode) && feed === 0 && charge === 0 && sameTarget && switchMode !== null) {
        s = { ...s, version: 174, owned: true, portal, instance: inst, originalMode: hubMode, originalFeed: 0, originalCharge: 0, noChargeSince: 0 };
        stage('entering');
      } else reason = 'Chybi cerstve Optimized/Mode/Hub4 potvrzeni nebo cizi blokovaci flagy';
    }
  }
  const retry = now - (s.lastWrite || 0) >= 10000;
  if (s.owned && s.phase === 'entering') {
    reason = 'Priprava Passthru: cekam na Mode3 a oba Hub4 flagy';
    if (switchMode === 3 && feed === 1 && charge === 1) stage('external');
    else if (retry) {
      modeMsg = { topic: 'winter coordinated Mode3', payload: { path: 'Mode', value: 3, instance: inst }, _winterMode: true };
      if (switchMode === 3) { if (feed !== 1) write('vebus', 'Hub4/DisableFeedIn', 1); if (charge !== 1) write('vebus', 'Hub4/DisableCharge', 1); }
      s.lastWrite = now;
    }
  }
  if (s.owned && s.phase === 'external') {
    reason = 'Cekam na potvrzeni External control a obou bloku';
    if (hubMode === 3 && feed === 1 && charge === 1 && switchMode === 3) stage('asleep');
    else if (retry && feed === 1 && charge === 1 && switchMode === 3) { write('settings', 'Settings/CGwacs/Hub4Mode', 3); s.lastWrite = now; }
  }
  if (s.owned && s.phase === 'asleep') {
    reason = 'Zimni spanek; cekam na novou hranu ceny nad -> pod limit';
    if (hubMode !== 3 || feed !== 1 || charge !== 1 || switchMode !== 3) {
      s.fault = 'Zimni spanek ztratil cerstve potvrzeni'; stage('restoring'); s.restoreNext = 'awake';
    }
  }
  if (s.owned && s.phase === 'restoring') {
    reason = emergency ? 'Obnova Optimized pred nouzovym nabijenim' : 'Obnova puvodniho Optimized a vlastnich flagu';
    if (hubMode === s.originalMode && feed === s.originalFeed && charge === s.originalCharge) {
      s.owned = false;
      const next = s.restoreNext || 'awake'; stage(next);
      s.graceUntil = next === 'grace' ? now + (finite(global.get('winterWakeGraceSec')) ?? 180) * 1000 : 0;
      s.noChargeSince = 0;
    } else if (retry) {
      // Never release inhibit flags before native ESS control is acknowledged.
      if (hubMode !== s.originalMode) write('settings', 'Settings/CGwacs/Hub4Mode', s.originalMode);
      else { if (feed !== s.originalFeed) write('vebus', 'Hub4/DisableFeedIn', s.originalFeed); if (charge !== s.originalCharge) write('vebus', 'Hub4/DisableCharge', s.originalCharge); }
      s.lastWrite = now;
    }
  }
  if (s.owned && retry) readback();
  // Persist ownership BEFORE publishing the first hardware change.
  if (JSON.stringify(s) !== before) await writeRecord('winter.json', s);
  global.set('winterRuntime', s);
  global.set('winterOwnsVebus', s.owned === true);
  return [writes.length ? writes : null, modeMsg];
} catch (error) {
  global.set('winterOwnsVebus', s.owned === true);
  global.set('winterFault', 'Zimni uloziste/rizeni selhalo: ' + (error.code || error.message));
  node.error('Zimni rizeni selhalo: ' + (error.code || error.message));
  return [null, null];
} finally {
  global.set('winterControl', { ts, enabled, phase: s.phase, owned: s.owned === true, confirmed: s.phase === 'asleep' && hubMode === 3 && feed === 1 && charge === 1 && switchMode === 3,
    reason, fault: s.fault || global.get('winterFault') || null, price, wakeLimit: limit, priceEdge: edge,
    charging: chargingKnown ? charging : null, batteryPowerW: chargingKnown ? d.batteryPowerW : null,
    soc: finite(d.soc), graceUntil: s.graceUntil || null, originalMode: s.originalMode || null });
  context.set('busy', false);
}
