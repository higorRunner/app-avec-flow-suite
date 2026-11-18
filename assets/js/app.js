/* FlowSuite — SPA estática. Supabase Auth + RLS, processamento em serviço próprio. */
const conf = window.FLOWSUITE_CONFIG || {};
const el = document.getElementById('app');
const q = new URLSearchParams(location.search);
const requestedSlug = q.get('estabelecimento') || location.pathname.match(/\/e\/([a-z0-9-]+)\/?$/)?.[1] || '';
const assetBase = new URL('.', document.baseURI);
const masterRoute = q.get('admin') === '1';
const embedded = q.get('embed') === '1';
if (embedded) document.body.classList.add('embed-mode');
const MODULES = [
  {type:'csat',icon:'♡',title:'Pesquisa de satisfação',sub:'CSAT após atendimento',desc:'Disparo de pesquisa após a conclusão do serviço.'},
  {type:'inactive',icon:'◷',title:'Clientes inativos',sub:'Recuperação',desc:'Reengaje clientes há X dias sem agendamento.'},
  {type:'post_service',icon:'✓',title:'Pós-atendimento',sub:'Agendamento concluído',desc:'Mensagem após o atendimento concluído no AVEC.'},
  {type:'return',icon:'↻',title:'Sugestão de retorno',sub:'Ciclo do serviço',desc:'Sugira novo agendamento conforme a recorrência do serviço.'},
  {type:'birthday',icon:'✳',title:'Aniversário',sub:'Data especial',desc:'Felicitações na data de aniversário do cliente.'},
  {type:'cross_sell',icon:'◇',title:'Venda complementar',sub:'Cross-sell',desc:'Ofereça serviços relacionados aos já realizados.'},
  {type:'stock',icon:'▣',title:'Alerta de estoque',sub:'Produto esgotado',desc:'Notificação para responsável por produto em falta.'},
  {type:'arrival',icon:'⌁',title:'Aviso de chegada',sub:'Check-in',desc:'Avise um responsável quando um cliente chegar.'}
];
const nativeRuleTypes=new Set(['csat','post_service','return','cross_sell','birthday','inactive']);
const state = {client:null,user:null,profile:null,session:null,establishments:[],current:null,page:'dashboard',modal:null,modules:[],channels:[],templates:[],services:[],customers:[],jobs:[],logs:[],status:null,editing:null,ticket:null,ticketVerified:false,authMode:'login',navOpen:false,loading:false,avecCatalog:[],avecSearch:'',avecReportCode:'0004', avecStatus:'idle', membershipRole:null, manual:{selected:new Set(), page:0, request:0}, tenantRequest:0, authRequest:0};
const h = (value) => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (date) => date ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(date)):'—';
const dateOnly = (date) => date ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'}).format(new Date(date)):'—';
const statuses={queued:'Na fila',processing:'Aguardando confirmação',sent:'Enviada',delivered:'Entregue',read:'Lida',failed:'Falha',skipped:'Ignorada',canceled:'Cancelada',scheduled:'Agendado',completed:'Concluído',cancelled:'Cancelado',confirmed:'Confirmado'};
const statusLabel=(status)=>Object.hasOwn(statuses,status)?statuses[status]:status||'—';
const numeric = (n) => Number(n || 0).toLocaleString('pt-BR');
const normalizeSearch=(value)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').trim();
const slugify = (s) => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const toast = (msg,err=false) => {const node=document.createElement('div');node.setAttribute('role',err?'alert':'status');node.className=`toast ${err?'error':''}`;node.textContent=msg;document.getElementById('toast-root').append(node);setTimeout(()=>node.remove(),4200)};
const apiError=(err)=>toast(err?.message||String(err),true);
const db=()=>state.client;
async function queryData(table, callback, columns = '*', tenant = state.current?.id) {
 let query = db().from(table).select(columns).eq('establishment_id',tenant);
 if(callback) query=callback(query);
 const {data,error}=await query;
 if(error) throw error;
 return data || [];
}

async function loadAvecCatalog() {
 if (state.avecStatus === 'loading' || state.avecStatus === 'ready') return;
 state.avecStatus = 'loading';
 try {
  const catalogUrl = new URL('assets/data/avec-reports.json', assetBase);
  const assetVersion = document.querySelector('meta[name="flowsuite-asset-version"]')?.content;
  if (assetVersion && assetVersion !== 'local') catalogUrl.searchParams.set('v', assetVersion);
  const response = await fetch(catalogUrl);
  if (!response.ok) throw Error('Catálogo indisponível');
  const catalog = await response.json();
  if (!Array.isArray(catalog.reports)) throw Error('Catálogo inválido');
  state.avecCatalog = catalog.reports;
  state.avecStatus = 'ready';
 } catch {
  state.avecStatus = 'error';
 }
 if (state.user && state.page === 'avec') render();
}

