import { randomUUID } from 'node:crypto';
import { assert, AppError, text, phone, uuid, passwordHash } from './security.mjs';
import { readCatalog, senderEndpoint, messagePayload, sendMessage, ProviderError } from './providers/clickmassa.mjs';
import { apiBase, DEFAULT_API_BASE } from './providers/http.mjs';
import { fetchReportAll, fetchReportPage, AvecError, avecBirthday } from './providers/avec.mjs';
import { syncAvecData, avecConfig } from './avec-sync.mjs';
import reportCatalog from './providers/avec-catalog.json' with {type:'json'};
import { professionalAlerts } from './alerts.mjs';
import { candidates, ruleTypes } from './routines.mjs';
import { reportDispatch } from './report-dispatch.mjs';

const eq = value => 'eq.' + value;
const fields = ['customer.name','customer.phone','customer.email','customer.birthday','service.name',
  'appointment.scheduled_at','appointment.completed_at','establishment.name','feedback.url'];
const safeUnit = ({ avec_sample, ...unit }) => ({ ...unit, sample_columns:Object.keys(avec_sample?.[0]||{}) });

export function application({ db, secrets, catalog = readCatalog, send = sendMessage, report = fetchReportAll,
  version = process.env.GIT_SHA || 'desenvolvimento', survey, pageReport=fetchReportPage }) {
  const busy = new Set();
  let ticking=false;
  const alerts=professionalAlerts({db,deliveryConfig});
  const dispatch=reportDispatch({db,deliveryConfig});

  async function one(table, where) {
    return (await db.select(table,{...where,limit:1}))[0] || null;
  }
  async function credential(unit,kind) {
    const row=await one('fs_credentials',{unit_id:eq(unit),kind:eq(kind)});
    return row ? secrets.decrypt(row.encrypted) : null;
  }
  async function saveCredential(unit,kind,value) {
    await db.upsert('fs_credentials',{unit_id:unit,kind,encrypted:secrets.encrypt(value),updated_at:new Date().toISOString()},'unit_id,kind');
  }
  async function event(unit,event,state,detail) {
    await db.insert('fs_events',{unit_id:unit,event,state,detail});
  }
  function trace(unit,provider) {
    return async info=>{
      const {state='info',...data}=info;
      const detail={provider,version,reader:'avec-report-envelope-v2',...data};
      console.log('Diagnóstico FlowSuite',JSON.stringify({unit,...detail}));
      try { await event(unit,'diagnostic',state,JSON.stringify(detail)); }
      catch { console.error('Não foi possível persistir o diagnóstico da integração.'); }
    };
  }
  async function access(user,unit,write=false,manage=false) {
    const record=await one('fs_units',{id:eq(uuid(unit))});
    assert(record,'Unidade não encontrada.',404);
    if(user.master) return {...record,role:'master'};
    const membership=await one('fs_memberships',{unit_id:eq(unit),user_id:eq(user.id)});
    assert(record.active && membership,'Você não tem acesso a esta unidade.',403);
    assert(!write || membership.role!=='viewer','Seu perfil permite consulta.',403);
    assert(!manage || membership.role==='manager','Esta ação exige um gestor.',403);
    return {...record,role:membership.role};
  }
  function master(user) { assert(user.master,'Acesso restrito ao painel master.',403); }
  async function unitData(user,id) {
    const unit=await access(user,id);
    const [channels,templates,contacts,services,appointments,rules,jobs,events]=await Promise.all([
      db.select('fs_channels',{unit_id:eq(id),order:'name'}),
      db.select('fs_templates',{unit_id:eq(id),order:'name'}),
      db.select('fs_contacts',{unit_id:eq(id),order:'name',limit:100}),
      db.select('fs_services',{unit_id:eq(id),order:'name'}),
      db.select('fs_appointments',{unit_id:eq(id),order:'scheduled_at.desc',limit:100}),
      db.select('fs_rules',{unit_id:eq(id),order:'name'}),
      db.select('fs_jobs',{unit_id:eq(id),order:'created_at.desc',limit:100}),
      db.select('fs_events',{unit_id:eq(id),event:'neq.diagnostic',order:'created_at.desc',limit:30}),
    ]);
    const [professionals,stock,feedback]=await Promise.all([
      db.select('fs_professionals',{unit_id:eq(id),order:'name'}),
      db.select('fs_avec_records',{unit_id:eq(id),report_code:'eq.0046',external_key:'eq.snapshot'}),
      db.select('fs_feedback',{unit_id:eq(id),select:'id,contact_id,appointment_id,score,comment,created_at,answered_at',order:'created_at.desc',limit:500}),
    ]);
    const responses=feedback.filter(row=>row.score!==null);
    return {unit:safeUnit(unit),channels,templates,contacts,services,appointments,rules,jobs,events,professionals,
      products:stock[0]?.payload?.products||[],feedback:{configured:survey?.configured||false,responses,total:responses.length,invited:feedback.length,
        average:responses.length?responses.reduce((sum,row)=>sum+row.score,0)/responses.length:null,
        satisfied:responses.length?100*responses.filter(row=>row.score>=4).length/responses.length:0}};
  }
  async function integration(user,id) {
    master(user);
    const unit=await access(user,id);
    const account=await credential(id,'catalog');
    const credentials=await db.select('fs_credentials',{unit_id:eq(id),select:'kind'});
    const rows=await db.select('fs_events',{unit_id:eq(id),event:'eq.diagnostic',order:'created_at.desc,id.desc',limit:100});
    const diagnostics=rows.flatMap(row=>{
      try { return [{id:row.id,created_at:row.created_at,state:row.state,...JSON.parse(row.detail)}]; }
      catch { return []; }
    });
    return {unit:safeUnit(unit),email:account?.email||'',base_url:account?.baseUrl||DEFAULT_API_BASE,avec:credentials.some(c=>c.kind==='avec'),
      diagnostics,version,reader:'avec-report-envelope-v2',
      channels:await db.select('fs_channels',{unit_id:eq(id),order:'name'}),
      templates:await db.select('fs_templates',{unit_id:eq(id),order:'name'})};
  }
  async function synchronize(id) {
    if(busy.has(id)) return;
    busy.add(id);
    const onTrace=trace(id,'Clickmassa');
    try {
      const unit=await one('fs_units',{id:eq(id),active:'eq.true'});
      if(!unit) return;
      const account=await credential(id,'catalog');
      assert(account,'Cadastre a conta Clickmassa.');
      await db.update('fs_units',{id:eq(id)},{sync_state:'syncing',sync_error:null});
      const result=await catalog({...account,tenantId:unit.catalog_tenant,onTrace});
      await db.rpc('fs_catalog_commit',{p_unit:id,p_channels:result.channels,p_templates:result.templates,p_tenant:result.tenantId});
      await onTrace({stage:'completed',state:'ok',channels:result.channels.length,templates:result.templates.length});
      await event(id,'catalog','ok',`${result.channels.length} canais e ${result.templates.length} modelos importados.`);
    } catch(error) {
      const detail=error instanceof ProviderError||error instanceof AppError?error.message:'Confira a conta Clickmassa e o formato do catálogo.';
      await onTrace({stage:'failed',state:'error',message:detail});
      await db.update('fs_units',{id:eq(id)},{sync_state:'error',sync_error:detail});
      await event(id,'catalog','error',detail);
    } finally {busy.delete(id)}
  }
  function launch(task) { Promise.resolve().then(task).catch(error=>console.error('Tarefa FlowSuite:',error.message)); }
  async function syncAvec(id) {
    const key='avec:'+id;
    if(busy.has(key)) return;
    busy.add(key);
    const onTrace=trace(id,'AVEC');
    try {
      const previousUnit=await one('fs_units',{id:eq(id)});
      await db.update('fs_units',{id:eq(id)},{avec_state:'syncing',avec_error:null,
        avec_summary:{...previousUnit.avec_summary,attempted_at:new Date().toISOString()}});
      const value=await credential(id,'avec');
      assert(value?.token,'Cadastre o token AVEC.');
      const originalUnit=await one('fs_units',{id:eq(id)});
      if(originalUnit.avec_config?.enabled){
        const result=await syncAvecData({db,unit:originalUnit,token:value.token,report,onTrace});
        const failures=Object.entries(result.summary.reports).filter(([,v])=>v.state==='error');
        const detail=failures.length?'Relatórios AVEC pendentes: '+failures.map(([code])=>code).join(', ')+'. Confira o diagnóstico.':null;
        await db.update('fs_units',{id:eq(id)},{avec_state:failures.length?'error':'ready',avec_error:detail,
          avec_summary:result.summary,avec_sample:result.sample,avec_checked_at:new Date().toISOString()});
        await event(id,'avec',failures.length?'error':'ok',`${result.summary.contacts} clientes, ${result.summary.services} serviços e ${result.summary.appointments} atendimentos sincronizados.`);
        await onTrace({stage:'completed',state:failures.length?'error':'ok',records:result.summary.contacts});
        return;
      }
      const result=await report({code:'0004',token:value.token,maxPages:100,onTrace});
      // Only a bounded sample is exposed to the administrator for field mapping.
      await db.update('fs_units',{id:eq(id)},{avec_state:'ready',avec_checked_at:new Date().toISOString(),
        avec_sample:result.result.slice(0,5),avec_error:null});
      const unit=await one('fs_units',{id:eq(id)});
      const imported=unit.avec_mapping?.name?await importContacts(unit,result.result):null;
      await onTrace({stage:'completed',state:'ok',records:result.records,pages:result.pages,imported});
      await event(id,'avec','ok',`${result.records} registros consultados. ${imported===null?'Configure os campos para importar os clientes.':imported+' clientes importados ou atualizados com nome e telefone válidos.'}`);
    } catch(error) {
      const detail=error instanceof AvecError||error instanceof AppError?error.message:
        'Não foi possível concluir a consulta ou importação AVEC. Confira os campos de importação.';
      await onTrace({stage:'failed',state:'error',message:detail});
      await db.update('fs_units',{id:eq(id)},{avec_state:'error',avec_error:detail});
      await event(id,'avec','error',detail);
    } finally {busy.delete(key)}
  }
  async function importContacts(unit,rows) {
    const mapping=unit.avec_mapping;
    assert(mapping.name && mapping.phone,'Selecione os campos de nome e telefone.');
    const existing=await db.all('fs_contacts',{unit_id:eq(unit.id)});
    const known=new Map(existing.map(c=>[c.phone,c]));
    const records=new Map();
    for(const row of rows){
      const name=text(row[mapping.name],120);
      let normalized;
      try{normalized=phone(String(row[mapping.phone]||''))}catch{continue}
      if(!name) continue;
      const previous=known.get(normalized);
      const record={id:previous?.id||randomUUID(),unit_id:unit.id,name,phone:normalized,email:text(row[mapping.email],160)||null,
        consent:previous?.consent||false,birthday:previous?.birthday||null,external_id:previous?.external_id||null};
      if(mapping.birthday){
        const birthday=avecBirthday(row[mapping.birthday]);
        if(birthday)record.birthday=birthday;
      }
      records.set(normalized,record);
    }
    const values=[...records.values()];
    for(let i=0;i<values.length;i+=200) await db.upsert('fs_contacts',values.slice(i,i+200),'unit_id,phone');
    return values.length;
  }
  async function deliveryConfig(unit,channelId,templateId) {
    const channel=await one('fs_channels',{id:eq(channelId),unit_id:eq(unit)});
    assert(channel?.active && channel.enabled && channel.configured,'O canal precisa estar conectado e liberado para envio.');
    let template=null;
    if(channel.type==='waba'){
      template=await one('fs_templates',{id:eq(uuid(templateId)),unit_id:eq(unit),channel_id:eq(channelId),active:'eq.true',supported:'eq.true'});
      assert(template,'Escolha um modelo textual aprovado deste canal.');
    }
    return {channel,template};
  }
  function validateSender(sender,channel,tenant,baseUrl = DEFAULT_API_BASE) {
    senderEndpoint(sender.url,baseUrl);
    let claims;
    try{claims=JSON.parse(Buffer.from(sender.token.split('.')[1],'base64url').toString('utf8'))}
    catch{throw new AppError('Token de envio inválido.')}
    assert(String(claims.sessionId)===channel.external_id && String(claims.tenantId)===tenant &&
      claims.channelType===channel.type && Number(claims.exp)>Date.now()/1000,
      'O token precisa corresponder ao canal, à empresa e estar válido.');
  }
  async function ruleContext(unit) {
    const [contacts,appointments,services,jobs]=await Promise.all([
      db.all('fs_contacts',{unit_id:eq(unit.id)}),db.all('fs_appointments',{unit_id:eq(unit.id)}),
      db.all('fs_services',{unit_id:eq(unit.id)}),db.all('fs_jobs',{unit_id:eq(unit.id)}),
    ]);
    return {unit,contacts,appointments,services,jobs};
  }
  async function expand(context,item,rule) {
    const value={ 'customer.name':item.contact.name,'customer.phone':item.contact.phone,
      'customer.email':item.contact.email,'customer.birthday':item.contact.birthday,
      'establishment.name':context.unit.name,'service.name':item.event.service?.name };
    if(rule.type==='csat'){
      assert(survey?.configured,'Configure PUBLIC_ORIGIN para os links de avaliação.');
      value['feedback.url']=(await survey.issue({unit:context.unit,contact:item.contact,appointment:item.event.appointment,jobKey:item.key})).url;
    }
    for(const key of ['scheduled_at','completed_at']){
      const date=item.event.appointment?.[key];
      value['appointment.'+key]=date?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:context.unit.timezone}).format(new Date(date)):null;
    }
    return value;
  }
  async function schedule(unit) {
    if(unit.avec_config?.enabled&&unit.avec_state!=='ready')return;
    const rules=await db.select('fs_rules',{unit_id:eq(unit.id),enabled:'eq.true'});
    if(!rules.length) return;
    const context=await ruleContext(unit);
    for(const rule of rules){
      try {await deliveryConfig(unit.id,rule.channel_id,rule.template_id)}catch{continue}
      const matches=candidates({...context,rule});
      // One recipient per rule on a pass also makes cooldown effective within the batch.
      const rows=[];
      for(const item of matches.slice(0,100)){
        rows.push({channel_id:rule.channel_id,template_id:rule.template_id,contact_id:item.contact.id,rule_id:rule.id,
          phone:item.contact.phone,kind:'automatic',idempotency_key:item.key,
          payload:{mapping:rule.mapping,rule_armed_at:rule.armed_at,fields:await expand(context,item,rule),
            appointment_id:item.event.appointment?.id}});
      }
      if(rows.length) await db.rpc('fs_enqueue',{p_unit:unit.id,p_rows:rows});
    }
  }
  async function processJob() {
    const job=await db.rpc('fs_claim');
    if(!job) return false;
    let outcome;
    try {
      const unit=await one('fs_units',{id:eq(job.unit_id),active:'eq.true'});
      assert(unit,'Unidade desativada.');
      if(job.kind==='automatic'&&unit.avec_config?.enabled&&unit.avec_state!=='ready'){
        await db.update('fs_jobs',{id:eq(job.id),status:'eq.processing'},{status:'queued',
          scheduled_at:new Date(Date.now()+60000).toISOString(),error:'Aguardando sincronização AVEC válida.'});
        return true;
      }
      const {channel,template}=await deliveryConfig(job.unit_id,job.channel_id,job.template_id);
      const sender=await credential(job.unit_id,'sender:'+channel.id);
      assert(sender,'Credencial de envio pendente.');
      const account=await credential(job.unit_id,'catalog');
      const baseUrl=account?.baseUrl||DEFAULT_API_BASE;
      validateSender(sender,channel,unit.catalog_tenant,baseUrl);
      if(job.payload.professional_alert){
        Object.assign(job.payload,await alerts.validate(job,unit));
      }else if(job.kind!=='test'){
        const contact=await one('fs_contacts',{id:eq(job.contact_id),unit_id:eq(job.unit_id)});
        assert(contact?.consent&&contact.phone===job.phone,'O contato revogou a autorização ou mudou de telefone.');
      }
      if(job.rule_id){
        const rule=await one('fs_rules',{id:eq(job.rule_id),unit_id:eq(job.unit_id)});
        assert(rule?.enabled && Date.parse(rule.armed_at)===Date.parse(job.payload.rule_armed_at) && rule.channel_id===job.channel_id && rule.template_id===job.template_id &&
          Date.parse(rule.armed_at)<=Date.parse(job.created_at),'A regra foi pausada ou alterada.');
        if(job.payload.appointment_id){
          const appointment=await one('fs_appointments',{id:eq(job.payload.appointment_id),unit_id:eq(job.unit_id)});
          assert(appointment?.completed_at&&!appointment.canceled,'O atendimento deixou de estar concluído.');
        }
        if(['return','inactive','cross_sell'].includes(rule.type)){
          const future=await db.all('fs_appointments',{unit_id:eq(unit.id),contact_id:eq(job.contact_id),canceled:'eq.false'});
          assert(!future.some(a=>!a.completed_at&&Date.parse(a.scheduled_at)>Date.now()&&
            (rule.type==='inactive'||a.service_id===(rule.type==='cross_sell'?rule.target_service_id:rule.service_id||
              future.find(p=>p.id===job.payload.appointment_id)?.service_id))),
            'O cliente já possui um agendamento futuro para esta rotina.');
        }
      }
      const payload=messagePayload({
        id:job.id,phone:job.phone,channel_type:channel.type,provider_template_id:template?.provider_id,
        variable_keys:template?.variables,fields:job.payload.fields||{},
        test_run:job.kind==='test',payload:{...job.payload,variable_mapping:job.payload.mapping,test_params:job.payload.params},
      });
      const result=await send({...sender,baseUrl},payload);
      outcome={status:result.status==='processing'?'accepted':result.status,external_id:result.externalId,
        error:null,completed_at:new Date().toISOString()};
    } catch(error) {
      outcome=error instanceof ProviderError && error.ambiguous?
        {status:'processing',error:'Resposta inconclusiva. Confira o protocolo no Clickmassa antes de repetir.'}:
        {status:error instanceof AppError?'skipped':'failed',
          error:error instanceof AppError||error instanceof ProviderError?error.message:'Confira os dados e os campos desta mensagem.'};
    }
    await db.update('fs_jobs',{id:eq(job.id),status:'eq.processing'},outcome);
    return true;
  }
  let nextCatalog=0;
  let nextSchedule=0;
  let nextLogCleanup=0;
  async function tick() {
    if(ticking) return;
    ticking=true;
    try {
      await db.upsert('fs_runtime',{id:'app',version:'2',seen_at:new Date().toISOString()},'id');
      const units=await db.select('fs_units',{active:'eq.true'});
      if(Date.now()>nextCatalog){
        nextCatalog=Date.now()+15*60000;
        for(const unit of units) if(await credential(unit.id,'catalog')) launch(()=>synchronize(unit.id));
      }
      if(Date.now()>nextSchedule){
        nextSchedule=Date.now()+60000;
        for(const unit of units){
          const config=avecConfig(unit.avec_config);
          const lastAttempt=Date.parse(unit.avec_summary?.attempted_at||unit.avec_summary?.finished_at||unit.avec_checked_at||0);
          if(config.enabled&&(!Number.isFinite(lastAttempt)||Date.now()-lastAttempt>=config.interval_minutes*60000)){
            launch(()=>syncAvec(unit.id));continue;
          }
          await schedule(unit);
          if(!config.enabled||unit.avec_state==='ready')await alerts.schedule(unit);
        }
      }
      for(let i=0;i<10;i++) if(!await processJob()) break;
      await db.remove('fs_sessions',{expires_at:'lt.'+new Date().toISOString()});
      await db.remove('fs_report_previews',{expires_at:'lt.'+new Date().toISOString()});
      if(Date.now()>nextLogCleanup){
        await db.remove('fs_events',{event:'eq.diagnostic',created_at:'lt.'+new Date(Date.now()-7*86400000).toISOString()});
        nextLogCleanup=Date.now()+3600000;
      }
    } finally {ticking=false}
  }

  async function route(user,method,path,input) {
    const parts=path.split('/').filter(Boolean);
    if(path==='/account/password' && method==='POST'){
      const hash=await passwordHash(input.password);
      await db.update('fs_users',{id:eq(user.id)},{password_hash:hash,must_change_password:false});
      await db.remove('fs_sessions',{user_id:eq(user.id)});
      return {loginAgain:true};
    }
    assert(!user.must_change_password,'Defina sua senha antes de continuar.',403);
    if(path==='/units'&&method==='GET'){
      if(user.master) return db.select('fs_units',{select:'id,name,slug,timezone,active,sync_state,synced_at',order:'name'});
      const memberships=await db.select('fs_memberships',{user_id:eq(user.id)});
      if(!memberships.length) return [];
      return db.select('fs_units',{id:'in.('+memberships.map(m=>m.unit_id).join(',')+')',active:'eq.true',select:'id,name,slug,timezone,active',order:'name'});
    }
    if(path==='/units'&&method==='POST'){
      master(user);
      const name=text(input.name,120),slug=text(input.slug,100);
      assert(name.length>=2&&/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug),'Preencha o nome e um identificador válido.');
      const timezone=text(input.timezone,80)||'America/Sao_Paulo';
      try{new Intl.DateTimeFormat('pt-BR',{timeZone:timezone}).format()}catch{throw new AppError('Fuso horário inválido.')}
      return (await db.insert('fs_units',{name,slug,timezone}))[0];
    }
    assert(parts[0]==='units'&&parts[1],'Rota não encontrada.',404);
    const id=uuid(parts[1]),action=parts[2]||'data';
    const unit=await access(user,id,method!=='GET',action==='rules');
    if(action==='data'&&method==='GET') return unitData(user,id);
    if(action==='settings'&&method==='GET'){
      assert(unit.role==='master'||unit.role==='manager','Esta ação exige um gestor.',403);
      const settings=await one('fs_alert_settings',{unit_id:eq(id)});
      return {unit:safeUnit(unit),professionals:await db.select('fs_professionals',{unit_id:eq(id),order:'name'}),
        services:await db.select('fs_services',{unit_id:eq(id),order:'name'}),
        alerts:settings?{...settings,...settings.config,channel_id:settings.arrival_channel_id||settings.stock_channel_id}:null,
        report_catalog:reportCatalog,csat_configured:survey?.configured||false};
    }
    if(action==='settings'&&method==='POST'){
      assert(unit.role==='master'||unit.role==='manager','Esta ação exige um gestor.',403);
      if(input.avec){
        const config=avecConfig(input.avec);
        assert(!config.enabled||await credential(id,'avec'),'Solicite ao administrador o cadastro do token AVEC.');
        await db.update('fs_units',{id:eq(id)},{avec_config:config});
        if(config.enabled)launch(()=>syncAvec(id));
      }
      if(input.alerts){
        const a=input.alerts;
        const previous=await one('fs_alert_settings',{unit_id:eq(id)});
        const config={arrival_mapping:a.arrival_mapping||{},stock_mapping:a.stock_mapping||{},
          stock_cooldown_days:Number(a.stock_cooldown_days??7),armed_at:new Date().toISOString()};
        assert(Number.isInteger(config.stock_cooldown_days)&&config.stock_cooldown_days>=1&&config.stock_cooldown_days<=365,'Intervalo de estoque inválido.');
        const allowed=['professional.name','customer.name','service.name','appointment.scheduled_at','product.name','product.quantity','product.minimum','establishment.name'];
        for(const kind of ['arrival','stock'])if(a[kind+'_enabled']){
          const delivery=await deliveryConfig(id,uuid(a.channel_id),a[kind+'_template_id']);
          assert(delivery.channel.type==='waba','Os alertas usam modelos do canal Oficial.');
          for(const variable of delivery.template.variables){
            const field=config[kind+'_mapping'][variable];
            assert(allowed.includes(field)&&!(kind==='arrival'&&field.startsWith('product.'))&&
              !(kind==='stock'&&['customer.name','service.name','appointment.scheduled_at'].includes(field)),
              'Preencha os campos do modelo com informações disponíveis para este aviso.');
          }
        }
        // A config revision invalidates queued notifications; avoid historical arrivals on enable.
        await db.upsert('fs_alert_settings',{unit_id:id,arrival_enabled:a.arrival_enabled===true,stock_enabled:a.stock_enabled===true,
          arrival_channel_id:a.channel_id||null,stock_channel_id:a.channel_id||null,
          arrival_template_id:a.arrival_template_id||null,stock_template_id:a.stock_template_id||null,config},'unit_id');
      }
      return {saved:true};
    }
    if(action==='professionals'&&method==='POST'){
      assert(unit.role==='master'||unit.role==='manager','Esta ação exige um gestor.',403);
      const professional=await one('fs_professionals',{unit_id:eq(id),id:eq(uuid(input.id))});
      assert(professional,'Profissional não encontrado.',404);
      const number=input.phone?phone(input.phone):null;
      assert(input.enabled!==true||number,'Cadastre o telefone do profissional.');
      return db.update('fs_professionals',{unit_id:eq(id),id:eq(professional.id)},{phone:number,enabled:input.enabled===true});
    }
    if(action==='avec-sync'&&method==='POST'){
      assert(unit.role==='master'||unit.role==='manager','Esta ação exige um gestor.',403);
      assert(await credential(id,'avec'),'Solicite ao administrador o cadastro do token AVEC.');
      assert(!busy.has('avec:'+id),'A consulta AVEC está em andamento.',409);
      launch(()=>syncAvec(id));return {pending:true};
    }
    if(action==='avec-report'&&method==='POST'){
      assert(unit.role==='master'||unit.role==='manager','Esta ação exige um gestor.',403);
      const definition=reportCatalog.find(r=>r.code===input.code);assert(definition,'Relatório não disponível.');
      const value=await credential(id,'avec');assert(value?.token,'Solicite ao administrador o cadastro do token AVEC.');
      const params={};
      for(const field of definition.params){
        let val=input.params?.[field.key]??field.default;
        assert(typeof val==='string'&&val.length<=200,'Filtro inválido.');
        if(field.type==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(val))val=val.split('-').reverse().join('/');
        params[field.key]=val;
      }
      params.page=Number(input.params?.page||1);params.limit=250;
      assert(Number.isInteger(params.page)&&params.page>=1&&params.page<=100,'Página inválida.');
      if(unit.avec_config?.salon_id)params.salao_unidade_id=unit.avec_config.salon_id;
      try{
        const result=await pageReport({code:definition.code,token:value.token,params,onTrace:trace(id,'AVEC')});
        const snapshot=await dispatch.issue({unit:id,user:user.id,code:definition.code,rows:result.result});
        return {...snapshot,columns:[...new Set(result.result.flatMap(row=>Object.keys(row||{})))],rows:result.result,
          records:result.result.length,pages:params.page,has_more:result.hasMore};
      }catch(error){throw new AppError(error instanceof AvecError?error.message:'Não foi possível consultar o relatório.',502)}
    }
    if(['report-preview','report-send'].includes(action)&&method==='POST'){
      assert(unit.role==='master'||unit.role==='manager','Esta ação exige um gestor.',403);
      if(action==='report-preview')return dispatch.preview(id,user.id,input);
      const result=await dispatch.enqueue(id,user.id,input);
      await event(id,'report_send','ok',`${result.queued} mensagens manuais adicionadas à fila pelo relatório.`);
      launch(tick);return result;
    }
    if(action==='contacts'&&parts[3]&&parts[4]==='history'&&method==='GET'){
      const contact=await one('fs_contacts',{unit_id:eq(id),id:eq(uuid(parts[3]))});assert(contact,'Cliente não encontrado.',404);
      return {contact,appointments:await db.select('fs_appointments',{unit_id:eq(id),contact_id:eq(contact.id),order:'scheduled_at.desc',limit:300}),
        jobs:await db.select('fs_jobs',{unit_id:eq(id),contact_id:eq(contact.id),order:'created_at.desc',limit:100}),
        feedback:await db.select('fs_feedback',{unit_id:eq(id),contact_id:eq(contact.id),select:'id,score,comment,answered_at',order:'created_at.desc',limit:100})};
    }
    if(action==='active'&&method==='POST'){
      master(user);assert(typeof input.active==='boolean','Estado inválido.');
      return db.update('fs_units',{id:eq(id)},{active:input.active});
    }
    if(action==='integration'&&method==='GET') return integration(user,id);
    if(action==='catalog'&&method==='POST'){
      master(user);
      assert(!busy.has(id),'A sincronização já está em andamento.',409);
      const previous=await credential(id,'catalog');
      if(input.email || input.password || input.base_url){
        const email=text(input.email,160).toLowerCase();
        let baseUrl;
        try { baseUrl=apiBase(input.base_url||previous?.baseUrl||DEFAULT_API_BASE); }
        catch(error) { throw new AppError(error.message); }
        assert(/^[^@\s]+@[^@\s]+$/.test(email),'Informe o e-mail Clickmassa.');
        assert(input.password || previous?.email===email,'Informe a senha da conta.');
        const changed=previous&&baseUrl!==apiBase(previous.baseUrl||DEFAULT_API_BASE);
        if(changed){
          await db.update('fs_channels',{unit_id:eq(id)},{enabled:false,configured:false});
          await db.update('fs_jobs',{unit_id:eq(id),status:'eq.queued'},{status:'skipped',error:'A URL da integração foi alterada. Revise o envio.'});
          await db.update('fs_rules',{unit_id:eq(id)},{enabled:false,armed_at:null});
          await db.update('fs_units',{id:eq(id)},{catalog_tenant:null});
        }
        await saveCredential(id,'catalog',{baseUrl,email,password:input.password||previous.password});
      }
      assert(await credential(id,'catalog'),'Cadastre a conta Clickmassa.');
      await db.update('fs_units',{id:eq(id)},{sync_state:'pending',sync_error:null});
      launch(()=>synchronize(id));
      return {pending:true};
    }
    if(action==='sender'&&method==='POST'){
      master(user);
      const channel=await one('fs_channels',{id:eq(uuid(input.channel_id)),unit_id:eq(id)});
      assert(channel,'Canal não encontrado.',404);
      let sender=await credential(id,'sender:'+channel.id);
      const account=await credential(id,'catalog');
      const baseUrl=account?.baseUrl||DEFAULT_API_BASE;
      if(input.url || input.token){
        let url;
        try{url=new URL(input.url)}catch{throw new AppError('Informe uma URL de envio válida.')}
        const token=text(input.token,5000)||url.searchParams.get('token');
        url.search='';
        try{sender={url:senderEndpoint(url.href,baseUrl),token,baseUrl}}catch(error){throw new AppError(error.message)}
      }
      assert(sender,'Informe a URL e o token do canal.');
      try{validateSender(sender,channel,unit.catalog_tenant,baseUrl)}catch(error){throw new AppError(error.message)}
      if(input.url||input.token)await saveCredential(id,'sender:'+channel.id,sender);
      await db.update('fs_channels',{id:eq(channel.id),unit_id:eq(id)},{configured:true,enabled:input.enabled===true});
      return {saved:true};
    }
    if(action==='avec'&&method==='POST'){
      master(user);
      if(input.token) await saveCredential(id,'avec',{token:text(input.token,5000)});
      assert(await credential(id,'avec'),'Informe o token AVEC.');
      if(input.mapping){
        const keys=Object.keys(unit.avec_sample?.[0]||{});
        assert(keys.includes(input.mapping.name)&&keys.includes(input.mapping.phone),'Selecione os campos de nome e telefone.');
        for(const key of ['email','birthday']) assert(!input.mapping[key]||keys.includes(input.mapping[key]),'Campo AVEC inválido.');
        await db.update('fs_units',{id:eq(id)},{avec_mapping:input.mapping});
      }
      assert(!busy.has('avec:'+id),'A consulta AVEC está em andamento.',409);
      await db.update('fs_units',{id:eq(id)},{avec_state:'pending',avec_error:null});
      launch(()=>syncAvec(id));
      return {pending:true};
    }
    if(action==='members'&&method==='GET'){
      master(user);
      return db.select('fs_memberships',{unit_id:eq(id),select:'id,role,fs_users(id,email,name,active)'});
    }
    if(action==='members'&&!parts[3]&&method==='POST'){
      master(user);
      const email=text(input.email,160).toLowerCase(),name=text(input.name,120);
      assert(/^[^@\s]+@[^@\s]+$/.test(email)&&name.length>=2,'Preencha nome e e-mail.');
      assert(['manager','operator','viewer'].includes(input.role),'Permissão inválida.');
      let account=await one('fs_users',{email:eq(email)});
      if(!account){
        const hash=await passwordHash(input.password);
        account=(await db.insert('fs_users',{email,name,password_hash:hash}))[0];
      }
      assert(!account.master,'Esta conta já tem acesso de administrador master.');
      await db.upsert('fs_memberships',{unit_id:id,user_id:account.id,role:input.role},'unit_id,user_id');
      return {saved:true};
    }
    if(action==='members'&&method==='DELETE'){
      master(user);
      await db.remove('fs_memberships',{unit_id:eq(id),id:eq(uuid(parts[3]))});
      return {saved:true};
    }
    if(action==='members'&&parts[3]&&parts[4]==='password'&&method==='POST'){
      master(user);
      const membership=await one('fs_memberships',{id:eq(uuid(parts[3])),unit_id:eq(id)});
      assert(membership,'Acesso não encontrado.',404);
      await db.update('fs_users',{id:eq(membership.user_id),master:'eq.false'},{
        password_hash:await passwordHash(input.password),must_change_password:true,
      });
      await db.remove('fs_sessions',{user_id:eq(membership.user_id)});
      return {saved:true};
    }
    if(action==='contacts'&&method==='GET'){
      const page=Math.max(0,Number(input.page)||0);
      const params={unit_id:eq(id),order:'name,id',limit:26,offset:page*25};
      if(input.eligible==='true')params.consent='eq.true';
      const search=text(input.search,80).replace(/[^\p{L}\p{N}+ -]/gu,'');
      if(search) params.or=`(name.ilike.*${search}*,phone.ilike.*${search}*)`;
      return db.select('fs_contacts',params);
    }
    if(action==='contacts'&&method==='POST'){
      const name=text(input.name,120);assert(name.length>=2,'Preencha o nome do contato.');
      const record={name,phone:phone(input.phone),email:text(input.email,160)||null,
        birthday:input.birthday||null,consent:input.consent===true};
      if(record.birthday) assert(/^\d{4}-\d{2}-\d{2}$/.test(record.birthday)&&!Number.isNaN(Date.parse(record.birthday)),'Data de nascimento inválida.');
      if(input.id) return db.update('fs_contacts',{unit_id:eq(id),id:eq(uuid(input.id))},record);
      return db.insert('fs_contacts',{unit_id:id,...record});
    }
    if(action==='services'&&method==='POST'){
      assert(unit.role==='master'||unit.role==='manager','Esta ação exige um gestor.',403);
      const name=text(input.name,120),days=Number(input.return_days);
      assert(name.length>=2&&(!days||(Number.isInteger(days)&&days>0&&days<=3650)),'Informe o nome e um intervalo válido.');
      if(input.id)return db.update('fs_services',{unit_id:eq(id),id:eq(uuid(input.id))},{name,return_days:days||null,return_source:'manual'});
      return db.insert('fs_services',{unit_id:id,name,return_days:days||null,source:'manual',return_source:'manual'});
    }
    if(action==='appointments'&&method==='POST'){
      const contact=await one('fs_contacts',{id:eq(uuid(input.contact_id)),unit_id:eq(id)});
      const service=await one('fs_services',{id:eq(uuid(input.service_id)),unit_id:eq(id)});
      const date=new Date(input.scheduled_at);
      assert(contact&&service&&!Number.isNaN(date.getTime()),'Selecione cliente, serviço e data válidos.');
      if(input.completed_at) assert(!Number.isNaN(Date.parse(input.completed_at))&&Date.parse(input.completed_at)<=Date.now(),'Conclusão deve ser uma data passada.');
      return db.insert('fs_appointments',{unit_id:id,contact_id:contact.id,service_id:service.id,
        scheduled_at:date.toISOString(),completed_at:input.completed_at||null,canceled:false});
    }
    if(action==='send'&&method==='POST'){
      assert(unit.active,'A unidade está desativada.');
      uuid(input.request_id);
      const {channel,template}=await deliveryConfig(id,uuid(input.channel_id),input.template_id);
      const test=input.kind==='test';
      let recipients;
      assert(input.confirm===true,'Confirme a autorização do destinatário.');
      if(test) recipients=[{id:null,phone:phone(input.phone)}];
      else{
        assert(Array.isArray(input.contacts)&&input.contacts.length>=1&&input.contacts.length<=100,'Selecione até 100 contatos.');
        const ids=[...new Set(input.contacts.map(uuid))];
        recipients=await db.select('fs_contacts',{unit_id:eq(id),id:'in.('+ids.join(',')+')',consent:'eq.true'});
        assert(recipients.length===ids.length,'Há contatos sem autorização na seleção.');
        assert(recipients.every(contact=>contact.phone),'Complete os telefones dos clientes selecionados.');
      }
      if(channel.type==='waba'){
        if(test) assert(Array.isArray(input.params)&&input.params.length===template.variables.length&&
          input.params.every(p=>typeof p==='string'&&p.trim()&&p.length<=1024),'Preencha todos os valores do modelo.');
        else for(const key of template.variables) assert(fields.includes(input.mapping?.[key]),'Escolha a informação de cada campo do modelo.');
      }else assert(text(input.body,4097)&&input.body.length<=4096,'Preencha uma mensagem com até 4.096 caracteres.');
      assert(!input.note||typeof input.note==='string'&&input.note.length<=1000,'A nota interna pode ter até 1.000 caracteres.');
      const rows=recipients.map(c=>({
        channel_id:channel.id,template_id:template?.id||null,contact_id:c.id,phone:c.phone,kind:test?'test':'manual',
        idempotency_key:`send:${user.id}:${input.request_id}:${c.id||'test'}`,
        payload:channel.type==='waba'?{params:input.params,mapping:input.mapping,fields:{
          'customer.name':c.name,'customer.phone':c.phone,'customer.email':c.email,'customer.birthday':c.birthday,'establishment.name':unit.name,
        }}:{body:input.body,note:input.note},
      }));
      const added=await db.rpc('fs_enqueue',{p_unit:id,p_rows:rows});
      launch(tick);
      return {queued:added};
    }
    if(action==='rules'&&method==='POST'){
      const enabled=input.enabled===true;
      const {channel,template}=await deliveryConfig(id,uuid(input.channel_id),input.template_id);
      assert(channel.type==='waba','As rotinas usam modelos do WhatsApp Oficial.');
      assert(ruleTypes.includes(input.type),'Tipo de rotina inválido.');
      const values={unit_id:id,name:text(input.name,120),type:input.type,channel_id:channel.id,template_id:template.id,
        delay_days:Number(input.delay_days),cooldown_days:Number(input.cooldown_days),send_time:input.send_time,
        service_id:input.service_id||null,target_service_id:input.target_service_id||null,mapping:input.mapping||{},enabled,
        armed_at:enabled?new Date().toISOString():null};
      assert(values.name&&/^([01]\d|2[0-3]):[0-5]\d$/.test(values.send_time),'Preencha nome e horário.');
      for(const n of [values.delay_days,values.cooldown_days]) assert(Number.isInteger(n)&&n>=0&&n<=3650,'Intervalo inválido.');
      if(values.type==='cross_sell') assert(values.target_service_id,'Selecione o serviço recomendado.');
      if(values.type==='csat'){
        assert(survey?.configured,'Configure PUBLIC_ORIGIN no serviço para enviar avaliações.');
        assert(Object.values(values.mapping).includes('feedback.url'),'Inclua o link da avaliação em um campo do modelo CSAT.');
      }
      for(const serviceId of [values.service_id,values.target_service_id]) if(serviceId) assert(await one('fs_services',{unit_id:eq(id),id:eq(uuid(serviceId))}),'Serviço inválido.');
      for(const key of template.variables) assert(fields.includes(values.mapping[key])&&
        (values.mapping[key]!=='feedback.url'||values.type==='csat'),'Preencha todos os campos do modelo.');
      if(input.id) return db.update('fs_rules',{id:eq(uuid(input.id)),unit_id:eq(id)},values);
      return db.insert('fs_rules',values);
    }
    if(action==='rules'&&method==='DELETE'){
      await db.update('fs_rules',{unit_id:eq(id),id:eq(uuid(parts[3]))},{enabled:false,armed_at:null});
      return {saved:true};
    }
    if(action==='simulate'&&method==='POST'){
      assert(unit.role==='master'||unit.role==='manager','Esta ação exige um gestor.',403);
      const rule=await one('fs_rules',{unit_id:eq(id),id:eq(uuid(input.rule_id))});
      assert(rule,'Regra não encontrada.',404);
      await deliveryConfig(id,rule.channel_id,rule.template_id);
      const context=await ruleContext(unit);
      const matches=candidates({...context,rule,preview:true});
      return {count:matches.length,names:matches.slice(0,10).map(x=>x.contact.name)};
    }
    throw new AppError('Rota não encontrada.',404);
  }
  return {route,tick,access};
}
