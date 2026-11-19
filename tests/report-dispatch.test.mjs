import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support.mjs';
import { reportDispatch } from '../server/report-dispatch.mjs';

async function setup(){
  const f=await fixture();
  const [unit]=await f.db.insert('fs_units',{name:'Reports',slug:'reports',catalog_tenant:'10'});
  const [other]=await f.db.insert('fs_units',{name:'Other reports',slug:'other-reports'});
  const [user]=await f.db.insert('fs_users',{email:'reports@example.test',name:'Manager',password_hash:'test',must_change_password:false});
  const [secondUser]=await f.db.insert('fs_users',{email:'other@example.test',name:'Second',password_hash:'test',must_change_password:false});
  await f.db.insert('fs_memberships',{unit_id:unit.id,user_id:user.id,role:'manager'});
  const catalog=await f.catalog();
  await f.db.rpc('fs_catalog_commit',{p_unit:unit.id,p_channels:catalog.channels,p_templates:catalog.templates,p_tenant:'10'});
  const channel=(await f.db.select('fs_channels',{unit_id:'eq.'+unit.id,type:'eq.waba'}))[0];
  const template=(await f.db.select('fs_templates',{unit_id:'eq.'+unit.id}))[0];
  await f.db.update('fs_channels',{id:'eq.'+channel.id},{enabled:true,configured:true});
  const [contact]=await f.db.insert('fs_contacts',{unit_id:unit.id,name:'Authorized customer',phone:'+5511999990001',external_id:'101',avec_global_id:'9001',consent:true});
  const dispatch=reportDispatch({db:f.db,deliveryConfig:async(unitId,channelId,templateId)=>{
    assert.equal(unitId,unit.id);assert.equal(channelId,channel.id);assert.equal(templateId,template.id);
    return {channel,template};
  }});
  return {...f,unit,other,user,secondUser,channel,template,contact,dispatch};
}

test('report sends use server snapshots, scope actor and unit, resolve customer IDs and prevent duplicate enqueue',async()=>{
  const f=await setup();
  try{
    const issued=await f.dispatch.issue({unit:f.unit.id,user:f.user.id,code:'0186',rows:[{salao_cliente_id:101,nome:'Report name',valor:125.5}]});
    const input={snapshot_id:issued.snapshot_id,rows:[0],id_column:'salao_cliente_id',channel_id:f.channel.id,template_id:f.template.id,mapping:{1:'column:valor'}};
    const preview=await f.dispatch.preview(f.unit.id,f.user.id,input);
    assert.equal(preview.ready,1);assert.equal(preview.rows[0].phone,f.contact.phone);
    assert.deepEqual(preview.rows[0].params,['125.5']);
    await assert.rejects(f.dispatch.preview(f.other.id,f.user.id,input),{status:410});
    await assert.rejects(f.dispatch.preview(f.unit.id,f.secondUser.id,input),{status:410});
    await assert.rejects(f.dispatch.enqueue(f.unit.id,f.user.id,input),/Confirme/);
    const result=await f.dispatch.enqueue(f.unit.id,f.user.id,{...input,confirm:true,phone:'+5511999990099',fields:{valor:'tampered'}});
    assert.equal(result.queued,1);
    const [job]=await f.db.select('fs_jobs',{unit_id:'eq.'+f.unit.id});
    assert.equal(job.phone,f.contact.phone);assert.equal(job.payload.fields['report.1'],'125.5');
    assert.equal((await f.dispatch.enqueue(f.unit.id,f.user.id,{...input,confirm:true})).queued,0);
    await assert.rejects(f.dispatch.preview(f.unit.id,f.user.id,{...input,rows:[999]}),/itens válidos/);
    await assert.rejects(f.dispatch.preview(f.unit.id,f.user.id,{...input,rows:[0,0]}),/itens válidos/);
    await assert.rejects(f.dispatch.preview(f.unit.id,f.user.id,{...input,mapping:{1:'column:__proto__'}}),/campo/);
    const global=await f.dispatch.issue({unit:f.unit.id,user:f.user.id,code:'0008',rows:[{cliente_id:9001}]});
    const resolved=await f.dispatch.preview(f.unit.id,f.user.id,{...input,snapshot_id:global.snapshot_id,id_column:'cliente_id',mapping:{1:'customer.name'}});
    assert.equal(resolved.rows[0].phone,f.contact.phone);
    await f.db.update('fs_report_previews',{id:'eq.'+issued.snapshot_id},{expires_at:'2000-01-01T00:00:00Z'});
    await assert.rejects(f.dispatch.preview(f.unit.id,f.user.id,input),{status:410});
    await f.pg.exec('SET ROLE authenticated');
    await assert.rejects(f.pg.query('SELECT * FROM public.fs_report_previews'),{code:'42501'});
    await f.pg.exec('RESET ROLE');
  }finally{await f.pg.close()}
});