async function boot(){
 if(!conf.supabaseUrl||!conf.supabaseAnonKey||conf.supabaseUrl.includes('SEU-PROJETO')){
  el.innerHTML='<main class="splash"><strong>FlowSuite</strong><p>O ambiente ainda precisa ser configurado. Solicite acesso ao administrador.</p></main>';
  return;
 }
 if(!window.supabase){el.innerHTML='<div class="splash">Não foi possível carregar a conexão. <button class="btn" data-action="retry-load">Tentar novamente</button></div>';return}
 state.client=window.supabase.createClient(conf.supabaseUrl,conf.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 installPostMessage();
 const {data:{session},error}=await db().auth.getSession();
 if (error) throw error;
 if (location.hash.includes('type=recovery')) state.authMode='new-password';
 db().auth.onAuthStateChange((event,next)=>{
  setTimeout(()=>{
   if (event==='PASSWORD_RECOVERY') {
    state.authMode='new-password';
    state.session=next;
    renderAuth();
   } else if (next?.user?.id!==state.session?.user?.id) {
    loadAuth(next).catch(apiError);
   } else {
    state.session=next;
   }
  },0);
 });
 await loadAuth(session);
}

function clearTenant() {
 state.tenantRequest++;
 state.manual.request++;
 state.manual.selected.clear();
 state.manual.page=0;
 Object.assign(state,{modules:[],channels:[],templates:[],services:[],customers:[],jobs:[],logs:[],status:null,membershipRole:null,modal:null,editing:null,loading:false,tenantError:false});
}

async function loadAuth(session){
 const request=++state.authRequest;
 clearTenant();
 Object.assign(state,{session,user:session?.user||null,page:'dashboard',current:null,profile:null,establishments:[],memberships:[],navOpen:false});
 if(!state.user){state.ticket=null;state.ticketVerified=false;renderAuth();return}
 if(state.authMode==='new-password'){renderAuth();return}
 el.innerHTML='<div class="splash" role="status">Carregando seu ambiente…</div>';
 const userId=state.user.id;
 try {
  const [profile,est,memberships]=await Promise.all([
   db().from('profiles').select('id,full_name,master_admin').eq('id',userId).single(),
   db().from('establishments').select('id,name,slug,active,timezone').order('name'),
   db().from('memberships').select('establishment_id,role').eq('user_id',userId)
  ]);
  if(request!==state.authRequest) return;
  for(const result of [profile,est,memberships]) if(result.error) throw result.error;
  const slug=requestedSlug || localStorage.getItem('flowsuite_tenant');
  state.profile=profile.data;
  state.memberships=memberships.data||[];
  state.establishments=(est.data||[]).filter(item=>item.active||state.profile.master_admin);
  const masterHome=state.profile.master_admin&&(masterRoute||!requestedSlug);
  state.page=masterHome?'admin':'dashboard';
  state.current=masterHome?null:state.establishments.find(x=>x.slug===slug&&x.active)||(!requestedSlug?state.establishments.find(x=>x.active):null)||null;
  if(!masterHome&&q.get('teste')==='1'&&state.current) state.page='manual-test';
  if(requestedSlug&&!masterHome&&!state.current) toast('Você não possui acesso a este estabelecimento.',true);
  if(!masterHome) await loadTenant();
  if(request===state.authRequest) render();
 }catch(err){
  if(request!==state.authRequest) return;
  el.innerHTML='<div class="splash"><p>Não foi possível carregar seu acesso.</p><button class="btn" data-action="retry-access">Tentar novamente</button><button class="btn ghost" data-action="logout">Sair</button></div>';
  apiError(err);
 }
}

const jobColumns='id,created_at,customer_id,source,status,error_message,external_message_id,test_run,customers(name)';
const recentJobs=query=>query.order('created_at',{ascending:false}).limit(500);
let refreshingJobs=false;

async function refreshVisibleJobs(){
 if(document.hidden||state.page!=='reports'||!state.current||state.modal||refreshingJobs) return;
 const tenant=state.current.id;
 refreshingJobs=true;
 try{
  const jobs=await queryData('message_jobs',recentJobs,jobColumns,tenant);
  if(state.page==='reports'&&state.current?.id===tenant&&JSON.stringify(jobs)!==JSON.stringify(state.jobs)){
   const content=document.querySelector('#main-content');
   if(content){
    const refreshFocused=document.activeElement?.dataset.action==='refresh';
    state.jobs=jobs;
    content.innerHTML=reportsPage();
    if(refreshFocused) content.querySelector('[data-action="refresh"]')?.focus({preventScroll:true});
   }
  }
 }catch{/* Manual refresh surfaces connection errors. */}
 finally{refreshingJobs=false}
}
async function loadTenant(){
 const request=++state.tenantRequest;
 const tenant=state.current?.id;
 if (!tenant) return;
 state.membershipRole=state.memberships.find(item=>item.establishment_id===tenant)?.role||null;
 state.loading=true;
 state.tenantError=false;
 try {
  const [modules,channels,templates,services,customers,jobs,logs,stat]=await Promise.all([
   queryData('automations',x=>x.order('created_at',{ascending:false})),
   queryData('channels',x=>x.order('name')),
   queryData('templates',x=>x.order('name')),
   queryData('services',x=>x.order('name'),'id,name,external_id,default_return_days,active'),
   queryData('customers',x=>x.order('name').limit(1000),'id,name,phone'),
   queryData('message_jobs',recentJobs,jobColumns),
   queryData('integration_logs',x=>x.order('created_at',{ascending:false}).limit(100),'id,created_at,source,event,status'),
   db().from('integration_status').select('*').eq('establishment_id',tenant).maybeSingle()
  ]);
  if(request!==state.tenantRequest) return;
  if(stat.error) throw stat.error;
  Object.assign(state,{modules,channels,templates,services,customers,jobs,logs,status:stat.data||null});
 }catch(err){
  if(request!==state.tenantRequest) return;
  state.tenantError=true;
  apiError(err);
 }finally{
  if(request===state.tenantRequest) state.loading=false;
 }
}

function renderAuth(){
 const signup=state.authMode==='signup',reset=state.authMode==='reset';
 if(state.authMode==='new-password'){
  el.innerHTML=`<main class="auth-right"><section class="auth-card"><h1>Definir nova senha</h1><form id="auth-form" class="stack">${field('Nova senha','password','password','','','required minlength="8" autocomplete="new-password"')}${field('Confirme a nova senha','confirm_password','password','','','required minlength="8" autocomplete="new-password"')}<button type="submit" class="btn primary">Salvar nova senha</button></form></section></main>`;
  return;
 }
 el.innerHTML=`<div class="auth-shell"><aside class="auth-art"><div class="brand"><div class="brandmark">✦</div><span>FlowSuite</span></div><div class="auth-hero"><h1>Relacionamentos que <span class="gradient-text">evoluem sozinhos.</span></h1><p>Orquestre mensagens, personalize a jornada do cliente e acompanhe cada resultado em um só lugar.</p></div><span class="muted small">AVEC + Clickmassa + Supabase</span></aside><section class="auth-right"><div class="auth-card"><div class="brand" style="margin-bottom:32px"><div class="brandmark">✦</div> FlowSuite</div><h2>${reset?'Recuperar acesso':signup?'Criar sua conta':masterRoute?'Acesso administrativo':'Bem-vindo de volta'}</h2><p class="muted subtitle">${reset?'Enviaremos um link para seu e-mail.':signup?'Confirme seu e-mail antes de entrar.':masterRoute?'Entre com uma conta de administrador master.':'Entre com sua conta FlowSuite para acessar seu estabelecimento.'}</p><form id="auth-form">${signup?field('Nome completo','name','text','Seu nome'):''}${field('E-mail','email','email','nome@empresa.com','','required autocomplete="email"')} ${!reset?field('Senha','password','password',signup?'Mínimo de 8 caracteres':'Sua senha'):''}<button class="btn primary" type="submit">${reset?'Enviar link de recuperação':signup?'Criar conta':'Entrar no painel'} →</button></form><div class="center" style="margin-top:23px"><button class="btn ghost small" data-action="auth-mode" data-mode="${signup||reset?'login':'signup'}">${signup||reset?'Voltar ao login':'Criar conta'}</button>${!signup&&!reset?'<button class="btn ghost small" data-action="auth-mode" data-mode="reset">Esqueci minha senha</button>':''}</div></div></section></div>`;
}
const field=(label,name,type='text',placeholder='',value='',extra='')=>`<div class="field"><label for="${h(name)}">${h(label)}</label><input class="input" id="${h(name)}" name="${h(name)}" type="${type}" placeholder="${h(placeholder)}" value="${h(value)}" ${extra}></div>`;
const select=(label,name,options=[],value='',extra='')=>`<div class="field"><label for="${h(name)}">${h(label)}</label><select class="select" id="${h(name)}" name="${h(name)}" ${extra}>${options.map(o=>`<option value="${h(o.value)}" ${String(value)===String(o.value)?'selected':''}>${h(o.label)}</option>`).join('')}</select></div>`;
const opt=(v,label)=>({value:v,label});
const mod=(type)=>MODULES.find(x=>x.type===type)||{title:type,icon:'⚙'};
const canManage=()=>state.current?.active && (state.profile?.master_admin || ['owner','manager'].includes(state.membershipRole));
const canSend=()=>canManage() || (state.current?.active && state.membershipRole==='operator');
const activeChannels=()=>state.channels.filter(x=>x.active&&['waba','whatsapp'].includes(x.type));
const activeTemplates=()=>state.templates.filter(x=>x.status==='active');
const dispatchChannels=()=>activeChannels().filter(channel=>channel.dispatch_ready&&
 (channel.type==='whatsapp'||activeTemplates().some(t=>t.clickmassa_channel_id===channel.id)));
function navItems(){let items=[['dashboard','◫','Visão geral'],['automations','⚡','Automações'],['manual','➤','Envio manual'],['customers','♙','Clientes e histórico'],['reports','▥','Relatórios e envios'],['catalog','▤','Catálogos e serviços'],['avec','▤','Relatórios AVEC'],['ticket','☷','Atendimento aberto'],['settings','⚙','Configurações']];return items}
function render(){
 if(!state.user){renderAuth();return}if(state.page==='admin'&&state.profile?.master_admin){renderMaster();return}const isAdmin=false;let title=isAdmin?'Administração master':state.current?.name||'Nenhum estabelecimento';let main=pageBody();
 el.innerHTML=`<div class="layout"><button type="button" class="nav-scrim" data-action="toggle-nav" aria-label="Fechar menu" ${state.navOpen?'':'hidden'}></button><aside id="main-sidebar" class="sidebar ${state.navOpen?'open':''}"><div class="brand"><div class="brandmark">✦</div><span>FlowSuite</span></div><div><div class="sidebar-caption">Workspace</div>${state.establishments.length?`<select class="select" id="tenant-select" aria-label="Estabelecimento" style="font-size:.79rem">${!state.current?'<option value="" selected disabled>Selecione um estabelecimento</option>':''}${state.establishments.filter(x=>x.active).map(x=>`<option value="${h(x.id)}" ${state.current?.id===x.id?'selected':''}>${h(x.name)}</option>`).join('')}</select>`:'<p class="hint">Sem estabelecimentos</p>'}</div><nav class="nav-list" aria-label="Navegação principal"><div class="sidebar-caption">Navegação</div>${navItems().map(([id,ico,name])=>`<button class="nav-link ${(state.page===id||(id==='manual'&&state.page==='manual-test'))?'active':''}" data-action="navigate" data-page="${id}" aria-label="${h(name)}" ${state.page===id?'aria-current="page"':''}><span class="nav-icon">${ico}</span><span class="nav-label">${h(name)}</span></button>`).join('')}</nav><div class="sidebar-bottom">${state.profile?.master_admin?'<a class="nav-link" href="/?admin=1">Voltar ao painel master</a>':''}<div class="user-mini"><div class="avatar">${h((state.profile?.full_name||state.user.email||'U')[0].toUpperCase())}</div><div style="min-width:0"><strong class="small">${h(state.profile?.full_name||'Usuário')}</strong><div class="muted tiny" style="overflow:hidden;text-overflow:ellipsis">${h(state.user.email)}</div></div></div><button class="nav-link" data-action="logout" aria-label="Sair da conta"><span class="nav-icon">↪</span><span class="logout-label">Sair da conta</span></button></div></aside><div class="main"><header class="topbar"><div class="actions"><button class="btn ghost mobile-menu" data-action="toggle-nav" aria-label="Menu" aria-controls="main-sidebar" aria-expanded="${state.navOpen}">☰</button><div><strong>${h(isAdmin?'Painel master':title)}</strong><div class="muted tiny">${isAdmin?'Controle de estabelecimentos e acessos':'Central de automações e relacionamento'}</div></div></div><div class="topbar-right"><span class="pill ${state.current?.active===false?'off':''}">● ${state.current?.active===false?'Desativado':'Conectado'}</span><span class="avatar">${h((state.user.email||'U')[0].toUpperCase())}</span></div></header><main class="content" id="main-content">${main}</main></div></div>`;
 const manualForm=document.getElementById('manual-form');
 if(manualForm){updateManualChannel(manualForm);syncRecipientSelection(manualForm);if(!manualForm.dataset.testRun) void loadContactPage(true)}
 if(state.page==='customers') void loadContactPage(false);
 if(state.page==='avec'&&state.avecStatus==='idle') void loadAvecCatalog();
 if(state.modal) showModal();
}
const head=(title,desc,action='')=>`<div class="page-head"><div><h1>${h(title)}</h1><p>${h(desc)}</p></div><div class="actions">${action}</div></div>`;
const button=(label,action,attr='',variant='primary')=>`<button class="btn ${variant}" type="button" data-action="${action}" ${attr}>${label}</button>`;
function pageBody(){if(state.loading)return '<p class="card" role="status">Carregando estabelecimento…</p>';if(state.tenantError)return `<div class="alert">Alguns dados não puderam ser carregados. ${button('Tentar novamente','refresh','','small')}</div>`;if(!state.current)return `${head('Comece por um estabelecimento','Solicite acesso ao administrador master ou cadastre o primeiro estabelecimento.')}`;switch(state.page){case'dashboard':return dashboardPage();case'automations':return automationsPage();case'manual':return manualPage();case'manual-test':return manualPage();case'customers':return customersPage();case'reports':return reportsPage();case'catalog':return catalogPage();case'avec':return avecPage();case'ticket':return ticketPage();case'settings':return settingsPage();default:return dashboardPage()}}
function setupChecklist(){
 const steps=[
  {ok:!!state.status?.avec_configured,label:'Conectar AVEC',sub:'Cadastre o token da unidade no painel master.',page:state.profile?.master_admin?'admin':'settings'},
  {ok:!!state.status?.clickmassa_configured,label:'Conectar Clickmassa',sub:'Configure a conta de catálogo no serviço FlowSuite.',page:state.profile?.master_admin?'admin':'settings'},
  {ok:activeChannels().length>0,label:'Sincronizar canais',sub:'Importe os canais usando a API do Clickmassa.',page:'catalog'},
  {ok:activeTemplates().length>0,label:'Sincronizar modelos',sub:'Sincronize os modelos disponíveis para envio.',page:'catalog'},
  {ok:state.customers.length>0,label:'Sincronizar clientes',sub:'Importe os clientes elegíveis do AVEC.',page:'customers'},
 ];
 const done=steps.filter(s=>s.ok).length;
 if(done===steps.length) return '';
 return `<section class="setup-panel" aria-label="Preparação do estabelecimento"><div class="setup-copy"><h2>Deixe sua operação pronta para enviar</h2><p>Configure as integrações uma vez. Depois, cada automação utiliza seu próprio canal e template.</p><div class="setup-progress"><span style="width:${Math.round(done/steps.length*100)}%"></span></div><small>${done} de ${steps.length} etapas configuradas</small></div><div class="setup-list">${steps.map((s,i)=>`<button class="setup-step ${s.ok?'done':''}" data-action="navigate" data-page="${s.page}"><span class="step-index">${s.ok?'✓':i+1}</span><span><strong>${h(s.label)}</strong><small>${h(s.sub)}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</div></section>`;
}
function dashboardPage(){let active=state.modules.filter(a=>a.enabled&&a.native_armed_at).length,sent=state.jobs.filter(a=>['sent','delivered','read'].includes(a.status)).length,failed=state.jobs.filter(a=>a.status==='failed').length;
 return `${head('Visão geral','Sua operação, campanhas e integrações em um só lugar.',canManage()?button('＋ Nova automação','new-automation'):'')}${setupChecklist()}<div class="metrics"><div class="card metric-card"><span class="metric-icon">⚡</span><div class="metric">${numeric(active)}</div><span class="eyebrow">Automações ativas</span></div><div class="card metric-card"><span class="metric-icon">➤</span><div class="metric">${numeric(sent)}</div><span class="eyebrow">Mensagens enviadas*</span></div><div class="card metric-card"><span class="metric-icon">♙</span><div class="metric">${numeric(state.customers.length)}</div><span class="eyebrow">Clientes sincronizados*</span></div><div class="card metric-card"><span class="metric-icon">⚠</span><div class="metric">${numeric(failed)}</div><span class="eyebrow">Falhas registradas*</span></div></div><div class="grid2"><section class="card"><div class="card-heading"><h2>Suas automações</h2>${button('Ver todas','navigate','data-page="automations"','small')}</div>${state.modules.length?state.modules.slice(0,6).map(a=>`<div class="list-row"><div><strong>${h(a.name)}</strong><div class="muted small">${h(mod(a.type).title)}</div></div><span class="badge ${a.enabled&&a.native_armed_at?'green':''}">${a.enabled?(a.native_armed_at?'Ativa':'Revisar ativação'):'Pausada'}</span></div>`).join(''):empty('Nenhuma automação','Configure a primeira regra de envio.')}</section><section class="card"><div class="card-heading"><h2>Integrações</h2>${button('Configurações','navigate','data-page="settings"','small')}</div><div class="list-row"><span>AVEC</span><span class="badge ${state.status?.avec_configured?'green':'amber'}">${state.status?.avec_configured?'Configurado':'Pendente'}</span></div><div class="list-row"><span>Clickmassa / CRM</span><span class="badge ${state.status?.clickmassa_configured?'green':'amber'}">${state.status?.clickmassa_configured?'Configurado':'Pendente'}</span></div><div class="list-row"><span>Canais sincronizados</span><strong>${state.channels.length}</strong></div><div class="list-row"><span>Templates disponíveis</span><strong>${state.templates.length}</strong></div><p class="hint" style="margin-top:17px">* Indicadores baseados nos registros sincronizados para este painel. Para grandes volumes, use agregações no banco.</p></section></div>`}
function automationsPage(){const cards=MODULES.map(m=>{const count=state.modules.filter(a=>a.type===m.type).length;return `<section class="card module"><div><div class="module-top"><span class="module-icon">${m.icon}</span><span class="badge ${count?'green':''}">${count} regra(s)</span></div><h3 style="margin-top:16px">${m.title}</h3><p>${m.desc}</p></div><div class="footer"><span class="muted tiny">${h(m.sub)}</span>${canManage()?button('+ Configurar','new-automation',`data-type="${m.type}"`,'small'):''}</div></section>`}).join('');return `${head('Automações','Configure regras para os clientes e agendamentos já disponíveis na unidade.',canManage()?button('＋ Nova regra','new-automation'):'')}<div class="module-grid">${cards}</div><div class="section-title"><h2>Regras cadastradas</h2></div><section class="card">${state.modules.length?table(['Nome','Tipo','Canal','Template','Status','Ações'],state.modules.map(a=>[h(a.name),h(mod(a.type).title),h(state.channels.find(x=>x.id===a.channel_id)?.name||'—'),h(state.templates.find(x=>x.id===a.template_id)?.name||'—'),`<span class="badge ${a.enabled&&a.native_armed_at?'green':''}">${a.enabled?(a.native_armed_at?'Ativa':'Revisar ativação'):'Pausada'}</span>`,`${canManage()?`${button('Editar','edit-automation',`data-id="${h(a.id)}"`,'small')} ${nativeRuleTypes.has(a.type)?button('Simular','preview-automation',`data-id="${h(a.id)}"`,'small'):''} ${button(a.enabled&&a.native_armed_at?'Pausar':'Ativar','toggle-automation',`data-id="${h(a.id)}"`,'small')} ${button('Excluir','delete-automation',`data-id="${h(a.id)}"`,'small danger')}`:'—'}`])):empty('Sem regras','Crie uma configuração para começar.')}</section>`}
const table=(cols,rows)=>`<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela com rolagem"><table class="table"><thead><tr>${cols.map(c=>`<th scope="col">${h(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const empty=(title,desc)=>`<div class="empty"><span class="emoji">◇</span><strong>${h(title)}</strong><span class="small">${h(desc)}</span></div>`;
const sampleFields = [
 ['customer.name','Nome do cliente','Mariana'],
 ['customer.phone','Telefone do cliente','+55 11 99999-0000'],
 ['customer.email','E-mail do cliente','mariana@exemplo.com'],
 ['customer.birthday','Aniversário','18/11'],
 ['service.name','Nome do serviço','Corte'],
 ['appointment.scheduled_at','Data e hora do agendamento','18/11 às 14:00'],
 ['appointment.completed_at','Conclusão do atendimento','18/11 às 15:00'],
 ['establishment.name','Nome do estabelecimento','Seu estabelecimento'],
 ['product.name','Nome do produto','Shampoo'],
 ['product.stock','Quantidade em estoque','3']
].map(([value,label,example])=>({value,label,example}));

function variableKeys(template, mapping) {
 const keys=new Map();
 function add(key,label=key) {
  if(key!==undefined&&key!==null&&String(key).trim()&&!keys.has(String(key))) keys.set(String(key),String(label||key));
 }
 const declared=template?.variables;
 if(Array.isArray(declared)) declared.forEach((item,index)=>{
  if(item&&typeof item==='object') add(item.key??item.position??item.name??item.id??index+1,item.label??item.name);
  else add(item);
 });
 else if(declared&&typeof declared==='object') Object.entries(declared).forEach(([key,value])=>add(key,value?.label??(typeof value==='string'?value:key)));
 for(const match of (template?.body||'').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) add(match[1]);
 Object.keys(mapping).forEach(key=>add(key));
 return keys;
}

function variablePanel(form, mapping = {}, previous) {
 const target=form.querySelector('[data-variables]');
 const template=state.templates.find(x=>x.id===form.elements.template_id.value);
 target.dataset.template=template?.id||'';
 if(!template){
  target.innerHTML='<p class="hint">Escolha um modelo para ver a mensagem e seus campos.</p>';
  return;
 }
 if(form.dataset.testRun==='true'){
  target.innerHTML=`<div class="message-preview"><strong>Prévia da mensagem</strong><p data-template-preview></p></div>${
   [...variableKeys(template,{})].map(([key],index)=>
    field(`Valor de teste do campo ${key}`,`test-param-${index}`,'text','Informe um valor de exemplo','','required maxlength="1024" data-test-param')).join('')
  }`;
  updateMessagePreview(form);
  return;
 }
 const manual=form.id==='manual-form';
 const fields=sampleFields.filter(x=>manual
  ? !x.value.startsWith('appointment.')&&!x.value.startsWith('product.')&&(form.elements.service_id.value||x.value!=='service.name')
  : form.elements.type.value==='stock'||(!x.value.startsWith('product.')&&
    (form.elements.type.value!=='birthday'||(!x.value.startsWith('appointment.')&&x.value!=='service.name'))));
 target.innerHTML=`<div class="message-preview"><strong>Prévia da mensagem</strong><p data-template-preview></p></div>${
  [...variableKeys(template,mapping)].map(([key,label],index)=>{
   const saved=mapping[key];
   const legacy=Object.hasOwn(mapping,key)&&!fields.some(x=>x.value===saved);
   const choices=[opt('','Escolha a informação'),...fields];
   if(legacy) choices.push(opt('__saved','Manter valor configurado'));
   const draft=previous&&Object.hasOwn(previous,key)?previous[key]:legacy?'__saved':saved;
   return `<div data-variable data-key="${h(key)}">${select(`Campo ${label}`,`template-field-${index}`,choices,choices.some(x=>x.value===draft)?draft:'','required')}</div>`;
  }).join('')||'<p class="hint">Este modelo não tem campos para preencher.</p>'}`;
 target.savedValues=structuredClone(mapping);
 updateMessagePreview(form);
}

function readVariableMapping(form, draft = false) {
 const target=form.querySelector('[data-variables]');
 return Object.fromEntries([...target.querySelectorAll('[data-variable]')].map(row=>{
  const key=row.dataset.key,value=row.querySelector('select').value;
  return [key,value==='__saved'&&!draft?target.savedValues[key]:value];
 }).filter(([,value])=>value!==''));
}

function updateMessagePreview(form) {
 const preview=form.querySelector('[data-template-preview]');
 if(!preview) return;
 const template=state.templates.find(x=>x.id===form.elements.template_id.value);
 const mapping=readVariableMapping(form);
 const testValues=[...form.querySelectorAll('[data-test-param]')].map(input=>input.value.trim());
 preview.textContent=template.body?.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_token,key)=>{
  if(form.dataset.testRun==='true') return testValues[Number(key)-1]||`[${key}]`;
  const value=Object.hasOwn(mapping,key)?mapping[key]:null;
  return sampleFields.find(x=>x.value===value)?.example||`[${key}]`;
 })||'O texto deste modelo ainda não foi sincronizado.';
}

