import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './support.mjs';
import { syncAvecData, avecDate, avecConfig } from '../server/avec-sync.mjs';
import { fetchReportAll } from '../server/providers/avec.mjs';
import { candidates } from '../server/routines.mjs';

const now=new Date('2026-11-18T17:00:00Z');

function providerRows(){
  return {
    '0004':[
      {id:1,cliente_id:1001,nome:'Synthetic customer one',celular:'11999990001',aniversario:'15/1/1990'},
      {id:2,cliente_id:1002,nome:'Synthetic customer two',celular:'11999990002',aniversario:''},
      {id:3,cliente_id:1003,nome:'Conflicting phone customer',celular:'11999990002'},
      {id:4,cliente_id:1004,nome:'Invalid phone customer',celular:'invalid'},
      {id:5,cliente_id:1005,nome:'Missing phone customer'},
    ],
    '0033':[{id:101,servico:'Synthetic service',retorno:30,status:1,categoria:'Synthetic category'}],
    '0229':[{id:77,nome:'Synthetic professional',apelido:'Artist',cargo:'Synthetic role'}],
    '0186':[
      {idComanda:500,idItem:501,salao_cliente_id:1,tipo:'Serviço',tipo_id:101,data:'2026-11-17',
        data_finalizada:'2026-11-17 12:34:56',profissional_id:77,profissional:'Artist'},
      {idComanda:500,idItem:502,salao_cliente_id:1,tipo:'Serviço',tipo_id:101,data:'2026-11-17',data_finalizada:null},
      {idComanda:500,idItem:503,salao_cliente_id:1,tipo:'Produto',tipo_id:101,data:'2026-11-17',data_finalizada:'2026-11-17 13:00:00'},
      {idComanda:500,idItem:504,salao_cliente_id:3,nome:'Conflicting phone customer',celular:'11999990002',
        tipo:'Serviço',tipo_id:101,data:'2026-11-17',data_finalizada:'2026-11-17 13:00:00'},
      {idComanda:500,idItem:505,salao_cliente_id:4,tipo:'Serviço',tipo_id:101,data:'2026-11-17',data_finalizada:'2026-11-17 13:30:00'},
      {idComanda:500,idItem:506,salao_cliente_id:6,nome:'Receipt only customer without phone',
        tipo:'Serviço',tipo_id:101,data:'2026-11-17',data_finalizada:'2026-11-17 14:00:00'},
    ],
    '0155':[
      {id:601,salao_cliente_id:1,servico_id:101,data:'2026-11-19',hora_ini:630,apelido:'Artist',status:'Agendado'},
      {id:602,salao_cliente_id:2,servico_id:101,data:'2026-11-18',hora_ini:660,apelido:'Artist',status:'Aguardando'},
      {id:603,salao_cliente_id:1,servico_id:101,data:'2026-11-20',hora_ini:720,apelido:'Artist',status:'Cancelado'},
    ],
    '0046':[{nome:'Synthetic product',marca:'Synthetic brand',medida:'un',atual:2,estoque_minimo:5,diferenca:3}],
  };
}

function reportFrom(rows){
  return options=>fetchReportAll({...options,fetchImpl:async(url,request)=>{
    assert.equal(request.headers.Authorization,'synthetic-test-token');
    const code=new URL(url).pathname.split('/').at(-1);
    assert(code in rows,'Unexpected report '+code);
    return Response.json({code:200,data:{report:{description:'Synthetic report',requiredParams:'',total:null,
      result:structuredClone(rows[code]),hasMore:false}}});
  }});
}

test('AVEC local dates, configuration and minutes from midnight are interpreted in the unit timezone',()=>{
  assert.equal(avecDate('2026-11-18 10:30:00','America/Sao_Paulo'),'2026-11-18T13:30:00.000Z');
  assert.equal(avecDate('18/11/2026 10:30:00','America/Sao_Paulo'),'2026-11-18T13:30:00.000Z');
  assert.equal(avecDate('2026-02-31 10:30:00'),null);
  assert.equal(avecDate(null),null);
  assert.throws(()=>avecConfig({interval_minutes:1}));
  assert.throws(()=>avecConfig({history_days:9999}));
  assert.equal(avecConfig({enabled:true,interval_minutes:'15'}).interval_minutes,15);
});

