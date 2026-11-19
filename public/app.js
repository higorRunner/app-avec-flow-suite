import { reportComposer } from './report-composer.js';
const root=document.getElementById('app');
const dialog=document.getElementById('dialog');
const state={user:null,units:[],unit:null,data:null,integration:null,members:[],page:'home',tab:'connect',menu:false,
  contacts:[],contactPage:0,contactSearch:'',selected:new Set(),sendMode:'test',channel:'',template:'',models:[],settings:null,avecReport:null,reportCode:'',reportPage:1};
const labels={queued:'Na fila',processing:'Resultado inconclusivo',accepted:'Aceita pelo Clickmassa',sent:'Enviada',delivered:'Entregue',
  read:'Lida',failed:'Falha',skipped:'Ignorada',pending:'Solicitado',syncing:'Conectando',ready:'Atualizado',error:'Falha',unconfigured:'Pendente'};
const types={post_service:'Pós-atendimento',csat:'Pesquisa de satisfação',return:'Sugestão de retorno',
  birthday:'Aniversário',inactive:'Clientes inativos',cross_sell:'Venda complementar'};
const appointmentStatusChoices=[['scheduled','Agendado'],['confirmed','Confirmado'],['waiting','Aguardando'],
  ['in_progress','Em atendimento'],['finalized','Finalizado'],['paid','Pago'],['canceled','Cancelado'],['missed','Faltou']];
const fieldChoices={'customer.name':'Nome do cliente','customer.phone':'Telefone do cliente','customer.email':'E-mail do cliente',
  'customer.birthday':'Nascimento','establishment.name':'Nome da unidade','service.name':'Nome do serviço',
  'appointment.scheduled_at':'Data do agendamento','appointment.completed_at':'Conclusão do atendimento',
  'feedback.url':'Link individual da pesquisa de satisfação'};
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',
  timeZone:state.data?.unit.timezone||'America/Sao_Paulo'}).format(new Date(value)):'—';