function manualPage(){
 const test=state.page==='manual-test';
 return `${head(test?'Envio de teste':'Envio manual',test?'Valide um canal com um contato autorizado da equipe.':'Escolha o canal, personalize a mensagem e selecione os destinatários.',
 test?button('Voltar ao envio manual','navigate','data-page="manual"','small'):button('Envio de teste','navigate','data-page="manual-test"','small'))}
 ${!canSend()?'<p class="alert">Um operador ou gestor pode adicionar mensagens à fila.</p>':
 !dispatchChannels().length?`<div class="alert">Nenhum canal está pronto para enviar. Confira a integração no catálogo. ${button('Abrir catálogos','navigate','data-page="catalog"','small')}</div>`:
 `<form id="manual-form" class="stack" ${test?'data-test-run="true"':''}>
 <div class="grid2 manual-grid"><section class="card stack"><h2>Mensagem</h2>
 ${select('Canal','channel_id',[opt('','Selecione um canal'),...dispatchChannels().map(x=>opt(x.id,`${x.name} · ${x.type==='waba'?'Oficial':'QR Code'}`))],'','required')}
 <div class="stack" data-manual-template hidden>
 ${select('Modelo de mensagem','template_id',[opt('','Selecione um modelo')],'','disabled')}
 <div class="stack" data-variables></div></div>
 <div class="stack" data-manual-text hidden>
 <div class="field"><label for="manual-body">Mensagem</label><textarea id="manual-body" name="body" class="textarea" rows="5" maxlength="4096" disabled></textarea></div>
 <div class="field"><label for="manual-note">Nota interna (opcional)</label><textarea id="manual-note" name="note" class="textarea" rows="2" maxlength="1000" disabled></textarea><p class="hint">Visível para a equipe de atendimento.</p></div>
 </div>
 </section><section class="card stack">${test?`<h2>Contato de teste</h2>
 ${field('Número com DDI','test_phone','tel','+55 11 99999-0000','','required autocomplete="off" maxlength="25"')}
 <p class="hint">Use um número da equipe que autorizou este teste.</p>`:`<h2>Destinatários</h2>

 ${select('Serviço já realizado','service_id',[opt('','Todos os serviços'),...state.services.map(x=>opt(x.id,x.name))])}
 ${field('Buscar por nome ou telefone','customer-search','search','Ex. Mariana ou 1199999')}
 <div class="selection-bar"><strong id="manual-count" aria-live="polite">0 selecionados</strong>${button('Limpar seleção','clear-recipients','','small')}</div>
 <div id="manual-customers" class="recipient-list" aria-busy="true"></div>
 <div class="pager" id="manual-pager" aria-label="Páginas de clientes"></div>
` }
 </section></div>
 <section class="card stack"><label class="check-row"><input type="checkbox" name="confirm_consent" required>${test?'Confirmo que o contato da equipe autorizou a mensagem de teste.':'Confirmo que os destinatários autorizaram este envio.'}</label>
 <div class="actions"><button class="btn primary" type="submit" disabled>${test?'Enviar teste':'Adicionar à fila'}</button><span class="hint">O FlowSuite processa a fila e registra a resposta do Clickmassa.</span></div></section>
 </form>`}`;
}

function updateManualChannel(form){
 const channel=state.channels.find(x=>x.id===form.elements.channel_id.value);
 const official=channel?.type==='waba';
 const qr=channel?.type==='whatsapp';
 const templates=form.elements.template_id;
 form.querySelector('[data-manual-template]').hidden=!official;
 form.querySelector('[data-manual-text]').hidden=!qr;
 templates.disabled=!official;
 templates.required=official;
 form.elements.body.disabled=!qr;
 form.elements.body.required=qr;
 form.elements.note.disabled=!qr;
 templates.replaceChildren(new Option('Selecione um modelo',''));
 if(official){
  for(const model of activeTemplates().filter(x=>x.clickmassa_channel_id===channel.id)){
   templates.add(new Option(model.name,model.id));
  }
 }
 variablePanel(form);
}

function customersPage(){
 return `${head('Clientes e histórico','Encontre um cliente e consulte seus agendamentos e mensagens.')}
 <section class="card stack">${field('Buscar por nome ou telefone','customer-filter','search','Ex. Mariana ou 1199999')}
 <div id="customer-results" aria-busy="true"></div>
 <div class="pager" id="customer-pager" aria-label="Páginas de clientes"></div></section>`;
}

const contactPageSize=25;
const browse={page:0,request:0};
let contactSearchTimer;

function syncRecipientSelection(form){
 if(!form?.isConnected) return;
 if(form.dataset.testRun==='true'){
  form.querySelector('[type="submit"]').disabled=form.dataset.submitting==='true';
  return;
 }
 const count=state.manual.selected.size;
 form.querySelector('#manual-count').textContent=`${count} ${count===1?'selecionado':'selecionados'} de 100`;
 const locked=form.dataset.submitting==='true';
 form.querySelector('[data-action="clear-recipients"]').disabled=!count||locked;
 form.querySelector('[type="submit"]').disabled=!count||locked;
}