test('AVEC sync is idempotent, preserves local settings, records real completion and reconciles canceled or removed agenda',async()=>{
  const f=await fixture();
  try{
    const unit=(await f.db.insert('fs_units',{name:'Synthetic AVEC unit',slug:'synthetic-avec-'+randomUUID(),
      timezone:'America/Sao_Paulo',avec_config:{enabled:true,auto_import:true,history_days:90,future_days:30}}))[0];
    const rows=providerRows();
    const sync=()=>syncAvecData({db:f.db,unit,token:'synthetic-test-token',report:reportFrom(rows),now});
    const first=await sync();
    assert.equal(first.summary.reports['0004'].state,'ready');
    assert(first.summary.skipped>=2,'Conflicting customer IDs must be counted as skipped');
    let contacts=await f.db.select('fs_contacts',{unit_id:'eq.'+unit.id});
    assert.equal(contacts.length,5);
    assert(!contacts.some(c=>c.external_id==='3'));
    for(const external of ['4','5','6']){
      const withoutPhone=contacts.find(c=>c.external_id===external);
      assert(withoutPhone,'Customers without phones retain distinct AVEC IDs');
      assert.equal(withoutPhone.phone,null);
      assert.equal(withoutPhone.consent,false);
    }
    assert(contacts.every(c=>c.consent===false));
    const customer=contacts.find(c=>c.external_id==='1');
    assert.equal(String(customer.birthday).slice(0,10),'1990-01-15');
    const service=(await f.db.select('fs_services',{unit_id:'eq.'+unit.id}))[0];
    assert.equal(service.return_days,30);
    const professional=(await f.db.select('fs_professionals',{unit_id:'eq.'+unit.id}))[0];
    let appointments=await f.db.select('fs_appointments',{unit_id:'eq.'+unit.id});
    assert.equal(appointments.length,6);
    const completed=appointments.find(a=>a.external_id==='receipt:500:501');
    assert.equal(new Date(completed.completed_at).toISOString(),'2026-11-17T15:34:56.000Z');
    assert(!appointments.some(a=>a.external_id==='receipt:500:502'),'An open receipt cannot prove completion');
    assert(!appointments.some(a=>a.external_id==='receipt:500:503'),'A product sale is not a service appointment');
    assert(!appointments.some(a=>a.external_id==='receipt:500:504'),'A conflicting customer must not receive another customer history');
    assert(appointments.some(a=>a.external_id==='receipt:500:505'),'A customer without a phone keeps completed service history');
    assert(appointments.some(a=>a.external_id==='receipt:500:506'),'A receipt can backfill a customer with an AVEC ID and no phone');
    assert.equal(new Date(appointments.find(a=>a.external_id==='agenda:601').scheduled_at).toISOString(),'2026-11-19T13:30:00.000Z');
    assert.equal(appointments.find(a=>a.external_id==='agenda:601').completed_at,null);
    const waiting=appointments.find(a=>a.external_id==='agenda:602');
    assert.equal(waiting.status,'waiting');
    assert.equal(new Date(waiting.arrived_at).toISOString(),now.toISOString());
    assert.equal(appointments.find(a=>a.external_id==='agenda:603').canceled,true);
    const ids=new Map(appointments.map(a=>[a.external_id,a.id]));
    await f.db.update('fs_contacts',{id:'eq.'+customer.id},{consent:true});
    await f.db.update('fs_services',{id:'eq.'+service.id},{return_days:42,return_source:'manual'});
    await f.db.update('fs_professionals',{id:'eq.'+professional.id},{phone:'+5511999990099',enabled:true});
    await sync();
    assert.equal((await f.db.select('fs_contacts',{unit_id:'eq.'+unit.id})).length,5);
    assert.equal((await f.db.select('fs_services',{unit_id:'eq.'+unit.id})).length,1);
    assert.equal((await f.db.select('fs_professionals',{unit_id:'eq.'+unit.id})).length,1);
    assert.equal((await f.db.select('fs_services',{id:'eq.'+service.id}))[0].return_days,42);
    const updatedProfessional=(await f.db.select('fs_professionals',{id:'eq.'+professional.id}))[0];
    assert.equal(updatedProfessional.phone,'+5511999990099');
    assert.equal(updatedProfessional.enabled,true);
    appointments=await f.db.select('fs_appointments',{unit_id:'eq.'+unit.id});
    assert.equal(appointments.length,6);
    assert(appointments.every(a=>ids.get(a.external_id)===a.id));
    assert.equal(new Date(appointments.find(a=>a.external_id==='agenda:602').arrived_at).toISOString(),now.toISOString());
    rows['0155']=rows['0155'].filter(a=>a.id!==602);
    rows['0155'].find(a=>a.id===601).status='Cancelado';
    await sync();
    appointments=await f.db.select('fs_appointments',{unit_id:'eq.'+unit.id});
    assert.equal(appointments.find(a=>a.external_id==='agenda:601').canceled,true);
    assert.equal(appointments.find(a=>a.external_id==='agenda:602').status,'removed');
    assert.equal(appointments.find(a=>a.external_id==='agenda:602').canceled,true);
    contacts=await f.db.select('fs_contacts',{unit_id:'eq.'+unit.id});
    const due=candidates({unit,rule:{id:'r',type:'inactive',delay_days:1,cooldown_days:0,send_time:'09:00'},
      contacts,appointments,services:[service],jobs:[],now,preview:true});
    assert.equal(due.length,1,'Canceled and removed future appointments must not block inactivity eligibility');
    const stock=(await f.db.select('fs_avec_records',{unit_id:'eq.'+unit.id,report_code:'eq.0046'}))[0];
    assert.equal(stock.payload.products[0].quantity,2);
    assert.equal(stock.payload.products[0].minimum,5);
    assert.equal(stock.payload.products[0].low_stock,true);
    rows['0186']=rows['0186'].filter(row=>row.idItem!==501);
    await sync();
    const reopened=(await f.db.select('fs_appointments',{unit_id:'eq.'+unit.id,external_id:'eq.receipt:500:501'}))[0];
    assert.equal(reopened.completed_at,null);
    assert.equal(reopened.canceled,true);
  }finally{await f.pg.close()}
});