const button=(title,action,attr='',style='')=>`<button type="button" class="btn ${style}" data-action="${action}" ${attr}>${title}</button>`;
const input=(label,name,type='text',value='',attrs='')=>`<div class="field"><label for="${h(name)}">${h(label)}</label><input id="${h(name)}" name="${h(name)}" type="${type}" value="${h(value)}" ${attrs}></div>`;
const options=rows=>rows.map(([id,label])=>`<option value="${h(id)}">${h(label)}</option>`).join('');
const select=(label,name,rows,value='',attrs='')=>`<div class="field"><label for="${h(name)}">${h(label)}</label><select id="${h(name)}" name="${h(name)}" ${attrs}>${rows.map(([id,title])=>`<option value="${h(id)}" ${String(id)===String(value)?'selected':''}>${h(title)}</option>`).join('')}</select></div>`;
const textarea=(label,name,value='',attrs='')=>`<div class="field"><label for="${h(name)}">${h(label)}</label><textarea id="${h(name)}" name="${h(name)}" ${attrs}>${h(value)}</textarea></div>`;
const empty=(title,detail)=>`<div class="empty"><strong>${h(title)}</strong><p class="hint">${h(detail)}</p></div>`;
const badge=(value,kind='')=>`<span class="badge ${kind}">${h(labels[value]||value)}</span>`;
const table=(cols,rows)=>`<div class="table-scroll" role="region" tabindex="0" aria-label="Tabela com rolagem"><table><thead><tr>${cols.map(c=>`<th scope="col">${h(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const head=(title,desc,action='')=>`<div class="page-head"><div><h1>${h(title)}</h1><p>${h(desc)}</p></div><div class="actions">${action}</div></div>`;
const metric=(title,n)=>`<section class="card"><p class="metric-label">${h(title)}</p><div class="metric-number">${h(n)}</div></section>`;
const unitPath=action=>'/units/'+state.unit.id+'/'+action;
const canManage=()=>state.user.master||state.data?.unit.role==='manager';
const canSend=()=>state.user.master||['manager','operator'].includes(state.data?.unit.role);
const unitLink=unit=>location.origin+'/?unidade='+encodeURIComponent(unit.slug);
const readyChannels=()=>state.data?.channels.filter(c=>c.active&&c.enabled&&c.configured)||[];
const readyModels=(channel)=>state.data?.templates.filter(t=>t.channel_id===channel&&t.active&&t.supported)||[];
const composer=reportComposer({api,h,select,button,table,openDialog,unitPath,channels:readyChannels,
  models:()=>state.data?.templates.filter(t=>t.active&&t.supported)||[],toast,
  onSent:async()=>{state.page='reports';await refreshData();render()}});
const brandLogo='<img class="brand-logo" src="/logo.webp" alt="FlowSuite" width="218" height="73">';

async function api(path,method='GET',data) {
  const response=await fetch('/api'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},
    body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});
  let result;
  try{result=await response.json()}catch{throw Error('O servidor não retornou uma resposta válida.')}
  if(!response.ok){
    if(response.status===401){state.user=null;renderLogin()}
    throw Error(result.error||'Não foi possível concluir.');
  }
  return result;
}
function toast(message,error=false){
  const el=document.createElement('div');
  el.className='toast'+(error?' error':'');el.setAttribute('role',error?'alert':'status');el.textContent=message;
  const notifications=document.getElementById('notifications');
  notifications.append(el);
  while(notifications.children.length>3)notifications.firstElementChild.remove();
  setTimeout(()=>el.remove(),4500);
}
function renderLogin(message=''){
  root.innerHTML=`<main class="auth">
   <aside class="auth-story"><div class="brand">${brandLogo}</div>
    <div><h1>Cada contato.<br>Cada retorno.<br>Uma operação.</h1><p>Conecte seu atendimento, acompanhe as mensagens e cuide da jornada de cada cliente.</p></div>
    <small>Central de relacionamento</small>
   </aside>
   <section class="auth-form"><div class="auth-card stack"><div class="mobile-brand">${brandLogo}</div><div><h1>Entre no FlowSuite</h1><p class="muted">Acesse com a conta criada para sua equipe.</p></div>
    ${message?`<p class="alert error" role="alert">${h(message)}</p>`:''}
    <form id="login-form" class="stack">
     ${input('E-mail','email','email','','required autocomplete="username" maxlength="160"')}
     ${input('Senha','password','password','','required autocomplete="current-password" maxlength="200"')}
     <button class="btn primary" type="submit">Entrar</button>
    </form><p class="hint auth-version">Primeiro acesso ou senha esquecida? Solicite uma conta ou uma senha temporária ao administrador.</p>
   </div></section></main>`;
}
function renderPassword(){
  root.innerHTML=`<main class="auth-form loading"><section class="auth-card stack"><h1>Defina sua senha</h1>
   <p class="muted">Escolha a senha que você usará para entrar no FlowSuite.</p>
   <form id="password-form" class="stack">${input('Nova senha','password','password','','required minlength="10" maxlength="200" autocomplete="new-password"')}
   ${input('Confirme a senha','confirmation','password','','required minlength="10" maxlength="200" autocomplete="new-password"')}
   <button class="btn primary" type="submit">Salvar senha</button></form>
   ${button('Sair da conta','logout','','ghost')}</section></main>`;
}
async function boot(){
  try{state.user=await api('/me')}catch(error){
    if(state.user===null){
      let message='';
      try{const status=await(await fetch('/health')).json();if(!status.ok)message=status.message}catch{message='Não foi possível conectar ao servidor.'}
      renderLogin(message);
    }
    return;
  }
  if(state.user.must_change_password){renderPassword();return}
  state.units=await api('/units');
  const slug=new URLSearchParams(location.search).get('unidade');
  if(state.user.master&&!slug){state.unit=null;state.page='home'}
  else state.unit=state.units.find(u=>u.slug===slug)||(!slug?state.units[0]:null);
  if(state.unit){state.data=await api(unitPath('data'));state.page='dashboard';
    if(location.hash==='#settings'&&canManage()){state.settings=await api(unitPath('settings'));state.page='settings'}}
  render();
}
function navigation(){
  if(state.user.master&&!state.unit) return [['home','Unidades','▦']];
  return [['dashboard','Visão geral','◫'],['send','Envios','↗'],['rules','Automações','↻'],
    ['contacts','Clientes','♙'],['catalog','Canais e modelos','▤'],['services','Serviços e agenda','◷'],
    ['feedback','Satisfação','☆'],['inventory','Estoque','▧'],['reports','Relatórios','▥'],...(canManage()?[['settings','Configurações','⚙']]:[])];
}
function render(){
  if(!state.user){renderLogin();return}
  const master=state.user.master&&!state.unit;
  root.innerHTML=`<div class="layout ${master?'master-mode':'operation-mode'}">
   <button class="scrim" data-action="menu" aria-label="Fechar menu" ${state.menu?'':'hidden'}></button>
   <aside class="sidebar ${state.menu?'open':''}" id="sidebar">
    <div class="brand">${brandLogo}</div>
    <div><p class="sidebar-caption">${master?'Administração master':'Operação da unidade'}</p>
     <nav aria-label="${master?'Administração':'Operação'}">${navigation().map(([id,title,icon])=>
      `<button class="nav-link ${state.page===id?'active':''}" data-page="${id}" ${state.page===id?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span>${title}</button>`).join('')}</nav></div>
    <div class="sidebar-bottom">
     ${state.user.master&&state.unit?'<a class="nav-link" href="/">← Administração master</a>':''}
     <div class="user-name">${h(state.user.name)}<br><small>${h(state.user.email)}</small></div>
     ${button('Minha senha','password','','ghost')}${button('Sair','logout','','ghost')}
    </div>
   </aside>
   <div><header class="topbar"><div class="actions">${button('☰','menu','aria-label="Menu" aria-controls="sidebar" aria-expanded="'+state.menu+'"','menu-toggle small')}
    <strong>${master?'Painel master':h(state.unit?.name||'Acesso da equipe')}</strong></div>
    <span class="hint"><span class="status-dot"></span>Servidor integrado</span></header>
    <main class="content" id="main">${content()}</main>
   </div></div>`;
  hydrate();
}
function content(){
  if(state.user.master&&!state.unit) return state.page==='integration'?integrationPage():unitsPage();
  if(!state.unit) return empty('Acesso pendente','Solicite ao administrador o vínculo com sua unidade.');
  switch(state.page){
    case 'dashboard':return dashboard();
    case 'catalog':return catalogPage();
    case 'send':return sendPage();
    case 'rules':return rulesPage();
    case 'contacts':return contactsPage();
    case 'services':return servicesPage();
    case 'reports':return reportsPage();
    case 'feedback':return feedbackPage();
    case 'inventory':return inventoryPage();
    case 'settings':return settingsPage();
    default:return dashboard();
  }
}
function unitsPage(){
  return `${head('Suas unidades','Configure as conexões e organize o acesso das equipes.',button('＋ Nova unidade','new-unit','','primary'))}
   ${state.units.length?`<div class="unit-grid">${state.units.map(u=>`<article class="card unit-card">
    <header><div><h2>${h(u.name)}</h2><p class="hint">${h(u.timezone)}</p></div>${badge(u.active?'Ativa':'Inativa',u.active?'ok':'warn')}</header>
    <div class="field"><label for="link-${u.id}">Link da equipe</label><div class="input-row">
     <input id="link-${u.id}" class="unit-link" readonly value="${h(unitLink(u))}">${button('Copiar','copy','data-id="'+u.id+'"','small')}</div></div>
    <div class="actions">${button('Integrações','integrations','data-id="'+u.id+'"','primary small')}
     ${button('Acessos','members','data-id="'+u.id+'"','small')}
     ${button(u.active?'Desativar':'Ativar','unit-active','data-id="'+u.id+'"','small')}
     ${u.active?`<a class="btn small" href="${h(unitLink(u))}">Abrir operação ↗</a>`:''}
    </div></article>`).join('')}</div>`:`<section class="card">${empty('Crie sua primeira unidade','Depois, conecte o Clickmassa e libere o acesso da equipe.')}</section>`}`;
}
function integrationStatus(){
  const u=state.integration.unit;
  return `<section class="card stack"><h2>Estado das conexões</h2>
   <div class="actions between"><span>Catálogo Clickmassa</span>${badge(u.sync_state,u.sync_state==='ready'?'ok':u.sync_state==='error'?'error':'warn')}</div>
   <p class="hint">${u.sync_error?h(u.sync_error):u.synced_at?'Última atualização em '+h(fmt(u.synced_at)):'Salve o login para importar canais e modelos.'}</p>
   <div class="actions between"><span>Consulta AVEC</span>${badge(u.avec_state,u.avec_state==='ready'?'ok':u.avec_state==='error'?'error':'warn')}</div>
   <p class="hint">${h(u.avec_error|| (u.avec_checked_at?'Última consulta em '+fmt(u.avec_checked_at):'Cadastre o token para consultar os clientes.'))}</p>
   ${button('Atualizar estado','refresh-integration','','small')}
  </section>`;
}
function diagnosticText(info){
  const lines=[`FlowSuite · versão: ${info.version||'não informada'}`,`Leitor AVEC: ${info.reader||'não informado'}`];
  const stages={request:'Iniciando consulta',http:'Resposta HTTP',response_structure:'Estrutura da resposta',
    parsed:'Registros reconhecidos',completed:'Consulta concluída',failed:'Falha'};
  for(const entry of [...(info.diagnostics||[])].reverse()){
    lines.push('',`[${fmt(entry.created_at)}] ${entry.provider} · ${stages[entry.stage]||entry.stage} · ${entry.state}`);
    if(entry.version)lines.push(`Versão desta consulta: ${entry.version}`);
    if(entry.url)lines.push(`${entry.method} ${entry.url}`);
    if(entry.http_status!==undefined)lines.push(`HTTP ${entry.http_status}${entry.content_type?' · '+entry.content_type:''}`);
    if(entry.duration_ms!==undefined)lines.push(`Tempo: ${entry.duration_ms} ms`);
    if(entry.shape)lines.push('Estrutura: '+JSON.stringify(entry.shape));
    if(entry.records!==undefined)lines.push(`Registros: ${entry.records}${entry.pages!==undefined?' · Páginas: '+entry.pages:''}`);
    if(entry.has_more!==undefined)lines.push('Mais páginas: '+(entry.has_more?'sim':'não'));
    if(entry.imported!==undefined&&entry.imported!==null)lines.push('Clientes importados: '+entry.imported);
    if(entry.channels!==undefined)lines.push(`Canais: ${entry.channels} · Modelos: ${entry.templates}`);
    if(entry.message)lines.push(entry.message);
  }
  if(!info.diagnostics?.length)lines.push('','Nenhuma consulta registrada nesta versão. Salve a conexão ou sincronize para gerar o diagnóstico.');
  return lines.join('\n');
}
function updateDiagnostics(){
  const log=document.getElementById('integration-log');
  if(log&&document.activeElement!==log){
    const atEnd=log.scrollTop+log.clientHeight>=log.scrollHeight-20;
    log.value=diagnosticText(state.integration);
    if(atEnd)log.scrollTop=log.scrollHeight;
  }
}
function integrationPage(){
  const info=state.integration,u=info.unit;
  const rows=info.channels.map(c=>[
    h(c.name),badge(c.type==='waba'?'Oficial':'QR Code'),badge(!c.active?'Desconectado':c.enabled&&c.configured?'Pronto para enviar':'Configuração pendente',c.active&&c.enabled&&c.configured?'ok':'warn'),
    button('Configurar envio','sender','data-id="'+c.id+'"','small'),
  ]);
  const columns=u.sample_columns||[];
  return `${head(u.name,'Conexões e credenciais desta unidade.',button('← Unidades','back-units','','small'))}
  <div class="integration-layout"><div class="stack">
   <section class="card stack"><h2>Conta Clickmassa</h2><p class="hint">Use a conta que pode acessar os canais e os modelos da empresa.</p>
    <form id="catalog-form" class="stack">
     ${input('URL base da API Clickmassa','catalog_base_url','url',info.base_url,'required placeholder="https://api.seudominio.com.br" autocomplete="off"')}
     <p class="hint">Login, canais e modelos usam essa base. Trocar a API pausa as rotinas e exige revisar os canais de envio.</p>
     ${input('E-mail Clickmassa','catalog_email','email',info.email,'required autocomplete="off"')}
     ${input('Senha Clickmassa','catalog_password','password','','autocomplete="new-password" '+(!info.email?'required':''))}
     ${info.email?'<p class="hint">Preencha a senha apenas para substituir a credencial cadastrada.</p>':''}
     <div class="actions"><button class="btn primary" type="submit">Salvar e importar catálogo</button>
      ${info.email?button('Sincronizar agora','sync-now','','small'):''}</div>
    </form>
    ${u.catalog_tenant?`<p class="hint">Empresa identificada pelo Clickmassa · ${h(u.catalog_tenant)}</p>`:''}
   </section>
   <section class="card stack"><h2>Canais de envio</h2>
    ${rows.length?table(['Canal','Tipo','Estado','Ação'],rows):empty('Aguardando canais','Importe o catálogo para configurar o envio de cada canal.')}
    ${rows.length?`<a class="btn" href="${h(unitLink(u))}#send">Abrir envio de teste ↗</a>`:''}
   </section>
   <section class="card stack"><h2>Conexão AVEC</h2><form id="avec-form" class="stack">
    ${input('Token AVEC','avec_token','password','','autocomplete="new-password" '+(!info.avec?'required':''))}
    <p class="hint">Cole somente o valor do token, sem o prefixo Bearer. A consulta usa o relatório de clientes 0004.</p>
    ${info.avec?'<p class="hint">Token cadastrado. Preencha para substituir.</p>':''}
    <div class="actions"><button class="btn primary" type="submit">Salvar e consultar clientes</button>
     <a class="btn" href="${h(unitLink(u))}#settings">Configurar sincronização completa ↗</a></div>
   </form>
   ${columns.length?`<details><summary>Escolher os campos para importar clientes</summary><form id="mapping-form" class="stack">
     <p class="hint">Clientes com telefone válido ficam disponíveis. Bloqueios manuais são preservados.</p>
     ${['name','phone','email','birthday'].map((key,i)=>select(['Nome do cliente','Telefone','E-mail (opcional)','Nascimento (opcional)'][i],
       'map-'+key,[['','Selecione'],...columns.map(k=>[k,k])],u.avec_mapping?.[key],i<2?'required':'')).join('')}
     <button class="btn primary" type="submit">Importar com estes campos</button></form></details>`:''}
   </section>
  </div><aside class="stack"><div id="integration-status">${integrationStatus()}</div><section class="card stack"><h2>Modelos importados</h2>
   <p class="metric-number">${info.templates.filter(t=>t.active&&t.supported).length}</p><p class="hint">Modelos textuais aprovados disponíveis para a equipe.</p>
   <p class="hint">Modelos com mídia e campos adicionais aparecem no catálogo com a indicação de formato pendente.</p></section></aside></div>
   <section class="card stack diagnostics"><div class="actions between"><h2>Diagnóstico das integrações</h2>
    <div class="actions">${button('Atualizar logs','refresh-diagnostics','','small')}${button('Copiar diagnóstico','copy-diagnostics','','small')}</div></div>
    <p class="hint" id="diagnostic-help">Atualiza a cada 5 segundos. Mostra as últimas 100 etapas dos últimos 7 dias. Tokens, senhas e dados dos clientes ficam ocultos.</p>
    <label for="integration-log">Log de consultas</label>
    <textarea id="integration-log" class="diagnostic-log" readonly spellcheck="false" aria-describedby="diagnostic-help">${h(diagnosticText(info))}</textarea>
   </section>`;
}
function dashboard(){
  const d=state.data;
  return `${head('Visão geral','Acompanhe as conexões e os resultados da unidade.',canSend()?button('Fazer um envio','go-send','','primary'):'')}
   <div class="metrics">${metric('Canais prontos',readyChannels().length)}${metric('Rotinas ativas',d.rules.filter(r=>r.enabled).length)}
   ${metric('Na fila',d.jobs.filter(j=>j.status==='queued').length)}${metric('Falhas recentes',d.jobs.filter(j=>j.status==='failed').length)}</div>
   ${!readyChannels().length?'<p class="alert">A unidade ainda precisa de um canal conectado e liberado pelo administrador.</p>':''}
   <div class="grid2"><section class="card stack"><h2>Mensagens recentes</h2>${jobTable(d.jobs.slice(0,8))}</section>
    <section class="card stack"><h2>Atividade das integrações</h2>${eventsList()}</section></div>
   <p class="hint">Indicadores de mensagens consideram os 100 registros mais recentes.</p>`;
}
function eventsList(){
  return state.data.events.length?`<div class="event-list">${state.data.events.slice(0,8).map(e=>
   `<div class="event-row"><div class="actions between"><strong>${e.event==='catalog'?'Clickmassa':'AVEC'}</strong><small>${h(fmt(e.created_at))}</small></div><p class="hint">${h(e.detail)}</p></div>`).join('')}</div>`:empty('Nenhuma atividade registrada','As conexões aparecem aqui após a primeira consulta.');
}
function catalogPage(){
  const d=state.data;
  return `${head('Canais e modelos',d.unit.synced_at?'Catálogo atualizado em '+fmt(d.unit.synced_at):'Aguardando sincronização.',button('Atualizar','refresh','','small'))}
   <div class="stack"><section class="card stack"><h2>Canais</h2>${d.channels.length?table(['Canal','Tipo','Estado'],d.channels.map(c=>[
    h(c.name),h(c.type==='waba'?'WhatsApp Oficial':'WhatsApp QR Code'),badge(!c.active?'Desconectado':c.enabled&&c.configured?'Pronto para enviar':'Credencial pendente',c.active&&c.enabled&&c.configured?'ok':'warn'),
   ])):empty('Nenhum canal importado','Solicite ao administrador a conexão com o Clickmassa.')}</section>
   <section class="card stack"><h2>Modelos de mensagem</h2>${select('Filtrar pelo canal','catalog-channel',[['','Todos os canais'],...d.channels.filter(c=>c.type==='waba').map(c=>[c.id,c.name])])}
   <div id="model-table">${modelTable()}</div></section></div>`;
}
function modelTable(channel=''){
  const rows=state.data.templates.filter(t=>!channel||t.channel_id===channel);
  return rows.length?table(['Modelo','Canal','Estado','Campos'],rows.map(t=>[h(t.name),h(state.data.channels.find(c=>c.id===t.channel_id)?.name),
    badge(!t.active?'Indisponível':t.supported?'Aprovado':'Formato pendente',t.active&&t.supported?'ok':'warn'),h(t.variables.length)])):empty('Nenhum modelo neste filtro','Confira o canal e a sincronização.');
}
function sendPage(){
  if(!canSend()) return head('Envios','Seu perfil permite consultar os resultados.')+jobTable(state.data.jobs);
  if(!readyChannels().length)return head('Envios','Prepare um canal para começar.')+empty('Nenhum canal pronto','O administrador pode configurar as credenciais na integração da unidade.');
  const test=state.sendMode==='test';
  return `${head('Nova mensagem','Escolha o canal, revise o conteúdo e confirme o destinatário.')}
   <div class="tabs" role="group" aria-label="Tipo de envio">${[['test','Envio de teste'],['manual','Enviar para clientes']].map(([id,label])=>
    `<button data-mode="${id}" class="${state.sendMode===id?'active':''}" aria-pressed="${state.sendMode===id}">${label}</button>`).join('')}</div>
   <form id="send-form" class="stack"><div class="grid2">
    <section class="card stack"><h2>Mensagem</h2>
     ${select('Canal de envio','send-channel',[['','Selecione um canal'],...readyChannels().map(c=>[c.id,c.name+' · '+(c.type==='waba'?'Oficial':'QR Code')])],'','required')}
     <div id="send-content" class="stack"><p class="hint">Selecione o canal para preencher a mensagem.</p></div>
    </section><section class="card stack"><h2>${test?'Contato da equipe':'Destinatários'}</h2>
     ${test?`${input('Telefone com DDI','send-phone','tel','','required placeholder="+55 11 99999-0000" autocomplete="off"')}
      <p class="hint">Use um telefone que autorizou o recebimento deste teste.</p>`:
      `${input('Buscar nome ou telefone','send-search','search','','placeholder="Pesquisar clientes"')}
       <p class="hint" id="selection-count">0 de 100 selecionados</p><div id="send-contacts"></div>`}
    </section></div>
    <section class="card stack"><label class="check"><input type="checkbox" name="confirm" required>Confirmo que o destinatário autorizou o recebimento desta mensagem.</label>
     <div class="actions"><button class="btn primary" type="submit">${test?'Enviar teste':'Adicionar à fila'}</button><p class="hint">Você acompanha o protocolo e o resultado em Relatórios.</p></div>
    </section></form>`;
}
function sendContent(){
  const channel=state.data.channels.find(c=>c.id===state.channel);
  if(!channel)return '<p class="hint">Selecione o canal.</p>';
  if(channel.type==='whatsapp')return textarea('Mensagem','send-body','','required maxlength="4096"')+
    textarea('Nota interna (opcional)','send-note','','maxlength="1000"')+'<p class="hint">A nota fica visível para a equipe de atendimento.</p>';
  return select('Modelo aprovado','send-template',[['','Selecione um modelo'],...readyModels(channel.id).map(t=>[t.id,t.name])],'','required')+
    '<div class="stack" id="template-fields"></div>';
}
function modelFields(template,mode,mapping={}){
  if(!template)return '';
  const allowed=Object.entries(fieldChoices).filter(([key])=>mode==='rule'||(!key.startsWith('appointment.')&&key!=='service.name'&&key!=='feedback.url'));
  return `<div class="preview" id="message-preview">${h(template.body)}</div>`+template.variables.map((key,index)=>
    mode==='test'?input('Valor do campo '+key,'param-'+index,'text','','required maxlength="1024" data-param'):
    select('Informação do campo '+key,'variable-'+index,[['','Selecione a informação'],...allowed],mapping[key]||'','required data-variable="'+h(key)+'"')).join('');
}
function jobTable(jobs){
  return jobs.length?table(['Data','Origem','Destino','Estado','Protocolo'],jobs.map(j=>[
    h(fmt(j.created_at)),h({test:'Teste',manual:'Manual',automatic:'Rotina'}[j.kind]),h(j.phone),
    badge(j.status,['failed','skipped'].includes(j.status)?'error':j.status==='processing'?'warn':'ok')+(j.error?`<p class="hint">${h(j.error)}</p>`:''),
    `<code>${h(j.external_id||j.id)}</code>`,
  ])):empty('Nenhuma mensagem registrada','Comece com um envio de teste para a equipe.');
}
function reportsPage(){
  return `${head('Relatórios de envios','O estado Aceita indica que o Clickmassa recebeu a mensagem. A entrega é confirmada no atendimento.',button('Atualizar','refresh','','small'))}
   <div class="stack"><section class="card stack"><div id="report-jobs">${jobTable(state.data.jobs)}</div><p class="hint">Até 100 mensagens recentes. O relatório atualiza automaticamente.</p></section>
   ${canManage()?reportExplorer():''}</div>`;
}
function contactsPage(){
  return `${head('Clientes','Gerencie os dados e a autorização de contato.',canSend()?button('＋ Novo cliente','new-contact','','primary'):'')}
   <section class="card stack">${input('Buscar por nome ou telefone','contact-search','search',state.contactSearch,'placeholder="Pesquisar clientes"')}
   <div id="contact-table"></div></section>`;
}
function contactTable(){
  const rows=state.contacts.slice(0,25);
  return `${rows.length?table(['Cliente','Telefone','Autorização','Ação'],rows.map(c=>[
    h(c.name),h(c.phone||'Telefone não informado'),badge(c.send_blocked?'Bloqueado':c.consent?'Disponível':'Sem telefone válido',c.send_blocked?'error':c.consent?'ok':'warn'),
    `<div class="actions">${button('Histórico','contact-history','data-id="'+c.id+'"','small')}${canSend()?button('Editar','edit-contact','data-id="'+c.id+'"','small'):''}</div>`,
  ])):empty('Nenhum cliente encontrado','Cadastre um cliente ou peça ao administrador a importação AVEC.')}
   <div class="pager">${button('Anterior','contacts-prev',state.contactPage?'':'disabled','small')}<small>Página ${state.contactPage+1}</small>${button('Próxima','contacts-next',state.contacts.length>25?'':'disabled','small')}</div>`;
}
function servicesPage(){
  const d=state.data;
  return `${head('Serviços e agenda','Serviços e agendamentos AVEC alimentam as regras de relacionamento.',canManage()?button('Sincronizar AVEC','avec-sync','','primary'):'')}
   ${avecSummary()}
   <div class="stack"><section class="card stack"><div class="actions between"><h2>Serviços</h2>${canManage()?button('＋ Serviço','new-service','','small'):''}</div>
    ${d.services.length?table(['Serviço','Origem','Prazo de retorno','Ação'],d.services.map(s=>[h(s.name),badge(s.external_id?'AVEC':'Manual'),s.return_days?h(s.return_days)+' dias':'Não definido',canManage()?button('Definir retorno','service-return','data-id="'+s.id+'"','small'):'—'])):empty('Aguardando serviços','Ative a sincronização AVEC nas configurações para importar o catálogo.')}</section>
    <section class="card stack"><div class="actions between"><h2>Atendimentos</h2>${canSend()?button('＋ Atendimento','new-appointment','','small'):''}</div>
     ${d.appointments.length?table(['Data','Cliente','Serviço / profissional','Estado','Origem'],d.appointments.map(a=>[h(fmt(a.scheduled_at)),
      h(a.contact_name||d.contacts.find(c=>c.id===a.contact_id)?.name||'Cliente'),h(d.services.find(s=>s.id===a.service_id)?.name)+`<p class="hint">${h(a.professional_name||'')}</p>`,
      appointmentState(a),badge(a.external_id||a.source==='avec'?'AVEC':'Manual')])):empty('Nenhum atendimento sincronizado','Sincronize a AVEC e confira o período de histórico nas configurações.')}</section></div>`;
}
function appointmentState(a){return badge(a.canceled?'Cancelado':a.completed_at?'Concluído':a.arrived_at?'Cliente chegou':'Agendado',a.canceled?'warn':a.completed_at?'ok':'')}
function avecSummary(){
  const u=state.data.unit,summary=u.avec_summary||{};
  return `<section class="card sync-summary"><div class="actions between"><div><strong>Integração AVEC</strong>
   <p class="hint">${h(u.avec_error||(u.avec_checked_at?'Última consulta: '+fmt(u.avec_checked_at):'Configure a sincronização para trazer os dados da unidade.'))}</p></div>${badge(u.avec_state||'unconfigured',u.avec_state==='ready'?'ok':u.avec_state==='error'?'error':'warn')}</div>
   ${summary.warning?`<p class="hint">${h(summary.warning)}</p>`:''}
   ${canManage()?button('Ajustar sincronização','go-settings','','small'):''}</section>`;
}
function feedbackPage(){
  const feedback=state.data.feedback||{},responses=feedback.responses||[];
  return `${head('Satisfação dos clientes','Acompanhe as avaliações recebidas nas pesquisas enviadas após o atendimento.',canManage()?button('Configurar pesquisa CSAT','new-csat','','primary'):button('Atualizar','refresh','','small'))}
   <section class="card stack csat-guide"><div class="actions between"><h2>Sua pesquisa no dia seguinte</h2>${badge(feedback.configured?'Link disponível':'Endereço pendente',feedback.configured?'ok':'warn')}</div>
    <p>O cliente recebe um link individual, escolhe uma nota de 1 a 5 e pode deixar um comentário. A resposta aparece aqui e no histórico do cliente.</p>
    <div class="rating-demo" aria-label="Pesquisa com notas de 1 a 5"><span>1</span><span>2</span><span>3</span><span>4</span><span>5 <small>Excelente</small></span></div>
    <p class="hint">${feedback.configured?'Escolha um modelo aprovado com um campo para o link da pesquisa. Na rotina, selecione o link individual e o intervalo de 1 dia.':'Solicite ao administrador o endereço público da pesquisa para habilitar os links de avaliação.'}</p>
    <p class="hint">${state.data.rules.filter(r=>r.type==='csat'&&r.enabled).length} rotina(s) de satisfação ativa(s). As respostas são únicas e o link vale por 30 dias.</p></section>
   <div class="metrics">${metric('Pesquisas geradas',feedback.invited??0)}${metric('Respostas',feedback.total??responses.length)}
    ${metric('Nota média',feedback.average===null||feedback.average===undefined?'—':Number(feedback.average).toFixed(1)+' / 5')}${metric('Satisfeitos',feedback.satisfied===null||feedback.satisfied===undefined?'—':feedback.satisfied+'%')}</div>
   <section class="card stack"><h2>Avaliações recebidas</h2>${responses.length?table(['Recebida em','Cliente','Nota','Comentário'],responses.map(r=>[
    h(fmt(r.answered_at||r.created_at)),h(r.contact_name||state.data.contacts.find(c=>c.id===r.contact_id)?.name||'Cliente'),badge(r.score+' / 5',r.score>=4?'ok':r.score<=2?'error':'warn'),h(r.comment||'—'),
   ])):empty('Aguardando avaliações','Crie uma rotina de satisfação para o dia seguinte e inclua o link individual da pesquisa em um campo do modelo.')}
   <p class="hint">Cada atendimento recebe seu próprio link. Notas 4 e 5 são consideradas satisfeitas.</p></section>`;
}
function inventoryPage(){
  const products=state.data.products||[];
  return `${head('Estoque AVEC','Acompanhe os produtos e os itens abaixo do mínimo definido no AVEC.',canManage()?button('Sincronizar AVEC','avec-sync','','primary'):'')}
   ${avecSummary()}<section class="card stack"><div class="actions between"><h2>Produtos</h2><span class="badge warn">${products.filter(p=>p.low_stock).length} abaixo do mínimo</span></div>
    ${products.length?table(['Produto','Quantidade','Mínimo','Estado'],products.map(p=>[h(p.name),h(p.quantity??'—'),h(p.minimum??'—'),badge(p.low_stock?'Estoque baixo':'Dentro do mínimo',p.low_stock?'warn':'ok')])):empty('Nenhum produto sincronizado','Os relatórios de estoque disponíveis para a unidade aparecerão após a sincronização.')}
    ${canManage()?button('Configurar avisos de estoque','go-settings','','small'):''}</section>`;
}
function alertFields(kind,templateId,mapping={}){
  const template=state.data.templates.find(t=>t.id===templateId);
  if(!template)return '<p class="hint">Selecione um modelo aprovado para definir o conteúdo do aviso.</p>';
  const fields=kind==='arrival'?[['professional.name','Nome do profissional'],['customer.name','Nome do cliente'],['service.name','Serviço'],['appointment.scheduled_at','Horário do agendamento'],['establishment.name','Nome da unidade']]:
    [['professional.name','Nome do profissional'],['product.name','Nome do produto'],['product.quantity','Quantidade atual'],['product.minimum','Estoque mínimo'],['establishment.name','Nome da unidade']];
  return `<div class="preview">${h(template.body)}</div>`+template.variables.map((key,index)=>select('Informação do campo '+key,kind+'-field-'+index,[['','Selecione'],...fields],mapping[key]||'','data-alert-variable="'+h(key)+'" data-kind="'+kind+'"')).join('');
}
function settingsPage(){
  if(!canManage())return empty('Acesso restrito','As configurações são administradas pelo gestor da unidade.');
  const settings=state.settings;
  if(!settings)return head('Configurações','Carregando configurações da unidade…');
  const u=settings.unit||state.data.unit,c=u.avec_config||{},alerts=settings.alerts||{},professionals=settings.professionals||[];
  const channels=readyChannels().filter(ch=>ch.type==='waba'),models=readyModels(alerts.channel_id),caps=u.avec_summary?.capabilities||{};
  return `${head('Configurações da unidade','Defina a sincronização, os retornos e os avisos da operação.',button('Sincronizar AVEC agora','avec-sync','','primary'))}
   <div class="stack"><form id="avec-settings-form" class="card stack"><h2>Sincronização AVEC</h2>
    <p class="hint">O token é cadastrado pelo administrador master. Os dados são consultados diretamente na AVEC e usados nas rotinas desta unidade.</p>
    <label class="check"><input type="checkbox" name="enabled" ${c.enabled?'checked':''}>Atualizar os dados AVEC automaticamente</label>
    <div class="form-grid">${select('Frequência de atualização','interval_minutes',[[5,'A cada 5 minutos'],[15,'A cada 15 minutos'],[30,'A cada 30 minutos'],[60,'A cada hora']],c.interval_minutes||15)}
     ${input('Dias de histórico para sincronizar','history_days','number',c.history_days??90,'required min="1" max="730"')}
     ${input('Dias futuros da agenda','future_days','number',c.future_days??30,'required min="1" max="180"')}
     ${input('ID da unidade AVEC (token de franquia)','salon_id','text',c.salon_id||'','maxlength="40" placeholder="Opcional para token de unidade"')}</div>
    <label class="check"><input type="checkbox" name="auto_import" ${c.auto_import!==false?'checked':''}>Importar clientes, serviços e agendamentos para as rotinas</label>
    <p class="hint">Clientes com telefone válido ficam disponíveis por padrão. Bloqueios manuais são preservados. A integração respeita o período escolhido.</p>
    <button class="btn primary" type="submit">Salvar sincronização</button></form>
   <section class="card stack"><h2>Avisos aos profissionais</h2>
    <p class="hint">Cadastre o WhatsApp de cada profissional abaixo. Os avisos usam o canal e os modelos aprovados selecionados aqui.</p>
    <p class="alert">A chegada depende de o AVEC informar explicitamente que o cliente chegou. Um horário agendado não gera aviso de chegada.${caps.arrival===false?' O relatório atual ainda não disponibilizou esse evento.':''}</p>
    <form id="alerts-settings-form" class="stack">
     ${select('Canal dos avisos','alert-channel',[['','Selecione o canal'],...channels.map(ch=>[ch.id,ch.name])],alerts.channel_id)}
     <div class="grid2"><div class="stack"><label class="check"><input type="checkbox" name="arrival_enabled" ${alerts.arrival_enabled?'checked':''}>Avisar quando o cliente chegar</label>
      ${select('Modelo de chegada','arrival-template',[['','Selecione'],...models.map(t=>[t.id,t.name])],alerts.arrival_template_id)}
      <div id="arrival-fields" class="stack">${alertFields('arrival',alerts.arrival_template_id,alerts.arrival_mapping)}</div></div>
      <div class="stack"><label class="check"><input type="checkbox" name="stock_enabled" ${alerts.stock_enabled?'checked':''}>Avisar sobre estoque baixo</label>
      ${select('Modelo de estoque baixo','stock-template',[['','Selecione'],...models.map(t=>[t.id,t.name])],alerts.stock_template_id)}
      <div id="stock-fields" class="stack">${alertFields('stock',alerts.stock_template_id,alerts.stock_mapping)}</div>
      ${input('Intervalo entre avisos do mesmo produto (dias)','stock_cooldown_days','number',alerts.stock_cooldown_days??1,'required min="1" max="365"')}</div></div>
     <button class="btn primary" type="submit">Salvar avisos</button></form>
    <h3>Profissionais sincronizados</h3>${professionals.length?table(['Profissional','WhatsApp','Avisos','Ação'],professionals.map(p=>[h(p.name),h(p.phone||'Não cadastrado'),badge(p.enabled?'Habilitados':'Desativados',p.enabled?'ok':''),button('Configurar','professional','data-id="'+p.id+'"','small')])):empty('Aguardando profissionais','Sincronize os dados AVEC. Depois, informe o telefone dos profissionais que receberão os avisos.')}
   </section>
   <section class="card stack"><h2>Prazos de retorno por serviço</h2><p class="hint">Informe o intervalo médio de cada serviço. A rotina de sugestão de retorno usa esse prazo; quando disponível, o prazo retornado pela AVEC é importado.</p>
    ${(settings.services||state.data.services).length?table(['Serviço','Retorno médio','Ação'],(settings.services||state.data.services).map(s=>[h(s.name),s.return_days?h(s.return_days)+' dias':'Não definido',button('Definir retorno','service-return','data-id="'+s.id+'"','small')])):empty('Nenhum serviço importado','Sincronize o catálogo AVEC para configurar os retornos.')}
   </section></div>`;
}
function reportExplorer(){
  const catalog=state.settings?.report_catalog||[];
  return `<section class="card stack"><h2>Consultar relatórios AVEC</h2><p class="hint">Escolha um relatório e preencha os filtros. A consulta é somente leitura e exibe até 250 linhas por página.</p>
   ${!state.settings?button('Carregar relatórios disponíveis','load-reports','','small'):`<form id="avec-report-form" class="stack">
    ${select('Relatório AVEC','report-code',[['','Selecione o relatório'],...catalog.map(r=>[r.code,r.name])],state.reportCode,'required')}
    <div id="report-parameters" class="form-grid">${reportParameters()}</div><button class="btn primary" type="submit">Consultar relatório</button></form>`}
   <div id="avec-report-result">${reportResult()}</div></section>`;
}
function reportParameters(){
  const report=state.settings?.report_catalog?.find(r=>r.code===state.reportCode);
  return (report?.params||report?.query||[]).filter(p=>!['page','limit'].includes(p.key)).map(p=>{
    const name='report-param-'+p.key,label=p.label||p.key;
    if(p.key==='servico_id')return select(label,name,[['','Todos os serviços'],...state.data.services.filter(s=>s.external_id).map(s=>[s.external_id,s.name])]);
    if(p.key==='profissional_id')return select(label,name,[['','Todos os profissionais'],...(state.settings?.professionals||[]).map(s=>[s.external_id,s.name])]);
    if(p.options?.length)return select(label,name,[['','Todos'],...p.options.map(o=>Array.isArray(o)?o:[o.value??o.id,o.label??o.name])]);
    return input(label,name,p.type==='date'?'date':p.type==='number'?'number':'text','','data-report-key="'+h(p.key)+'" placeholder="'+h(p.type==='select'?'ID opcional':p.type==='date'?'':'Opcional')+'"');
  }).join('')||'<p class="hint">Este relatório não exige filtros adicionais.</p>';
}
function reportResult(){
  const report=state.avecReport;
  if(!report)return '';
  const columns=report.columns||Object.keys(report.rows?.[0]||{}),rows=report.rows||[];
  return `<div class="stack"><p class="hint">Página ${state.reportPage} · ${rows.length} linha(s) nesta página.</p>
    ${rows.length?composer.renderRows({...report,code:state.reportCode}):empty('Nenhum resultado neste filtro','Confira o período e os filtros informados.')}
   <div class="pager">${button('Página anterior','report-prev',state.reportPage>1?'':'disabled','small')}${button('Próxima página','report-next',report.has_more?'':'disabled','small')}</div></div>`;
}
async function queryReport(form,page=1){
  const values=new FormData(form),params={page,limit:250};
  for(const [key,value]of values){
    if(!key.startsWith('report-param-')||!value)continue;
    const input=form.elements.namedItem(key);
    params[key.slice(13)]=input.type==='date'?value.split('-').reverse().join('/'):value;
  }
  state.avecReport=await api(unitPath('avec-report'),'POST',{code:values.get('report-code'),params});
  state.reportPage=page;
  document.getElementById('avec-report-result').innerHTML=reportResult();
}
function rulesPage(){
  return `${head('Automações','Regras avaliadas a cada minuto, com horário e consentimento da unidade.',canManage()?button('＋ Nova rotina','new-rule','','primary'):'')}
   <section class="card stack">${state.data.rules.length?table(['Regra','Gatilho','Horário','Estado','Ações'],state.data.rules.map(r=>[
    h(r.name),h(types[r.type]),h(r.send_time.slice(0,5)),badge(r.enabled?'Ativa':'Pausada',r.enabled?'ok':''),
    canManage()?`<div class="actions">${button('Editar','edit-rule','data-id="'+r.id+'"','small')}${button('Simular','simulate','data-id="'+r.id+'"','small')}${r.enabled?button('Pausar','pause-rule','data-id="'+r.id+'"','small'):''}</div>`:'—',
   ])):empty('Nenhuma rotina criada','Comece com uma regra de pós-atendimento e teste sua elegibilidade.')}</section>`;
}
function openDialog(title,body){
  document.getElementById('dialog-content').innerHTML=`<div class="dialog-head"><h2>${h(title)}</h2>${button('✕','close-dialog','aria-label="Fechar"','small ghost')}</div>${body}`;
  dialog.showModal();
}
function footer(label='Salvar'){return `<div class="actions dialog-footer">${button('Cancelar','close-dialog','','ghost')}<button class="btn primary" type="submit">${label}</button></div>`}
async function hydrate(){
  if(state.page==='send'&&state.unit){
    state.channel='';state.template='';state.selected.clear();
    if(state.sendMode==='manual')await loadContacts(true);
  }
  if(state.page==='contacts'&&state.unit)await loadContacts();
}
async function loadContacts(forSend=false){
  const page=forSend?0:state.contactPage;
  const search=document.getElementById(forSend?'send-search':'contact-search')?.value||'';
  const target=document.getElementById(forSend?'send-contacts':'contact-table');
  if(!target)return;
  const request=Symbol();target.request=request;
  try{
    const contacts=await api(unitPath('contacts')+'?'+new URLSearchParams({page,search,eligible:forSend?'true':'false'}));
    if(!target.isConnected||target.request!==request)return;
    if(forSend){
      target.innerHTML=contacts.filter(c=>c.consent).slice(0,25).map(c=>`<label class="contact-choice"><input type="checkbox" data-contact="${c.id}" ${state.selected.has(c.id)?'checked':''}><span>${h(c.name)}<small>${h(c.phone)}</small></span></label>`).join('')||empty('Nenhum cliente autorizado neste filtro','Pesquise outro nome ou confira a autorização no cadastro.');
      target.className='contact-choices';
    }else{
      state.contacts=contacts;target.innerHTML=contactTable();
    }
  }catch(error){toast(error.message,true)}
}

async function refreshData(){
  if(!state.unit)return;
  state.data=await api(unitPath('data'));
}
function renderMain(){
  const main=document.getElementById('main');
  if(main)main.innerHTML=content();
}
function contactDialog(contact={}){
  openDialog(contact.id?'Editar cliente':'Novo cliente',`<form id="contact-form" class="stack" data-id="${h(contact.id||'')}">
   ${input('Nome','name','text',contact.name,'required maxlength="120"')}
   ${input('Telefone com DDI','phone','tel',contact.phone,'placeholder="+55 11 99999-0000" maxlength="30"')}
   <div class="form-grid">${input('E-mail (opcional)','email','email',contact.email,'maxlength="160"')}${input('Nascimento (opcional)','birthday','date',contact.birthday)}</div>
   <label class="check"><input type="checkbox" name="blocked" ${contact.send_blocked?'checked':''}>Bloquear envios para este cliente.</label>
   <p class="hint">Sem bloqueio, um telefone válido deixa o cliente disponível. O bloqueio é mantido nas sincronizações AVEC.</p>
   ${footer()}</form>`);
}
async function membersDialog(){
  const id=state.adminUnit.id;
  state.members=await api('/units/'+id+'/members');
  const rows=state.members.map(m=>[h(m.fs_users.name),h(m.fs_users.email),h({manager:'Gestor',operator:'Operador',viewer:'Consulta'}[m.role]),
    `<div class="actions">${button('Nova senha','reset-member','data-id="'+m.id+'"','small')}${button('Remover acesso','remove-member','data-id="'+m.id+'"','small danger')}</div>`]);
  openDialog('Acessos · '+state.adminUnit.name,`<div class="stack">${rows.length?table(['Pessoa','E-mail','Perfil','Ação'],rows):'<p class="hint">Nenhuma pessoa vinculada.</p>'}
   <form id="member-form" class="stack">
    ${input('Nome','name','text','','required minlength="2" maxlength="120"')}
    ${input('E-mail','email','email','','required maxlength="160"')}
    ${input('Senha temporária (contas novas)','password','password','','minlength="10" maxlength="200" autocomplete="new-password"')}
    <p class="hint">No primeiro acesso a pessoa define a própria senha. Contas existentes recebem acesso com a senha que já usam.</p>
    ${select('Permissão','role',[['manager','Gestor · gerencia rotinas e operação'],['operator','Operador · gerencia clientes e envios'],['viewer','Consulta · visualiza informações']])}
    ${footer('Conceder acesso')}</form></div>`);
}
function ruleDialog(rule={}){
  const channels=readyChannels().filter(c=>c.type==='waba');
  const selectedStatuses=Array.isArray(rule.appointment_statuses)?rule.appointment_statuses:['finalized','paid'];
  openDialog(rule.id?'Editar rotina':'Nova rotina',`<form id="rule-form" class="stack" data-id="${h(rule.id||'')}">
   ${input('Nome da rotina','name','text',rule.name,'required maxlength="120"')}
   ${select('Quando executar','type',Object.entries(types),rule.type||'post_service','required')}
   <p class="hint" id="rule-help"></p>
   <div class="form-grid">${input('Intervalo em dias','delay_days','number',rule.delay_days??(rule.type==='csat'?1:0),'required min="0" max="3650"')}
    ${input('Horário da unidade','send_time','time',(rule.send_time||'09:00').slice(0,5),'required')}</div>
   ${input('Intervalo mínimo entre mensagens ao cliente (dias)','cooldown_days','number',rule.cooldown_days??7,'required min="0" max="3650"')}
   <fieldset id="rule-statuses" class="status-selector"><legend>Estados do atendimento considerados</legend>
    <p class="hint">O horário do agendamento precisa ter passado. Quando a AVEC informar a conclusão, o sistema usa essa data mais precisa.</p>
    <div class="status-options">${appointmentStatusChoices.map(([value,label])=>`<label class="check"><input type="checkbox" data-rule-status value="${value}" ${selectedStatuses.includes(value)?'checked':''}>${label}</label>`).join('')}</div>
   </fieldset>
   ${select('Serviço realizado','service_id',[['','Todos os serviços'],...state.data.services.map(s=>[s.id,s.name])],rule.service_id)}
   <div id="target-service">${select('Serviço recomendado','target_service_id',[['','Selecione'],...state.data.services.map(s=>[s.id,s.name])],rule.target_service_id)}</div>
   ${select('Canal Oficial','rule-channel',[['','Selecione o canal'],...channels.map(c=>[c.id,c.name])],rule.channel_id,'required')}
   ${select('Modelo aprovado','rule-template',[['','Selecione o modelo'],...readyModels(rule.channel_id).map(t=>[t.id,t.name])],rule.template_id,'required')}
   <div id="rule-fields" class="stack">${modelFields(state.data.templates.find(t=>t.id===rule.template_id),'rule',rule.mapping)}</div>
   <label class="check"><input type="checkbox" name="enabled" ${rule.enabled?'checked':''}>Ativar esta rotina</label>
   <p class="hint">A ativação considera os horários de envio a partir de agora. Simule os dados disponíveis após salvar.</p>
   ${footer('Salvar rotina')}</form>`);
  updateRuleType();
}
function updateRuleType(){
  const form=document.getElementById('rule-form');
  if(!form)return;
  const type=form.elements.type.value;
  const help={post_service:'Mensagem após a conclusão confirmada do atendimento no AVEC.',csat:'Use 1 dia para enviar no dia seguinte. Inclua o Link individual da pesquisa de satisfação em um campo do modelo para receber as avaliações no painel.',
    return:'Usa o prazo de retorno do serviço. O intervalo desta regra serve como alternativa.',
    birthday:'Zero dias envia na data de aniversário. Nascidos em 29/02 recebem no próprio dia em anos bissextos.',
    inactive:'Conta os dias desde o último serviço concluído e verifica se há agendamento futuro.',
    cross_sell:'Oferece um serviço complementar após o atendimento concluído.'};
  form.querySelector('#rule-help').textContent=help[type];
  const target=form.querySelector('#target-service');
  target.hidden=type!=='cross_sell';
  target.querySelector('select').required=type==='cross_sell';
  target.querySelector('select').disabled=type!=='cross_sell';
  form.elements.service_id.disabled=type==='birthday';
  const statuses=form.querySelector('#rule-statuses');
  statuses.hidden=type==='birthday';
  statuses.querySelectorAll('input').forEach(input=>input.disabled=type==='birthday');
}
function updatePreview(form){
  const template=state.data.templates.find(t=>t.id===(form.id==='rule-form'?form.elements['rule-template'].value:state.template));
  const preview=form.querySelector('#message-preview');
  if(!preview||!template)return;
  const samples={'customer.name':'Mariana','customer.phone':'+55 11 99999-0000','customer.email':'mariana@exemplo.com',
    'customer.birthday':'18/11','service.name':'Corte','establishment.name':state.unit.name,
    'appointment.scheduled_at':'18/11 às 14:00','appointment.completed_at':'18/11 às 15:00','feedback.url':location.origin+'/avaliar/link-individual'};
  const test=form.id==='send-form'&&state.sendMode==='test';
  preview.textContent=template.body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_,key)=>{
    const index=template.variables.indexOf(key);
    if(test)return form.elements['param-'+index]?.value||'['+key+']';
    return samples[form.elements['variable-'+index]?.value]||'['+key+']';
  });
}
function readMapping(form){
  return Object.fromEntries([...form.querySelectorAll('[data-variable]')].map(select=>[select.dataset.variable,select.value]));
}