async function loadContactPage(manualMode){
 const form=manualMode?document.getElementById('manual-form'):null;
 const input=document.getElementById(manualMode?'customer-search':'customer-filter');
 if(!input||!state.current) return;
 const view=manualMode?state.manual:browse;
 const target=document.getElementById(manualMode?'manual-customers':'customer-results');
 const pager=document.getElementById(manualMode?'manual-pager':'customer-pager');
 const request=++view.request;
 const tenant=state.current.id;
 const service=form?.elements.service_id.value;
 const page=view.page;
 const search=input.value.trim().replace(/[^\p{L}\p{N}+ -]/gu,' ').trim().slice(0,100);
 target.setAttribute('aria-busy','true');
 target.innerHTML='<p class="hint" role="status">Buscando clientes…</p>';
 pager.innerHTML='';
 try{
  const columns='id,name,phone,birthday,marketing_opt_in,opted_out_at';
  const rows=await queryData('customers',query=>{
   if(manualMode) query=query.eq('marketing_opt_in',true).is('opted_out_at',null).not('phone','is',null).neq('phone','');
   if(service) query=query.eq('appointments.establishment_id',tenant).eq('appointments.service_id',service).or('completed_at.not.is.null,status.eq.completed',{referencedTable:'appointments'});
   if(search) query=query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
   return query.order('name').order('id').range(page*contactPageSize,(page+1)*contactPageSize);
  },service?`${columns},appointments!inner(id)`:columns,tenant);
  if(request!==view.request||!target.isConnected) return;
  const visible=rows.slice(0,contactPageSize);
  if(manualMode){
   target.innerHTML=visible.length?visible.map(c=>`<label class="recipient-row"><input type="checkbox" name="customer_ids" value="${h(c.id)}" ${view.selected.has(c.id)?'checked':''}><span><strong>${h(c.name||'Cliente sem nome')}</strong><small>${h(c.phone||'Sem telefone informado')}</small></span></label>`).join('')
    : '<p class="hint">Nenhum cliente elegível para esses filtros.</p>';
  } else {
   target.innerHTML=customerTable(visible);
  }
  const controls=`data-mode="${manualMode?'manual':'browse'}"`;
  pager.innerHTML=`${button('Anterior','contact-page',`${controls} data-step="-1" ${page?'':'disabled'}`,'small')}<span class="hint">Página ${page+1}</span>${button('Próxima','contact-page',`${controls} data-step="1" ${rows.length>contactPageSize?'':'disabled'}`,'small')}`;
 }catch{
  if(request===view.request&&target.isConnected) target.innerHTML=`<p class="hint">Não foi possível buscar os clientes.</p>${button('Tentar novamente','contact-page',`data-mode="${manualMode?'manual':'browse'}" data-step="0"`,'small')}`;
 }finally{
  if(request===view.request) target.setAttribute('aria-busy','false');
 }
}

function customerTable(list){return list.length?table(['Cliente','Telefone','Aniversário','Consentimento','Ação'],list.map(c=>[h(c.name),h(c.phone||'—'),h(c.birthday?dateOnly(c.birthday+'T12:00:00'):'—'),`<span class="badge ${c.marketing_opt_in&&!c.opted_out_at?'green':'amber'}">${c.marketing_opt_in&&!c.opted_out_at?'Autorizado':'Não autorizado'}</span>`,button('Histórico','customer-detail',`data-id="${h(c.id)}"`,'small')])):empty('Nenhum cliente encontrado','Confira a origem dos clientes desta unidade.')}
function reportsPage(){return `${head('Relatórios de envios','Acompanhe mensagens, falhas e execução das rotinas.',button('↻ Atualizar','refresh','','small'))}<div class="metrics"><div class="card"><span class="muted small">Na fila</span><div class="metric">${state.jobs.filter(j=>j.status==='queued').length}</div></div><div class="card"><span class="muted small">Aguardando confirmação</span><div class="metric">${state.jobs.filter(j=>j.status==='processing').length}</div></div><div class="card"><span class="muted small">Enviadas</span><div class="metric">${state.jobs.filter(j=>['sent','delivered','read'].includes(j.status)).length}</div></div><div class="card"><span class="muted small">Falhas</span><div class="metric">${state.jobs.filter(j=>j.status==='failed').length}</div></div><div class="card"><span class="muted small">Ignoradas</span><div class="metric">${state.jobs.filter(j=>j.status==='skipped').length}</div></div></div><section class="card"><div class="card-heading"><h2>Últimas mensagens</h2><span class="muted small">Até 500 registros</span></div>${state.jobs.length?table(['Data','Cliente','Origem','Status','Protocolo','Detalhe'],state.jobs.map(j=>[h(fmt(j.created_at)),h(j.test_run?'Contato de teste':j.customers?.name||state.customers.find(c=>c.id===j.customer_id)?.name||'—'),h(j.test_run?'Teste':j.source==='manual'?'Manual':'Automação'),`<span class="badge ${['sent','delivered','read'].includes(j.status)?'green':j.status==='failed'?'red':'amber'}">${h(statusLabel(j.status))}</span>`,`<span class="code">${h(j.external_message_id||j.id)}</span>`,h(j.error_message||'—')])):empty('Sem envios registrados','Os registros aparecerão após a primeira execução.')}</section><div class="section-title"><h2>Logs de integração</h2></div><section class="card">${state.logs.length?table(['Data','Fonte','Evento','Status'],state.logs.map(l=>[h(fmt(l.created_at)),h(l.source),h(l.event),h(l.status)])):empty('Sem logs','Os registros de integração aparecem aqui.')}</section>`}
let catalogChannel='';
function catalogModels(){
 const models=state.templates.filter(t=>!catalogChannel||t.clickmassa_channel_id===catalogChannel);
 return models.length?table(['Modelo','Canal','Estado','Campos'],models.map(t=>[
  h(t.name),h(state.channels.find(c=>c.id===t.clickmassa_channel_id)?.name||'—'),
  h(t.status==='active'?'Disponível':t.status==='unsupported'?'Formato pendente de validação':'Indisponível'),
  h(Array.isArray(t.variables)?t.variables.length:0)
 ])):empty('Sem modelos neste filtro','Confira o canal selecionado e a integração do catálogo.');
}
function catalogPage(){
 const routes=activeChannels();
 const lastSync=state.status?.last_clickmassa_sync;
 const channelRows=state.channels.map(c=>[
  h(c.name),h(c.type==='waba'?'Oficial':c.type==='whatsapp'?'QR Code':c.type),
  `<span class="badge ${c.dispatch_ready?'green':'amber'}">${c.dispatch_ready?'Pronto para enviar':c.active?'Aguardando credenciais':'Desconectado'}</span>`,
  h(c.external_id)
 ]);
 return `${head('Catálogos e serviços',lastSync?`Clickmassa sincronizado em ${fmt(lastSync)}.`:'Aguardando a primeira sincronização do Clickmassa.',
  button('Atualizar catálogo','refresh','','small'))}
 <div class="metrics catalog-metrics">
  <div class="card"><span class="muted small">Canais</span><div class="metric">${numeric(state.channels.length)}</div></div>
  <div class="card"><span class="muted small">Prontos para enviar</span><div class="metric">${numeric(dispatchChannels().length)}</div></div>
  <div class="card"><span class="muted small">Modelos disponíveis</span><div class="metric">${numeric(activeTemplates().length)}</div></div>
 </div>
 <div class="stack"><section class="card stack"><h2>Canais</h2>${channelRows.length?table(['Canal','Tipo','Estado','Código'],channelRows):
 empty('Sem canais importados','O painel master pode conferir o estado da sincronização.')}</section>
 <section class="card stack"><h2>Modelos de mensagem</h2>
 ${select('Filtrar por canal','catalog_channel',[opt('','Todos os canais'),...routes.filter(c=>c.type==='waba').map(c=>opt(c.id,c.name))],catalogChannel)}
 <div id="catalog-models">${catalogModels()}</div></section>
 <section class="card stack"><h2>Serviços AVEC</h2>
 ${state.services.length?table(['Serviço','ID AVEC','Retorno padrão','Ação'],state.services.map(s=>[
 h(s.name),h(s.external_id),s.default_return_days?h(s.default_return_days)+' dias':'—',
 canManage()?button('Definir retorno','service-return',`data-id="${h(s.id)}"`,'small'):'—'
 ])):empty('Sem serviços importados','Os serviços ficam disponíveis quando os dados da unidade são importados.')}</section></div>`;
}
function avecPage(){
 if(state.avecStatus!=='ready') return `${head('Relatórios AVEC','Pesquise relatórios por código ou assunto.')}${state.avecStatus==='error'?`<div class="alert">O catálogo está indisponível. ${button('Tentar novamente','retry-avec','','small')}</div>`:'<p class="card" role="status">Carregando catálogo…</p>'}`;
 const reports=state.avecCatalog;
 const mappings={csat:['0031','0008','0004'],inactive:['0107','0004'],post_service:['0031','0038','0248'],return:['0020','0320'],birthday:['0001','0004'],cross_sell:['0005','0008','0033'],history:['0002','0008','0031','0248'],stock:['0046'],arrival:['0248']};
 const moduleNames={...Object.fromEntries(MODULES.map(m=>[m.type,m.title])),history:'Histórico do cliente'};
 const report=reports.find(x=>x.code===state.avecReportCode)||reports[0];
 const filtered=reports.filter(x=>normalizeSearch([x.code,x.name,x.description].join(' ')).includes(normalizeSearch(state.avecSearch)));
 return `${head('Relatórios AVEC','Catálogo extraído da documentação oficial recebida. O servidor consulta a AVEC com as credenciais da unidade.')}
 <div class="alert info">Os relatórios habilitados são coletados pelo serviço do FlowSuite. Esta tela apresenta os parâmetros documentados.</div>
 <section class="card" style="margin-top:16px"><h2 style="margin-bottom:14px">Mapeamento por automação</h2><div class="avec-map">${Object.entries(mappings).map(([type,codes])=>`<div class="avec-map-row"><strong>${h(moduleNames[type])}</strong><div>${codes.map(code=>`<button class="btn small" data-action="avec-select" data-code="${h(code)}">${h(code)}</button>`).join(' ')}</div></div>`).join('')}</div><p class="hint">Aviso de chegada: 0248 indica status de agendamento, mas não confirma check-in. Não ativar envios automáticos por chegada sem validar o contrato da AVEC.</p></section>
 <div class="grid2" style="margin-top:18px"><section class="card"><h2 style="margin-bottom:14px">Catálogo de relatórios (${reports.length})</h2><div class="field"><label for="avec-search">Pesquisar por código ou assunto</label><input class="input" id="avec-search" value="${h(state.avecSearch)}" placeholder="Ex.: 0107, aniversário, estoque"></div><div class="avec-report-list">${reportButtons(filtered,report?.code)}</div><p class="hint" id="avec-count" role="status">${filtered.length} relatórios encontrados</p></section>
 <section class="card"><h2>Detalhes do relatório</h2>${report?`<p class="muted" style="margin:12px 0"><strong class="code">${h(report.code)}</strong> ${h(report.name)}</p><p class="muted small">${h(report.description||'Descrição indisponível')}</p><p class="muted small" style="margin-top:12px">Método: <strong>${h(report.method)}</strong> • Caminho: <span class="code">${h(report.path)}</span></p><div class="section-title"><h3>Parâmetros documentados</h3></div>${report.params.length?table(['Parâmetro','Tipo','Exemplo na coleção'],report.params.map(p=>[h(p.name),h(p.type),h(p.sample||'—')])):'<p class="muted small">Sem parâmetros extras documentados.</p>'}<p class="hint">Expressões como date('m/Y') são exemplos da coleção. O serviço deve enviar datas calculadas no formato DD/MM/AAAA.</p>`:'<p class="muted">Catálogo ainda não carregado.</p>'}</section></div>`;
}
function reportButtons(reports,selected){
 return reports.map(r=>`<button class="avec-report-button ${selected===r.code?'selected':''}" aria-pressed="${selected===r.code}" data-action="avec-select" data-code="${h(r.code)}"><span class="code">${h(r.code)}</span><span>${h(r.name)}</span></button>`).join('')||'<p class="muted small">Nenhum relatório encontrado.</p>';
}
function filterAvec(search){
 state.avecSearch=search;
 const term=normalizeSearch(search);
 const reports=state.avecCatalog.filter(r=>normalizeSearch([r.code,r.name,r.description].join(' ')).includes(term));
 document.querySelector('.avec-report-list').innerHTML=reportButtons(reports,state.avecReportCode);
 document.getElementById('avec-count').textContent=`${reports.length} relatórios encontrados`;
}

