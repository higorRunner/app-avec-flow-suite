import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './support.mjs';
import { professionalAlerts } from '../server/alerts.mjs';

async function setup(){
  const f=await fixture();
  await f.pg.exec(await readFile(new URL('../sql/ATUALIZAR_INTEGRACAO_AVEC.sql',import.meta.url),'utf8'));
  const [unit]=await f.db.insert('fs_units',{name:'Professional alerts',slug:'professional-alerts',avec_config:{interval_minutes:15}});
  const catalog=await f.catalog();
  await f.db.rpc('fs_catalog_commit',{p_unit:unit.id,p_channels:catalog.channels,p_templates:catalog.templates,p_tenant:catalog.tenantId});
  const channel=(await f.db.select('fs_channels',{unit_id:'eq.'+unit.id,type:'eq.waba'}))[0];
  const template=(await f.db.select('fs_templates',{unit_id:'eq.'+unit.id}))[0];
  await f.db.update('fs_channels',{id:'eq.'+channel.id},{enabled:true,configured:true});
  const [professional]=await f.db.insert('fs_professionals',{unit_id:unit.id,external_id:'22',name:'Profissional teste',phone:'+5511999990022',enabled:true});
  const [contact]=await f.db.insert('fs_contacts',{unit_id:unit.id,name:'Cliente teste',phone:'+5511999990001'});
  const [service]=await f.db.insert('fs_services',{unit_id:unit.id,name:'Serviço teste'});
  const now=new Date('2026-11-18T15:00:00Z'),armed=new Date(now.getTime()-3600000).toISOString();
  await f.db.insert('fs_alert_settings',{unit_id:unit.id,arrival_enabled:true,stock_enabled:true,
    arrival_channel_id:channel.id,arrival_template_id:template.id,stock_channel_id:channel.id,stock_template_id:template.id,
    config:{armed_at:armed,arrival_mapping:{1:'customer.name'},stock_mapping:{1:'product.name'},stock_cooldown_days:2}});
  const [appointment]=await f.db.insert('fs_appointments',{unit_id:unit.id,contact_id:contact.id,service_id:service.id,
    scheduled_at:now.toISOString(),source:'avec',status:'waiting',professional_id:'22',professional_name:professional.name,arrived_at:now.toISOString()});
  const snapshot={unit_id:unit.id,report_code:'0046',external_key:'snapshot',observed_at:now.toISOString(),
    payload:{products:[{external_id:'product-1',name:'Produto teste',quantity:1,minimum:3,low_stock:true}]}};
  await f.db.insert('fs_avec_records',snapshot);
  const alerts=professionalAlerts({db:f.db,deliveryConfig:async(unitId,channelId,templateId)=>{
    assert.equal(unitId,unit.id);assert.equal(channelId,channel.id);assert.equal(templateId,template.id);
    return {channel:{...channel,enabled:true,configured:true},template};
  }});
  return {...f,unit,channel,template,professional,contact,service,appointment,snapshot,alerts,now,armed};
}

