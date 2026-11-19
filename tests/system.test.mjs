import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './support.mjs';
import { candidates } from '../server/routines.mjs';
import { passwordHash, passwordMatches, secretBox } from '../server/security.mjs';
import { createAppServer } from '../server/main.mjs';
import { fetchReportPage, fetchReportAll, AvecError, avecBirthday, avecBirthdayMonthDay, requestUrl } from '../server/providers/avec.mjs';
import { readCatalog, ProviderError, sendMessage } from '../server/providers/clickmassa.mjs';
import { apiBase, externalEndpoint, publicAddress } from '../server/providers/http.mjs';
import { responseShape, diagnosticUrl } from '../server/diagnostics.mjs';
import { application } from '../server/application.mjs';

test('saving AVEC credentials queries the real API object format using a raw token and records HTTP 401',async()=>{
  const f=await fixture();
  try{
    const token='synthetic-raw-token';
    const requests=[];
    const app=application({db:f.db,secrets:secretBox('avec-integration-test-key'),version:'avec-contract-test',
      report:options=>fetchReportAll({...options,fetchImpl:async(url,request)=>{
        requests.push({url,authorization:request.headers.Authorization});
        if(request.headers.Authorization!==token)return Response.json({message:'Unauthorized'},{status:401});
        assert.equal(request.method,'GET');
        assert.equal(url,'https://api.avec.beauty/reports/0004?page=1&limit=250');
        return Response.json({code:200,data:{report:{description:'Synthetic report',requiredParams:'',total:null,
          result:[{nome:'Synthetic customer',celular:'11999990000'}],hasMore:false}}});
      }})});
    const master={id:randomUUID(),master:true};
    const unit=await app.route(master,'POST','/units',{name:'AVEC contract test',slug:'avec-contract-test'});
    const path='/units/'+unit.id;
    async function waitFor(expected){
      for(let i=0;i<100;i++){
        const info=await app.route(master,'GET',path+'/integration',{});
        if(info.unit.avec_state===expected)return info;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.fail('AVEC query did not finish');
    }
    await app.route(master,'POST',path+'/avec',{token});
    const success=await waitFor('ready');
    assert(success.unit.sample_columns.includes('nome'));
    assert(success.unit.sample_columns.includes('celular'));
    assert.equal(success.unit.avec_error,null);
    assert(success.diagnostics.some(entry=>entry.shape?.report?.path==='$.data.report'));
    assert(!JSON.stringify(success.diagnostics).includes(token));
    assert(!JSON.stringify(success.diagnostics).includes('Synthetic customer'));
    await app.route(master,'POST',path+'/avec',{token:'invalid-test-token'});
    const failure=await waitFor('error');
    assert.match(failure.unit.avec_error,/HTTP 401/);
    assert(failure.diagnostics.some(entry=>entry.http_status===401));
    assert.deepEqual(requests.map(entry=>entry.authorization),[token,'invalid-test-token']);
  }finally{await f.pg.close()}
});

test('visible diagnostics identify AVEC structure and HTTP errors without recording secrets or customer values',async()=>{
  const traces=[];
  const privateValue='never-record-this-private-value';
  await fetchReportPage({code:'0004',token:privateValue,onTrace:async entry=>traces.push(entry),
    fetchImpl:async()=>Response.json([{code:200,data:{report:{description:privateValue,
      result:[{nome:privateValue,email:privateValue}],hasMore:false}},token:privateValue,message:privateValue}])});
  assert.equal(traces.find(x=>x.stage==='http').http_status,200);
  const structure=traces.find(x=>x.stage==='response_structure').shape;
  assert.equal(structure.report.path,'[0].data.report');
  assert.deepEqual(structure.records,{type:'array',length:1});
  assert.equal(traces.find(x=>x.stage==='parsed').has_more,false);
  assert(!JSON.stringify(traces).includes(privateValue));
  assert(!JSON.stringify(responseShape({[privateValue]:privateValue,message:privateValue})).includes(privateValue));
  const url=diagnosticUrl('https://user:private@example.test/reports/0004?page=2&token='+privateValue+'&search='+privateValue);
  assert(!url.includes(privateValue));
  assert(!url.includes('user:private'));
  assert.equal(new URL(url).searchParams.get('page'),'2');
  traces.length=0;
  await assert.rejects(fetchReportPage({code:'0004',token:privateValue,onTrace:async entry=>traces.push(entry),
    fetchImpl:async()=>Response.json([{code:200,data:{report:{message:privateValue}}}])}),/Result/);
  assert.equal(traces.find(x=>x.stage==='http').http_status,200);
  assert.equal(traces.find(x=>x.stage==='response_structure').shape.records.type,'undefined');
  assert.equal(traces.at(-1).stage,'failed');
  assert(!JSON.stringify(traces).includes(privateValue));
  traces.length=0;
  await assert.rejects(fetchReportPage({code:'0004',token:privateValue,onTrace:async entry=>traces.push(entry),
    fetchImpl:async()=>new Response(privateValue,{status:403})}),/HTTP 403/);
  assert.equal(traces.find(x=>x.stage==='http').http_status,403);
  assert.equal(traces.at(-1).stage,'failed');
  assert(!JSON.stringify(traces).includes(privateValue));
});

test('reads the observed AVEC report envelope and paginates until report.hasMore is false',async()=>{
  assert.equal(avecBirthday('15/1/1990'),'1990-01-15');
  assert.equal(avecBirthday('29/02/2000'),'2000-02-29');
  assert.equal(avecBirthday('31/02/2000'),null);
  assert.equal(avecBirthday('15/1'),null);
  assert.equal(avecBirthday(''),null);
  assert.equal(avecBirthdayMonthDay('18/11'),'11-18');
  assert.equal(avecBirthdayMonthDay('31/02'),null);
  const requiredBlank=new URL(requestUrl('0051',{site:'',profissional_id:''}));
  assert.equal(requiredBlank.searchParams.get('site'),'');
  assert.equal(requiredBlank.searchParams.get('profissional_id'),'');
  const pages=[];
  const result=await fetchReportAll({code:'0004',token:'fake-avec-token',fetchImpl:async(url,options)=>{
    const page=Number(new URL(url).searchParams.get('page'));
    pages.push(page);
    assert.equal(options.headers.Authorization,'fake-avec-token');
    return Response.json([{code:200,data:{report:{
      description:'Relatório de teste',requiredParams:'',total:null,
      result:page===1?[{nome:'Cliente de teste',celular:'11999990000'}]:[],
      hasMore:page===1,
    }}}]);
  }});
  assert.deepEqual(pages,[1,2]);
  assert.equal(result.records,1);
  assert.equal(result.pages,2);
  assert.equal(result.result[0].nome,'Cliente de teste');
  for(const shape of [
    {code:200,data:{report:{result:[],hasMore:false}}},
    {Result:[],HasMore:false},
    {Data:{Result:[],HasMore:false}},
  ]){
    const page=await fetchReportPage({code:'0004',token:'fake',fetchImpl:async()=>Response.json(shape)});
    assert.deepEqual(page.result,[]);
    assert.equal(page.hasMore,false);
  }
  await assert.rejects(fetchReportPage({code:'0004',token:'fake',
    fetchImpl:async()=>Response.json([{code:401,data:{report:{result:[],hasMore:false}}}])}),
    error=>error instanceof AvecError&&error.status===401);
  await assert.rejects(fetchReportPage({code:'0149',token:'fake',fetchImpl:async()=>
    Response.json({code:200,data:{report:{code:'HY093',message:'private SQL error'}}})}),
    error=>error instanceof AvecError&&error.message.includes('falha interna')&&!error.message.includes('private SQL'));
});

test('custom Clickmassa base is used for login, channels, templates and channel send URL',async()=>{
  const base='https://api.example.test/platform';
  const calls=[];
  const catalog=await readCatalog({baseUrl:base+'/',email:'user@example.test',password:'fake',fetchImpl:async(url)=>{
    calls.push(url);
    if(url===base+'/auth/login/')return Response.json({tenantId:5,token:'catalog-token'});
    if(url===base+'/whatsapp/?hideInactive=true')return Response.json([
      {id:12,tenantId:5,name:'Canal de teste',type:'waba',isActive:true,status:'CONNECTED'},
    ]);
    assert.equal(new URL(url).searchParams.get('whatsappId'),'12');
    assert(url.startsWith(base+'/templates?'));
    return Response.json({templates:[{id:30,whatsappId:12,hsmId:'333',tenantId:5,name:'Modelo',
      templateType:'TEXT',status:'APPROVED',components:[{type:'BODY',text:'Olá'}]}],hasMore:false});
  }});
  assert.equal(catalog.channels[0].external_id,'12');
  assert.equal(calls.length,3);
  const endpoint=base+'/v1/api/external/00000000-0000-0000-0000-000000000001';
  await sendMessage({baseUrl:base,url:endpoint,token:'sender-token'},{number:'5511999990000'},async(url,options)=>{
    assert.equal(url,endpoint);
    assert.equal(options.headers.Authorization,'Bearer sender-token');
    return Response.json({message:{id:'provider-id',status:'pending'}});
  });
  assert.throws(()=>externalEndpoint(endpoint,'https://other.example.test'));
  assert.throws(()=>apiBase('http://api.example.test'));
  assert.throws(()=>apiBase('https://127.0.0.1'));
  assert.equal(publicAddress('10.0.0.1'),false);
  assert.equal(publicAddress('::ffff:127.0.0.1'),false);
  assert.equal(publicAddress('8.8.8.8'),true);
});

test('integration failures identify HTTP status without exposing credentials or response bodies',async()=>{
  const secret='private-test-credential';
  await assert.rejects(fetchReportPage({code:'0004',token:secret,fetchImpl:async()=>{
    return new Response('response contains '+secret,{status:401});
  }}),error=>error instanceof AvecError&&error.status===401&&error.message.includes('token')&&!error.message.includes(secret));
  await assert.rejects(fetchReportPage({code:'0004',token:secret,fetchImpl:async()=>{
    return Response.json({Result:[]});
  }}),error=>error instanceof AvecError&&error.status===null&&error.message.includes('HasMore'));
  await assert.rejects(readCatalog({email:'user@example.test',password:secret,fetchImpl:async(url,options)=>{
    assert.equal(options.headers.Origin,'https://cs.clickmassa.com.br');
    assert.equal(options.headers.Referer,'https://cs.clickmassa.com.br/');
    assert.deepEqual(JSON.parse(options.body),{email:'user@example.test',password:secret,captchaToken:''});
    return new Response('response contains '+secret,{status:401});
  }}),error=>error instanceof ProviderError&&error.status===401&&error.message.includes('autenticação')&&!error.message.includes(secret));
});

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
    await f.app.route(master,'POST','/units/'+unit.id+'/catalog',{base_url:'https://api.custom.test',email:'test@example.test',password:'fake'});
    for(let i=0;i<50;i++){
      if((await f.db.select('fs_units',{id:'eq.'+unit.id}))[0].sync_state==='ready')break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    let info=await f.app.route(master,'GET','/units/'+unit.id+'/integration',{});
    assert.equal(info.channels.length,2);
    assert.equal(info.templates.length,1);
    assert.equal(info.base_url,'https://api.custom.test');
    assert.equal(info.reader,'avec-report-envelope-v2');
    assert.equal(info.diagnostics.at(0).provider,'Clickmassa');
    assert.equal(info.diagnostics.at(0).channels,2);
    assert(!JSON.stringify(info).includes('"password"'));
    const channel=info.channels.find(c=>c.type==='waba'),template=info.templates[0];
    const claims=Buffer.from(JSON.stringify({tenantId:10,sessionId:1,channelType:'waba',exp:Date.now()/1000+3600})).toString('base64url');
    await f.app.route(master,'POST','/units/'+unit.id+'/sender',{channel_id:channel.id,
      url:'https://api.custom.test/v1/api/external/00000000-0000-0000-0000-000000000001?token=fake.'+claims+'.signature',enabled:true});
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
    const viewerData=await f.app.route(viewer,'GET','/units/'+unit.id+'/data',{});
    assert(viewerData.events.every(entry=>entry.event!=='diagnostic'));
    await assert.rejects(f.app.route(viewer,'POST','/units/'+unit.id+'/send',request),{status:403});
    const another=await f.app.route(master,'POST','/units',{name:'Other unit',slug:'other'});
    await assert.rejects(f.app.route(viewer,'GET','/units/'+another.id+'/data',{}),{status:403});
    await f.app.route(master,'POST','/units/'+unit.id+'/contacts',{name:'Client',phone:'+5511999990001',consent:false});
    const contact=(await f.db.select('fs_contacts'))[0];
    await assert.rejects(f.app.route(master,'POST','/units/'+unit.id+'/send',{...request,kind:'manual',contacts:[contact.id]}),
      /sem autorização/);
    await f.db.insert('fs_jobs',{unit_id:unit.id,channel_id:channel.id,template_id:template.id,phone:'+5511999990000',
      kind:'test',idempotency_key:'pending-before-move',payload:{params:['Equipe']}});
    await f.db.insert('fs_rules',{unit_id:unit.id,name:'Regra antiga',type:'birthday',channel_id:channel.id,
      template_id:template.id,enabled:true,armed_at:new Date().toISOString()});
    await f.app.route(master,'POST','/units/'+unit.id+'/catalog',{base_url:'https://api.new.test',
      email:'test@example.test',password:''});
    assert.equal((await f.db.select('fs_jobs',{idempotency_key:'eq.pending-before-move'}))[0].status,'skipped');
    assert.equal((await f.db.select('fs_rules'))[0].enabled,false);
    assert.equal((await f.db.select('fs_channels',{id:'eq.'+channel.id}))[0].enabled,false);
  }finally{
    await new Promise(resolve=>setTimeout(resolve,50));
    await f.pg.close();
  }
});