function ticketPage(){const t=state.ticket;return `${head('Atendimento aberto','Contexto recebido via window.postMessage, quando disponibilizado pelo CRM.')}${!t?'<div class="alert info">Aguardando contexto do atendimento. Abra o plugin no ticket do CRM e configure a origem autorizada no config.js.</div>':`<div class="grid2"><div class="card"><div class="card-heading"><h2>Contexto do ticket</h2><span class="badge ${state.ticketVerified?'green':'amber'}">${state.ticketVerified?'Origem autorizada':'Não verificado'}</span></div><div class="ticket-info"><div><span>ID do ticket</span><strong>${h(t.ticketId||'—')}</strong></div><div><span>ID do contato</span><strong>${h(t.contactId||'—')}</strong></div><div><span>Telefone</span><strong>${h(t.phone||'—')}</strong></div><div><span>Origem informada</span><strong>${h(t.origin||'—')}</strong></div></div><p class="hint" style="margin-top:14px">Dados de postMessage são contexto visual, não prova de identidade do cliente. Valide qualquer operação sensível pelo servidor.</p></div><section class="card"><h2>Histórico vinculado</h2>${ticketCustomerHistory(t)}</section></div>`}`}
function ticketCustomerHistory(t){const digits=String(t.phone||'').replace(/\D/g,'');if(digits.length<10)return empty('Sem correspondência','O CRM precisa enviar um telefone válido, ou será necessário um endpoint de vínculo pelo ticket ID.');const found=state.customers.filter(c=>String(c.phone||'').replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'')===digits.replace(/^55(?=\d{10,11}$)/,''));return found.length===1?`<p style="margin:12px 0"><strong>${h(found[0].name)}</strong></p>${button('Visualizar histórico','customer-detail',`data-id="${h(found[0].id)}"`,'small')}`:empty('Cliente não encontrado','Confira a sincronização e a normalização dos telefones.')}
function settingsPage(){return `${head('Configurações','Personalização do ambiente e status das integrações.') }<div class="grid2"><section class="card"><h2 style="margin-bottom:17px">Estabelecimento</h2><div class="list-row"><span class="muted">Nome</span><strong>${h(state.current.name)}</strong></div><div class="list-row"><span class="muted">Fuso horário</span><strong>${h(state.current.timezone)}</strong></div></section><section class="card"><h2 style="margin-bottom:17px">Integrações</h2><div class="list-row"><span>AVEC</span><span class="badge ${state.status?.avec_configured?'green':'amber'}">${state.status?.avec_configured?'Configurado':'Pendente'}</span></div><div class="list-row"><span>Clickmassa</span><span class="badge ${state.status?.clickmassa_configured?'green':'amber'}">${state.status?.clickmassa_configured?'Configurado':'Pendente'}</span></div><div class="list-row"><span>Última coleta AVEC</span><span class="small">${h(fmt(state.status?.last_avec_snapshot||state.status?.last_avec_sync))}</span></div><div class="list-row"><span>Última sync CRM</span><span class="small">${h(fmt(state.status?.last_clickmassa_sync))}</span></div></section></div>`}
function renderMaster(){
 el.innerHTML=`<div class="layout master-layout">
  <button type="button" class="nav-scrim" data-action="toggle-nav" aria-label="Fechar menu" ${state.navOpen?'':'hidden'}></button>
  <aside id="main-sidebar" class="sidebar ${state.navOpen?'open':''}">
   <div class="brand"><div class="brandmark">✦</div><span>FlowSuite</span></div>
   <nav class="nav-list" aria-label="Administração">
    <div class="sidebar-caption">Painel master</div>
    <a class="nav-link active" href="/?admin=1" aria-current="page">Estabelecimentos</a>
   </nav>
   <div class="sidebar-bottom"><p class="muted small master-account">${h(state.user.email)}</p>
    ${button('Sair da conta','logout','','ghost')}</div>
  </aside>
  <div class="main"><header class="topbar"><div class="actions">
    <button class="btn ghost mobile-menu" data-action="toggle-nav" aria-label="Menu" aria-controls="main-sidebar" aria-expanded="${state.navOpen}">☰</button>
    <strong>Administração master</strong>
  </div></header><main class="content" id="main-content">${adminPage()}</main></div>
 </div>`;
 if(state.modal) showModal();
}

function adminPage(){
 if(!state.profile?.master_admin) return empty('Acesso restrito','Somente administradores master podem acessar esta área.');
 const active=state.establishments.filter(x=>x.active).length;
 const establishments=state.establishments.map(unit=>{
  const attr=`data-id="${h(unit.id)}"`;
  const link=tenantUrl(unit.slug,false);
  return `<article class="card unit-card" data-unit="${h(unit.id)}">
   <div class="card-heading"><div><h2>${h(unit.name)}</h2><p class="hint">${h(unit.timezone)}</p><p class="hint">ID <span class="code">${h(unit.id)}</span></p></div>
    <span class="badge ${unit.active?'green':'red'}">${unit.active?'Ativo':'Inativo'}</span></div>
   <div class="field"><label for="unit-link-${h(unit.id)}">Link da equipe</label>
    <div class="input-row"><input class="input" id="unit-link-${h(unit.id)}" value="${h(link)}" readonly>
    ${button('Copiar link','copy-unit-link',attr,'small')}</div></div>
   <div class="actions">
    ${button('Integrações','credentials',attr,'small')}
    ${button('Acessos','grant-access',attr,'small')}
    ${button(unit.active?'Desativar':'Ativar','toggle-establishment',attr,'small')}
    ${unit.active?`<a class="btn small" href="${h(link)}" target="_blank" rel="noopener">Abrir operação</a>`:''}
   </div>
  </article>`;
 }).join('');
 return `${head('Estabelecimentos','Cadastre unidades, configure integrações e libere o acesso das equipes.',button('＋ Nova unidade','add-establishment'))}
 <div class="kpi-row master-summary"><span class="badge green">${active} ativos</span><span class="badge">${state.establishments.length-active} inativos</span></div>
 ${establishments?`<div class="unit-grid">${establishments}</div>`:`<section class="card">${empty('Nenhuma unidade criada','Use Nova unidade para começar.')}</section>`}`;
}
const tenantUrl=(slug,embed=embedded)=>`${String(conf.publicBaseUrl||location.origin).replace(/\/$/,'')}/?estabelecimento=${encodeURIComponent(slug)}${embed?'&embed=1':''}`;
function modalHtml(){const m=state.modal;let content='';if(m.type==='add-establishment')content=`<form id="establishment-form" class="stack">${field('Nome do estabelecimento','name','text','Ex: Studio Premium','','required minlength="2"')}${field('Slug do link (sem espaços)','slug','text','studio-premium','','required pattern="[a-z0-9]+(-[a-z0-9]+)*"')}${select('Fuso horário','timezone',[opt('America/Sao_Paulo','Brasília / São Paulo'),opt('America/Fortaleza','Fortaleza / Nordeste'),opt('America/Manaus','Manaus'),opt('America/Rio_Branco','Rio Branco')])}<div class="alert info">O cadastro criará o estabelecimento e registros iniciais no banco, com isolamento por RLS.</div><div class="modal-footer">${button('Cancelar','close-modal','','')}<button class="btn primary" type="submit">Criar estabelecimento</button></div></form>`;
 if(m.type==='credentials')content=integrationSetup(m);
 if(m.type==='grant-access')content=`<form id="access-form" class="stack"><div class="alert info">O usuário deve primeiro criar a conta e confirmar o e-mail, depois você atribui o acesso.</div>${field('E-mail do usuário','email','email','usuario@empresa.com','','required')}${select('Permissão','role',[opt('owner','Proprietário'),opt('manager','Gerente'),opt('operator','Operador'),opt('viewer','Somente leitura')])}<div class="modal-footer">${button('Cancelar','close-modal','','')}<button class="btn primary" type="submit">Autorizar acesso</button></div></form>`;
 if(m.type==='automation')content=automationForm();
 if(m.type==='automation-preview')content=m.loading?'<p role="status" class="hint">Calculando elegibilidade…</p>':
  `<p class="alert info">${m.eligible==null?'Não foi possível simular a regra.':`${m.eligible===100?'100 ou mais':m.eligible} envios elegíveis nas últimas 24 horas.`}</p>
   <p class="hint">A simulação considera consentimento, horário, canal, modelo, eventos importados e histórico da fila. Nenhuma mensagem foi criada.</p>`;

 if(m.type==='customer-detail')content=customerDetail(m.id);
 if(m.type==='service-return'){const s=state.services.find(x=>x.id===m.id);content=`<form id="service-return-form" class="stack"><p class="muted small">${h(s?.name)}</p>${field('Dias médios para retorno','default_return_days','number','30',s?.default_return_days||30,'min="1" max="3650" required')}<div class="alert info">A regra de retorno de cada serviço poderá usar este intervalo.</div><div class="modal-footer">${button('Cancelar','close-modal','','')}<button class="btn primary" type="submit">Salvar</button></div></form>`}
 const titles={'add-establishment':['Novo estabelecimento','Crie uma URL e um ambiente isolado.'],credentials:['Integrações da unidade',state.establishments.find(x=>x.id===m.id)?.name||''], 'grant-access':['Acesso ao estabelecimento','Vincule um usuário confirmado.'],'automation-preview':['Simulação da regra','Elegibilidade dos eventos da unidade'],automation:[state.editing?'Editar automação':'Criar automação','Canal, template e regras independentes'], 'customer-detail':['Histórico do cliente','Dados sincronizados do AVEC'], 'service-return':['Retorno por serviço','Intervalo médio recomendado']};let [title,desc]=titles[m.type]||['Editar',''];return `<div class="modal-bg" id="modal-bg"><div class="modal ${['automation','credentials'].includes(m.type)?'wide':''}" role="dialog" aria-modal="true" aria-label="${h(title)}"><div class="modal-head"><div><h2>${h(title)}</h2><p>${h(desc)}</p></div>${button('✕','close-modal','aria-label="Fechar janela"','ghost small')}</div><div class="modal-body">${content}</div></div>`}
const integrationSyncLabels={
 pending:'Sincronização solicitada', ready:'Catálogo sincronizado',
 auth_error:'Login recusado pelo Clickmassa', sync_error:'Falha ao sincronizar o catálogo',
 sender_error:'Catálogo sincronizado. Confira as credenciais de envio dos canais pendentes.'
};