test('professional alerts enqueue confirmed arrivals and low stock once, refresh fields and revoke obsolete jobs',async()=>{
  const f=await setup();
  try{
    assert.deepEqual(await f.alerts.schedule(f.unit,{now:f.now}),{queued:2,skipped:0});
    assert.equal((await f.alerts.schedule(f.unit,{now:f.now})).queued,0);
    const jobs=await f.db.select('fs_jobs',{unit_id:'eq.'+f.unit.id});
    assert.equal(jobs.length,2);
    assert(jobs.every(job=>job.contact_id===null&&job.kind==='automatic'));
    const arrival=jobs.find(job=>job.payload.professional_alert.kind==='arrival');
    const stock=jobs.find(job=>job.payload.professional_alert.kind==='stock');
    assert.equal((await f.alerts.validate(arrival,f.unit,{now:f.now})).fields['customer.name'],f.contact.name);
    assert.equal((await f.alerts.validate(stock,f.unit,{now:f.now})).fields['product.quantity'],1);
    await f.db.update('fs_avec_records',{unit_id:'eq.'+f.unit.id},{payload:{products:[{...f.snapshot.payload.products[0],quantity:2}]}});
    assert.equal((await f.alerts.validate(stock,f.unit,{now:f.now})).fields['product.quantity'],2);
    await f.db.update('fs_appointments',{id:'eq.'+f.appointment.id},{status:'in_progress'});
    await assert.rejects(f.alerts.validate(arrival,f.unit,{now:f.now}),/aguardando/);
    await f.db.update('fs_avec_records',{unit_id:'eq.'+f.unit.id},{payload:{products:[]}});
    await assert.rejects(f.alerts.validate(stock,f.unit,{now:f.now}),/estoque mínimo/);
    await f.db.update('fs_professionals',{id:'eq.'+f.professional.id},{enabled:false});
    await assert.rejects(f.alerts.validate(stock,f.unit,{now:f.now}),/profissional/);
  }finally{await f.pg.close()}
});

test('professional alerts reject historical arrivals, stale stock, ambiguous names and changed settings',async()=>{
  const f=await setup();
  try{
    await f.db.update('fs_appointments',{id:'eq.'+f.appointment.id},{arrived_at:new Date(Date.parse(f.armed)-1000).toISOString()});
    await f.db.update('fs_avec_records',{unit_id:'eq.'+f.unit.id},{observed_at:new Date(f.now.getTime()-3600000).toISOString()});
    assert.equal((await f.alerts.schedule(f.unit,{now:f.now})).queued,0);
    await f.db.update('fs_appointments',{id:'eq.'+f.appointment.id},{arrived_at:f.now.toISOString(),professional_id:null});
    await f.db.insert('fs_professionals',{unit_id:f.unit.id,external_id:'33',name:f.professional.name,enabled:false});
    assert.equal((await f.alerts.schedule(f.unit,{now:f.now})).queued,0);
    await f.db.update('fs_appointments',{id:'eq.'+f.appointment.id},{professional_id:'22'});
    assert.equal((await f.alerts.schedule(f.unit,{now:f.now})).queued,1);
    const job=(await f.db.select('fs_jobs'))[0];
    await f.db.update('fs_alert_settings',{unit_id:'eq.'+f.unit.id},{config:{armed_at:f.now.toISOString(),arrival_mapping:{1:'customer.name'}}});
    await assert.rejects(f.alerts.validate(job,f.unit,{now:f.now}),/configuração/);
  }finally{await f.pg.close()}
});

test('low stock reminders respect rolling cooldown and never repeat an inconclusive send',async()=>{
  const f=await setup();
  try{
    await f.db.update('fs_alert_settings',{unit_id:'eq.'+f.unit.id},{arrival_enabled:false});
    assert.equal((await f.alerts.schedule(f.unit,{now:f.now})).queued,1);
    const job=(await f.db.select('fs_jobs'))[0];
    await f.db.update('fs_jobs',{id:'eq.'+job.id},{status:'accepted',created_at:f.now.toISOString()});
    const nextDay=new Date(f.now.getTime()+86400000);
    await f.db.update('fs_avec_records',{unit_id:'eq.'+f.unit.id},{observed_at:nextDay.toISOString()});
    assert.equal((await f.alerts.schedule(f.unit,{now:nextDay})).queued,0);
    const afterCooldown=new Date(f.now.getTime()+3*86400000);
    await f.db.update('fs_avec_records',{unit_id:'eq.'+f.unit.id},{observed_at:afterCooldown.toISOString()});
    await f.db.update('fs_jobs',{id:'eq.'+job.id},{status:'processing'});
    assert.equal((await f.alerts.schedule(f.unit,{now:afterCooldown})).queued,0);
    await f.db.update('fs_jobs',{id:'eq.'+job.id},{status:'accepted'});
    assert.equal((await f.alerts.schedule(f.unit,{now:afterCooldown})).queued,1);
  }finally{await f.pg.close()}
});
