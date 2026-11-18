import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './support.mjs';
import { candidates } from '../server/routines.mjs';
import { passwordHash, passwordMatches, secretBox } from '../server/security.mjs';
import { createAppServer } from '../server/main.mjs';

test('schema reset is repeatable and browser roles cannot read application data',async()=>{
  const f=await fixture();
  try{
    await f.pg.exec(f.schema);
    await f.pg.exec('SET ROLE authenticated');
    await assert.rejects(f.pg.query('SELECT * FROM public.fs_credentials'),{code:'42501'});
    await assert.rejects(f.pg.query("SELECT public.fs_bootstrap('a','b','c')"),{code:'42501'});
  }finally{await f.pg.close()}
});

test('credentials are encrypted and passwords use salted hashes',async()=>{
  const hash=await passwordHash('temporary-password');
  assert.equal(await passwordMatches('temporary-password',hash),true);
  assert.equal(await passwordMatches('incorrect-password',hash),false);
  const box=secretBox('test-key');
  const encrypted=box.encrypt({password:'fake-secret'});
  assert(!encrypted.includes('fake-secret'));
  assert.deepEqual(box.decrypt(encrypted),{password:'fake-secret'});
  assert.throws(()=>secretBox('different-key').decrypt(encrypted));
});

test('master setup, catalog sync, test send, idempotency, queue acknowledgement and tenant isolation',async()=>{
  const f=await fixture();
  try{
    const master={id:randomUUID(),master:true};
    const unit=await f.app.route(master,'POST','/units',{name:'Test unit',slug:'test'});
    await f.app.route(master,'POST','/units/'+unit.id+'/catalog',{email:'test@example.test',password:'fake'});
    for(let i=0;i<50;i++){
      if((await f.db.select('fs_units',{id:'eq.'+unit.id}))[0].sync_state==='ready')break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    let info=await f.app.route(master,'GET','/units/'+unit.id+'/integration',{});
    assert.equal(info.channels.length,2);
    assert.equal(info.templates.length,1);
    assert(!JSON.stringify(info).includes('"password"'));
    const channel=info.channels.find(c=>c.type==='waba'),template=info.templates[0];
    const claims=Buffer.from(JSON.stringify({tenantId:10,sessionId:1,channelType:'waba',exp:Date.now()/1000+3600})).toString('base64url');
    await f.app.route(master,'POST','/units/'+unit.id+'/sender',{channel_id:channel.id,
      url:'https://suporteapi.clickmassa.com.br/v1/api/external/00000000-0000-0000-0000-000000000001?token=fake.'+claims+'.signature',enabled:true});
    const request={request_id:randomUUID(),kind:'test',phone:'+5511999990000',channel_id:channel.id,template_id:template.id,
      params:['Equipe'],confirm:true};
    await f.app.route(master,'POST','/units/'+unit.id+'/send',request);
    await f.app.route(master,'POST','/units/'+unit.id+'/send',request);
    for(let i=0;i<50;i++){
      const job=(await f.db.select('fs_jobs'))[0];
      if(job.status==='accepted')break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    const jobs=await f.db.select('fs_jobs');
    assert.equal(jobs.length,1);
    assert.equal(jobs[0].status,'accepted');
    assert.equal(jobs[0].external_id,'provider-1');
    assert.equal(f.deliveries,1);
    await f.app.route(master,'POST','/units/'+unit.id+'/members',{email:'viewer@example.test',name:'Viewer',
      password:'temporary-password',role:'viewer'});
    const viewer=(await f.db.select('fs_users',{email:'eq.viewer@example.test'}))[0];
    await f.db.update('fs_users',{id:'eq.'+viewer.id},{must_change_password:false});
    viewer.must_change_password=false;
    await assert.rejects(f.app.route(viewer,'GET','/units/'+unit.id+'/integration',{}),{status:403});
    await assert.rejects(f.app.route(viewer,'POST','/units/'+unit.id+'/send',request),{status:403});
    const another=await f.app.route(master,'POST','/units',{name:'Other unit',slug:'other'});
    await assert.rejects(f.app.route(viewer,'GET','/units/'+another.id+'/data',{}),{status:403});
    await f.app.route(master,'POST','/units/'+unit.id+'/contacts',{name:'Client',phone:'+5511999990001',consent:false});
    const contact=(await f.db.select('fs_contacts'))[0];
    await assert.rejects(f.app.route(master,'POST','/units/'+unit.id+'/send',{...request,kind:'manual',contacts:[contact.id]}),
      /sem autorização/);
  }finally{
    await new Promise(resolve=>setTimeout(resolve,50));
    await f.pg.close();
  }
});

test('rules respect time zone, consent, future bookings and idempotency',()=>{
  const now=new Date('2026-11-18T15:00:00Z');
  const context={unit:{timezone:'America/Sao_Paulo'},now,preview:true,
    contacts:[{id:'c',consent:true,birthday:'2000-11-18'}],
    services:[{id:'s',return_days:30},{id:'target'}],jobs:[],
    appointments:[{id:'a',contact_id:'c',service_id:'s',completed_at:'2026-11-18T13:00:00Z'}]};
  const rule={id:'r',type:'post_service',enabled:true,send_time:'11:00',delay_days:0,cooldown_days:7};
  assert.equal(candidates({...context,rule}).length,1);
  assert.equal(candidates({...context,rule:{...rule,send_time:'13:00'}}).length,0);
  assert.equal(candidates({...context,rule,contacts:[{id:'c',consent:false}]}).length,0);
  assert.equal(candidates({...context,rule,jobs:[{idempotency_key:'rule:r:c:a'}]}).length,0);
  assert.equal(candidates({...context,rule:{...rule,type:'birthday'}}).length,1);
  assert.equal(candidates({...context,rule:{...rule,type:'cross_sell',target_service_id:'target'}}).length,1);
});

test('native scheduler delivers one automatic message and preserves idempotency on the next pass',async()=>{
  const f=await fixture();
  try{
    const unit=(await f.db.insert('fs_units',{name:'Rotinas',slug:'rotinas',catalog_tenant:'10'}))[0];
    await f.db.rpc('fs_catalog_commit',{p_unit:unit.id,...Object.fromEntries(
      Object.entries(await f.catalog()).filter(([key])=>key!=='tenantId').map(([key,value])=>['p_'+key,value])),
      p_tenant:'10'});
    const channel=(await f.db.select('fs_channels',{unit_id:'eq.'+unit.id,type:'eq.waba'}))[0];
    const template=(await f.db.select('fs_templates'))[0];
    const claims=Buffer.from(JSON.stringify({tenantId:10,sessionId:1,channelType:'waba',exp:Date.now()/1000+3600})).toString('base64url');
    await f.app.route({master:true},'POST','/units/'+unit.id+'/sender',{channel_id:channel.id,enabled:true,
      url:'https://suporteapi.clickmassa.com.br/v1/api/external/00000000-0000-0000-0000-000000000001',
      token:'fake.'+claims+'.signature'});
    const contact=(await f.db.insert('fs_contacts',{unit_id:unit.id,name:'Cliente',phone:'+5511999990000',consent:true}))[0];
    const service=(await f.db.insert('fs_services',{unit_id:unit.id,name:'Corte'}))[0];
    await f.db.insert('fs_appointments',{unit_id:unit.id,contact_id:contact.id,service_id:service.id,
      scheduled_at:new Date().toISOString(),completed_at:new Date().toISOString()});
    await f.db.insert('fs_rules',{unit_id:unit.id,name:'Pós-serviço',type:'post_service',channel_id:channel.id,
      template_id:template.id,mapping:{1:'customer.name'},enabled:true,send_time:'00:00',
      armed_at:new Date(Date.now()-86400000).toISOString()});
    await f.app.tick();
    await f.app.tick();
    const jobs=await f.db.select('fs_jobs');
    assert.equal(jobs.length,1);
    assert.equal(jobs[0].kind,'automatic');
    assert.equal(jobs[0].status,'accepted');
    assert.equal(f.deliveries,1);
  }finally{
    await new Promise(resolve=>setTimeout(resolve,30));
    await f.pg.close();
  }
});

test('HTTP login stores HttpOnly cookie and rejects cross-origin changes',async()=>{
  const f=await fixture();
  const hash=await passwordHash('temporary-password');
  await f.db.rpc('fs_bootstrap',{p_email:'admin@example.test',p_name:'Admin',p_hash:hash});
  const {server}=createAppServer({db:f.db,app:f.app,secure:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},
      body:JSON.stringify({email:'admin@example.test',password:'temporary-password'})});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie');
    assert(cookie.includes('HttpOnly')&&cookie.includes('SameSite=Strict'));
    const me=await fetch(base+'/api/me',{headers:{Cookie:cookie.split(';')[0]}});
    assert.equal((await me.json()).master,true);
    const csrf=await fetch(base+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.test',Cookie:cookie},
      body:'{}'});
    assert.equal(csrf.status,403);
  }finally{await new Promise(resolve=>server.close(resolve));await f.pg.close()}
});
