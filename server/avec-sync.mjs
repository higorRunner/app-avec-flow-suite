import { createHash, randomUUID } from 'node:crypto';
import { assert, phone, text } from './security.mjs';
import { avecBirthday, avecBirthdayMonthDay, formatAvecDate } from './providers/avec.mjs';

const eq=value=>'eq.'+value;
const key=value=>createHash('sha256').update(String(value)).digest('hex');
export const avecDefaults={enabled:false,interval_minutes:15,history_days:90,future_days:30,salon_id:'',auto_import:true};
export function avecConfig(input={}){
  const config={...avecDefaults,...input};
  for(const [name,min,max]of [['interval_minutes',5,1440],['history_days',1,730],['future_days',1,180]]){
    config[name]=Number(config[name]);assert(Number.isInteger(config[name])&&config[name]>=min&&config[name]<=max,'Intervalo AVEC inválido: '+name);
  }
  config.enabled=config.enabled===true;config.auto_import=config.auto_import!==false;
  config.salon_id=text(config.salon_id,30);assert(!config.salon_id||/^\d+$/.test(config.salon_id),'ID da unidade AVEC inválido.');
  return config;
}
// Interpret the provider's local dates in the unit's timezone, including DST.
export function avecDate(value,zone='America/Sao_Paulo'){
  if(typeof value!=='string'||!value.trim())return null;
  let raw=value.trim();
  const br=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(.*)$/);
  if(br)raw=`${br[3]}-${br[2]}-${br[1]}${br[4]}`;
  if(!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(raw))return null;
  const iso=raw.replace(' ','T')+(raw.length===10?'T12:00:00':raw.length===16?':00':'');
  const nominal=Date.parse(iso+'Z');if(!Number.isFinite(nominal))return null;
  if(new Date(nominal).toISOString().slice(0,10)!==iso.slice(0,10))return null;
  let utc=nominal;
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(format.formatToParts(new Date(utc)).map(p=>[p.type,p.value]));
    const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    utc+=nominal-represented;
  }
  return new Date(utc).toISOString();
}
function normalizedPhone(...values){for(const value of values){try{return phone(String(value||''))}catch{}}return null}
function numeric(value){const match=String(value??'').match(/-?\d+(?:[.,]\d+)?/);return match?Number(match[0].replace(',','.')):null}