function integrationSetup(modal){
 if(modal.loading) return '<p role="status" class="hint">Carregando integrações…</p>';
 if(!modal.setup) return `<p class="alert">Não foi possível carregar a configuração. Confira se a migração 005 está aplicada.</p>${button('Tentar novamente','reload-integration','','small')}`;
 const {status={},channels=[],catalog_email,catalog_tenant,catalog_verified}=modal.setup;
 const syncStatus=status||{};
 const online=syncStatus.worker&&Date.now()-Date.parse(syncStatus.worker)<120000;
 const selected=channels.find(x=>x.id===modal.channelId)||null;
 const unit=state.establishments.find(x=>x.id===modal.id);
 const avecTest=modal.avecTest;
 return `<div class="stack">
 <div class="alert info" role="status">${online?'Serviço conectado.':'Serviço sem sinal recente.'}
 ${h(integrationSyncLabels[syncStatus.sync]||'Aguardando configuração do catálogo.')}
 ${syncStatus.last_sync?` Última sincronização em ${h(fmt(syncStatus.last_sync))}.`:''}
 <div class="actions" style="margin-top:8px">${button('Atualizar status','reload-integration','','small')}${catalog_email?button('Sincronizar agora','sync-integration','','small'):''}
 ${unit?.active&&channels.some(c=>c.ready)?`<a class="btn small" href="${h(tenantUrl(unit.slug,false))}&amp;teste=1" target="_blank" rel="noopener">Abrir envio de teste</a>`:''}</div></div>
 <section class="card stack"><form class="stack" id="credentials-form">
 <h3>AVEC</h3><p class="hint">${syncStatus.avec?'Token cadastrado. Preencha para substituir.':'Cadastre o token usado para consultar relatórios desta unidade.'}</p>
 ${field('Token AVEC','avec_token','password','Novo token','','required autocomplete="new-password"')}
 <div class="actions"><button class="btn primary" type="submit">Salvar token AVEC</button>
 ${syncStatus.avec&&unit?.active?button('Testar AVEC','test-avec','','small'):''}</div>
 ${avecTest?.avec_test_state?`<p class="hint" role="status">${avecTest.avec_test_state==='ready'?
  `Conexão validada. ${h(avecTest.avec_test_records)} registros na primeira página.`:avecTest.avec_test_state==='error'?
  'O serviço não conseguiu validar a resposta AVEC. Confira o token.':'Teste solicitado ao serviço.'}</p>`:''}
 </form></section>
 <section class="card stack"><form class="stack" id="clickmassa-account-form">
 <h3>Clickmassa · conta do catálogo</h3><p class="hint">O serviço usa este login para buscar canais e modelos aprovados.</p>
 <div class="form-grid">
 ${field('E-mail Clickmassa','catalog_email','email','usuario@empresa.com',catalog_email,'required autocomplete="off"')}
 ${field('ID da empresa no Clickmassa','catalog_tenant','text','ID numérico',catalog_tenant,`required inputmode="numeric" pattern="[1-9][0-9]*" ${catalog_verified?'readonly':''}`)}
 </div>
 ${field('Senha Clickmassa','catalog_password','password',catalog_email?'Em branco para manter':'Senha da conta','','autocomplete="new-password" '+(catalog_email?'':'required'))}
 <div class="actions"><button class="btn primary" type="submit">Salvar e sincronizar</button></div></form></section>
 <section class="card stack"><h3>Clickmassa · envio por canal</h3>
 ${channels.length?`<form class="stack" id="clickmassa-sender-form">
 ${select('Canal','clickmassa_channel',[opt('','Selecione um canal'),...channels.map(c=>opt(c.id,`${c.name} · ${c.type==='waba'?'Oficial':'QR Code'}`))],selected?.id||'','required')}
 ${selected?`<p class="hint">${selected.ready?'Pronto para enviar.':selected.configured?'Credencial cadastrada. Confira a liberação e o status da sincronização.':'URL e token pendentes para este canal.'}</p>
 ${field('URL de envio','clickmassa_send_url','url',selected.configured?'Em branco para manter':'URL da API externa', '',selected.configured?'autocomplete="off"':'required autocomplete="off"')}
 ${field('Token de envio','clickmassa_send_token','password',selected.configured?'Em branco para manter':'Token emitido para o canal','',selected.configured?'autocomplete="new-password"':'required autocomplete="new-password"')}
 <label class="check-row"><input type="checkbox" name="clickmassa_enabled" ${selected.enabled?'checked':''}>Liberar envios neste canal</label>
 <div class="actions"><button class="btn primary" type="submit">Salvar canal</button></div>`:''}</form>`:'<p class="hint">Salve a conta do catálogo e aguarde a chegada dos canais para configurar o envio.</p>'}</section>
 </div>`;
}

async function reloadIntegration(modal, focusSelector=''){
 const [{data,error},avec]=await Promise.all([
  db().rpc('fs_integration_setup',{p_est:modal.id}),
  db().from('integration_status').select('avec_test_state,avec_test_records').eq('establishment_id',modal.id).maybeSingle(),
 ]);
 if(state.modal!==modal) return;
 modal.loading=false;
 modal.setup=error?null:data;
 modal.avecTest=avec.data;
 const body=document.querySelector('.modal-body');
 body.innerHTML=integrationSetup(modal);
 if(focusSelector) (body.querySelector(focusSelector)||document.querySelector('.modal-head button'))?.focus();
 if(error) apiError(error);
}

async function openIntegration(id){
 if(!state.profile?.master_admin) throw Error('Acesso restrito ao administrador master.');
 openModal('credentials',id);
 await reloadIntegration(state.modal);
}

async function changeIntegration(rpc, values, message, focus){
 const modal=state.modal;
 const {error}=await db().rpc(rpc,{p_est:modal.id,...values});
 if(error) throw error;
 toast(message);
 if(state.modal===modal) await reloadIntegration(modal,focus);
}

function customerDetail(id){
 const {detail,loading}=state.modal;
 if(loading) return '<p class="hint" role="status">Carregando histórico…</p>';
 if(!detail) return `<p class="alert">Não foi possível abrir o histórico.</p>${button('Tentar novamente','customer-detail',`data-id="${h(id)}"`,'small')}`;
 const {customer:c,appointments,jobs}=detail;
 return `<dl class="ticket-info"><div><dt>Nome</dt><dd>${h(c.name)}</dd></div><div><dt>Telefone</dt><dd>${h(c.phone||'—')}</dd></div><div><dt>Aniversário</dt><dd>${h(c.birthday?dateOnly(c.birthday+'T12:00:00'):'—')}</dd></div><div><dt>Consentimento</dt><dd>${c.marketing_opt_in&&!c.opted_out_at?'Autorizado':'Não autorizado'}</dd></div></dl>
 <div class="section-title"><h3>Últimos agendamentos</h3></div>${appointments.length?table(['Data','Serviço','Status','Valor'],appointments.map(a=>[h(fmt(a.scheduled_at)),h(a.services?.name||'—'),h(statusLabel(a.status)),a.amount==null?'—':h(Number(a.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}))])):empty('Sem agendamentos','')}
 <div class="section-title"><h3>Últimas mensagens</h3></div>${jobs.length?table(['Data','Status','Origem'],jobs.map(j=>[h(fmt(j.created_at)),h(statusLabel(j.status)),j.source==='manual'?'Manual':'Automação'])):empty('Sem mensagens','')}`;
}

async function openCustomerDetail(id){
 const tenant=state.current?.id;
 if(!tenant) return;
 const modal={type:'customer-detail',id,loading:true};
 state.modal=modal;
 showModal();
 try{
  const [customers,appointments,jobs]=await Promise.all([
   queryData('customers',q=>q.eq('id',id).limit(1),'id,name,phone,birthday,marketing_opt_in,opted_out_at',tenant),
   queryData('appointments',q=>q.eq('customer_id',id).order('scheduled_at',{ascending:false}).limit(30),'scheduled_at,status,amount,services(name)',tenant),
   queryData('message_jobs',q=>q.eq('customer_id',id).order('created_at',{ascending:false}).limit(20),'created_at,status,source',tenant)
  ]);
  if(customers[0]) modal.detail={customer:customers[0],appointments,jobs};
 }catch(err){if(state.modal===modal)apiError(err)}
 finally{
  modal.loading=false;
  if(state.modal===modal) document.querySelector('.modal-body').innerHTML=customerDetail(id);
 }
}

const triggerHelp={
 csat:'O intervalo começa quando o atendimento é concluído.',
 inactive:'Defina quantos dias sem agendamento caracterizam inatividade.',
 post_service:'Zero dias coloca a mensagem na fila após a conclusão do atendimento.',
 return:'O intervalo do serviço tem prioridade. Use este campo como alternativa.',
 birthday:'Use zero para a data do aniversário.',
 cross_sell:'Escolha o serviço recomendado após um atendimento elegível.',
 stock:'Avisa o responsável quando o estoque atinge o limite escolhido.',
 arrival:'Avisa o responsável quando o AVEC registra uma chegada confirmada.'
};

function automationForm(){
 const a=state.editing||{}, rules=a.rules||{};
 const type=a.type||state.modal.moduleType||'csat';
 const channels=activeChannels().filter(c=>c.type==='waba').map(c=>opt(c.id,c.name));
 const templates=activeTemplates().filter(t=>t.clickmassa_channel_id===a.channel_id).map(t=>opt(t.id,t.name));
 if(a.channel_id&&!channels.some(x=>x.value===a.channel_id)) channels.push(opt(a.channel_id,'Canal atual (indisponível)'));
 if(a.template_id&&!templates.some(x=>x.value===a.template_id)) templates.push(opt(a.template_id,'Modelo atual (indisponível)'));
 const selected=new Set(Array.isArray(rules.service_ids)?rules.service_ids:[]);
 const services=state.services.map(s=>opt(s.id,s.name));
 for(const id of selected) if(!services.some(x=>x.value===id)) services.push(opt(id,'Serviço sincronizado anteriormente'));
 if(rules.cross_sell_target_service_id&&!services.some(x=>x.value===rules.cross_sell_target_service_id)) services.push(opt(rules.cross_sell_target_service_id,'Serviço sincronizado anteriormente'));
 return `<form id="automation-form" class="stack">
 <div class="form-grid">
 ${field('Nome da regra','name','text','Ex. Pesquisa após atendimento',a.name,'required maxlength="120"')}
 ${select('Tipo de automação','type',MODULES.map(x=>opt(x.type,x.title)),type,state.editing?'disabled':'required')}
 <p class="hint full" data-trigger-help></p>
 ${field('Intervalo em dias','delay_days','number','0',a.delay_days??0,'min="0" max="3650" required')}
 ${field('Horário no estabelecimento','send_time','time','',String(a.send_time||'09:00').slice(0,5),'required')}
 <div data-for-types="stock arrival">${field('Telefone do responsável com DDI','recipient_phone','tel','+5511999990000',rules.recipient_phone,'maxlength="30"')}</div>
 <div data-for-types="stock">${field('Limite de estoque','min_stock','number','0',rules.min_stock??0,'min="0" max="999999999"')}</div>
 <div data-for-types="cross_sell">${select('Serviço recomendado','cross_sell_target_service_id',[opt('','Selecione um serviço'),...services],rules.cross_sell_target_service_id)}</div>
 <div data-for-types="inactive return">${select('Contar a partir de','date_basis',[opt('last_completed','Último atendimento concluído'),opt('last_appointment','Último agendamento'),opt('next_appointment','Próximo agendamento (legado)')],rules.date_basis||'last_completed')}</div>
 ${field('Intervalo mínimo entre mensagens (dias)','cooldown_days','number','7',rules.cooldown_days??7,'min="0" max="3650" required')}
 </div>
 <details class="service-picker" ${selected.size?'open':''} data-for-types="csat inactive post_service return cross_sell arrival">
 <summary>Serviços elegíveis <span class="hint">Todos quando a seleção estiver vazia</span></summary>
 <div class="recipient-list">${services.map(x=>`<label class="recipient-row"><input type="checkbox" name="service_ids" value="${h(x.value)}" ${selected.has(x.value)?'checked':''}>${h(x.label)}</label>`).join('')||'<p class="hint">Nenhum serviço sincronizado.</p>'}</div>
 </details>
 <div class="form-grid">
 ${select('Canal de WhatsApp','channel_id',[opt('','Selecione um canal'),...channels],a.channel_id,'required')}
 ${select('Modelo de mensagem','template_id',[opt('','Selecione um modelo'),...templates],a.template_id,'required')}
 </div><div class="stack" data-variables></div>
 <label class="check-row"><input type="checkbox" name="enabled" ${a.enabled&&a.native_armed_at?'checked':''}> Ativar regra após salvar</label>
 <div class="modal-footer">${button('Cancelar','close-modal','','ghost')}<button class="btn primary" type="submit">Salvar automação</button></div></form>`;
}

function updateAutomationTemplates(form){
 const channel=form.elements.channel_id.value;
 const selectInput=form.elements.template_id;
 const models=activeTemplates().filter(x=>x.clickmassa_channel_id===channel);
 const previous=selectInput.value;
 selectInput.replaceChildren(new Option('Selecione um modelo',''),...models.map(x=>new Option(x.name,x.id)));
 if(models.some(x=>x.id===previous)) selectInput.value=previous;
 variablePanel(form);
}
function updateAutomationFields(form){
 const type=form.elements.type.value;
 form.querySelector('[data-trigger-help]').textContent=nativeRuleTypes.has(type)?triggerHelp[type]:
  'A regra pode ser salva. A ativação depende de uma fonte de eventos validada.';
 form.elements.enabled.disabled=!nativeRuleTypes.has(type);
 if(form.elements.enabled.disabled) form.elements.enabled.checked=false;
 for(const group of form.querySelectorAll('[data-for-types]')){
  group.hidden=!group.dataset.forTypes.split(' ').includes(type);
  for(const field of group.querySelectorAll('input,select')){
   field.disabled=group.hidden;
   if(['recipient_phone','min_stock','cross_sell_target_service_id'].includes(field.name)) field.required=!group.hidden;
  }
 }
}