async function action(name,btn){
  if(await composer.action(name,btn))return;
  const id=btn.dataset.id;
  switch(name){
    case 'menu':
      state.menu=!state.menu;
      document.querySelector('.sidebar').classList.toggle('open',state.menu);
      document.querySelector('.scrim').hidden=!state.menu;
      document.querySelector('.menu-toggle').setAttribute('aria-expanded',String(state.menu));
      return;
    case 'logout':
      await api('/logout','POST',{});location.href='/';return;
    case 'password':
      state.user.must_change_password=true;renderPassword();return;
    case 'close-dialog':
      dialog.close();return;
    case 'new-unit':
      openDialog('Nova unidade',`<form id="unit-form" class="stack">
       ${input('Nome da unidade','name','text','','required minlength="2" maxlength="120"')}
       ${input('Identificador do link','slug','text','','required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="100"')}
       ${select('Fuso horário','timezone',[['America/Sao_Paulo','Brasília / São Paulo'],['America/Fortaleza','Fortaleza'],
        ['America/Manaus','Manaus'],['America/Rio_Branco','Rio Branco']])}${footer('Criar unidade')}</form>`);return;
    case 'copy':
      await navigator.clipboard.writeText(unitLink(state.units.find(u=>u.id===id)));toast('Link copiado.');return;
    case 'unit-active': {
      const unit=state.units.find(u=>u.id===id);
      if(!confirm((unit.active?'Desativar ':'Ativar ')+unit.name+'?'))return;
      await api('/units/'+id+'/active','POST',{active:!unit.active});
      state.units=await api('/units');render();return;
    }
    case 'integrations':
      state.integration=await api('/units/'+id+'/integration');state.page='integration';render();return;
    case 'back-units':
      state.units=await api('/units');state.page='home';state.integration=null;render();return;
    case 'refresh-integration':
      state.integration=await api('/units/'+state.integration.unit.id+'/integration');
      state.integrationPendingRender=false;
      renderMain();
      toast('Estado atualizado.');return;
    case 'refresh-diagnostics':
      state.integration=await api('/units/'+state.integration.unit.id+'/integration');
      updateDiagnostics();
      document.getElementById('integration-status').innerHTML=integrationStatus();
      toast('Diagnóstico atualizado.');return;
    case 'copy-diagnostics':
      await navigator.clipboard.writeText(diagnosticText(state.integration));toast('Diagnóstico copiado.');return;
    case 'sync-now':
      await api('/units/'+state.integration.unit.id+'/catalog','POST',{});toast('Sincronização iniciada.');return;
    case 'sender': {
      const channel=state.integration.channels.find(c=>c.id===id);
      openDialog('Envio · '+channel.name,`<form id="sender-form" class="stack" data-channel="${channel.id}">
       <p class="hint">Cole a URL externa fornecida pelo Clickmassa. O token incluído na URL será extraído e guardado no servidor.</p>
       ${input('URL de envio','url','url','','autocomplete="off" '+(!channel.configured?'required':''))}
       ${input('Token de envio (quando separado da URL)','token','password','','autocomplete="new-password"')}
       ${channel.configured?'<p class="hint">Credencial cadastrada. Deixe os campos vazios para manter.</p>':''}
       <label class="check"><input type="checkbox" name="enabled" ${channel.enabled?'checked':''}>Liberar envios neste canal</label>
       ${footer('Salvar canal')}</form>`);return;
    }
    case 'members':
      state.adminUnit=state.units.find(u=>u.id===id);await membersDialog();return;
    case 'remove-member':
      if(!confirm('Remover o acesso desta pessoa à unidade?'))return;
      await api('/units/'+state.adminUnit.id+'/members/'+id,'DELETE',{});
      dialog.close();await membersDialog();return;
    case 'reset-member':
      dialog.close();
      openDialog('Definir senha temporária',`<form id="reset-member-form" class="stack" data-id="${id}">
       ${input('Senha temporária','password','password','','required minlength="10" maxlength="200" autocomplete="new-password"')}
       <p class="hint">As sessões anteriores serão encerradas. A pessoa define uma senha pessoal ao entrar novamente.</p>
       ${footer('Salvar senha temporária')}</form>`);
      return;
    case 'go-send':
      state.page='send';state.menu=false;render();return;
    case 'go-settings':
      state.settings=await api(unitPath('settings'));state.page='settings';state.menu=false;render();return;
    case 'avec-sync':
      await api(unitPath('avec-sync'),'POST',{});toast('Sincronização AVEC iniciada. Acompanhe o estado da conexão.');
      await refreshData();renderMain();return;
    case 'professional': {
      const professional=state.settings.professionals.find(p=>p.id===id);
      openDialog('Avisos · '+professional.name,`<form id="professional-form" class="stack" data-id="${h(id)}">
       ${input('WhatsApp do profissional com DDI','phone','tel',professional.phone||'','placeholder="+55 11 99999-0000" maxlength="30"')}
       <label class="check"><input type="checkbox" name="enabled" ${professional.enabled?'checked':''}>Habilitar avisos operacionais para este profissional</label>
       <p class="hint">Confirme o número com o profissional. Os avisos usam os modelos e o canal configurados nesta unidade.</p>${footer('Salvar profissional')}</form>`);return;
    }
    case 'service-return': {
      const service=state.data.services.find(s=>s.id===id);
      openDialog('Retorno · '+service.name,`<form id="service-return-form" class="stack" data-id="${h(id)}">
       ${input('Prazo médio de retorno (dias)','return_days','number',service.return_days||'','min="1" max="3650"')}
       <p class="hint">A rotina de sugestão de retorno considera a conclusão deste serviço e o prazo informado. Deixe vazio para usar o intervalo da rotina.</p>${footer('Salvar prazo')}</form>`);return;
    }
    case 'contact-history': {
      const history=await api(unitPath('contacts')+'/'+id+'/history');
      const appointments=history.appointments||[],feedback=Array.isArray(history.feedback)?history.feedback:history.feedback?.responses||[];
      openDialog('Histórico · '+history.contact.name,`<div class="stack"><p class="hint">${h(history.contact.phone)} · Histórico disponível no período sincronizado.</p>
       <h3>Serviços e agendamentos</h3>${appointments.length?table(['Data','Serviço','Estado'],appointments.map(a=>[h(fmt(a.scheduled_at)),h(a.service_name||state.data.services.find(s=>s.id===a.service_id)?.name||'Serviço'),appointmentState(a)])):empty('Nenhum atendimento neste período','Amplie o histórico nas configurações e sincronize novamente.')}
       <h3>Mensagens</h3>${jobTable(history.jobs||[])}<h3>Avaliações</h3>${feedback.length?table(['Data','Nota','Comentário'],feedback.map(r=>[h(fmt(r.answered_at)),h(r.score)+' / 5',h(r.comment||'—')])):'<p class="hint">Nenhuma avaliação recebida.</p>'}
       ${button('Fechar','close-dialog','','primary')}</div>`);return;
    }
    case 'load-reports':
      state.settings=await api(unitPath('settings'));renderMain();return;
    case 'report-prev':
      await queryReport(document.getElementById('avec-report-form'),Math.max(1,state.reportPage-1));return;
    case 'report-next':
      await queryReport(document.getElementById('avec-report-form'),state.reportPage+1);return;
    case 'refresh':
      await refreshData();render();toast('Dados atualizados.');return;
    case 'new-contact':
      contactDialog();return;
    case 'edit-contact':
      contactDialog(state.contacts.find(c=>c.id===id));return;
    case 'contacts-prev':
      state.contactPage=Math.max(0,state.contactPage-1);await loadContacts();return;
    case 'contacts-next':
      state.contactPage++;await loadContacts();return;
    case 'new-service':
      openDialog('Novo serviço',`<form id="service-form" class="stack">
       ${input('Nome do serviço','name','text','','required minlength="2" maxlength="120"')}
       ${input('Prazo de retorno em dias (opcional)','return_days','number','','min="1" max="3650"')}
       ${footer()}</form>`);return;
    case 'new-appointment':
      if(!state.data.contacts.length||!state.data.services.length){toast('Cadastre um cliente e um serviço primeiro.',true);return}
      openDialog('Registrar atendimento',`<form id="appointment-form" class="stack">
       ${input('Buscar cliente','appointment-search','search','','placeholder="Nome ou telefone"')}
       ${select('Cliente','contact_id',[['','Selecione'],...state.data.contacts.map(c=>[c.id,c.name])],'','required')}
       ${select('Serviço','service_id',[['','Selecione'],...state.data.services.map(s=>[s.id,s.name])],'','required')}
       ${input('Data e hora do agendamento','scheduled_at','datetime-local','','required')}
       ${input('Conclusão (preencha se já terminou)','completed_at','datetime-local')}
       <p class="hint">Informe as datas no fuso horário deste navegador. O painel exibe os horários no fuso da unidade.</p>${footer()}</form>`);return;
    case 'new-rule':
      if(!readyChannels().some(c=>c.type==='waba')){toast('Prepare um canal Oficial com um modelo aprovado.',true);return}
      ruleDialog();return;
    case 'new-csat':
      if(!state.data.feedback?.configured)throw Error('O administrador precisa configurar o endereço público da pesquisa (PUBLIC_ORIGIN).');
      if(!readyChannels().some(c=>c.type==='waba'))throw Error('Prepare um canal Oficial com um modelo aprovado para a pesquisa.');
      ruleDialog({name:'Satisfação no dia seguinte',type:'csat',delay_days:1,send_time:'09:00'});return;
    case 'edit-rule':
      ruleDialog(state.data.rules.find(r=>r.id===id));return;
    case 'pause-rule':
      await api(unitPath('rules')+'/'+id,'DELETE',{});await refreshData();render();return;
    case 'simulate': {
      const result=await api(unitPath('simulate'),'POST',{rule_id:id});
      openDialog('Simulação da rotina',`<div class="stack"><p class="alert"><strong>${result.count} cliente(s) elegíveis neste momento.</strong></p>
       <p class="hint">A elegibilidade usa os estados selecionados e a data do atendimento; quando disponível, usa a conclusão confirmada pela AVEC. Simular não envia nada; somente o botão de envio confirmado adiciona os selecionados à fila.</p>
       ${result.items.length?`<div class="simulation-list" role="group" aria-label="Clientes elegíveis">
        <label class="check simulation-all"><input type="checkbox" data-simulation-all checked> Selecionar todos os ${result.items.length} exibidos</label>
        ${result.items.map(item=>`<label class="check simulation-item"><input type="checkbox" data-simulation-contact value="${h(item.id)}" checked>
         <span><strong>${h(item.name)}</strong><small>${h(item.phone)}</small></span></label>`).join('')}</div>
        <p class="hint">${result.count>result.items.length?`São exibidos os primeiros ${result.items.length} de ${result.count}.`:'Todos os elegíveis estão exibidos.'} O envio feito aqui registra o evento e impede que a automação o repita.</p>
        <div class="actions dialog-footer">${button('Fechar','close-dialog','','ghost')}${button('Enviar selecionados','simulation-send',`data-id="${h(id)}"`,'primary')}</div>`:
        `${empty('Nenhum cliente elegível','Ajuste os dados, o horário ou o intervalo da rotina e simule novamente.')}${button('Fechar','close-dialog','','primary')}`}
       </div>`);return;
    }
    case 'simulation-send': {
      const contacts=[...dialog.querySelectorAll('[data-simulation-contact]:checked')].map(el=>el.value);
      if(!contacts.length)throw Error('Selecione pelo menos um cliente.');
      if(!confirm(`Enviar agora para ${contacts.length} cliente(s) selecionado(s)?`))return;
      const result=await api(unitPath('simulate-send'),'POST',{rule_id:id,contacts,confirm:true});
      dialog.close();
      toast(result.queued?`${result.queued} mensagem(ns) adicionada(s) à fila.`:'Estes eventos já estavam registrados.');
      state.page='reports';await refreshData();render();return;
    }
  }
}

