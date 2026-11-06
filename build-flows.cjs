const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const files = ['Cerbo_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json', 'Proxmox_v166_VICTRON_ESS_JEN_PREBYTKY_FV.json'];
const [cerbo, prox] = files.map(f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')));
const source = name => fs.readFileSync(path.join(root, 'runtime', name + '.js'), 'utf8');
const common = source('common');
const get = (nodes, id) => { const n = nodes.find(n => n.id === id); if (!n) throw new Error('Missing node ' + id); return n; };
function replace(n, old, next) {
  if (!n.func.includes(old)) throw new Error('Expected code missing in ' + n.id + ': ' + old.slice(0, 60));
  n.func = n.func.replace(old, next);
}
const cfg = get(cerbo, '3a4bfaa60e6694e1');
const schemaLine = cfg.func.split('\n').find(l => l.startsWith('const dashboardSettingsSchemaV138 = '));
const schema = JSON.parse(schemaLine.slice('const dashboardSettingsSchemaV138 = '.length).replace(/;$/, ''));
const add = f => { const i = schema.findIndex(x => x.key === f.key); if (i >= 0) schema[i] = { ...schema[i], ...f }; else schema.push(f); };
const number = (key, def, min, max, group, label = key) => add({ key, def, min, max, group, label, step: 0.01, type: 'number' });
add({ key: 'winterModeEnabled', def: false, group: 'Zimni rezim', label: 'Povolit zimni spanek (External control pouze pri spanku)', type: 'bool' });
number('winterSleepSoc', 25, 1, 90, 'Zimni rezim', 'Spat pri SOC do (%) a skutecne nenabijet');
number('winterWakePriceKcKwh', 4.9, -50, 20, 'Zimni rezim', 'Probudit pri nove hrane ceny nad -> pod (Kc/kWh)');
number('winterWakeGraceSec', 180, 30, 1800, 'Zimni rezim', 'Cas na rozbeh nabijeni po probuzeni (s)');
number('winterNoChargeSec', 60, 10, 1800, 'Zimni rezim', 'Potvrzeni bez nabijeni pred spankem (s)');
number('winterChargePowerW', 50, 1, 2000, 'Zimni rezim', 'Minimalni skutecny nabijeci vykon baterie (W)');
add({ key: 'chargeMethod', group: 'Automatika a cena', label: 'Metoda A/B/C', type: 'select', def: 'C', options: ['A', 'B', 'C'].map(value => ({ value, label: value })) });
number('cheapestIntervalsCount', 16, 1, 100, 'Automatika a cena', 'Pocet nejlevnejsich 15min intervalu denne (C)');
number('chargeBelowFinalPriceKcKwh', 4.9, -50, 10, 'Automatika a cena');
number('solaxChargeBelowFinalPriceKcKwh', -7, -50, 10, 'Automatika a cena');
number('forceChargeToSoc', 15, 1, 100, 'Nouzove nabijeni');
number('jkBmsExpectedCount', 2, 1, 8, 'Ridici JK BMS');
number('nightModeStart', 17, 0, 23, 'Nocni rezim'); number('nightModeEnd', 5, 0, 23, 'Nocni rezim');
for (const [key, def] of [['solarForecastSolaxKwp',5], ['solarForecastRoofKwp',10], ['solarForecastGardenKwp',5], ['solarForecastPeakPowerKwp',20]]) number(key, def, 0, 100, 'Solarni predpoved');
add({ key: 'solarForecastEnabled', type: 'bool', def: true, group: 'Solarni predpoved', label: 'Povolit predpoved FV' });
add({ key: 'victronCheapPriceMode', type: 'select', def: 'ess_surplus', options: [{ value: 'ess_surplus', label: 'ESS pouze prebytky FV; sit jen nouzove' }] });
for (const [i, price, soc] of [[1,4.9,60],[2,4,80],[3,3.5,90],[4,3,95],[5,2,100]]) {
  number('chargeTier'+i+'Price', price, -50, 10, 'Metoda B'); number('chargeTier'+i+'Soc', soc, 0, 100, 'Metoda B');
}
for (const key of ['cheapPriceWattrouterEnabled', 'cheapPriceBoilerRelayEnabled', 'solax_control_enabled']) add({ key, type: 'bool', def: key === 'solax_control_enabled', group: 'Levna cena', label: key });
number('solax_charge_current_a', 50, 0, 50, 'SolaX');
for (const key of ['manualRelay1Mode', 'manualRelay2Mode', 'manualShellyMode']) add({ key, group: 'Rucni rele', label: key, type: 'select', def: 'auto', options: ['auto','on','off'].map(value => ({ value, label: value })) });
number('relay1BelowFinalPriceKcKwh',1,-50,10,'Levna cena'); number('relay2BelowFinalPriceKcKwh',1,-50,10,'Levna cena');
number('shellyOffSoc', 95, 0, 100, 'Shelly'); number('spiralOffSoc', 89, 0, 100, 'Spirala');
number('inverterOnlyAt100PctPriceLimitKcKwh',3,-50,20,'Automatika a cena');
add({ key: 'gridShieldEnabled', type: 'bool', def: false, group: 'Sit', label: 'Grid Shield' }); number('gridShieldVoltage',253,240,265,'Sit');
const publicSchema = schema.filter(f => !/token|password|secret|username|credential/i.test(f.key));
const libs = [{ var: 'fs', module: 'fs' }, { var: 'path', module: 'path' }, { var: 'os', module: 'os' }];
function node(nodes, id, name, func, wires, z) {
  let n = nodes.find(n => n.id === id);
  if (!n) { n = { id, type: 'function', z, name, outputs: wires.length, x: 600, y: 1300, noerr: 0, initialize: '', finalize: '', libs }; nodes.push(n); }
  Object.assign(n, { name, func, wires, outputs: wires.length, libs }); return n;
}
node(cerbo, 'automation_settings_v174', 'Durable validated settings v174', common + '\nconst SETTINGS_SCHEMA=' + JSON.stringify(publicSchema) + ';\n' + source('settings'), [['9578e2c0c6c12a25']], cfg.z);
node(cerbo, 'winter_controller_v174', 'Winter acknowledged state machine v174', common + '\n' + source('winter'), [['9cfd8e630da2aae4'], ['e454e2f6f17be356']], get(cerbo,'252b7ebcd48a5c07').z);
if (!cfg.func.includes('automationReady')) cfg.func = "global.set('automationReady',false);global.set('winterOwnsVebus',true);\n" + cfg.func;
cfg.wires = [['automation_settings_v174']];
if (!cfg.func.includes('msg._runtimeInit=true')) replace(cfg, 'return msg;', 'msg._runtimeInit=true;return msg;');
get(cerbo, '698012b937ecc429').wires = [['automation_settings_v174']];
const handler = get(cerbo,'v139_dashboard_command_handler');
if (!handler.func.includes('_durableSettingsRoute')) {
  handler.func = "// _durableSettingsRoute\n" + handler.func;
  replace(handler, "} else if (action === 'fix_hub4mode') {\n  msg._fixHub4Mode = true;\n  text = 'ESS přepnuto na Optimized bez BatteryLife';", "} else if (action === 'fix_hub4mode') {\n  ok=false; text='Obnovu vlastniho zimniho rezimu ridi stavovy automat; cizi ESS nastaveni se nemeni';");
}
const commandStart = handler.func.lastIndexOf("const body = msg.payload && typeof msg.payload === 'object'");
if (commandStart < 0) throw new Error('Original API command handler missing');
const commandBody = handler.func.slice(commandStart);
// Keep the historical HTTP response output; imported three-output nodes must not drop saves.
handler.func = "// _durableSettingsRoute\nif(msg.payload?.action==='save_settings'){\nconst reply=await(async()=>{\n" +
  common + '\nconst SETTINGS_SCHEMA=' + JSON.stringify(publicSchema) + ';\n' + source('settings') +
  '\n})();return [reply,null,null];}\n' + commandBody;
handler.outputs = 3;
handler.wires = handler.wires.slice(0, 3);
handler.libs = libs;
const manager = get(cerbo,'252b7ebcd48a5c07');
if (!manager.func.includes('makePlan(')) {
  replace(manager, 'function num(x){ const n = Number(x);', "function num(x){ if(x===null||x===undefined||x==='')return NaN; const n = Number(x);");
  replace(manager, 'const list = expected.filter(b=>ageMin(b&&b.ts)<=maxAge);', "const fieldFresh=(b,key)=>ageMin(b[key+'Ts'] || (b.values ? null : b.ts))<=maxAge;\n  const list = expected.filter(b=>ageMin(b&&b.ts)<=maxAge&&['soc','allowCharge','allowDischarge','maxChargeA'].every(k=>fieldFresh(b,k)));\n  const enough=selected!=='all'||expected.length>=Number(global.get('jkBmsExpectedCount')??1);");
  replace(manager, 'const dataFresh = expected.length > 0', 'const dataFresh = enough && expected.length > 0');
  replace(manager, 'power:powers[0],cclSum', "power:powers.length===list.length?powers.reduce((a,b)=>a+b,0):NaN,powerFresh:dataFresh&&list.length>0&&list.every(b=>fieldFresh(b,'power')),cclSum");
  const start = manager.func.indexOf('// CHARGING METHODS'); const end = manager.func.indexOf('// EMERGENCY CHARGE');
  if(start<0||end<start)throw new Error('Manager method region missing');
  manager.func = manager.func.slice(0,start) + "const chargeMethod=global.get('chargeMethod')||'A';\nconst plan=makePlan(bms.dataFresh&&Number.isFinite(bms.soc)?bms.soc:null);global.set('chargePlan',plan);\nconst effectiveChargeLimit=priceLimit;\nconst lowPrice=priceKnown&&plan.current?.eligible===true;\nconst highPrice=priceKnown&&!lowPrice;\nconst negativePrice=priceKnown&&final<0;\n\n" + manager.func.slice(end);
  replace(manager, "global.get('forceChargeToSoc') ?? 25, forceChargeBelowSoc+1, 100, Math.max(25,forceChargeBelowSoc+1)", "global.get('forceChargeToSoc') ?? 15, forceChargeBelowSoc+1, 100, Math.max(15,forceChargeBelowSoc+1)");
  replace(manager, "const gridPriceChargeActive = (victronCheapPriceMode === 'charger_only') && lowPrice && (bms.soc < (global.get('priceChargeTargetSoc') ?? 100));", 'const gridPriceChargeActive = false;');
  replace(manager, 'const currentHour = new Date().getHours();', "const currentHour = Number(new Date().toLocaleTimeString('en-GB',{timeZone:'Europe/Prague',hour:'2-digit',hour12:false}));");
  replace(manager, "} else if (manualChargeActive) {\n  desiredMode = 1;", "} else if (manualChargeActive) {\n  desiredMode = 3;");
  replace(manager, 'Charger Only / RUČNÍ NABÍJENÍ', 'ON / ESS / RUCNI POVOLENI PREBYTKU FV');
  replace(manager, '} else if (isNight) {', "} else if (global.get('winterRuntime')?.phase === 'grace') {\n    desiredMode=3;desiredModeName='ON / ESS / zimni rozbeh nabijeni z FV';\n  } else if (isNight) {");
  replace(manager, "  emergencyChargeActive: emergencyChargeActive", "  soc:Number.isFinite(bms.soc)?bms.soc:null,bmsFresh:bms.dataFresh,batteryPowerW:Number.isFinite(bms.power)?bms.power:null,batteryPowerFresh:bms.powerFresh,priceKnown,targetSoc:plan.current?.targetSoc??null,pricePermission:lowPrice,\n  emergencyChargeActive: emergencyChargeActive");
  manager.func = common + '\n' + manager.func;
}
if (!manager.wires[0].includes('winter_controller_v174')) manager.wires[0].push('winter_controller_v174');
manager.func = common + '\n' + manager.func.slice(manager.func.indexOf('function num('));
if (!manager.func.includes('allowDischarge:bms.allowDischarge')) replace(manager, 'bmsFresh:bms.dataFresh,', 'bmsFresh:bms.dataFresh,allowDischarge:bms.allowDischarge,');
if (!manager.func.includes("b.connected===0")) replace(manager, 'const list = expected.filter(b=>ageMin(b&&b.ts)<=maxAge&&', 'const list = expected.filter(b=>!(b.connected===0||b.connected===false)&&ageMin(b&&b.ts)<=maxAge&&');
if (!manager.func.includes('BMS blokuje vybijeni')) replace(manager, '} else if (manualChargeActive) {', "} else if (!bms.allowDischarge) {\n  desiredMode=3;desiredModeName='ON / ESS / BMS blokuje vybijeni';\n} else if (manualChargeActive) {");
if (!manager.func.includes('nouzovy pozadavek bez AC vstupu')) replace(manager, '} else if (emergencyChargeActive) {', "} else if (emergencyChargeActive && fresh(global.get('vebusActiveInConnectedTs')) && finite(global.get('vebusActiveInConnected'))===0) {\n  desiredMode=3;desiredModeName='ON / ESS / nouzovy pozadavek bez AC vstupu';\n} else if (emergencyChargeActive) {");
const system = get(cerbo,'18ba376f056a1b5d');
if (!system.func.includes('hub4ModePortal')) replace(system,"global.set('hub4ModeValue', v);", "global.set('hub4ModePortal',parts[1]);global.set('hub4ModeValue', v);");
const watchdog = get(cerbo,'d4ac0d33a81d4bcc');
if (!watchdog.func.includes('winterOwnsVebus')) watchdog.func = "if(global.get('winterOwnsVebus')===true||global.get('automationReady')===false){node.status({fill:'blue',shape:'ring',text:'Zimni/obnovovaci automat vlastni Mode'});return [null,null];}\n" + watchdog.func;
const writer = get(cerbo,'e454e2f6f17be356');
if (!writer.func.includes('winterOwnsVebus')) writer.func = "if((global.get('winterOwnsVebus')===true||global.get('automationReady')===false)&&msg._winterMode!==true)return null;\n" + writer.func;
if (!writer.func.includes('emergency-only writer gate')) replace(writer, 'const now=Date.now();', "// emergency-only writer gate: no alternate caller can request grid charging.\nif(value===1){const d=global.get('lastDecisionSummary')||{},b=global.get('jkBmsControlStatus')||{};if(global.get('lowSocForceChargeLatch')!==true||global.get('safeMode')===true||Date.now()-tsMs(d.ts)>20000||b.dataFresh!==true||b.chargeAllowed!==true||Number(b.maxChargeA)<=0||Date.now()-tsMs(b.ts)>20000){global.set('victronChargeControlFault','Mode1 zablokovan: chybi cerstvy nouzovy pozadavek/BMS');return null;}}\nconst now=Date.now();");
if (!writer.func.includes('winter target mismatch')) replace(writer, 'if(!portal||!inst)', "if(msg._winterMode===true){const lease=global.get('winterRuntime')||{};if(inst!==lease.instance||portal!==lease.portal){global.set('winterFault','winter target mismatch');return null;}}\nif(!portal||!inst)");
const state = get(cerbo,'b1e1a9798714f670');
if (!state.func.includes('automationSettingsSchema')) {
  replace(state, "const settings={};for(const k of settingsKeys)settings[k]=global.get(k);", "const settings={...(global.get('automationSettings')||{})};for(const k of settingsKeys)if(!/token|password|secret/i.test(k))settings[k]=global.get(k);");
  replace(state, '  settings,settingsSchema,', "  settings,settingsSchema:global.get('automationSettingsSchema')||settingsSchema,winterControl:global.get('winterControl')||null,chargePlan:global.get('chargePlan')||null,persistence:global.get('settingsPersistence')||null,");
}
if (!state.func.includes('automationUptimeSec')) replace(state, '  settings,settingsSchema:', "  runtime:{version:174,automationStartedAt:global.get('automationBootTs')||null,automationUptimeSec:global.get('automationBootTs')?Math.max(0,(Date.now()-new Date(global.get('automationBootTs')).getTime())/1000):null,hostUptimeSec:os.uptime()},\n  settings,settingsSchema:");
state.libs=[...(state.libs||[]).filter(l=>l.var!=='os'),{var:'os',module:'os'}];
const poll = get(prox,'prox_poll_route_v131');
if (!poll.func.includes('winterControl:body.winterControl')) {
  replace(poll, '  ts:body.ts||null,', "  winterControl:body.winterControl||null,chargePlan:body.chargePlan||null,persistence:body.persistence||null,diagnostics:global.get('diagnosticsStatus')||null,\n  ts:body.ts||null,");
  replace(poll, 'const schema=Array.isArray(body.settingsSchema)', 'const schema=Array.isArray(body.settingsSchema)');
  replace(poll, 'for(const f of localSchema)if(!schema.some(x=>x.key===f.key))schema.push(f);', "// Cerbo owns the validated public schema; do not append unsaved local fields.\n");
  replace(poll, 'const settingsMsg={payload:{now:nowText,', 'const settingsMsg={payload:{winterControl:body.winterControl||null,chargePlan:body.chargePlan||null,persistence:body.persistence||null,diagnostics:global.get(\'diagnosticsStatus\')||null,now:nowText,');
  replace(poll, "const debugMsg={payload:{receivedAt:", "const debugMsg={payload:{winterControl:body.winterControl||null,chargePlan:body.chargePlan||null,persistence:body.persistence||null,diagnostics:global.get('diagnosticsStatus')||null,receivedAt:");
}
if (!poll.wires[6].includes('diagnostics_store_v174')) poll.wires[6].push('diagnostics_store_v174');
if (!poll.func.includes('runtime:body.runtime')) poll.func=poll.func.replaceAll('winterControl:body.winterControl||null,','runtime:body.runtime||null,winterControl:body.winterControl||null,');
for (const [suffix, target, output] of [['settings','b0adaf6e2547060f',2],['debug','v150_debug_template',6],['main','6ed7973472045dda',0]]) {
  const base=get(prox,target), id='winter_evidence_'+suffix+'_v174';
  let view=prox.find(n=>n.id===id);
  if(!view){view={...base,id,name:'Winter state, plan and diagnostics v174',order:2,height:'18',wires:[[]]};prox.push(view);}
  view.format=fs.readFileSync(path.join(root,'runtime','status.vue'),'utf8');view.template=view.format;
  if(!poll.wires[output].includes(id))poll.wires[output].push(id);
}
for(const id of ['6ed7973472045dda','b0adaf6e2547060f','v150_debug_template'])get(prox,id).template=get(prox,id).format;
const bridge = get(prox,'prox_dash_send_fn_v131');
if (!bridge.func.includes('pending_settings_v174')) {
  const start=bridge.func.indexOf("if (action === 'save_settings') {");const end=bridge.func.indexOf('\nconst host',start);
  if(start<0||end<start)throw new Error('Bridge settings block missing');
  bridge.func=bridge.func.slice(0,start)+"if(action==='save_settings'){flow.set('pending_settings_v174',p.settings||{});node.status({fill:'blue',shape:'ring',text:'Cekam na potvrzeni disku Cerba'});}\n"+bridge.func.slice(end);
}
const status = get(prox,'prox_command_status_v131');
if (!status.func.includes('pending_settings_v174')) {
  status.func = "let body=msg.payload;try{if(typeof body==='string')body=JSON.parse(body);}catch(error){body={ok:false,text:'Neplatna odpoved Cerba'};}\nconst ok=!msg.error&&Number(msg.statusCode)>=200&&Number(msg.statusCode)<300&&body?.ok===true;\nif(ok&&body.action==='save_settings'&&body.persistence?.ok===true){for(const[k,v]of Object.entries(body.saved||{}))global.set(k,v);global.set('settingsLastSaveTs',body.ts);}\nflow.set('pending_settings_v174',null);\nglobal.set('lastCommandResult',{ts:new Date().toISOString(),ok,text:body?.text||'Chyba API'});\nnode.status({fill:ok?'green':'red',shape:'dot',text:body?.text||'Chyba API'});msg.payload=(ok?'Potvrzeno: ':'SELHALO: ')+(body?.text||'Chyba API');msg.topic=ok?'Hotovo':'Chyba';return msg;";
}
if (!bridge.func.includes('_settingsSaveRequestId')) replace(bridge,
  "if(action==='save_settings'){flow.set('pending_settings_v174',p.settings||{});",
  "if(action==='save_settings'){msg._settingsSaveRequestId=String(p.requestId||msg._msgid||Date.now()).slice(0,100);flow.set('pending_settings_v174',p.settings||{});");
status.func = `let body=msg.payload;
try{if(typeof body==='string')body=JSON.parse(body);}catch(error){body={ok:false,text:'Neplatna JSON odpoved Cerba'};}
const requestId=msg._settingsSaveRequestId;
const isSettings=!!requestId||body?.action==='save_settings';
const durable=body?.action==='save_settings'&&body.persistence?.ok===true&&Number.isFinite(Date.parse(body.persistence.ts));
const ok=!msg.error&&Number(msg.statusCode)>=200&&Number(msg.statusCode)<300&&body?.ok===true&&(!isSettings||durable);
const detail=msg.error?(msg.error.code||'TRANSPORT_ERROR'):(body?.text||'Chybi platna odpoved API');
const text=ok?detail:((msg.error?'Spojeni s Cerbem: ':('HTTP '+(Number(msg.statusCode)||'?')+': '))+detail+(isSettings&&!durable&&body?.ok===true?' / chybi potvrzeni zapisu na disk':''));
if(ok&&isSettings){for(const[k,v]of Object.entries(body.saved||{}))global.set(k,v);global.set('settingsLastSaveTs',body.persistence.ts);}
if(requestId){global.set('settingsSaveResult',{requestId,ok,text,ts:new Date().toISOString(),savedAt:ok?body.persistence.ts:null});flow.set('pending_settings_v174',null);}
global.set('lastCommandResult',{ts:new Date().toISOString(),ok,text});
node.status({fill:ok?'green':'red',shape:'dot',text});
const cached=global.get('settingsDashboardPayloadV174');
const receipt=requestId&&cached?{_client:msg._client,payload:{...cached,settingsSaveResult:global.get('settingsSaveResult'),...(ok?{cfg:body.saved,persistence:body.persistence,settingsLastSaveTs:body.persistence.ts,chargePlan:body.chargePlan||cached.chargePlan}:{})}}:null;
msg.payload=(ok?'Potvrzeno: ':'SELHALO: ')+text;msg.topic=ok?'Hotovo':'Chyba';return [msg,receipt];`;
status.outputs=2;
status.wires[1]=['b0adaf6e2547060f'];
if (!poll.func.includes('settingsSaveResult:')) replace(poll, 'settingsSchema:schema,priceStatus,currentPrice,settingsLastSaveTs:', "settingsSchema:schema,priceStatus,currentPrice,settingsSaveResult:global.get('settingsSaveResult')||null,settingsLastSaveTs:");
if (!poll.func.includes('cerboOnline&&body.persistence')) replace(poll,
  "settingsLastSaveTs:global.get('settingsLastSaveTs')||null",
  "settingsLastSaveTs:cerboOnline&&body.persistence?.ok===true?body.persistence.ts:null");
if (!poll.func.includes("global.set('settingsDashboardPayloadV174'")) replace(poll,
  'const debugMsg={payload:{', "global.set('settingsDashboardPayloadV174',settingsMsg.payload);\nconst debugMsg={payload:{");
const form=get(prox,'b0adaf6e2547060f');
form.format=form.format.replace(/<script>[\s\S]*?<\/script>/,'<script>\n'+source('settings-form')+'\n</script>');
form.format=form.format.replace(':disabled="!schema.length"', ':disabled="!schema.length || isSaving"');
form.format=form.format.replace('<button class="secondary" @click="reload">', '<button class="secondary" @click="reload" :disabled="isSaving">');
form.format=form.format.replace('<span>{{ saveInfo }}</span>', '<span role="status" aria-live="polite" :class="{bad:saveState===\'error\'||saveState===\'timeout\'}">{{ saveInfo }}</span>');
form.template=form.format;
const proxZ=poll.z;
node(prox,'diagnostics_store_v174','Sanitized rotating durable diagnostics v174',common+'\n'+source('diagnostics'),[[]],proxZ);
node(prox,'diagnostics_download_v174','Read sanitized diagnostic bundle v174',common+"\nmsg._downloadDiagnostics=true;\n"+source('diagnostics'),[['diagnostics_response_v174']],proxZ);
if (!prox.some(n=>n.id==='diagnostics_http_v174')) prox.push({id:'diagnostics_http_v174',type:'http in',z:proxZ,name:'GET sanitized diagnostics',url:'/api/diagnostics/download',method:'get',upload:false,x:180,y:1400,wires:[['diagnostics_download_v174']]}, {id:'diagnostics_response_v174',type:'http response',z:proxZ,name:'Diagnostic download',statusCode:'',headers:{},x:980,y:1400,wires:[]}, {id:'diagnostics_catch_v174',type:'catch',z:proxZ,name:'Diagnostic errors (no payloads)',scope:null,uncaught:false,x:180,y:1460,wires:[['diagnostics_store_v174']]}, {id:'diagnostics_status_v174',type:'status',z:proxZ,name:'Transport status changes',scope:prox.filter(n=>['mqtt in','mqtt out','http request'].includes(n.type)).map(n=>n.id),x:180,y:1520,wires:[['diagnostics_store_v174']]});
for (const [nodes, file] of [[cerbo,files[0]],[prox,files[1]]]) {
  for (const n of nodes) if (n.type==='function') new Function('return async function(msg){\n'+n.func+'\n}');
  fs.writeFileSync(path.join(root,file),JSON.stringify(nodes,null,2)+'\n');
}
console.log('Built two flows with durable settings, winter arbitration, planner and rotating diagnostics.');