test('rules respect time zone, consent, future bookings and idempotency',()=>{
  const now=new Date('2026-11-18T15:00:00Z');
  const context={unit:{timezone:'America/Sao_Paulo'},now,preview:true,
    contacts:[{id:'c',consent:true,phone:'+5511999990000',birthday:'2000-11-18'}],
    services:[{id:'s',return_days:30},{id:'target'}],jobs:[],
    appointments:[{id:'a',contact_id:'c',service_id:'s',completed_at:'2026-11-18T13:00:00Z'}]};
  const rule={id:'r',type:'post_service',enabled:true,send_time:'11:00',delay_days:0,cooldown_days:7};
  assert.equal(candidates({...context,rule}).length,1);
  assert.equal(candidates({...context,rule:{...rule,send_time:'13:00'}}).length,0);
  assert.equal(candidates({...context,rule,contacts:[{id:'c',consent:false}]}).length,0);
  assert.equal(candidates({...context,rule,contacts:[{id:'c',consent:true,phone:null}]}).length,0);
  assert.equal(candidates({...context,rule,jobs:[{idempotency_key:'rule:r:c:a'}]}).length,0);
  assert.equal(candidates({...context,rule:{...rule,type:'birthday'}}).length,1);
  assert.equal(candidates({...context,rule:{...rule,type:'cross_sell',target_service_id:'target'}}).length,1);
  assert.equal(candidates({...context,rule:{...rule,type:'birthday'},contacts:[{id:'c',consent:true,phone:'+5511999990000',birthday_month_day:'11-18'}]}).length,1);
  assert.equal(candidates({...context,rule:{...rule,type:'return'},appointments:[{id:'old',contact_id:'c',service_id:'s',completed_at:'2026-10-01T13:00:00Z'}]}).length,1,'Overdue return remains eligible');
});