let modalOpener;
function showModal(){
 document.getElementById('modal-bg')?.remove();
 modalOpener=document.activeElement;
 el.insertAdjacentHTML('beforeend',modalHtml());
 el.querySelector('.layout').inert=true;
 const dialog=el.querySelector('.modal');
 const form=dialog.querySelector('#automation-form');
 if(form){
  updateAutomationFields(form);
  variablePanel(form,state.editing?.variable_mapping||{});
 }
 (dialog.querySelector('form input:not([disabled])')||dialog.querySelector('[data-action="close-modal"]')).focus();
}
function closeModal(){
 const form=el.querySelector('.modal form[data-submitting="true"]');
 if(form) return;
 state.modal=null;
 state.editing=null;
 el.querySelector('#modal-bg')?.remove();
 el.querySelector('.layout').inert=false;
 modalOpener?.focus();
}
function openModal(type,id='',moduleType=''){
 state.modal={type,id,moduleType,loading:type==='credentials'};
 state.editing=type==='automation'&&id?state.modules.find(x=>x.id===id):null;
 showModal();
}
async function submitAuth(form){const v=Object.fromEntries(new FormData(form));if(state.authMode==='new-password'){
 if(v.password!==v.confirm_password) throw Error('As senhas precisam ser iguais.');
 const {error}=await db().auth.updateUser({password:v.password});if(error)throw error;
 state.authMode='login';await loadAuth(state.session);toast('Senha atualizada.');return;
 }if(state.authMode==='signup'){if((v.password||'').length<8)throw new Error('A senha deve ter no mínimo 8 caracteres.');const {error}=await db().auth.signUp({email:v.email,password:v.password,options:{data:{full_name:v.name},emailRedirectTo:location.origin+location.pathname+location.search}});if(error)throw error;toast('Confira seu e-mail para confirmar o cadastro.');state.authMode='login';renderAuth();return}
 if(state.authMode==='reset'){const {error}=await db().auth.resetPasswordForEmail(v.email,{redirectTo:location.origin+location.pathname+location.search});if(error)throw error;toast('Se o e-mail existir, enviaremos instruções.');state.authMode='login';renderAuth();return}
 const {error}=await db().auth.signInWithPassword({email:v.email,password:v.password});if(error)throw error;const {data:{session}}=await db().auth.getSession();await loadAuth(session)}
async function saveAutomation(form){
 if(!canManage()) throw Error('Seu perfil não pode alterar automações.');
 const f=new FormData(form), original=state.editing;
 const type=original?.type||f.get('type');
 const channel=f.get('channel_id'),template=f.get('template_id');
 const enabled=f.has('enabled');
 if(!activeChannels().some(x=>x.id===channel)||!activeTemplates().some(x=>x.id===template)) throw Error('Escolha um canal e um modelo ativos.');
 if(enabled&&(!nativeRuleTypes.has(type)||!dispatchChannels().some(x=>x.id===channel&&x.type==='waba')||
   !activeTemplates().some(x=>x.id===template&&x.clickmassa_channel_id===channel))) throw Error('A ativação exige um modelo deste canal Oficial pronto para envio.');
 if(enabled&&f.get('date_basis')==='next_appointment') throw Error('Selecione um atendimento passado para definir o intervalo.');
 const rules={...original?.rules,cooldown_days:Number(f.get('cooldown_days'))};
 if(!original||!form.querySelector('.service-picker').hidden) rules.service_ids=f.getAll('service_ids');
 if(f.has('cross_sell_target_service_id')) rules.cross_sell_target_service_id=f.get('cross_sell_target_service_id');
 if(f.has('date_basis')) rules.date_basis=f.get('date_basis');
 if(f.has('min_stock')) rules.min_stock=Number(f.get('min_stock'));
 if(f.has('recipient_phone')){
  rules.recipient_phone=String(f.get('recipient_phone')).replace(/[\s()-]/g,'');
  if(!/^\+?[1-9]\d{9,14}$/.test(rules.recipient_phone)) throw Error('Informe o telefone do responsável com DDI.');
 }
 const tenant=state.current.id;
 const obj={establishment_id:tenant,type,name:String(f.get('name')).trim(),enabled,native_armed_at:enabled?new Date().toISOString():null,
  delay_days:Number(f.get('delay_days')),send_time:f.get('send_time'),channel_id:channel,template_id:template,
  rules,variable_mapping:readVariableMapping(form),updated_at:new Date().toISOString()};
 if(!obj.name) throw Error('Preencha o nome da automação.');
 const result=original?await db().from('automations').update(obj).eq('id',original.id).eq('establishment_id',tenant).select('id').single()
  :await db().from('automations').insert({...obj,created_by:state.user.id}).select('id').single();
 if(result.error) throw result.error;
 toast('Automação salva.');
 if(!form.isConnected) return;
 form.dataset.submitting='false';
 closeModal();
 await loadTenant();
 if(state.current?.id===tenant) render();
}

async function saveEstablishment(form){const f=new FormData(form),name=String(f.get('name')||''),slug=String(f.get('slug')||'');const {error}=await db().rpc('create_establishment',{p_name:name,p_slug:slug,p_timezone:f.get('timezone')});if(error)throw error;toast('Estabelecimento criado.');state.modal=null;await loadAuth(state.session);state.page='admin';render()}
async function saveCredentials(form){
 const token=String(new FormData(form).get('avec_token')||'').trim();
 if(!token) throw Error('Informe o token AVEC.');
 await changeIntegration('fs_set_avec_token',{p_token:token},'Token AVEC atualizado.','#avec_token');
}
async function saveClickmassaAccount(form){
 const data=new FormData(form);
 await changeIntegration('fs_save_clickmassa_account',{p_tenant:data.get('catalog_tenant'),p_email:data.get('catalog_email'),
  p_password:data.get('catalog_password')||null},'Conta salva. Sincronização solicitada.','#catalog_email');
}
async function saveClickmassaSender(form){
 const data=new FormData(form);
 await changeIntegration('fs_save_clickmassa_sender',{p_channel:data.get('clickmassa_channel'),p_url:data.get('clickmassa_send_url')||null,
  p_token:data.get('clickmassa_send_token')||null,p_enabled:data.has('clickmassa_enabled')},'Configuração do canal salva.','#clickmassa_channel');
}
async function saveAccess(form){const f=new FormData(form);const {error}=await db().rpc('grant_membership_by_email',{p_est:state.modal.id,p_email:f.get('email'),p_role:f.get('role')});if(error)throw error;toast('Usuário autorizado.');state.modal=null;render()}
async function saveServiceReturn(form){const days=Number(new FormData(form).get('default_return_days'));const {error}=await db().from('services').update({default_return_days:days}).eq('id',state.modal.id).eq('establishment_id',state.current.id);if(error)throw error;toast('Intervalo salvo.');state.modal=null;await loadTenant();render()}
async function sendDiagnostic(form){
 const f=new FormData(form);
 const route=dispatchChannels().find(x=>x.id===f.get('channel_id'));
 if(!route) throw Error('Escolha um canal pronto para envio.');
 const raw=String(f.get('test_phone')||'').trim();
 if(!/^\+?[0-9().\s-]+$/.test(raw)) throw Error('Informe um número válido com DDI.');
 const phone='+'+raw.replace(/[^0-9]/g,'');
 if(!/^\+[1-9][0-9]{10,14}$/.test(phone)) throw Error('Informe o número completo com DDI.');
 const template=route.type==='waba'?f.get('template_id'):null;
 const content=route.type==='waba'?{params:[...form.querySelectorAll('[data-test-param]')].map(input=>input.value.trim())}:
   {body:String(f.get('body')||'').trim(),note:String(f.get('note')||'').trim()};
 const tenant=state.current.id;
 const key=JSON.stringify([tenant,route.id,template,phone,content]);
 if(form.draft?.fingerprint!==key) form.draft={fingerprint:key,id:crypto.randomUUID()};
 const {data,error}=await db().rpc('fs_queue_clickmassa_test',{
  p_est:tenant,p_channel:route.id,p_template:template,p_phone:phone,p_confirm:f.has('confirm_consent'),
  p_content:content,p_request:form.draft.id,
 });
 if(error) throw error;
 toast(data?'Mensagem de teste adicionada à fila.':'Teste solicitado.');
 if(!form.isConnected) return;
 state.page='reports';
 await loadTenant();
 if(state.current?.id===tenant&&state.page==='reports') render();
}

async function sendManual(form){
 if(!canSend()) throw Error('Seu perfil não pode enfileirar mensagens.');
 const f=new FormData(form), ids=[...state.manual.selected].sort();
 if(form.dataset.testRun==='true') return sendDiagnostic(form);
 if(!ids.length||ids.length>100) throw Error('Selecione de 1 a 100 clientes.');
 if(!f.has('confirm_consent')) throw Error('Confirme o consentimento dos destinatários.');
 const channel=f.get('channel_id'),template=f.get('template_id');
 const route=dispatchChannels().find(x=>x.id===channel);
 if(!route) throw Error('Escolha um canal pronto para envio.');
 const payload={transport:'clickmassa',service_id:f.get('service_id')||null,requested_by:state.user.id};
 if(route.type==='waba'){
  if(!activeTemplates().some(x=>x.id===template&&x.clickmassa_channel_id===route.id)) throw Error('Escolha um modelo ativo deste canal.');
  payload.variable_mapping=readVariableMapping(form);
 }else{
  payload.body=String(f.get('body')||'').trim();
  if(!payload.body) throw Error('Preencha o texto da mensagem.');
  if(String(f.get('note')||'').trim()) payload.note=String(f.get('note')).trim();
 }
 const tenant=state.current.id;
 const fingerprint=JSON.stringify([tenant,channel,template,payload,ids]);
 if(form.draft?.fingerprint!==fingerprint) form.draft={fingerprint,id:crypto.randomUUID()};
 const jobs=ids.map(id=>({establishment_id:tenant,customer_id:id,channel_id:channel,template_id:template,
  source:'manual',status:'queued',idempotency_key:`manual:${form.draft.id}:${id}`,payload}));
 const {error}=await db().from('message_jobs').insert(jobs);
 if(error){
  if(error.code!=='23505') throw error;
  const previous=await queryData('message_jobs',q=>q.eq('idempotency_key',jobs[0].idempotency_key),'id',tenant);
  if(!previous.length) throw error;
 }
 toast(`${jobs.length} ${jobs.length===1?'mensagem adicionada':'mensagens adicionadas'} à fila.`);
 if(!form.isConnected) return;
 state.manual.selected.clear();
 state.page='reports';
 await loadTenant();
 if(state.current?.id===tenant&&state.page==='reports') render();
}

