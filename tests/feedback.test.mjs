import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './support.mjs';
import { feedback } from '../server/feedback.mjs';
import { application } from '../server/application.mjs';
import { createAppServer } from '../server/main.mjs';
import { secretBox } from '../server/security.mjs';

test('CSAT migration preserves data and survey link is idempotent, private, single-use and expiring',async()=>{
  const f=await fixture();
  try{
    const [unit]=await f.db.insert('fs_units',{name:'Survey unit',slug:'survey-unit'});
    const migration=await readFile(new URL('../sql/ATUALIZAR_INTEGRACAO_AVEC.sql',import.meta.url),'utf8');
    await f.pg.exec(migration);
    await f.pg.exec(migration);
    assert.equal((await f.db.select('fs_units',{id:'eq.'+unit.id}))[0].name,'Survey unit');
    const [contact]=await f.db.insert('fs_contacts',{unit_id:unit.id,name:'Private customer name',phone:'+5511999990001'});
    const survey=feedback({db:f.db,publicOrigin:'https://flow.example.test',secret:'private-survey-test-secret'});
    const request={unit,contact,appointment:null,jobKey:'rule:csat:event-one'};
    const issued=await survey.issue(request),repeated=await survey.issue(request);
    assert.equal(issued.url,repeated.url);
    const token=new URL(issued.url).hash.slice(1);
    const rows=await f.db.select('fs_feedback');
    assert.equal(rows.length,1);
    assert(!JSON.stringify(rows).includes(token));
    const state=await survey.inspect(token);
    assert.equal(state.answered,false);
    assert(!JSON.stringify(state).includes('Private customer name'));
    await assert.rejects(survey.answer(token,{score:6}),/nota/);
    await assert.rejects(survey.answer(token,{score:5,comment:'x'.repeat(1001)}),/1.000/);
    const results=await Promise.allSettled([survey.answer(token,{score:5,comment:'Ótimo atendimento'}),
      survey.answer(token,{score:1,comment:'A second response must not replace the first'})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
    assert.equal((await survey.inspect(token)).answered,true);
    assert.equal((await f.db.select('fs_feedback'))[0].score,5);
    const expired=await survey.issue({...request,jobKey:'expired-survey'});
    const expiredToken=new URL(expired.url).hash.slice(1);
    await f.db.update('fs_feedback',{id:'eq.'+expired.id},{expires_at:new Date(Date.now()-1000).toISOString()});
    await assert.rejects(survey.inspect(expiredToken),{status:410});
    await assert.rejects(survey.answer(expiredToken,{score:5}),{status:410});
    await assert.rejects(survey.inspect('not-a-real-token'),{status:404});
    await f.pg.exec('SET ROLE anon');
    await assert.rejects(f.pg.query('SELECT * FROM public.fs_feedback'),{code:'42501'});
    await assert.rejects(f.pg.query("SELECT public.fs_feedback_answer('abc',5,'')"),{code:'42501'});
  }finally{await f.pg.close()}
});

test('CSAT links require an explicitly configured public origin',async()=>{
  const survey=feedback({db:{},secret:'test'});
  assert.equal(survey.configured,false);
  await assert.rejects(survey.issue({unit:'id',contact:'id',jobKey:'event'}),{status:503});
  assert.throws(()=>feedback({db:{},publicOrigin:'https://flow.example.test/path',secret:'test'}));
});

test('next-day CSAT runs through the scheduler, public answer and isolated dashboard history',async()=>{
  const f=await fixture();
  let server;
  try{
    await f.pg.exec(await readFile(new URL('../sql/ATUALIZAR_INTEGRACAO_AVEC.sql',import.meta.url),'utf8'));
    const survey=feedback({db:f.db,publicOrigin:'https://survey.example.test',secret:'end-to-end-survey-secret'});
    const sent=[];
    const app=application({db:f.db,secrets:secretBox('end-to-end-credentials'),catalog:f.catalog,survey,
      send:async(sender,payload)=>{sent.push(payload);return {status:'processing',externalId:'csat-provider-message'}}});
    const [unit]=await f.db.insert('fs_units',{name:'CSAT end-to-end',slug:'csat-end-to-end',catalog_tenant:'10'});
    const catalog=await f.catalog();
    await f.db.rpc('fs_catalog_commit',{p_unit:unit.id,p_channels:catalog.channels,p_templates:catalog.templates,p_tenant:catalog.tenantId});
    const channel=(await f.db.select('fs_channels',{unit_id:'eq.'+unit.id,type:'eq.waba'}))[0];
    const template=(await f.db.select('fs_templates',{unit_id:'eq.'+unit.id}))[0];
    await f.db.update('fs_templates',{id:'eq.'+template.id},{body:'Avalie seu atendimento: {{1}}'});
    const claims=Buffer.from(JSON.stringify({tenantId:10,sessionId:1,channelType:'waba',exp:Date.now()/1000+3600})).toString('base64url');
    const master={master:true};
    const path='/units/'+unit.id;
    await app.route(master,'POST',path+'/sender',{channel_id:channel.id,enabled:true,
      url:'https://suporteapi.clickmassa.com.br/v1/api/external/00000000-0000-0000-0000-000000000001',token:'fake.'+claims+'.signature'});
    const [contact]=await f.db.insert('fs_contacts',{unit_id:unit.id,name:'Cliente do teste CSAT',phone:'+5511999990010',consent:true});
    const [service]=await f.db.insert('fs_services',{unit_id:unit.id,name:'Serviço concluído'});
    const yesterday=new Date(Date.now()-86400000).toISOString();
    const [appointment]=await f.db.insert('fs_appointments',{unit_id:unit.id,contact_id:contact.id,service_id:service.id,
      scheduled_at:yesterday,completed_at:yesterday,source:'avec',status:'finalized'});
    await f.db.insert('fs_rules',{unit_id:unit.id,name:'CSAT no dia seguinte',type:'csat',channel_id:channel.id,
      template_id:template.id,mapping:{1:'feedback.url'},delay_days:1,enabled:true,send_time:'00:00',
      armed_at:new Date(Date.now()-3*86400000).toISOString()});
    await app.tick();
    assert.equal(sent.length,1);
    const link=sent[0].params[0];
    assert(link.startsWith('https://survey.example.test/avaliar#'));
    assert(!link.includes(contact.name)&&!link.includes(contact.id));
    const token=new URL(link).hash.slice(1);
    const jobs=await f.db.select('fs_jobs',{unit_id:'eq.'+unit.id});
    assert.equal(jobs[0].status,'accepted');
    assert.equal(jobs[0].external_id,'csat-provider-message');
    assert.equal(jobs[0].payload.appointment_id,appointment.id);
    const before=await app.route(master,'GET',path+'/data',{});
    assert.equal(before.feedback.invited,1);
    assert.equal(before.feedback.total,0);
    ({server}=createAppServer({db:f.db,app,survey,secure:false}));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const publicPage=await fetch(base+'/avaliar');
    assert.equal(publicPage.status,200);
    assert.match(await publicPage.text(),/Como foi seu atendimento/);
    const endpoint=base+'/api/feedback/'+token;
    const inspect=await fetch(endpoint);
    assert.equal(inspect.status,200);
    assert.equal((await inspect.json()).answered,false);
    const rejected=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.example.test'},
      body:JSON.stringify({score:1,comment:'Must not be accepted'})});
    assert.equal(rejected.status,403);
    const answer=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},
      body:JSON.stringify({score:5,comment:'Excelente atendimento'})});
    assert.equal(answer.status,200);
    assert.deepEqual(await answer.json(),{saved:true});
    const after=await app.route(master,'GET',path+'/data',{});
    assert.equal(after.feedback.total,1);
    assert.equal(after.feedback.average,5);
    assert.equal(after.feedback.satisfied,100);
    assert.equal(after.feedback.responses[0].comment,'Excelente atendimento');
    assert(!JSON.stringify(after.feedback).includes(token));
    const history=await app.route(master,'GET',path+'/contacts/'+contact.id+'/history',{});
    assert.equal(history.feedback[0].score,5);
    assert.equal(history.appointments[0].id,appointment.id);
    const [viewer]=await f.db.insert('fs_users',{email:'csat-viewer@example.test',name:'Consulta',password_hash:'test',must_change_password:false});
    await f.db.insert('fs_memberships',{unit_id:unit.id,user_id:viewer.id,role:'viewer'});
    const viewerData=await app.route(viewer,'GET',path+'/data',{});
    assert.equal(viewerData.feedback.average,5);
    await assert.rejects(app.route(viewer,'POST',path+'/settings',{alerts:{arrival_enabled:true}}),{status:403});
    const [otherUnit]=await f.db.insert('fs_units',{name:'Outra unidade',slug:'other-csat-unit'});
    await assert.rejects(app.route(viewer,'GET','/units/'+otherUnit.id+'/data',{}),{status:403});
    await app.tick();
    assert.equal(sent.length,1);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await f.pg.close();
  }
});
