export function reportComposer({api,h,select,button,table,openDialog,unitPath,channels,models,onSent,toast}){
  let report=null,selected=new Set(),request=null,review=null;
  const valueLabel=key=>key.replaceAll('_',' ');
  function renderRows(next){
    if(report?.snapshot_id!==next.snapshot_id){selected.clear();request=null;review=null}
    report=next;
    if(!report.snapshot_id)return table(report.columns,report.rows.map(row=>report.columns.map(key=>h(row[key]??'—'))));
    return `<div class="selection-toolbar"><div><strong id="report-selection-count">${selected.size} itens selecionados</strong><p class="hint">Selecione até 100 itens desta página para preparar mensagens.</p></div>
      <div class="actions">${button('Selecionar até 100','report-select','','small')}${button('Limpar','report-clear','','small')}${button('Preparar envio','report-compose','','primary')}</div></div>`+
      table(['Selecionar',...report.columns],report.rows.map((row,index)=>[
        `<input class="row-check" type="checkbox" data-report-index="${index}" aria-label="Selecionar item ${index+1}" ${selected.has(index)?'checked':''}>`,
        ...report.columns.map(key=>h(row[key]===null||row[key]===undefined?'—':typeof row[key]==='object'?'Conteúdo composto':row[key])),
      ]));
  }
  function repaintSelection(){
    document.querySelectorAll('[data-report-index]').forEach(el=>{
      el.checked=selected.has(Number(el.dataset.reportIndex));el.closest('tr').classList.toggle('selected-row',el.checked);
    });
    const count=document.getElementById('report-selection-count');if(count)count.textContent=selected.size+' itens selecionados';
  }
  function fields(templateId,mapping={}){
    const template=models().find(t=>t.id===templateId);
    return template?`<p class="preview">${h(template.body)}</p>`+template.variables.map(key=>select('Conteúdo do campo '+key,'report-variable-'+key,
      [['','Selecione uma informação'],['customer.name','Nome do cliente identificado'],['customer.phone','Telefone do cliente identificado'],
        ...report.columns.map(column=>['column:'+column,'Relatório · '+valueLabel(column)])],mapping[key]||'','required')).join(''):'<p class="hint">Escolha um modelo aprovado para definir seus campos.</p>';
  }
  function compose(){
    if(!selected.size)throw Error('Selecione os itens do relatório antes de preparar o envio.');
    const available=channels().filter(c=>c.type==='waba');
    if(!available.length)throw Error('Configure um canal Oficial antes de preparar mensagens por relatório.');
    const saved=request?.snapshot_id===report.snapshot_id?request:null;
    const phoneColumn=saved?.phone_column??(['celular','telefone','cliente_tel','cel_cli','phone'].find(key=>report.columns.includes(key))||'');
    const idColumn=saved?.id_column??(['salao_cliente_id','cliente_id',...(report.code==='0004'?['id']:[])].find(key=>report.columns.includes(key))||'');
    openDialog('Montar envio do relatório',`<form id="report-compose-form" class="stack">
      <p class="hint">${selected.size} itens selecionados. Primeiro identifique os clientes, depois escolha o conteúdo de cada campo.</p>
      <div class="form-grid">${select('Coluna de telefone ou celular','report-phone',[['','Usar o cadastro pelo ID'],...report.columns.map(key=>[key,valueLabel(key)])],phoneColumn)}
      ${select('Coluna do ID do cliente AVEC','report-id',[['','Identificar pelo telefone'],...report.columns.map(key=>[key,valueLabel(key)])],idColumn)}</div>
      <p class="hint">O ID é procurado nos clientes sincronizados desta unidade. O sistema confere se ID e telefone correspondem. Bloqueios manuais são respeitados.</p>
      ${select('Canal Oficial','report-channel',[['','Selecione'],...available.map(c=>[c.id,c.name])],saved?.channel_id,'required')}
      ${select('Modelo da mensagem','report-template',[['','Selecione o canal primeiro'],...models().filter(t=>t.channel_id===saved?.channel_id).map(t=>[t.id,t.name])],saved?.template_id,'required')}
      <div id="report-template-fields" class="stack">${fields(saved?.template_id,saved?.mapping)}</div>
      <div class="actions">${button('Cancelar','close-dialog','','ghost')}<button class="btn primary" type="submit">Revisar destinatários e mensagens</button></div></form>`);
  }
  function renderReview(){
    const duplicate=review.rows.length-new Set(review.rows.map(row=>row.phone).filter(Boolean)).size;
    openDialog('Revisar antes de enviar',`<form id="report-review-form" class="stack">
      <div class="review-metrics"><strong>${review.ready} aptos para envio</strong><span>${review.blocked} bloqueados</span></div>
      ${duplicate>0?'<p class="alert">Há itens com o mesmo destinatário. Cada item selecionado gera uma mensagem; confira se essa repetição é desejada.</p>':''}
      <div class="message-review-list">${review.rows.map(row=>`<article class="review-item"><div class="actions between"><strong>${h(row.name)}</strong>${button('Remover item','report-remove','data-index="'+row.index+'"','small')}</div>
        <p class="hint">${h(row.phone||'Sem telefone')} · Item ${row.index+1}${row.new_contact?' · Novo destinatário':''}</p>
        ${row.reason?`<p class="alert error">${h(row.reason)}</p>`:`<p class="preview">${h(review.body.replace(/\{\{\s*(\d+)\s*\}\}/g,(_,key)=>row.params[Number(key)-1]||''))}</p>`}</article>`).join('')}</div>
      <label class="check"><input type="checkbox" name="confirm" required>Revisei os números, os dados e as mensagens e confirmo a autorização dos destinatários.</label>
      <div class="actions">${button('Voltar à montagem','report-compose','','ghost')}<button class="btn primary" type="submit" ${review.blocked||!review.ready?'disabled':''}>Confirmar envio de ${review.ready} mensagem(ns)</button></div></form>`);
  }
  async function action(name,btn){
    if(name==='report-select'){selected=new Set(report.rows.slice(0,100).map((_,i)=>i));repaintSelection();return true}
    if(name==='report-clear'){selected.clear();repaintSelection();return true}
    if(name==='report-compose'){compose();return true}
    if(name==='report-remove'){
      const index=Number(btn.dataset.index);selected.delete(index);request.rows=request.rows.filter(i=>i!==index);
      if(!request.rows.length){document.getElementById('dialog').close();repaintSelection();return true}
      review=await api(unitPath('report-preview'),'POST',request);renderReview();repaintSelection();return true;
    }
    return false;
  }
  async function submit(form){
    if(form.id==='report-compose-form'){
      const values=new FormData(form),mapping={};
      for(const [key,value]of values)if(key.startsWith('report-variable-'))mapping[key.slice(16)]=value;
      request={snapshot_id:report.snapshot_id,rows:[...selected],phone_column:values.get('report-phone'),id_column:values.get('report-id'),
        channel_id:values.get('report-channel'),template_id:values.get('report-template'),mapping};
      review=await api(unitPath('report-preview'),'POST',request);renderReview();return true;
    }
    if(form.id==='report-review-form'){
      const values=new FormData(form);
      const result=await api(unitPath('report-send'),'POST',{...request,confirm:values.has('confirm'),confirm_new_contacts:values.has('confirm_new_contacts')});
      document.getElementById('dialog').close();selected.clear();toast(result.queued+' mensagem(ns) adicionada(s) à fila.');await onSent();return true;
    }
    return false;
  }
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.hasAttribute('data-report-index')){
      const index=Number(el.dataset.reportIndex);
      if(el.checked&&selected.size>=100){el.checked=false;toast('Selecione até 100 itens por envio.',true);return}
      if(el.checked)selected.add(index);else selected.delete(index);repaintSelection();
    }
    if(el.id==='report-channel'){
      const target=el.form.elements['report-template'];target.innerHTML='<option value="">Selecione</option>'+models().filter(t=>t.channel_id===el.value).map(t=>`<option value="${h(t.id)}">${h(t.name)}</option>`).join('');
      document.getElementById('report-template-fields').innerHTML=fields('');
    }
    if(el.id==='report-template')document.getElementById('report-template-fields').innerHTML=fields(el.value);
  });
  return {renderRows,action,submit};
}