async function submit(form){
  if(await composer.submit(form))return;
  const f=new FormData(form);
  const data=Object.fromEntries(f);
  switch(form.id){
    case 'login-form':
      await api('/login','POST',data);await boot();return;
    case 'password-form':
      if(data.password!==data.confirmation)throw Error('As senhas precisam ser iguais.');
      await api('/account/password','POST',{password:data.password});toast('Senha definida. Entre novamente.');state.user=null;renderLogin();return;
    case 'unit-form':
      await api('/units','POST',data);state.units=await api('/units');dialog.close();render();toast('Unidade criada.');return;
    case 'catalog-form':
      await api('/units/'+state.integration.unit.id+'/catalog','POST',{base_url:data.catalog_base_url,email:data.catalog_email,password:data.catalog_password});
      form.elements.catalog_password.value='';
      state.integration=await api('/units/'+state.integration.unit.id+'/integration');
      renderMain();toast('Catálogo solicitado. Acompanhe o estado da conexão.');return;
    case 'avec-form':
      await api('/units/'+state.integration.unit.id+'/avec','POST',{token:data.avec_token});
      form.elements.avec_token.value='';toast('Consulta AVEC iniciada.');return;
    case 'mapping-form': {
      const mapping=Object.fromEntries(['name','phone','email','birthday'].map(k=>[k,data['map-'+k]]));
      await api('/units/'+state.integration.unit.id+'/avec','POST',{mapping});
      toast('Consulta e importação iniciadas.');return;
    }
    case 'sender-form':
      await api('/units/'+state.integration.unit.id+'/sender','POST',{channel_id:form.dataset.channel,url:data.url,token:data.token,enabled:f.has('enabled')});
      state.integration=await api('/units/'+state.integration.unit.id+'/integration');dialog.close();renderMain();toast('Canal atualizado.');return;
    case 'member-form':
      await api('/units/'+state.adminUnit.id+'/members','POST',data);dialog.close();await membersDialog();toast('Acesso concedido.');return;
    case 'reset-member-form':
      await api('/units/'+state.adminUnit.id+'/members/'+form.dataset.id+'/password','POST',data);
      dialog.close();await membersDialog();toast('Senha temporária definida.');return;
    case 'contact-form':
      await api(unitPath('contacts'),'POST',{...data,id:form.dataset.id||null,blocked:f.has('blocked')});
      dialog.close();await refreshData();state.contactPage=0;await loadContacts();toast('Cliente salvo.');return;
    case 'service-form':
      await api(unitPath('services'),'POST',data);dialog.close();await refreshData();render();return;
    case 'service-return-form': {
      const service=state.data.services.find(s=>s.id===form.dataset.id);
      await api(unitPath('services'),'POST',{id:service.id,name:service.name,return_days:data.return_days});
      dialog.close();await refreshData();if(state.settings)state.settings=await api(unitPath('settings'));render();toast('Prazo de retorno salvo.');return;
    }
    case 'professional-form':
      await api(unitPath('professionals'),'POST',{id:form.dataset.id,phone:data.phone,enabled:f.has('enabled')});
      dialog.close();state.settings=await api(unitPath('settings'));await refreshData();render();toast('Profissional atualizado.');return;
    case 'avec-settings-form':
      await api(unitPath('settings'),'POST',{avec:{enabled:f.has('enabled'),auto_import:f.has('auto_import'),interval_minutes:Number(data.interval_minutes),
        history_days:Number(data.history_days),future_days:Number(data.future_days),salon_id:data.salon_id}});
      state.settings=await api(unitPath('settings'));await refreshData();renderMain();toast('Sincronização configurada.');return;
    case 'alerts-settings-form': {
      const mappings={arrival:{},stock:{}};
      for(const el of form.querySelectorAll('[data-alert-variable]'))mappings[el.dataset.kind][el.dataset.alertVariable]=el.value;
      await api(unitPath('settings'),'POST',{alerts:{channel_id:data['alert-channel']||null,arrival_enabled:f.has('arrival_enabled'),stock_enabled:f.has('stock_enabled'),
        arrival_template_id:data['arrival-template']||null,stock_template_id:data['stock-template']||null,
        arrival_mapping:mappings.arrival,stock_mapping:mappings.stock,stock_cooldown_days:Number(data.stock_cooldown_days)}});
      state.settings=await api(unitPath('settings'));renderMain();toast('Avisos configurados.');return;
    }
    case 'avec-report-form':
      await queryReport(form);return;
    case 'appointment-form':
      for(const key of ['scheduled_at','completed_at']) data[key]=data[key]?new Date(data[key]).toISOString():null;
      await api(unitPath('appointments'),'POST',data);dialog.close();await refreshData();render();toast('Atendimento registrado.');return;
    case 'rule-form':
      await api(unitPath('rules'),'POST',{...data,id:form.dataset.id||null,channel_id:data['rule-channel'],
        template_id:data['rule-template'],enabled:f.has('enabled'),mapping:readMapping(form),
        appointment_statuses:[...form.querySelectorAll('[data-rule-status]:checked')].map(input=>input.value)});
      dialog.close();await refreshData();render();toast('Rotina salva.');return;
    case 'send-form': {
      const payload={kind:state.sendMode,channel_id:data['send-channel'],template_id:data['send-template']||null,
        phone:data['send-phone'],body:data['send-body'],note:data['send-note'],confirm:f.has('confirm'),
        contacts:[...state.selected],mapping:readMapping(form),params:[...form.querySelectorAll('[data-param]')].map(el=>el.value.trim())};
      const fingerprint=JSON.stringify(payload);
      if(form.fingerprint!==fingerprint){form.fingerprint=fingerprint;form.request=randomUUID()}
      payload.request_id=form.request;
      const result=await api(unitPath('send'),'POST',payload);
      toast(result.queued?result.queued+' mensagem(ns) adicionada(s) à fila.':'Solicitação já registrada.');
      state.page='reports';await refreshData();render();return;
    }
  }
}
function randomUUID(){return crypto.randomUUID()}

