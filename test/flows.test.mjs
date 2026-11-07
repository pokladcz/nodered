import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const cerbo=JSON.parse(readFileSync(new URL('../Cerbo_v167_ZIMNI_PASSTHRU.json',import.meta.url),'utf8'));
const prox=JSON.parse(readFileSync(new URL('../Proxmox_v167_ZIMNI_PASSTHRU.json',import.meta.url),'utf8'));
const at=Date.parse('2026-11-07T12:00:00Z');
const iso=(delta=0)=>new Date(at+delta).toISOString();
const store=(data={})=>({data:structuredClone(data),stores:{winter:{}},get(k,name,callback){if(callback)callback(null,this.stores[name][k]);else return this.data[k]},set(k,v,name,callback){if(callback){this.stores[name][k]=v;callback(null)}else this.data[k]=v}});
function environment(data={}){
  return {global:store(data),flow:store(),context:store(),node:{status(){},warn(){},error(){},send(){}}};
}
function run(nodes,id,env,msg={payload:{}}){
  const n=nodes.find(n=>n.id===id);assert(n,`missing ${id}`);
  const now=env.now??at;
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
  const sandbox={...env,msg,Date:Clock,Buffer,Intl,console};
  return vm.runInNewContext(`(function(){${n.func}\n})()`,sandbox,{timeout:1000});
}
const ids={config:'3a4bfaa60e6694e1',manager:'252b7ebcd48a5c07',winter:'511b3c19f94ae84f',guard:'d4ac0d33a81d4bcc',writer:'e454e2f6f17be356',api:'b1e1a9798714f670'};
function bms(soc=19){
  const b={instance:'512',soc,connected:1,allowCharge:1,allowDischarge:1,maxChargeA:100,voltage:52,current:0,power:0,ts:iso()};
  for(const k of ['soc','connected','allowCharge','allowDischarge','maxChargeA'])b[k+'Ts']=iso();
  return b;
}
function plant({soc=19,grid=-499,price=2,...extra}={}){
  const env=environment();run(cerbo,ids.config,env);
  Object.assign(env.global.data,{
    jkBmsByInstance:{512:bms(soc),513:{...bms(soc),instance:'513'}},
    gridPowerW:grid,gridPowerWTs:iso(),
    enerspotPrices15:[{datetime:iso(-300000),datetimeTo:iso(600000),finalKcKwh:price}],
    enerspotLastFetchTs:iso(),enerspotLastFetchOk:true,chargeBelowFinalPriceKcKwh:1,
    ...extra
  });return env;
}
function decide(options){const env=plant(options);run(cerbo,ids.manager,env);return env;}
function transport(sleep=true){
  return environment({winterSleepLatched:sleep,vebusInstance:'276',venusPortalId:'testportal',
    winterEssModeFeedback:{value:1,ts:iso()},
    vebusByInstance:{276:{instance:'276',portal:'testportal',ts:iso(),hub4DisableCharge:0,hub4DisableFeedIn:0,hub4DisableChargeTs:iso(),hub4DisableFeedInTs:iso()}},
    victronActualModeValue:3,victronActualModeTs:iso(),vebusStateValue:8,vebusStateTs:iso()});
}

