import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateMessage, validContextMapping, validParameters } from '../public/message-contract.js';
import { fixture } from './support.mjs';

test('message sources and CSAT link are validated against actual template slots',()=>{
  const slots=['1'];
  assert.ok(validContextMapping('csat',slots,{1:'feedback.url'}));
  assert.equal(validContextMapping('csat',slots,{1:'customer.name',2:'feedback.url'}),false);
  assert.equal(validContextMapping('manual',slots,{1:'feedback.url'}),false);
  assert.equal(validContextMapping('arrival',slots,{1:'product.name'}),false);
  assert.ok(validContextMapping('stock',slots,{1:'product.name'}));
  assert.ok(validContextMapping('report',slots,{1:'column:valor'},new Set(['valor'])));
  assert.equal(validContextMapping('report',slots,{1:'column:valor'},new Set()),false);
  assert.ok(validContextMapping('manual',[],{}));
  assert.equal(validParameters(slots,['   ']),false);
  assert.equal(validParameters(slots,['x'.repeat(1025)]),false);
  assert.equal(interpolateMessage('{{1}} · {{ 1 }}',()=>'Maria'),'Maria · Maria');
});

test('job polling returns display columns only and checks unit membership',async()=>{
  const f=await fixture();
  try {
    const master={master:true};
    const units=await Promise.all(['a','b'].map(slug=>f.app.route(master,'POST','/units',{name:'Unidade '+slug,slug:'local-'+slug})));
    const [viewer]=await f.db.insert('fs_users',{name:'Consulta',email:'viewer@example.test',password_hash:'fixture',must_change_password:false});
    await f.db.insert('fs_memberships',{unit_id:units[0].id,user_id:viewer.id,role:'viewer'});
    for(const unit of units){
      const [channel]=await f.db.insert('fs_channels',{unit_id:unit.id,name:'Local',type:'whatsapp',external_id:'1'});
      await f.db.insert('fs_contacts',{unit_id:unit.id,name:unit.slug,phone:'+5511999990000',email:'contato@example.test'});
      await f.db.insert('fs_jobs',{unit_id:unit.id,channel_id:channel.id,kind:'test',phone:'+5511999990000',
        status:'accepted',idempotency_key:unit.slug,payload:{body:'privado'},external_id:unit.slug});
    }
    const jobs=await f.app.route(viewer,'GET','/units/'+units[0].id+'/jobs',{});
    assert.deepEqual(jobs.map(job=>job.external_id),['local-a']);
    assert.deepEqual(Object.keys(jobs[0]).sort(),['id','created_at','kind','phone','status','error','external_id'].sort());
    await assert.rejects(f.app.route(viewer,'GET','/units/'+units[1].id+'/jobs',{}),{status:403});
    const operation=await f.app.route(viewer,'GET','/units/'+units[0].id+'/data',{});
    assert.equal(operation.channels.length,1);
    assert.equal(Object.hasOwn(operation.channels[0],'external_id'),false);
    assert.equal(Object.hasOwn(operation,'professionals'),false);
    assert.deepEqual(operation.contacts.map(({id,...contact})=>contact),[{name:'local-a'}]);
    await assert.rejects(f.app.route(viewer,'GET','/units/'+units[0].id+'/settings',{}),{status:403});
    await assert.rejects(f.app.route(viewer,'GET','/units/'+units[1].id+'/data',{}),{status:403});
    await assert.rejects(f.app.route(viewer,'POST','/units/'+units[0].id+'/send',{}),{status:403});
  } finally {await f.pg.close()}
});
