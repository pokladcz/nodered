import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const cerbo=JSON.parse(readFileSync(new URL('../Cerbo_v167_ZIMNI_PASSTHRU.json',import.meta.url),'utf8'));
const prox=JSON.parse(readFileSync(new URL('../Proxmox_v167_ZIMNI_PASSTHRU.json',import.meta.url),'utf8'));
const format=prox.find(n=>n.id==='b0adaf6e2547060f').format;
const script=format.match(/<script>([\s\S]*?)<\/script>/)[1];
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const data={};const global={get:k=>data[k],set:(k,v)=>data[k]=v};
  const flow={get(){},set(){}};const node={status(){}};
  const run=(nodes,id,msg)=>new Function('global','flow','node','msg','Buffer',nodes.find(n=>n.id===id).func)(global,flow,node,msg,Buffer);
  run(cerbo,'3a4bfaa60e6694e1',{});
  const state=run(cerbo,'b1e1a9798714f670',{}).payload;
  const payload=run(prox,'prox_poll_route_v131',{payload:state,statusCode:200})[2][0].payload;
  payload.priceStatus={ok:true};payload.currentPrice={final:1.7};
  return {payload,global,run};
}
function view(){
  const f=fixture();const timers=new Map();let timerId=0;
  const context={Intl,Date,clearTimeout:id=>timers.delete(id),setTimeout:fn=>{timers.set(++timerId,fn);return timerId}};
  vm.runInNewContext(script.replace('export default','globalThis.component='),context);
  const component=context.component;
  const sent=[];const state={...component.data(),msg:{payload:f.payload},$nextTick:fn=>fn(),send:msg=>sent.push(plain(msg))};
  for(const [key,method] of Object.entries(component.methods))state[key]=method.bind(state);
  for(const [key,get] of Object.entries(component.computed))Object.defineProperty(state,key,{get:()=>get.call(state)});
  const receive=payload=>{state.msg={payload};component.watch.msg.handler.call(state)};
  receive(f.payload);return {...f,state,sent,timers,receive};
}
test('every setting offered by the dashboard is accepted by Cerbo, including the three previously missing options',()=>{
  const f=fixture();const allowed=f.global.get('dashboardSettingsSchemaV138').map(x=>x.key);
  for(const field of f.payload.settingsSchema)assert(allowed.includes(field.key),field.key);
  const result=f.run(cerbo,'v161_settings_api_handler',{payload:{settings:{cheapPriceWattrouterEnabled:true,cheapPriceBoilerRelayEnabled:true,exportAfterChargeEnabled:false}}});
  assert.equal(result.statusCode,200);assert.equal(f.global.get('cheapPriceBoilerRelayEnabled'),true);
});
test('all settings appear once, have a specific explanation, and technical parameters start hidden',()=>{
  const {state}=view();const keys=state.sections.flatMap(s=>state.fields(s).map(f=>f.key));
  assert.equal(keys.length,state.schema.length);assert.equal(new Set(keys).size,state.schema.length);
  for(const f of state.schema){assert(state.info(f).help.length>20);assert(!state.info(f).help.startsWith('Nastavení poskytované'),f.key)}
  assert.equal(state.advancedOpen,false);assert.equal(state.sections.find(s=>s.id==='winter').advanced,undefined);
});
test('only changed settings are sent and success is shown only after a matching Cerbo response',()=>{
  const {state,sent,receive,payload}=view();state.draft.chargeBelowFinalPriceKcKwh=1.5;
  state.save();assert.deepEqual(sent,[{payload:{action:'save_settings',settings:{chargeBelowFinalPriceKcKwh:1.5}}}]);
  assert.equal(state.waiting,true);assert.equal(state.saveMessage,'');
  receive({...payload,cfg:{...payload.cfg}});assert.equal(state.waiting,true);
  receive({...payload,cfg:{...payload.cfg,chargeBelowFinalPriceKcKwh:1.5}});
  assert.equal(state.waiting,false);assert.equal(state.changeCount,0);assert.match(state.saveMessage,/potvrdilo/);
});
test('polling does not overwrite edits or send unrelated externally changed settings',()=>{
  const {state,receive,payload,sent}=view();state.draft.priceChargeTargetSoc=88;
  receive({...payload,cfg:{...payload.cfg,safeMode:true}});
  assert.equal(state.draft.priceChargeTargetSoc,88);state.save();
  assert.deepEqual(sent[0].payload.settings,{priceChargeTargetSoc:88});
});
test('technical times are displayed in seconds and saved in the original milliseconds',()=>{
  const {state,sent}=view();const field=state.schema.find(f=>f.key==='relay1CommandHeartbeatMs');
  assert.equal(state.inputValue(field),60);assert.equal(state.scaled(field,field.step),10);
  state.setNumber(field,'40');state.save();assert.deepEqual(sent[0].payload.settings,{relay1CommandHeartbeatMs:40000});
});
test('missing values and invalid emergency charge thresholds are not silently replaced or saved',()=>{
  const {state,sent}=view();const field=state.schema.find(f=>f.key==='relay1CommandHeartbeatMs');
  state.setNumber(field,'');state.save();assert.equal(sent.length,0);assert.match(state.saveError,/Zkontrolujte/);
  state.reload();state.draft.forceChargeToSoc=5;state.save();assert.equal(sent.length,0);assert.match(state.saveError,/vyšší/);
});
test('an absent acknowledgement stops the pending state without losing the edits',()=>{
  const {state,timers}=view();state.draft.solax_charge_current_a=24;state.save();
  assert.equal(state.waiting,true);[...timers.values()][0]();assert.equal(state.waiting,false);
  assert.equal(state.draft.solax_charge_current_a,24);assert.equal(state.changeCount,1);assert.match(state.saveError,/nepotvrdilo/);
});
test('discard loads current Cerbo settings rather than factory defaults',()=>{
  const {state,receive,payload}=view();state.draft.solax_charge_current_a=12;
  receive({...payload,cfg:{...payload.cfg,solax_charge_current_a:28}});state.reload();
  assert.equal(state.draft.solax_charge_current_a,28);assert.equal(state.changeCount,0);
});
test('stale prices are not presented as a current decision price',()=>{
  const {state,receive,payload}=view();receive({...payload,priceStatus:{ok:false},currentPrice:{final:1.7}});
  assert.equal(state.priceText,'Cena není dostupná');
});
test('offline settings preserve edits and do not send commands until the connection returns',()=>{
  const {state,receive,payload,sent}=view();state.draft.solax_charge_current_a=18;
  receive({...payload,_bridgeError:true});assert.equal(state.connected,false);state.save();assert.equal(sent.length,0);
  assert.equal(state.draft.solax_charge_current_a,18);assert.match(state.saveError,/připojené/);
  receive({...payload,_bridgeError:false});state.save();assert.equal(sent.length,1);
});
test('the component uses the FlowFuse-supported top-level export and unmounted cleanup hook',()=>{
  assert.match(script.trimStart(),/^export default\s*\{/);
  const {state}=view();assert(state.descriptions.winterModeEnabled);assert(state.sectionList.length>0);
  assert(!script.includes('beforeUnmount()'));assert(script.includes('unmounted()'));
});