test('all function nodes and UI scripts parse; graph IDs, wires, links and HTTP routes are valid',()=>{
  for(const [name,nodes] of [['cerbo',cerbo],['proxmox',prox]]){
    const index=new Set(nodes.map(n=>n.id));assert.equal(index.size,nodes.length);
    const routes=new Set();mkdirSync(`.inspection/lint/${name}`,{recursive:true});
    for(const n of nodes){
      for(const target of [...(n.wires||[]).flat(),...(n.links||[]),...(Array.isArray(n.scope)?n.scope:[])])assert(index.has(target),`${name} ${n.id} -> ${target}`);
      for(const key of ['z','group','page','ui','theme','broker','tls','client'])if(n[key]&&!(key==='broker'&&n.type==='mqtt-broker'))assert(index.has(n[key]),`${name} ${n.id} ${key}=${n[key]}`);
      if(n.type==='http in'){const key=n.method+' '+n.url;assert(!routes.has(key),key);routes.add(key)}
      if(n.type==='function'){
        assert.doesNotThrow(()=>new Function('msg','global','flow','context','node','Buffer',n.func),`${name} ${n.id}`);
        writeFileSync(`.inspection/lint/${name}/${n.id}.js`,'function nodeFunction(msg){\n'+n.func+'\n}');
      }
      if(n.type==='ui-template'){
        const script=n.format.match(/<script>([\s\S]*?)<\/script>/)?.[1];
        if(script){assert.doesNotThrow(()=>new Function(script.replace('export default','return')),n.id);writeFileSync(`.inspection/lint/${name}/${n.id}.mjs`,script);}
      }
    }
  }
});
test('Enerspot uses an external token and never sends an unauthenticated request',()=>{
  const e=environment();e.env={get(){return undefined}};
  assert.equal(run(prox,'prox_enerspot_build_url',e),null);
  e.env={get(key){assert.equal(key,'ENERSPOT_TOKEN');return 'TEST_ONLY_ENV_TOKEN'}};
  assert.equal(run(prox,'prox_enerspot_build_url',e).headers.Authorization,'Bearer TEST_ONLY_ENV_TOKEN');
  e.global.set('enerspotToken','TEST_ONLY_CONTEXT_TOKEN');
  assert.equal(run(prox,'prox_enerspot_build_url',e).headers.Authorization,'Bearer TEST_ONLY_CONTEXT_TOKEN');
  assert.doesNotMatch(prox.find(n=>n.id==='prox_enerspot_build_url').func,/const TOKEN = .*\|\| '[^']+'/);
});
test('configuration initializes forecast and winter settings and preserves saved values',()=>{
  const env=environment({settingsStartupProfileV138:{chargeBelowFinalPriceKcKwh:2.75,forceChargeBelowSoc:7,forceChargeToSoc:18,winterModeEnabled:false}});
  run(cerbo,ids.config,env);
  assert.equal(env.global.get('chargeBelowFinalPriceKcKwh'),2.75);
  assert.equal(env.global.get('forceChargeBelowSoc'),7);
  assert.equal(env.global.get('winterModeEnabled'),false);
  assert.equal(env.global.get('solarForecastPeakPowerKwp'),10);
  assert.equal(typeof env.global.get('chargeBelowFinalPriceKcKwh'),'number');
});
test('winter sleeps below 20 percent AND below 500 W export, including grid import',()=>{
  for(const grid of [-499,0,1500]){
    const env=decide({grid});assert.equal(env.global.get('winterSleepLatched'),true);
    assert.equal(env.global.get('vebusDesiredMode'),3);
    assert.equal(env.global.get('victronChargeIntentActive'),false);
  }
});
test('winter does not enter at exactly 20 percent or exactly 500 W export',()=>{
  assert.equal(decide({soc:20}).global.get('winterSleepLatched'),false);
  assert.equal(decide({grid:-500}).global.get('winterSleepLatched'),false);
  assert.equal(decide({grid:-501}).global.get('winterSleepLatched'),false);
});
test('winter wakes only with export above 500 W AND a fresh price strictly above limit',()=>{
  for(const [grid,price,asleep] of [[-501,1.01,false],[-501,1,true],[-500,2,true],[-501,-1,true],[500,2,true]]){
    const env=decide({grid,price,winterSleepLatched:true});assert.equal(env.global.get('winterSleepLatched'),asleep,`${grid} ${price}`);
  }
});
test('rising SOC, stale prices, stale grid, and absent price never wake a sleeper',()=>{
  const cases=[{soc:99,grid:-499},{grid:-1000,enerspotLastFetchOk:false},{grid:-1000,enerspotLastFetchTs:iso(-7200000)},{grid:-1000,gridPowerWTs:iso(-31000)},{grid:-1000,enerspotPrices15:[]}];
  for(const c of cases)assert.equal(decide({...c,winterSleepLatched:true}).global.get('winterSleepLatched'),true);
});
test('stale BMS SOC cannot cause winter entry even when other BMS fields just updated',()=>{
  const env=plant();for(const b of Object.values(env.global.get('jkBmsByInstance')))b.socTs=iso(-3600000);
  run(cerbo,ids.manager,env);assert.equal(env.global.get('winterSleepLatched'),false);
  assert.equal(env.global.get('victronChargeBmsAllowed'),false);
});
test('winter takes priority over emergency and manual charge until disabled',()=>{
  const env=decide({soc:5,manualChargeEnabled:true});assert.equal(env.global.get('vebusDesiredMode'),3);
  assert.equal(env.global.get('victronChargeIntentActive'),false);
  env.global.set('winterModeEnabled',false);run(cerbo,ids.manager,env);
  assert.equal(env.global.get('winterSleepLatched'),false);assert.equal(env.global.get('vebusDesiredMode'),1);
});
test('missing expected BMS or zero CCL in any battery blocks charging',()=>{
  const env=plant({soc:50,price:-1,winterModeEnabled:false});delete env.global.get('jkBmsByInstance')[513];
  run(cerbo,ids.manager,env);assert.equal(env.global.get('victronChargeBmsAllowed'),false);
  env.global.get('jkBmsByInstance')[513]=bms(50);env.global.get('jkBmsByInstance')[513].maxChargeA=0;
  run(cerbo,ids.manager,env);assert.equal(env.global.get('victronChargeBmsAllowed'),false);
});
test('winter saves native ESS then requests both real flags and external control, never power setpoints',async()=>{
  const env=transport();const out=await run(cerbo,ids.winter,env);
  assert.equal(env.global.get('winterEssRestore').hub4Mode,1);
  const writes=out[0].filter(m=>m.topic.startsWith('W/'));
  assert(writes.some(m=>m.topic.endsWith('/Hub4/DisableCharge')&&m.payload.value===1));
  assert(writes.some(m=>m.topic.endsWith('/Hub4/DisableFeedIn')&&m.payload.value===1));
  assert(writes.some(m=>m.topic.endsWith('/Settings/CGwacs/Hub4Mode')&&m.payload.value===3));
  assert(!writes.some(m=>/DisableDischarge|AcPowerSetpoint/.test(m.topic)));
  assert.equal(env.global.get('winterControlStatus').confirmed,false);
});
test('Passthru is confirmed only by fresh mode, both flag readbacks and State 8',async()=>{
  const env=transport();await run(cerbo,ids.winter,env);
  env.global.set('winterEssModeFeedback',{value:3,ts:iso()});
  Object.assign(env.global.get('vebusByInstance')[276],{hub4DisableCharge:1,hub4DisableFeedIn:1});
  await run(cerbo,ids.winter,env);assert.equal(env.global.get('winterControlStatus').confirmed,true);
  env.global.set('vebusStateValue',9);await run(cerbo,ids.winter,env);assert.equal(env.global.get('winterControlStatus').confirmed,false);
});
test('winter cannot take over another external ESS controller or unknown ESS mode',async()=>{
  const env=transport();env.global.set('winterEssModeFeedback',{value:3,ts:iso()});
  assert.equal(await run(cerbo,ids.winter,env),null);assert.equal(env.global.get('winterEssRestore'),null);
  env.global.set('winterEssModeFeedback',null);const out=await run(cerbo,ids.winter,env);
  assert(out[0].every(m=>m.topic.startsWith('R/')));
});
test('winter restores native ESS, releases only its own flags and does not fight native BMS limits',async()=>{
  const env=transport();await run(cerbo,ids.winter,env);
  env.global.set('winterEssModeFeedback',{value:3,ts:iso()});env.global.set('winterSleepLatched',false);
  const out=await run(cerbo,ids.winter,env);assert(out[0].some(m=>m.topic.endsWith('/Hub4/DisableCharge')&&m.payload.value===0));
  assert(out[0].some(m=>m.topic.endsWith('/Settings/CGwacs/Hub4Mode')&&m.payload.value===1));
  env.now=at+5000;env.global.set('winterEssModeFeedback',{value:1,ts:iso(5000)});
  env.global.get('vebusByInstance')[276].hub4DisableCharge=1;
  assert.equal(await run(cerbo,ids.winter,env),null);
  assert.equal(env.global.get('winterEssRestore'),null);assert.equal(env.global.stores.winter.winterEssRestore,null);
});
test('winter never changes ESS if the durable journal write fails',async()=>{
  const env=transport();const originalSet=env.global.set;
  env.global.set=function(k,v,name,callback){if(callback)callback(new Error('disk full'));else originalSet.call(this,k,v)};
  assert.equal(await run(cerbo,ids.winter,env),null);
  assert.equal(env.global.get('winterControlStatus').state,'PERSISTENCE_ERROR');
});
test('winter recovers its original native mode from durable storage after a restart',async()=>{
  const env=transport(false);env.global.stores.winter.winterEssRestore={portal:'testportal',instance:'276',hub4Mode:2};
  env.global.set('winterEssModeFeedback',{value:3,ts:iso()});
  await run(cerbo,ids.winter,env);
  assert.equal(env.global.get('winterSleepLatched'),true);assert.equal(env.global.get('winterEssRestore').hub4Mode,2);
});
test('winter only reads when real ESS flags are missing, and cannot restore to a different inverter',async()=>{
  const env=transport();delete env.global.get('vebusByInstance')[276].hub4DisableCharge;
  const out=await run(cerbo,ids.winter,env);assert(out[0].every(m=>m.topic.startsWith('R/')));
  env.global.stores.winter.winterEssRestore={portal:'otherportal',instance:'276',hub4Mode:1};
  assert.equal(await run(cerbo,ids.winter,env),null);assert.equal(env.global.get('winterControlStatus').state,'IDENTITY_MISMATCH');
});
test('grid freshness is never renewed by unrelated PV measurements and null MQTT values invalidate the measurement',()=>{
  const env=environment({gridPowerW:-700,gridPowerWTs:iso(-60000),gridL1W:-700,gridL2W:0,gridL3W:0,gridL1WTs:iso(-60000),gridL2WTs:iso(-60000),gridL3WTs:iso(-60000)});
  run(cerbo,'18ba376f056a1b5d',env,{topic:'N/testportal/system/0/Dc/Pv/Power',payload:{value:2000}});
  assert.equal(env.global.get('gridPowerWTs'),iso(-60000));
  run(cerbo,'18ba376f056a1b5d',env,{topic:'N/testportal/system/0/Ac/Grid/L1/Power',payload:{value:null}});
  assert.equal(env.global.get('gridL1W'),null);assert.equal(env.global.get('gridPowerWTs'),null);
});
test('keepalive explicitly refreshes unchanged safety fields without writing any battery settings',()=>{
  const env=plant();env.global.set('venusPortalId','testportal');env.global.set('vebusInstance','276');
  const out=run(cerbo,'v144_keepalive_fn',env);
  assert(out[0].every(m=>m.topic.startsWith('R/')));
  assert(out[0].some(m=>m.topic==='R/testportal/battery/512/Io/AllowToCharge'));
  assert(out[0].some(m=>m.topic==='R/testportal/settings/0/Settings/CGwacs/Hub4Mode'));
});
test('house consumption sums actual Venus phase paths without inventing missing phases',()=>{
  const env=environment();
  for(const [phase,value] of [['L1',2000],['L2',2500]])run(cerbo,'18ba376f056a1b5d',env,{topic:`N/testportal/system/0/Ac/Consumption/${phase}/Power`,payload:{value}});
  assert.equal(env.global.get('houseLoadW'),undefined);
  run(cerbo,'18ba376f056a1b5d',env,{topic:'N/testportal/system/0/Ac/Consumption/L3/Power',payload:{value:3000}});
  assert.equal(env.global.get('houseLoadW'),7500);
});
test('a full Victron battery or deselected Victron cannot remain connected for negative-price charging',()=>{
  assert.equal(decide({soc:99,price:-1,winterModeEnabled:false}).global.get('vebusDesiredMode'),2);
  assert.equal(decide({soc:50,price:-1,winterModeEnabled:false,cheapPriceBatteryMode:'solax'}).global.get('vebusDesiredMode'),2);
});
test('watchdog keeps Mode 3 and continues winter control even in confirmed Passthru',()=>{
  const env=transport();Object.assign(env.global.data,{vebusDesiredMode:2,lastManagerTs:iso(),vebusActiveInConnected:1,vebusActiveInConnectedTs:iso()});
  const result=run(cerbo,ids.guard,env);assert.equal(env.global.get('vebusEffectiveDesiredMode'),3);assert.equal(result[1].topic,'winter_tick');
});
test('Mode writer waits for the two actual blocks before enabling On during winter',()=>{
  const env=transport();env.global.get('vebusByInstance')[276].mode=2;env.global.set('victronActualModeValue',2);
  const request={payload:{path:'Mode',value:2},topic:'watchdog'};
  assert.equal(run(cerbo,ids.writer,env,request),null);
  Object.assign(env.global.data,{hub4DisableCharge:1,hub4DisableFeedIn:1,hub4DisableChargeTs:iso(),hub4DisableFeedInTs:iso(),winterEssModeFeedback:{value:3,ts:iso()}});
  const out=run(cerbo,ids.writer,env,request);assert.equal(out[0][0].payload.value,3);
});
test('API reports actual mode using the key written by the VE.Bus parser and includes winter settings',()=>{
  const env=decide();env.global.set('victronActualModeValue',3);
  const result=run(cerbo,ids.api,env);
  assert.equal(result.payload.victron.mode,3);assert(result.payload.settingsSchema.some(f=>f.key==='winterModeEnabled'));
  assert.equal(result.payload.winter.asleep,true);
});
test('settings reject invalid values atomically and restore user changes after startup',()=>{
  const env=plant();
  for(const settings of [{winterModeEnabled:'false'},{chargeBelowFinalPriceKcKwh:null},{chargeBelowFinalPriceKcKwh:99},{vebusInstance:'untrusted'},{forceChargeBelowSoc:40,forceChargeToSoc:20}]){
    const out=run(cerbo,'v161_settings_api_handler',env,{payload:{settings}});assert.equal(out.statusCode,400);
  }
  assert.equal(run(cerbo,'v161_settings_api_handler',env,{payload:{settings:{winterModeEnabled:false,chargeBelowFinalPriceKcKwh:2.5}}}).statusCode,200);
  run(cerbo,ids.config,env);assert.equal(env.global.get('winterModeEnabled'),false);assert.equal(env.global.get('chargeBelowFinalPriceKcKwh'),2.5);
});
test('SAFE MODE cannot be bypassed by manual relay ON',()=>{
  for(const id of ['fcf5c9ea3b71fd14','6d24f48ed72e7e66','407b53c0b2985d01']){
    const env=plant({safeMode:true,manualRelay1Mode:'on',manualRelay2Mode:'on',manualShellyMode:'on'});
    const out=run(cerbo,id,env,{payload:1});
    if(id==='407b53c0b2985d01')assert.equal(out.payload.on,false);else assert.equal(out.payload.value,0);
  }
});
function solax(extra={}){
  return environment({
    enerspotPrices15:[{datetime:iso(-300000),datetimeTo:iso(600000),finalKcKwh:-1}],enerspotLastFetchTs:iso(),enerspotLastFetchOk:true,solaxChargeBelowFinalPriceKcKwh:1,
    cerboControlSnapshot:{ts:at,controlTs:iso(),decision:{bmsChargeAllowed:true,bmsMaxChargeA:100}},
    solax_last_data:{ok:true,stale:false,soc:50,batV:52},solax_last_ok_ts:iso(),...extra
  });
}
function target(env){run(prox,'prox_solax_modbus_decide',env);return env.global.get('solax_charge_decision').targetA;}
test('SolaX honors selection, configured current and price limit without stale Cerbo priceModeCode',()=>{
  assert.equal(target(solax({cheapPriceBatteryMode:'victron'})),0);
  assert.equal(target(solax({cheapPriceBatteryMode:'off'})),0);
  assert.equal(target(solax({solax_charge_current_a:17,solaxChargeBelowFinalPriceKcKwh:0,priceModeCode:'POSITIVE_HIGH'})),17);
});
test('SolaX stops on missing SOC, stale data, stale price, missing BMS permission or target SOC',()=>{
  for(const extra of [
    {solax_last_data:{ok:true,stale:false,batV:52}},
    {solax_last_ok_ts:iso(-20000)}, {enerspotLastFetchOk:false},
    {cerboControlSnapshot:{ts:at,controlTs:iso(),decision:{bmsChargeAllowed:false}}},
    {cerboControlSnapshot:{ts:at-16000,controlTs:iso(),decision:{bmsChargeAllowed:true}}},
    {solax_last_data:{ok:true,stale:false,soc:99,batV:52}}
  ])assert.equal(target(solax(extra)),0,JSON.stringify(extra));
});
test('manual SolaX charging retains BMS and telemetry safety and expires',()=>{
  const manual={mode:'charge',currentA:12,expiresAtMs:at+60000};
  assert.equal(target(solax({solax_manual_override:manual})),12);
  assert.equal(target(solax({solax_manual_override:manual,solax_last_ok_ts:iso(-20000)})),0);
  assert.equal(target(solax({solax_manual_override:{...manual,expiresAtMs:at-1},cheapPriceBatteryMode:'off'})),0);
});
test('SolaX current never exceeds the current allowed by the selected BMS',()=>{
  assert.equal(target(solax({solax_manual_override:{mode:'charge',currentA:50,expiresAtMs:at+60000},cerboControlSnapshot:{ts:at,controlTs:iso(),decision:{bmsChargeAllowed:true,bmsMaxChargeA:8}}})),8);
});
function response(env,{raw=0,tid,unit=1,fc=3}={}){
  const s=env.flow.get('solaxControlV160'),step=s.queue.at(-1);s.stepIndex=2;
  const frame=Buffer.alloc(11);frame.writeUInt16BE(tid??step.tid);frame.writeUInt16BE(5,4);frame[6]=unit;frame[7]=fc;frame[8]=2;frame.writeUInt16BE(raw,9);
  return run(prox,'prox_solax_step_parser',env,{payload:frame,_solaxStep:step,_solaxStepIndex:2});
}
test('Modbus readback mismatch retries and cannot acknowledge a stale transaction or nonzero STOP',()=>{
  const env=solax();target(env);response(env,{raw:0});
  assert.equal(env.global.get('solax_modbus_last_verify').ok,false);
  assert.equal(env.flow.get('solaxControlV160').lastTargetA,null);
  assert(env.flow.get('solaxControlV160').retryNotBefore>at);
  const stop=solax({cheapPriceBatteryMode:'off'});target(stop);response(stop,{raw:100});
  assert.equal(stop.global.get('solax_modbus_last_verify').ok,false);
  const wrong=solax();target(wrong);response(wrong,{raw:5000,tid:60000});
  assert(wrong.global.get('solax_modbus_last_error'));assert.equal(wrong.global.get('solax_modbus_last_verify'),undefined);
});
test('a manual SolaX STOP cannot start a competing transaction while an older write is in flight',()=>{
  const env=solax();target(env);const tid=env.flow.get('solaxControlV160').queue[0].tid;
  run(prox,'prox_solax_send_fn_v131',env,{payload:{cmd:'manual_stop'}});
  assert.equal(run(prox,'prox_solax_modbus_decide',env),null);
  assert.equal(env.flow.get('solaxControlV160').queue[0].tid,tid);
  response(env,{raw:5000});
  assert.equal(target(env),0);
});
test('HTTP command response cannot claim success for body.ok false and quiet sync does not notify users',()=>{
  const env=environment();
  const out=run(prox,'prox_command_status_v131',env,{payload:{ok:false,text:'zamítnuto'},statusCode:200});assert.equal(out.topic,'Chyba');
  assert.equal(run(prox,'prox_command_status_v131',env,{payload:{ok:true},statusCode:200,_quietCommand:true}),null);
});
test('forecast validates responses, applies Prague morning cutoff, and sends the resulting target to Cerbo',()=>{
  const env=environment();
  const msg=run(prox,'prox_solar_parse',env,{payload:{daily:{shortwave_radiation_sum:[25,10],sunshine_duration:[10000,5000]}},statusCode:200});
  assert.equal(msg.payload.action,'update_external_data');assert.equal(msg.payload.dynamicTargetSoc,75);
  const bad=run(prox,'prox_solar_parse',env,{payload:'error',statusCode:503});assert.equal(bad.payload.dynamicTargetSoc,null);
});
test('a missing BMS safety value cannot be green in the API or inherited from the old primary alias',()=>{
  const env=decide({winterModeEnabled:false});env.global.set('jkAllowToCharge',1);
  delete env.global.get('jkBmsByInstance')[512].allowCharge;
  const out=run(cerbo,ids.api,env).payload;assert.equal(out.bms.controlOk,false);assert.equal(out.battery.allowCharge,null);
});
test('an impossible BMS SOC cannot authorize manual charging',()=>{
  const env=decide({soc:150,winterModeEnabled:false,manualChargeEnabled:true});
  assert.equal(env.global.get('victronChargeBmsAllowed'),false);assert.equal(env.global.get('victronChargeIntentActive'),false);
});
test('relay feedback follows the configured output and null feedback is unknown rather than OFF',()=>{
  const env=plant();env.global.set('cerboRelay1Index',2);
  assert.equal(run(cerbo,'5e7482179c100ac3',env,{topic:'N/testportal/system/0/Relay/0/State',payload:{value:1}}),null);
  run(cerbo,'5e7482179c100ac3',env,{topic:'N/testportal/system/0/Relay/2/State',payload:{value:1}});
  assert.equal(env.global.get('cerboRelay1Actual'),1);
  run(cerbo,'5e7482179c100ac3',env,{topic:'N/testportal/system/0/Relay/2/State',payload:{value:null}});
  assert.equal(env.global.get('cerboRelay1Actual'),null);
});
test('two independent relay writers cannot be assigned to the same physical output',()=>{
  const env=plant();const out=run(cerbo,'v161_settings_api_handler',env,{payload:{settings:{cerboRelay1Index:1}}});
  assert.equal(out.statusCode,400);assert.equal(env.global.get('cerboRelay1Index'),0);
});
test('Tasmota rejects a null relay instead of switching all outputs and retains the HTTP response object',()=>{
  const env=plant(),res={id:'response'};
  const out=run(cerbo,'9b3b9b54e9997b58',env,{payload:{board:1,relay:null,action:'on'},res});
  assert.equal(out[0],null);assert.equal(out[1].statusCode,400);assert.equal(out[1].res,res);
});
test('Tasmota failed or unacknowledged responses cannot update the recorded relay state',()=>{
  for(const reply of [{statusCode:500,payload:'{}'},{statusCode:200,payload:'{"WARNING":"wrong password"}'}]){
    const env=environment({tasmota_relay_states:{'192.168.0.238_1':'off'}});
    const out=run(cerbo,'a4d2dc4b130288f5',env,{...reply,_tasmota:{board:{id:1,ip:'192.168.0.238'},relay:1,action:'on'}});
    assert.equal(out.statusCode,502);assert.equal(out.payload.ok,false);assert.equal(env.global.get('tasmota_relay_states')['192.168.0.238_1'],'off');
  }
});
test('Tasmota proxy honors the same Cerbo endpoint as the state and command bridge',()=>{
  const env=environment({cerboHost:'127.0.0.1',cerboPort:18891,cerboProtocol:'http'});
  const out=run(prox,'prox_tasmota_proxy_prepare_v131',env,{req:{originalUrl:'/api/tasmota?x=1',method:'POST'},payload:{board:1,relay:1,action:'on'}})[0];
  assert.equal(out.url,'http://127.0.0.1:18891/api/tasmota?x=1');assert.equal(out.requestTimeout,8000);
});
test('all HTTP nodes sending errors to Catch have a connected error path',()=>{
  for(const nodes of [cerbo,prox])for(const n of nodes.filter(n=>n.type==='http request'&&n.senderr===true)){
    assert(nodes.some(c=>c.type==='catch'&&Array.isArray(c.scope)&&c.scope.includes(n.id)&&c.wires?.flat().length),n.id);
  }
});
test('polling requests use the actual Node-RED timeout property',()=>{
  const env=environment();
  for(const [id,ms] of [['prox_poll_prepare_v131',7000],['prox_solax_http_prepare',4000],['prox_solar_build_url',7000]])assert.equal(run(prox,id,env).requestTimeout,ms);
});
test('explicit Enerspot kWh prices are recognized and converted with the fee exactly once',()=>{
  const env=environment({processFeeCzkMWh:300});const out=run(prox,'prox_enerspot_parse',env,{statusCode:200,payload:{data:[{datetime:iso(-1000),datetimeTo:iso(600000),priceKcKWh:1.5}]}});
  assert.equal(out.payload.priceOk,true);assert.equal(out.payload.priceFinalKcKwh,1.2);
});
test('SolaX uses the current fee rather than a cached net price from the previous settings',()=>{
  const env=solax({processFeeCzkMWh:500,solaxChargeBelowFinalPriceKcKwh:1.7,enerspotPrices15:[{datetime:iso(-1000),datetimeTo:iso(600000),priceKcMWh:2300,finalKcKwh:1.2}]});
  assert.equal(target(env),0);assert.equal(env.global.get('solax_charge_decision').priceKcKwh,1.8);
});
test('a manual STOP recovers after a lost Modbus response instead of remaining permanently busy',()=>{
  const env=solax();target(env);run(prox,'prox_solax_send_fn_v131',env,{payload:{cmd:'manual_stop'}});env.now=at+7000;
  const result=run(prox,'prox_solax_modbus_decide',env);assert(result);assert.equal(env.flow.get('solaxControlV160').expectedTargetA,0);
});
test('the settings page retains its schema and last settings during a Cerbo outage',()=>{
  const env=plant();const body=run(cerbo,ids.api,env).payload;
  const first=run(prox,'prox_poll_route_v131',env,{statusCode:200,payload:body})[2][0].payload;
  const failed=run(prox,'prox_poll_route_v131',env,{statusCode:0,error:{message:'timeout'},payload:''})[2][0].payload;
  assert.equal(failed._bridgeError,true);assert.equal(failed.settingsSchema.length,first.settingsSchema.length);assert.equal(failed.cfg.winterModeEnabled,true);
  assert.equal(env.global.get('cerboControlSnapshot'),null);
});
test('Shelly requires a valid acknowledgement rather than treating any HTTP 200 as success',()=>{
  for(const reply of [{statusCode:200,payload:{error:'not authorized'}},{statusCode:200,payload:{ison:false}},{payload:{was_on:false}}]){
    const env=environment();const out=run(cerbo,'a34f0c7dac13a9e9',env,{...reply,shellyExpectedOn:true});
    assert.equal(out.payload.ok,false);assert(env.global.get('shellyHttpBackoffUntilMs')>at);
  }
  const env=environment();const out=run(cerbo,'a34f0c7dac13a9e9',env,{statusCode:200,payload:{was_on:false},shellyExpectedOn:true});
  assert.equal(out.payload.ok,true);assert.equal(env.global.get('shellyActualOn'),true);
});
test('the durable winter journal cannot share a disk directory with the cached default context',()=>{
  const require=createRequire(import.meta.url),config=require('../settings-context.cjs');
  const regular=config[config.default];
  assert.equal(config.winter.config.cache,false);
  assert.notEqual(config.winter.config.base||'context',regular.config?.base||'context');
});
