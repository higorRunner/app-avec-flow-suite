import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// Use a second checkout to compare exactly the same local fixture with a previous release.
const [checkout='.', action='jobs'] = process.argv.slice(2);
const {fixture} = await import(pathToFileURL(resolve(checkout,'tests/support.mjs')));
const f = await fixture();
try {
  const user = {master:true};
  const unit = await f.app.route(user,'POST','/units',{name:'Unidade local',slug:'unidade-local'});
  const [channel] = await f.db.insert('fs_channels',{unit_id:unit.id,name:'Canal local',external_id:'1',type:'whatsapp'});
  await f.db.insert('fs_jobs',Array.from({length:100},(_,i)=>({
    unit_id:unit.id,channel_id:channel.id,kind:'test',phone:'+5511999990000',status:'accepted',
    idempotency_key:'fixture-'+i,payload:{body:'Mensagem de demonstração da unidade.'},
  })));
  const select = f.db.select;
  let calls = 0;
  f.db.select = (...args)=>{calls++;return select(...args)};
  const read = ()=>f.app.route(user,'GET','/units/'+unit.id+'/'+action,{});
  await read();
  const durations = [];
  let bytes;
  for(let i=0;i<21;i++){
    calls=0;
    const start=performance.now();
    const data=await read();
    bytes=Buffer.byteLength(JSON.stringify(data));
    durations.push(performance.now()-start);
  }
  durations.sort((a,b)=>a-b);
  console.log(JSON.stringify({action,reads:calls,bytes,median_ms:Number(durations[10].toFixed(2))}));
} finally {await f.pg.close()}
