import { h, input, select } from './ui.js';
import { interpolateMessage, maxParameterLength } from './message-contract.js';
import { messageBubble } from './message-picker.js';
const picker = document.getElementById('message-picker');
const normalize = text => text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('pt-BR').trim();
const control = (label,kind,style='') =>
  `<button type="button" class="btn ${style}" data-picker="${kind}">${h(label)}</button>`;

export function openPicker(host,config,{saved,validate,paint}) {
  const models = config.models(config.channel.value);
  if (!models.length || picker.open) return;
  const fields = config.fields?.() || [];
  const drafts = new Map();
  if (saved) drafts.set(saved.id,config.value);
  let current = saved;
  const channel = config.channel.selectedOptions[0]?.textContent;
  picker.innerHTML = `<form class="stack">
    <div class="dialog-head"><h2 id="message-picker-title">${h(config.label)}</h2>${control('Fechar','cancel','small ghost')}</div>
    <div class="message-picker-grid">
      <section class="stack" aria-label="Catálogo de modelos">
        ${input('Buscar modelos','message-search','search','','autofocus')}
        <div class="field"><label for="message-model">Modelos aprovados</label>
          <select id="message-model" size="5" aria-describedby="message-results"></select>
          <p class="hint" id="message-results" role="status"></p>
        </div>
        <div id="message-variables" class="stack"></div>
      </section>
      <section class="message-picker-preview stack" aria-label="Prévia da conversa">
        <div class="message-conversation-head"><div class="message-avatar" aria-hidden="true">W</div>
          <div><strong>WhatsApp Oficial</strong><p class="hint">${h(channel)}</p></div></div>
        <div id="message-bubble"></div>
        <p class="hint message-preview-note">Prévia de demonstração. Nenhuma mensagem é enviada aqui.</p>
      </section>
    </div>
    <p class="alert error" id="message-error" role="alert" hidden></p>
    <div class="actions dialog-footer">
      ${config.optional && saved ? control('Remover modelo','remove','ghost') : ''}
      ${control('Cancelar','cancel','ghost')}
      <button type="submit" class="btn primary">Confirmar modelo</button>
    </div>
  </form>`;
  const form = picker.querySelector('form');
  const search = form.elements.namedItem('message-search');
  const list = picker.querySelector('#message-model');
  const results = picker.querySelector('#message-results');
  const variables = picker.querySelector('#message-variables');
  const bubble = picker.querySelector('#message-bubble');
  const error = picker.querySelector('#message-error');
  const confirm = form.querySelector('[type="submit"]');

  function value() {
    const entries = current.variables.map((key,index) => [key,variables.querySelector('#message-field-'+index).value.trim()]);
    return {templateId:current.id,mapping:config.literal ? {} : Object.fromEntries(entries),
      params:config.literal ? entries.map(([,value]) => value) : []};
  }
  function preview() {
    if (!current) {
      bubble.innerHTML = messageBubble('Escolha um modelo para ver a conversa.');
      return;
    }
    const {params,mapping} = value();
    bubble.innerHTML = messageBubble(interpolateMessage(current.body,key => config.literal ?
      params[current.variables.indexOf(key)] : fields.find(field => field.key === mapping[key])?.example));
  }
  function renderVariables() {
    const saved = drafts.get(current?.id);
    variables.innerHTML = current ? `<div><strong>${h(current.name)}</strong>
      <p class="hint">${current.variables.length ? 'Preencha os campos abaixo para personalizar a mensagem.' : 'Este modelo não possui variáveis.'}</p></div>`+
      current.variables.map((key,index) => {
        const id = 'message-field-'+index;
        return config.literal ? input('Valor do campo '+key,id,'text',saved?.params[index],`required maxlength="${maxParameterLength}"`) :
          select('Informação do campo '+key,id,[['','Selecione a informação'],...fields.map(({key,label}) => [key,label])],saved?.mapping[key],'required');
      }).join('') : '';
    error.hidden = true;
    confirm.disabled = !current;
    preview();
  }
  function filter() {
    const term = normalize(search.value);
    const matches = models.filter(model => normalize(model.name+' '+model.body).includes(term));
    list.replaceChildren(...matches.map(model => new Option(model.name,model.id,false,model.id===current?.id)));
    if (!matches.some(model => model.id === current?.id)) {
      if (current) drafts.set(current.id,value());
      current = null;
      list.selectedIndex = -1;
      renderVariables();
    }
    results.textContent = matches.length ? `${matches.length} modelo(s) disponível(is)` : 'Nenhum modelo corresponde à busca.';
  }
  search.addEventListener('input',filter);
  list.addEventListener('change',() => {
    if (current) drafts.set(current.id,value());
    current = models.find(model => model.id === list.value);
    renderVariables();
  });
  variables.addEventListener('input',() => {error.hidden = true;preview()});
  form.addEventListener('click',event => {
    const action = event.target.closest('[data-picker]')?.dataset.picker;
    if (action === 'remove') {config.value = null;paint(host,config)}
    if (action === 'remove' || action === 'cancel') picker.close();
  });
  form.addEventListener('submit',event => {
    event.preventDefault();
    event.stopPropagation();
    if (!current) return;
    const next = value();
    const message = validate(config,current,next);
    if (message) {error.textContent = message;error.hidden = false;return}
    config.value = next;
    paint(host,config);
    picker.close();
  });
  picker.addEventListener('close',() => {
    host.querySelector('button')?.focus();
    picker.replaceChildren();
  },{once:true});
  filter();
  renderVariables();
  picker.showModal();
}