test('report recipient review preserves blocks and identity checks while new valid numbers are available',async()=>{
  const f=await setup();
  try{
    await f.db.update('fs_contacts',{id:'eq.'+f.contact.id},{consent:false,send_blocked:true});
    const issued=await f.dispatch.issue({unit:f.unit.id,user:f.user.id,code:'0004',rows:[
      {id:101,celular:'11999990001',nome:'Existing',valor:'A'},
      {id:'',celular:'11999990002',nome:'New customer',valor:'B'},
      {id:'',celular:'invalid',nome:'Invalid',valor:'C'},
      {id:101,celular:'11999990003',nome:'Mismatch',valor:'D'},
    ]});
    const input={snapshot_id:issued.snapshot_id,rows:[0],phone_column:'celular',id_column:'id',channel_id:f.channel.id,template_id:f.template.id,mapping:{1:'column:valor'}};
    assert.match((await f.dispatch.preview(f.unit.id,f.user.id,input)).rows[0].reason,/bloqueado/);
    await assert.rejects(f.dispatch.enqueue(f.unit.id,f.user.id,{...input,confirm:true,confirm_new_contacts:true}),/bloqueados/);
    const fresh={...input,rows:[1]};
    assert.equal((await f.dispatch.preview(f.unit.id,f.user.id,fresh)).rows[0].new_contact,true);
    assert.equal((await f.dispatch.enqueue(f.unit.id,f.user.id,{...fresh,confirm:true})).queued,1);
    const [created]=await f.db.select('fs_contacts',{unit_id:'eq.'+f.unit.id,phone:'eq.+5511999990002'});
    assert.equal(created.consent,true);assert.equal(created.source,'report');
    assert.match((await f.dispatch.preview(f.unit.id,f.user.id,{...input,rows:[2]})).rows[0].reason,/inválido/);
    await f.db.update('fs_contacts',{id:'eq.'+f.contact.id},{consent:true,send_blocked:false});
    assert.match((await f.dispatch.preview(f.unit.id,f.user.id,{...input,rows:[3]})).rows[0].reason,/difere/);
    const blocked=await f.dispatch.issue({unit:f.unit.id,user:f.user.id,code:'0186',rows:[{celular:'11999990001',valor:{private:'nested'}}]});
    assert.match((await f.dispatch.preview(f.unit.id,f.user.id,{...input,snapshot_id:blocked.snapshot_id,id_column:''})).rows[0].reason,/composto/);
    const viewer={...f.secondUser,master:false};
    await f.db.insert('fs_memberships',{unit_id:f.unit.id,user_id:viewer.id,role:'viewer'});
    await assert.rejects(f.app.route(viewer,'POST','/units/'+f.unit.id+'/report-send',input),{status:403});
    await assert.rejects(f.app.route(f.user,'GET','/units/'+f.unit.id+'/integration',{}),{status:403});
    await assert.rejects(f.app.route(f.user,'POST','/units',{name:'Forbidden',slug:'forbidden'}),{status:403});
  }finally{await f.pg.close()}
});
