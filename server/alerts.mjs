import { assert } from './security.mjs';
import { localDay } from './routines.mjs';

const eq=value=>'eq.'+value;
const sameInstant=(a,b)=>Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
const fieldKeys=new Set(['professional.name','customer.name','service.name','appointment.scheduled_at','product.name','product.quantity','product.minimum','establishment.name']);
const inFlight=new Set(['queued','processing']);
const accepted=new Set(['accepted','sent','delivered','read']);

export function professionalAlerts({db,deliveryConfig}) {
  const one=async(table,where)=>(await db.select(table,{...where,limit:1}))[0]||null;
  function settingsFor(settings,kind){
    const config=settings?.config||{};
    assert(['arrival','stock'].includes(kind)&&settings?.[kind+'_enabled']===true,
      'Este aviso foi desativado.');
    assert(Number.isFinite(Date.parse(config.armed_at)),'Salve a configuração dos avisos antes de enviar.');
    return {channelId:settings[kind+'_channel_id'],templateId:settings[kind+'_template_id'],
      mapping:config[kind+'_mapping']||{},armedAt:config.armed_at};
  }
  async function templateFor(unitId,settings,kind){
    const value=settingsFor(settings,kind);
    const delivery=await deliveryConfig(unitId,value.channelId,value.templateId);
    assert(delivery.channel.type==='waba'&&delivery.template,'Os avisos automáticos usam um modelo aprovado de um canal Oficial.');
    for(const key of delivery.template.variables){
      assert(fieldKeys.has(value.mapping[key]),'Preencha os campos do modelo de aviso.');
      if(kind==='arrival')assert(!value.mapping[key].startsWith('product.'),'O aviso de chegada não possui dados de produto.');
      if(kind==='stock')assert(!['customer.name','service.name','appointment.scheduled_at'].includes(value.mapping[key]),'O aviso de estoque não possui dados de cliente ou serviço.');
    }
    return value;
  }
  function professionalMatches(appointment,professionals){
    const matches=appointment.professional_id?
      professionals.filter(p=>p.external_id===String(appointment.professional_id)):
      professionals.filter(p=>p.name===appointment.professional_name);
    return matches.length===1?matches[0]:null;
  }
  function arrived(appointment,unit,armedAt,now){
    return appointment?.source==='avec'&&!appointment.canceled&&appointment.status==='waiting'&&
      Date.parse(appointment.arrived_at)>=Date.parse(armedAt)&&Date.parse(appointment.arrived_at)<=now.getTime()&&
      localDay(new Date(appointment.arrived_at),unit.timezone).day===localDay(now,unit.timezone).day;
  }
  function stockFresh(snapshot,unit,now){
    const minutes=Math.max(10,Math.min(1440,Number(unit.avec_config?.interval_minutes)||15)*2+5);
    return snapshot&&Date.parse(snapshot.observed_at)<=now.getTime()&&
      now.getTime()-Date.parse(snapshot.observed_at)<=minutes*60000;
  }
  function low(product){
    return product?.low_stock===true&&typeof product.name==='string'&&product.external_id&&
      (!(Number.isFinite(product.quantity)&&Number.isFinite(product.minimum))||product.quantity<=product.minimum);
  }
  function values(unit,professional,extra={}){
    return {'professional.name':professional.name,'establishment.name':unit.name,...extra};
  }
  async function arrivalFields(unit,professional,appointment){
    const [contact,service]=await Promise.all([
      one('fs_contacts',{unit_id:eq(unit.id),id:eq(appointment.contact_id)}),
      one('fs_services',{unit_id:eq(unit.id),id:eq(appointment.service_id)}),
    ]);
    assert(contact&&service,'O cliente ou o serviço do aviso não está disponível.');
    return values(unit,professional,{'customer.name':contact.name,'service.name':service.name,
      'appointment.scheduled_at':new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:unit.timezone}).format(new Date(appointment.scheduled_at))});
  }
  const stockFields=(unit,professional,product)=>values(unit,professional,{
    'product.name':product.name,'product.quantity':product.quantity,'product.minimum':product.minimum,
  });
  async function schedule(unit,{now=new Date()}={}){
    const settings=await one('fs_alert_settings',{unit_id:eq(unit.id)});
    if(!settings||!unit.active)return {queued:0,skipped:0};
    const allProfessionals=await db.all('fs_professionals',{unit_id:eq(unit.id)});
    const professionals=allProfessionals.filter(p=>p.enabled&&p.phone);
    const existingJobs=await db.all('fs_jobs',{unit_id:eq(unit.id)});
    const rows=[];let skipped=0;
    function row(kind,professional,settingsValue,fields,event,key){
      return {channel_id:settingsValue.channelId,template_id:settingsValue.templateId,phone:professional.phone,
        contact_id:null,rule_id:null,kind:'automatic',idempotency_key:key,
        payload:{mapping:settingsValue.mapping,fields,professional_alert:{kind,professional_id:professional.id,
          armed_at:settingsValue.armedAt,...event}}};
    }
    if(settings.arrival_enabled){
      let value;
      try{value=await templateFor(unit.id,settings,'arrival')}catch{skipped++}
      if(value){
        const appointments=await db.all('fs_appointments',{unit_id:eq(unit.id)});
        for(const appointment of appointments){
          if(!arrived(appointment,unit,value.armedAt,now))continue;
          const professional=professionalMatches(appointment,allProfessionals);
          if(!professional?.enabled||!professional.phone){skipped++;continue}
          try{
            const fields=await arrivalFields(unit,professional,appointment);
            const day=localDay(new Date(appointment.arrived_at),unit.timezone).day;
            rows.push(row('arrival',professional,value,fields,{appointment_id:appointment.id},
              `professional:arrival:${appointment.id}:${professional.id}:${day}`));
          }catch{skipped++}
        }
      }
    }
    if(settings.stock_enabled){
      let value;
      try{value=await templateFor(unit.id,settings,'stock')}catch{skipped++}
      const snapshot=await one('fs_avec_records',{unit_id:eq(unit.id),report_code:'eq.0046',external_key:'eq.snapshot'});
      if(value&&stockFresh(snapshot,unit,now)){
        const cooldown=Math.min(365,Math.max(1,Number(settings.config.stock_cooldown_days)||1))*86400000;
        for(const product of snapshot.payload?.products||[]){
          if(!low(product))continue;
          for(const professional of professionals){
            const blocked=existingJobs.some(job=>{
              const alert=job.payload?.professional_alert;
              return alert?.kind==='stock'&&alert.professional_id===professional.id&&alert.product_id===product.external_id&&
                (inFlight.has(job.status)||(accepted.has(job.status)&&now.getTime()-Date.parse(job.created_at)<cooldown));
            });
            if(blocked)continue;
            const day=localDay(now,unit.timezone).day;
            rows.push(row('stock',professional,value,stockFields(unit,professional,product),{product_id:product.external_id},
              `professional:stock:${product.external_id}:${professional.id}:${day}`));
          }
        }
      }
    }
    let queued=0;
    const knownKeys=new Set(existingJobs.map(job=>job.idempotency_key));
    const pending=rows.filter(row=>!knownKeys.has(row.idempotency_key));
    // Bound each pass; subsequent passes enqueue the remaining eligible rows.
    // fs_enqueue's unique key makes repeated and concurrent passes idempotent.
    for(let offset=0;offset<Math.min(pending.length,1000);offset+=100){
      queued+=await db.rpc('fs_enqueue',{p_unit:unit.id,p_rows:pending.slice(offset,offset+100)});
    }
    return {queued,skipped};
  }
  async function validate(job,unit,{now=new Date()}={}){
    assert(unit?.active,'Unidade desativada.');
    const alert=job.payload?.professional_alert;
    assert(alert,'Aviso profissional inválido.');
    const settings=await one('fs_alert_settings',{unit_id:eq(unit.id)});
    const value=await templateFor(unit.id,settings,alert.kind);
    assert(sameInstant(value.armedAt,alert.armed_at)&&value.channelId===job.channel_id&&value.templateId===job.template_id,
      'A configuração deste aviso foi alterada.');
    const professional=await one('fs_professionals',{unit_id:eq(unit.id),id:eq(alert.professional_id)});
    assert(professional?.enabled&&professional.phone===job.phone,'O profissional desativou os avisos ou mudou de telefone.');
    let fields;
    if(alert.kind==='arrival'){
      const appointment=await one('fs_appointments',{unit_id:eq(unit.id),id:eq(alert.appointment_id)});
      assert(arrived(appointment,unit,value.armedAt,now),'O cliente deixou de estar aguardando ou o aviso perdeu a validade.');
      const professionals=await db.all('fs_professionals',{unit_id:eq(unit.id)});
      assert(professionalMatches(appointment,professionals)?.id===professional.id,'O profissional deste atendimento foi alterado.');
      fields=await arrivalFields(unit,professional,appointment);
    }else{
      const snapshot=await one('fs_avec_records',{unit_id:eq(unit.id),report_code:'eq.0046',external_key:'eq.snapshot'});
      assert(stockFresh(snapshot,unit,now),'Sincronize o estoque AVEC antes de enviar este aviso.');
      const product=snapshot.payload?.products?.find(p=>p.external_id===alert.product_id);
      assert(low(product),'O produto deixou de estar abaixo do estoque mínimo.');
      fields=stockFields(unit,professional,product);
    }
    for(const field of Object.values(value.mapping))assert(fields[field]!==undefined&&fields[field]!==null&&String(fields[field])!=='','O modelo depende de um campo ausente neste aviso.');
    return {fields,mapping:value.mapping};
  }
  return {schedule,validate};
}