root.addEventListener('click',async e=>{
  const page=e.target.closest('[data-page]');
  const mode=e.target.closest('[data-mode]');
  try{
    if(page){
      state.page=page.dataset.page;state.menu=false;
      if(state.page==='settings')state.settings=await api(unitPath('settings'));
      if(state.unit)await refreshData();render();
      const heading=document.querySelector('#main h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}
      return;
    }
    if(mode){state.sendMode=mode.dataset.mode;render();return}
    const btn=e.target.closest('[data-action]');
    if(!btn||btn.disabled)return;
    btn.disabled=true;
    try{await action(btn.dataset.action,btn)}finally{if(btn.isConnected)btn.disabled=false}
  }catch(error){toast(error.message,true)}
});
dialog.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');
  if(!btn)return;
  try{await action(btn.dataset.action,btn)}catch(error){toast(error.message,true)}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.target;
  if(form.dataset.busy)return;
  const btn=form.querySelector('button[type="submit"]');
  if(!btn)return;
  const original=btn.textContent;
  form.dataset.busy='true';btn.disabled=true;btn.textContent='Aguarde…';
  try{await submit(form)}catch(error){toast(error.message,true)}
  finally{delete form.dataset.busy;if(btn.isConnected){btn.disabled=false;btn.textContent=original}}
});
document.addEventListener('change',e=>{
  const el=e.target,form=el.form;
  if(el.hasAttribute('data-simulation-all')){
    dialog.querySelectorAll('[data-simulation-contact]').forEach(item=>item.checked=el.checked);
  }
  if(el.hasAttribute('data-simulation-contact')){
    const all=dialog.querySelector('[data-simulation-all]');
    const items=[...dialog.querySelectorAll('[data-simulation-contact]')];
    if(all){all.checked=items.every(item=>item.checked);all.indeterminate=!all.checked&&items.some(item=>item.checked)}
  }
  if(el.id==='catalog-channel')document.getElementById('model-table').innerHTML=modelTable(el.value);
  if(el.id==='send-channel'){
    state.channel=el.value;state.template='';
    document.getElementById('send-content').innerHTML=sendContent();
  }
  if(el.id==='send-template'){
    state.template=el.value;
    document.getElementById('template-fields').innerHTML=modelFields(state.data.templates.find(t=>t.id===el.value),state.sendMode);
  }
  if(el.hasAttribute('data-contact')){
    if(el.checked&&state.selected.size>=100){el.checked=false;toast('Selecione até 100 contatos.',true);return}
    if(el.checked)state.selected.add(el.dataset.contact);else state.selected.delete(el.dataset.contact);
    document.getElementById('selection-count').textContent=state.selected.size+' de 100 selecionados';
  }
  if(el.id==='rule-channel'){
    const models=readyModels(el.value);
    form.elements['rule-template'].innerHTML=options([['','Selecione o modelo'],...models.map(t=>[t.id,t.name])]);
    form.querySelector('#rule-fields').innerHTML='';
  }
  if(el.id==='rule-template')form.querySelector('#rule-fields').innerHTML=modelFields(state.data.templates.find(t=>t.id===el.value),'rule');
  if(form?.id==='rule-form'&&el.name==='type'){
    if(!form.dataset.id&&el.value==='csat')form.elements.delay_days.value='1';
    updateRuleType();
  }
  if(el.id==='alert-channel'){
    const models=readyModels(el.value);
    for(const kind of ['arrival','stock']){
      form.elements[kind+'-template'].innerHTML=options([['','Selecione'],...models.map(t=>[t.id,t.name])]);
      document.getElementById(kind+'-fields').innerHTML=alertFields(kind,'');
    }
  }
  if(el.id==='arrival-template'||el.id==='stock-template'){
    const kind=el.id.split('-')[0];document.getElementById(kind+'-fields').innerHTML=alertFields(kind,el.value);
  }
  if(el.id==='report-code'){
    state.reportCode=el.value;state.avecReport=null;state.reportPage=1;
    document.getElementById('report-parameters').innerHTML=reportParameters();
    document.getElementById('avec-report-result').innerHTML='';
  }
  if(el.hasAttribute('data-variable'))updatePreview(form);
});
let searchTimer;
let appointmentSearchTimer;
document.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='contact-search'||el.id==='send-search'){
    const send=el.id==='send-search';
    state.contactPage=0;state.contactSearch=el.value;
    clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(el.isConnected)loadContacts(send)},250);
  }
  if(el.hasAttribute('data-param'))updatePreview(el.form);
  if(el.id==='appointment-search'){
    clearTimeout(appointmentSearchTimer);
    const term=el.value;
    appointmentSearchTimer=setTimeout(async()=>{
      try{
        const contacts=await api(unitPath('contacts')+'?'+new URLSearchParams({search:term}));
        if(el.isConnected&&el.value===term){
          el.form.elements.contact_id.innerHTML=options([['','Selecione'],...contacts.map(c=>[c.id,c.name])]);
        }
      }catch(error){toast(error.message,true)}
    },250);
  }
  if(el.form?.id==='unit-form'&&el.name==='name'&&!el.form.elements.slug.dataset.touched){
    el.form.elements.slug.value=el.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  }
  if(el.name==='slug')el.dataset.touched='true';
});
let polling=false;
setInterval(async()=>{
  if(document.hidden||dialog.open||polling||!state.user||state.user.must_change_password)return;
  polling=true;
  try{
    if(state.page==='integration'&&state.integration){
      const info=await api('/units/'+state.integration.unit.id+'/integration');
      const changed=info.unit.sync_state!==state.integration.unit.sync_state||info.unit.avec_state!==state.integration.unit.avec_state;
      const editing=document.activeElement?.closest('form')||document.activeElement?.id==='integration-log';
      if(changed)state.integrationPendingRender=true;
      state.integration=info;
      if(state.integrationPendingRender&&!editing){state.integrationPendingRender=false;renderMain()}
      else if(document.getElementById('integration-status'))document.getElementById('integration-status').innerHTML=integrationStatus();
      updateDiagnostics();
    }else if(state.unit&&state.page==='reports'){
      await refreshData();
      const target=document.getElementById('report-jobs');if(target)target.innerHTML=jobTable(state.data.jobs);
    }else if(state.unit&&['dashboard','feedback','inventory','services'].includes(state.page)&&!document.activeElement?.closest('form')){
      await refreshData();renderMain();
    }
  }catch{}finally{polling=false}
},5000);

boot().then(()=>{
  if(state.unit&&location.hash==='#send'){state.page='send';render()}
}).catch(error=>toast(error.message,true));