export async function syncAvecData({db,unit,token,report,onTrace,now=new Date()}){
  const config=avecConfig(unit.avec_config);
  const base=config.salon_id?{salao_unidade_id:config.salon_id}:{};
  const start=new Date(now.getTime()-config.history_days*86400000),end=new Date(now.getTime()+config.future_days*86400000);
  const range={inicio:formatAvecDate(start),fim:formatAvecDate(end)};
  const summary={started_at:now.toISOString(),reports:{},contacts:0,services:0,appointments:0,professionals:0,products:0,skipped:0,
    capabilities:{arrival:'O relatório Aguardando é consultado periodicamente; a AVEC deve marcar a chegada nesse estado.',completion:'Conclusão confirmada pela data de finalização da comanda.',stock:'Produtos abaixo do mínimo configurado na AVEC.'}};
  async function read(code,params={},required=false){
    try{
      const result=await report({code,token,params:{...base,...params},maxPages:100,onTrace});
      summary.reports[code]={state:'ready',records:result.result.length,pages:result.pages};
      return result.result;
    }catch(error){
      summary.reports[code]={state:'error',message:error.status?'AVEC HTTP '+error.status:'Não foi possível concluir este relatório.'};
      if(required||error.status===401||error.status===403)throw error;
      return null;
    }
  }
  const clients=await read('0004',{},true);
  const existingContacts=await db.all('fs_contacts',{unit_id:eq(unit.id)});
  const contactsByPhone=new Map(existingContacts.filter(c=>c.phone).map(c=>[c.phone,c]));
  const contactsByExternal=new Map(existingContacts.filter(c=>c.external_id).map(c=>[c.external_id,c]));
  const contactBatch=[];
  async function contact(row,batch=false){
    const external=String(row.salao_cliente_id??row.id??'');
    const number=normalizedPhone(row.celular,row.cel_cli,row.telefone,row.cliente_tel);
    const name=text(row.nome??row.cliente_nome,120);
    const previous=contactsByExternal.get(external)||(number?contactsByPhone.get(number):null);
    // An AVEC customer ID keeps history addressable even without a usable phone.
    // Missing numbers must never share a map key or collapse distinct customers.
    if(!name||(!external&&!number)){summary.skipped++;return previous||null}
    if(number&&previous&&contactsByPhone.has(number)&&contactsByPhone.get(number).id!==previous.id){summary.skipped++;return null}
    // Two distinct AVEC customer IDs sharing a phone cannot be merged silently.
    if(previous?.external_id&&external&&previous.external_id!==external){summary.skipped++;return null}
    const value={id:previous?.id||randomUUID(),unit_id:unit.id,external_id:external||previous?.external_id||null,
      name,phone:number,avec_global_id:row.cliente_id?String(row.cliente_id):previous?.avec_global_id||null,
      email:text(row.email,160)||previous?.email||null,birthday:avecBirthday(row.aniversario)||previous?.birthday||null,
      birthday_month_day:avecBirthdayMonthDay(row.aniversario)||previous?.birthday_month_day||null,
      consent:previous?.consent||false,source:'avec'};
    if(batch&&(!previous||previous.phone===number))contactBatch.push(value);
    else if(previous)await db.update('fs_contacts',{id:eq(previous.id),unit_id:eq(unit.id)},value);
    else await db.insert('fs_contacts',value);
    if(previous?.phone&&previous.phone!==number&&contactsByPhone.get(previous.phone)?.id===previous.id)contactsByPhone.delete(previous.phone);
    if(number)contactsByPhone.set(number,value);
    if(external)contactsByExternal.set(external,value);summary.contacts++;
    return value;
  }
  if(config.auto_import)for(const row of clients)await contact(row,true);
  const reachableContacts=[...new Map(contactBatch.filter(row=>row.phone).map(row=>[row.phone,row])).values()];
  const contactsWithoutPhone=[...new Map(contactBatch.filter(row=>!row.phone).map(row=>[row.external_id,row])).values()];
  for(let i=0;i<reachableContacts.length;i+=200)await db.upsert('fs_contacts',reachableContacts.slice(i,i+200),'unit_id,phone');
  for(let i=0;i<contactsWithoutPhone.length;i+=200)await db.upsert('fs_contacts',contactsWithoutPhone.slice(i,i+200),'unit_id,external_id');
  const serviceRows=await read('0033');
  const existingServices=await db.all('fs_services',{unit_id:eq(unit.id)});
  const servicesByExternal=new Map(existingServices.filter(s=>s.external_id).map(s=>[s.external_id,s]));
  const servicesByName=new Map(existingServices.map(s=>[s.name,s]));
  const serviceBatch=[];
  if(serviceRows&&config.auto_import)for(const row of serviceRows){
    if(row.id===undefined||!text(row.servico,120)){summary.skipped++;continue}
    const external=String(row.id),previous=servicesByExternal.get(external);
    const days=Number(row.retorno);
    const value={id:previous?.id||randomUUID(),unit_id:unit.id,external_id:external,name:text(row.servico,120),category:text(row.categoria,120),
      active:Number(row.status)===1,return_days:previous?.return_source==='manual'?previous.return_days:Number.isInteger(days)&&days>0&&days<=3650?days:null,
      return_source:previous?.return_source||'avec',source:'avec'};
    serviceBatch.push(value);
    servicesByExternal.set(external,value);servicesByName.set(value.name,value);summary.services++;
  }
  for(let i=0;i<serviceBatch.length;i+=200)await db.upsert('fs_services',serviceBatch.slice(i,i+200),'unit_id,external_id');
  const professionalRows=await read('0229');
  const professionals=await db.all('fs_professionals',{unit_id:eq(unit.id)});
  const professionalsByExternal=new Map(professionals.map(p=>[p.external_id,p]));
  const professionalsByName=new Map(professionals.map(p=>[p.name,p]));
  if(professionalRows&&config.auto_import)for(const row of professionalRows){
    if(row.id===undefined||!text(row.nome,120))continue;
    const previous=professionalsByExternal.get(String(row.id));
    const value={id:previous?.id||randomUUID(),unit_id:unit.id,external_id:String(row.id),name:text(row.nome,120),phone:previous?.phone||null,enabled:previous?.enabled||false};
    await db.upsert('fs_professionals',value,'unit_id,external_id');professionalsByExternal.set(value.external_id,value);
    professionalsByName.set(row.nome,value);if(row.apelido)professionalsByName.set(row.apelido,value);summary.professionals++;
  }
  const appointments=await db.all('fs_appointments',{unit_id:eq(unit.id)});
  const knownAppointments=new Map(appointments.filter(a=>a.external_id).map(a=>[a.external_id,a]));
  const appointmentBatch=new Map();
  async function appointment(value){
    const previous=knownAppointments.get(value.external_id);
    const record={...value,id:previous?.id||randomUUID(),unit_id:unit.id,source:'avec'};
    appointmentBatch.set(value.external_id,record);
    knownAppointments.set(record.external_id,record);summary.appointments++;
  }
  // The finalized receipt confirms an actual completed service; planned times do not.
  const completed=await read('0186',{inicio:range.inicio,fim:formatAvecDate(now)});
  const completedKeys=new Set();
  if(completed&&config.auto_import)for(const row of completed){
    if(row.tipo!=='Serviço'||!row.idComanda||!row.idItem)continue;
    const finished=avecDate(row.data_finalizada,unit.timezone);
    if(!finished||Date.parse(finished)>now.getTime())continue;
    completedKeys.add(`receipt:${row.idComanda}:${row.idItem}`);
    const service=servicesByExternal.get(String(row.tipo_id));
    const person=contactsByExternal.get(String(row.salao_cliente_id))||await contact({...row,id:undefined});
    if(!service||!person){summary.skipped++;continue}
    await appointment({external_id:`receipt:${row.idComanda}:${row.idItem}`,contact_id:person.id,service_id:service.id,
      scheduled_at:avecDate(row.data,unit.timezone)||finished,completed_at:finished,canceled:false,status:'completed',
      professional_id:row.profissional_id?String(row.profissional_id):null,professional_name:text(row.profissional,120),arrived_at:null});
  }
  if(completed&&config.auto_import)for(const previous of appointments){
    if(previous.external_id?.startsWith('receipt:')&&!completedKeys.has(previous.external_id)&&
      Date.parse(previous.scheduled_at)>=start.getTime()&&Date.parse(previous.scheduled_at)<=now.getTime())
      await appointment({...previous,completed_at:null,canceled:true,status:'reopened'});
  }
  // Report 0155 provides the real reservation ID, service ID and start time.
  // Planned dates and attendance state alone never prove actual completion.
  const agenda=await read('0155',range);
  if(agenda&&config.auto_import){
    const ids=new Set();
    for(const row of agenda){
      const person=contactsByExternal.get(String(row.salao_cliente_id));
      const service=servicesByExternal.get(String(row.servico_id));
      const minutes=Number(row.hora_ini);
      if(!row.id||!Number.isInteger(minutes)||minutes<0||minutes>=1440){summary.skipped++;continue}
      const date=avecDate(`${row.data} ${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}:00`,unit.timezone);
      if(!person||!service||!date){summary.skipped++;continue}
      const external='agenda:'+row.id;ids.add(external);
      const previous=knownAppointments.get(external);
      const status=String(row.status??'').trim().toLowerCase();
      const waiting=['aguardando','2'].includes(status),canceled=['cancelado','faltou','0','0.6'].includes(status);
      const professional=professionalsByName.get(row.apelido);
      await appointment({external_id:external,contact_id:person.id,service_id:service.id,scheduled_at:date,completed_at:null,
        canceled,status:waiting?'waiting':canceled?'canceled':['em atendimento','3'].includes(status)?'in_progress':'scheduled',
        professional_id:professional?.external_id||null,professional_name:text(row.apelido,120),
        arrived_at:waiting?(previous?.arrived_at||now.toISOString()):null});
    }
    // Reservations removed or rescheduled outside this complete report window
    // must stop blocking return/inactivity eligibility.
    for(const old of appointments)if(old.external_id?.startsWith('agenda:')&&!ids.has(old.external_id)&&
      Date.parse(old.scheduled_at)>=start.getTime()&&Date.parse(old.scheduled_at)<=end.getTime())
      await appointment({...old,canceled:true,status:'removed',arrived_at:null});
  }
  for(let i=0,rows=[...appointmentBatch.values()];i<rows.length;i+=200)await db.upsert('fs_appointments',rows.slice(i,i+200),'unit_id,external_id');
  const stock=await read('0046');
  if(stock){
    const products=stock.filter(row=>text(row.nome,160)).map(row=>({external_id:key([row.nome,row.marca,row.medida].join(':')),
      name:text(row.nome,160),quantity:numeric(row.atual),minimum:numeric(row.estoque_minimo),low_stock:true,brand:text(row.marca,120)}));
    await db.upsert('fs_avec_records',{unit_id:unit.id,report_code:'0046',external_key:'snapshot',payload:{products},observed_at:now.toISOString()},'unit_id,report_code,external_key');
    summary.products=products.length;
  }
  summary.finished_at=new Date().toISOString();
  return {summary,sample:clients.slice(0,5)};
}