test('simulation reviews recipients, requires confirmation and queues selected events only once',async()=>{
  const f=await fixture();
  try{
    const user={master:true};
    const unit=(await f.db.insert('fs_units',{name:'Simulação',slug:'simulacao',catalog_tenant:'10'}))[0];
    await f.db.rpc('fs_catalog_commit',{p_unit:unit.id,...Object.fromEntries(
      Object.entries(await f.catalog()).filter(([key])=>key!=='tenantId').map(([key,value])=>['p_'+key,value])),
      p_tenant:'10'});
    const channel=(await f.db.select('fs_channels',{unit_id:'eq.'+unit.id,type:'eq.waba'}))[0];
    const template=(await f.db.select('fs_templates',{unit_id:'eq.'+unit.id}))[0];
    const claims=Buffer.from(JSON.stringify({tenantId:10,sessionId:1,channelType:'waba',exp:Date.now()/1000+3600})).toString('base64url');
    await f.app.route(user,'POST','/units/'+unit.id+'/sender',{channel_id:channel.id,enabled:true,
      url:'https://suporteapi.clickmassa.com.br/v1/api/external/00000000-0000-0000-0000-000000000001',
      token:'fake.'+claims+'.signature'});
    const contact=(await f.db.insert('fs_contacts',{unit_id:unit.id,name:'Cliente da simulação',phone:'+5511999990000',consent:true}))[0];
    const service=(await f.db.insert('fs_services',{unit_id:unit.id,name:'Corte'}))[0];
    await f.db.insert('fs_appointments',{unit_id:unit.id,contact_id:contact.id,service_id:service.id,
      scheduled_at:new Date().toISOString(),completed_at:new Date().toISOString()});
    const rule=(await f.db.insert('fs_rules',{unit_id:unit.id,name:'Revisão',type:'post_service',channel_id:channel.id,
      template_id:template.id,mapping:{1:'customer.name'},enabled:false,send_time:'00:00'}))[0];
    const preview=await f.app.route(user,'POST','/units/'+unit.id+'/simulate',{rule_id:rule.id});
    assert.equal(preview.count,1);
    assert.deepEqual(preview.items.map(item=>item.id),[contact.id]);
    await assert.rejects(f.app.route(user,'POST','/units/'+unit.id+'/simulate-send',{
      rule_id:rule.id,contacts:[contact.id],confirm:false}),/Confirme/);
    const sent=await f.app.route(user,'POST','/units/'+unit.id+'/simulate-send',{
      rule_id:rule.id,contacts:[contact.id],confirm:true});
    assert.equal(sent.queued,1);
    await assert.rejects(f.app.route(user,'POST','/units/'+unit.id+'/simulate-send',{
      rule_id:rule.id,contacts:[contact.id],confirm:true}),/elegibilidade mudou/);
    const jobs=await f.db.select('fs_jobs',{unit_id:'eq.'+unit.id});
    assert.equal(jobs.length,1);
    assert.equal(jobs[0].kind,'manual');
  }finally{
    await new Promise(resolve=>setTimeout(resolve,30));
    await f.pg.close();
  }
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