async function handleAction(btn){const action=btn.dataset.action,id=btn.dataset.id;if(action==='retry-avec'){void loadAvecCatalog();render();return}
 if(action==='contact-page'){
  const manual=btn.dataset.mode==='manual';
  const view=manual?state.manual:browse;
  view.page=Math.max(0,view.page+Number(btn.dataset.step));
  await loadContactPage(manual);
  document.querySelector(manual?'#customer-search':'#customer-filter')?.focus();
  return;
 }
 if(action==='clear-recipients'){
  const form=btn.closest('form');
  state.manual.selected.clear();
  for(const input of form.querySelectorAll('[name="customer_ids"]')) input.checked=false;
  syncRecipientSelection(form);
  return;
 }
 if(action==='customer-detail'){await openCustomerDetail(id);return}
 if(['new-automation','edit-automation','toggle-automation','delete-automation','service-return'].includes(action)&&!canManage()) throw Error('Seu perfil não pode alterar esta configuração.');
 if(['credentials','grant-access','add-establishment','copy-unit-link','toggle-establishment'].includes(action)&&
    (state.page!=='admin'||!state.profile?.master_admin)) throw Error('Acesso restrito à administração master.');
 if(action==='copy-unit-link'){
  const unit=state.establishments.find(x=>x.id===id);
  if(unit){await navigator.clipboard.writeText(tenantUrl(unit.slug,false));toast('Link da equipe copiado.')}
  return;
 }
 if(action==='preview-automation'){
  if(!canManage()) throw Error('Seu perfil não pode simular esta regra.');
  const dialog={type:'automation-preview',id,loading:true};
  state.modal=dialog;
  showModal();
  const {data,error}=await db().rpc('fs_preview_automation',{p_est:state.current.id,p_rule:id});
  if(state.modal!==dialog) return;
  Object.assign(dialog,{loading:false,eligible:error?null:data});
  const temp=document.createElement('template');
  temp.innerHTML=modalHtml();
  document.querySelector('.modal-body').replaceWith(temp.content.querySelector('.modal-body'));
  if(error) apiError(error);
  return;
 }
 if(action==='credentials'){await openIntegration(id);return}
 if(action==='reload-integration'){await reloadIntegration(state.modal,'[data-action="reload-integration"]');return}
 if(action==='test-avec'){
  btn.disabled=true;
  try { await changeIntegration('fs_request_avec_test',{},'Teste de conexão AVEC solicitado.','[data-action="test-avec"]'); }
  finally { if(btn.isConnected) btn.disabled=false; }
  return;
 }
 if(action==='sync-integration'){
  btn.disabled=true;
  try { await changeIntegration('fs_request_clickmassa_sync',{},'Sincronização solicitada.','[data-action="sync-integration"]'); }
  finally { if(btn.isConnected) btn.disabled=false; }
  return;
 }
 if(action==='retry-load'){location.reload();return}if(action==='retry-access'){await loadAuth(state.session);return}if(action==='auth-mode'){state.authMode=btn.dataset.mode;renderAuth();return}if(action==='avec-select'){
  state.avecReportCode=btn.dataset.code;render();
  const group=btn.classList.contains('avec-report-button')?'.avec-report-list':'.avec-map';
  const replacement=[...document.querySelectorAll(group+' [data-code]')].find(x=>x.dataset.code===btn.dataset.code);
  replacement?.focus();
  return;
 }if(action==='avec-copy'){const r=state.avecCatalog.find(x=>x.code===btn.dataset.code);if(!r)return;await navigator.clipboard.writeText(JSON.stringify({method:r.method,base_url:'https://api.avec.beauty',path:r.path,headers:{Authorization:'TOKEN_AVEC_SERVER_SIDE','Content-Type':'application/json'},parameters:r.params.map(p=>({name:p.name,type:p.type,example:p.sample})),pagination:{page:1,limit:250,until:'HasMore === false'}},null,2));toast('Especificação copiada sem credenciais.');return}if(action==='toggle-nav'){
  state.navOpen=!state.navOpen;
  document.querySelector('.sidebar').classList.toggle('open',state.navOpen);
  document.querySelector('.nav-scrim').hidden=!state.navOpen;
  document.querySelector('.mobile-menu').setAttribute('aria-expanded',String(state.navOpen));
  (state.navOpen?document.querySelector('.nav-link[aria-current]'):document.querySelector('.mobile-menu'))?.focus();
  return;
 }if(action==='navigate'){
  const next=btn.dataset.page;
  if(state.page!==next){
   state.manual.selected.clear();
   state.manual.page=0; browse.page=0;
  }
  state.page=next;state.navOpen=false;render();
  const title=document.querySelector('.content h1');
  if(title){title.tabIndex=-1;title.focus({preventScroll:true})}
  window.scrollTo(0,0);
  return;
 }if(action==='logout'){const {error}=await db().auth.signOut();if(error)throw error;state.authMode='login';state.ticket=null;state.ticketVerified=false;await loadAuth(null);return}if(action==='close-modal'){closeModal();return}if(action==='refresh'){await loadTenant();render();toast('Dados atualizados.');return}if(action==='new-automation'){openModal('automation','',btn.dataset.type||'csat');return}if(action==='edit-automation'){openModal('automation',id);return}if(action==='add-establishment'||action==='grant-access'||action==='service-return'){openModal(action,id);return}if(action==='copy-link'){await navigator.clipboard.writeText(tenantUrl(state.current.slug));toast('Link copiado.');return}
 if(action==='toggle-automation'){
  const rule=state.modules.find(x=>x.id===id);
  if(!rule) return;
  const enabled=!(rule.enabled&&rule.native_armed_at);
  if(enabled&&(!nativeRuleTypes.has(rule.type)||rule.rules?.date_basis==='next_appointment'||
    !dispatchChannels().some(c=>c.id===rule.channel_id&&c.type==='waba')||
    !activeTemplates().some(t=>t.id===rule.template_id&&t.clickmassa_channel_id===rule.channel_id))){
   throw Error('Edite a regra. A ativação exige um gatilho disponível e um modelo do canal Oficial.');
  }
  const {error}=await db().from('automations').update({enabled,native_armed_at:enabled?new Date().toISOString():null,updated_at:new Date().toISOString()})
   .eq('id',id).eq('establishment_id',state.current.id);
  if(error) throw error;
  await loadTenant();
  render();
  return;
 }
 if(action==='delete-automation'){if(!confirm('Excluir esta automação permanentemente?'))return;const {error}=await db().from('automations').delete().eq('id',id).eq('establishment_id',state.current.id);if(error)throw error;await loadTenant();render();toast('Automação excluída.');return}
 if(action==='toggle-establishment'){const e=state.establishments.find(x=>x.id===id);if(!e)return;if(!confirm(`${e.active?'Desativar':'Ativar'} ${e.name}?`))return;const {error}=await db().from('establishments').update({active:!e.active}).eq('id',id);if(error)throw error;await loadAuth(state.session);state.page='admin';render();return}}
function installPostMessage(){window.addEventListener('message',(event)=>{const allowed=Array.isArray(conf.allowedParentOrigins)?conf.allowedParentOrigins:[];if(window.parent===window||!allowed.length||!allowed.includes(event.origin)||event.source!==window.parent)return;let payload=event.data;if(typeof payload==='string'){if(payload.length>20000)return;try{payload=JSON.parse(payload)}catch{return}}if(!payload||typeof payload!=='object'||Array.isArray(payload))return;
 // Aceita formatos comuns, sem presumir contrato final da plataforma.
 const ticket=payload.ticket||payload.data?.ticket||payload.payload?.ticket||null;const ticketId=ticket?.id??payload.ticket_id??payload.ticketId;
 if(!ticketId)return;const contact=ticket?.contact||payload.contact||payload.data?.contact||{};const phone=contact.phone||contact.phone_number||ticket?.phone||payload.phone||'';
 const obj={ticketId:String(ticketId).slice(0,100),contactId:String(contact.id||ticket?.contact_id||'').slice(0,100),phone:String(phone).slice(0,40),origin:event.origin};
 state.ticket=obj;state.ticketVerified=true;if(state.page==='ticket'&&state.user&&!state.modal)render();
 });}
function wireEvents(){
 const submits={
  'auth-form':submitAuth,'establishment-form':saveEstablishment,'credentials-form':saveCredentials,
  'clickmassa-account-form':saveClickmassaAccount,'clickmassa-sender-form':saveClickmassaSender,
  'access-form':saveAccess,'automation-form':saveAutomation,'manual-form':sendManual,'service-return-form':saveServiceReturn
 };
 document.addEventListener('click',async e=>{
  if(e.target.id==='modal-bg'){closeModal();return}
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  e.preventDefault();
  try{await handleAction(btn)}catch(err){apiError(err)}
 });
 document.addEventListener('submit',async e=>{
  const form=e.target;
  if(!Object.hasOwn(submits,form.id)) return;
  e.preventDefault();
  if(form.dataset.submitting==='true') return;
  const submit=form.querySelector('[type="submit"]');
  const title=submit.textContent;
  form.dataset.submitting='true';
  submit.disabled=true;
  submit.textContent='Salvando…';
  try{await submits[form.id](form)}catch(err){apiError(err)}finally{
   if(form.isConnected){
    form.dataset.submitting='false';
    submit.textContent=title;
    submit.disabled=false;
    if(form.id==='manual-form') syncRecipientSelection(form);
   }
  }
 });
 document.addEventListener('change',async e=>{
  const input=e.target,form=input.form;
  if(input.id==='catalog_channel'){
   catalogChannel=input.value;
   document.getElementById('catalog-models').innerHTML=catalogModels();
   return;
  }
  if(input.id==='tenant-select'){
   catalogChannel='';
   clearTenant();
   state.current=state.establishments.find(x=>x.id===input.value&&x.active);
   if(state.current) localStorage.setItem('flowsuite_tenant',state.current.slug);
   state.page='dashboard';state.navOpen=false;
   const loading=loadTenant();
   render();
   await loading;
   if(state.current?.id===input.value) render();
   return;
  }
  if(input.name==='clickmassa_channel'&&state.modal?.type==='credentials'){
   state.modal.channelId=input.value;
   const template=document.createElement('template');
   template.innerHTML=integrationSetup(state.modal);
   const sender=template.content.querySelector('#clickmassa-sender-form');
   input.form.replaceWith(sender);
   sender.querySelector('#clickmassa_channel')?.focus();
   return;
  }
  if(!form||!['manual-form','automation-form'].includes(form.id)) return;
  if(input.name==='customer_ids'){
   if(input.checked && state.manual.selected.size>=100){
    input.checked=false;
    toast('Selecione até 100 destinatários por envio.',true);
    return;
   }
   if(input.checked) state.manual.selected.add(input.value);
   else state.manual.selected.delete(input.value);
   syncRecipientSelection(form);
  }else if(input.name==='channel_id'&&form.id==='automation-form'){
   updateAutomationTemplates(form);
  }else if(input.name==='channel_id'&&form.id==='manual-form'){
   updateManualChannel(form);
  }else if(input.name==='service_id'){
   if(state.manual.selected.size) toast('Seleção limpa após a mudança de serviço.');
   state.manual.selected.clear();
   state.manual.page=0;
   syncRecipientSelection(form);
   variablePanel(form,{},readVariableMapping(form,true));
   void loadContactPage(true);
  }else if(input.name==='type'){
   updateAutomationFields(form);
   variablePanel(form,{},readVariableMapping(form,true));
  }else if(input.name==='template_id'){
   const mapping=input.value===state.editing?.template_id?state.editing.variable_mapping||{}:{};
   variablePanel(form,mapping);
  }else if(input.closest('[data-variable]')){
   updateMessagePreview(form);
  }
 });
 document.addEventListener('input',e=>{
  const input=e.target;
  if(input.id==='avec-search') filterAvec(input.value);
  if(input.hasAttribute('data-test-param')) updateMessagePreview(input.form);
  if(input.id==='customer-search'||input.id==='customer-filter'){
   const manual=input.id==='customer-search';
   const view=manual?state.manual:browse;
   view.page=0;
   view.request++;
   clearTimeout(contactSearchTimer);
   contactSearchTimer=setTimeout(()=>{if(input.isConnected) void loadContactPage(manual)},250);
  }
  if(input.name==='name'&&input.form?.id==='establishment-form'){
   const slug=input.form.elements.slug;
   if(!slug.dataset.touched) slug.value=slugify(input.value);
  }
  if(input.name==='slug') input.dataset.touched='1';
 });
 document.addEventListener('keydown',e=>{
  if(!state.modal){
   if(e.key==='Escape'&&state.navOpen) document.querySelector('.mobile-menu').click();
   return;
  }
  if(e.key==='Escape'){closeModal();return}
  if(e.key!=='Tab') return;
  const focusables=[...document.querySelectorAll('.modal button:not(:disabled), .modal input:not(:disabled), .modal select:not(:disabled), .modal summary, .modal a[href]')].filter(x=>x.getClientRects().length);
  const first=focusables[0],last=focusables.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
  if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
 });
}
wireEvents();
setInterval(refreshVisibleJobs,8000);
boot().catch(err=>{
 el.innerHTML='<main class="splash"><p>Não foi possível abrir o ambiente.</p><button class="btn" data-action="retry-load">Tentar novamente</button></main>';
 apiError(err);
});
