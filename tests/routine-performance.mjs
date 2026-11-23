import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { candidates } from '../server/routines.mjs';

const count = 3000;
const now = new Date('2026-11-23T15:00:00Z');
const contacts = Array.from({length:count},(_,i)=>({id:'contact-'+i,consent:true,phone:'+5511999990000'}));
const appointments = contacts.flatMap((contact,i)=>[1,2,3].map(days=>({
  id:i+'-'+days,contact_id:contact.id,service_id:'local',status:'finalized',
  completed_at:new Date(now.getTime()-days*86400000).toISOString(),
})));
const jobs = appointments.filter((_,i)=>i%2===0).map(appointment=>({
  idempotency_key:'rule:sample:'+appointment.contact_id+':'+appointment.id,
  rule_id:'sample',contact_id:appointment.contact_id,status:'sent',created_at:'2026-11-20T12:00:00Z',
}));
const input = {
  contacts,appointments,jobs,now,services:[{id:'local',name:'Corte'}],
  unit:{timezone:'America/Sao_Paulo'},
  rule:{id:'sample',type:'post_service',enabled:true,armed_at:'2026-11-19T12:00:00Z',send_time:'08:00',delay_days:1,cooldown_days:2},
};

function measure(evaluate) {
  const expected=evaluate(input);
  const durations=Array.from({length:15},()=>{
    const start=performance.now();
    evaluate(input);
    return performance.now()-start;
  }).sort((a,b)=>a-b);
  return {expected,medianMs:Number(durations[7].toFixed(2))};
}
const current=measure(candidates);
const baseline=process.argv[2];
if(baseline){
  const previous=await import(pathToFileURL(resolve(baseline)));
  const before=measure(previous.candidates);
  assert.deepEqual(current.expected,before.expected);
  console.log('Baseline median (ms):',before.medianMs);
}
console.log('Current median (ms):',current.medianMs,'Eligible:',current.expected.length);
