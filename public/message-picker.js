import { h } from './ui.js';
import { messageFields, validContextMapping, validParameters } from './message-contract.js';

const configurations = new WeakMap();

function findSelection(config) {
  return config.models(config.channel.value).find(model => model.id === config.value?.templateId);
}

/**
 * @typedef {{id:string,name:string,body:string,variables:string[]}} MessageTemplate
 * @typedef {{templateId:string|null,mapping:Record<string,string>,params:string[]}} MessageSelection
 * @typedef {{label:string,channel:HTMLSelectElement,models:(channel:string)=>MessageTemplate[],
 * reportColumns?:string[],value?:MessageSelection|null,
 * literal?:boolean,optional?:boolean,replacedOnChannelChange?:boolean,context:()=>import('./message-contract.js').MessageContext}} MessageConfig
 * @param {HTMLElement} host
 * @param {MessageConfig} config
 */
export function mountMessageConfig(host, config) {
  configurations.set(host,config);
  if (!config.replacedOnChannelChange) config.channel.addEventListener('change',() => {
    config.value = null;
    paint(host,config);
  });
  host.addEventListener('click',async event => {
    const trigger = event.target.closest('button');
    if (!trigger || trigger.disabled) return;
    trigger.disabled = true;
    trigger.setAttribute('aria-busy','true');
    trigger.removeAttribute('aria-label');
    trigger.textContent = 'Abrindo…';
    try {
      const {openPicker} = await import('./message-dialog.js');
      if (host.isConnected && host.contains(trigger)) {
        openPicker(host,config,{saved:findSelection(config),fields:fieldsFor(config),validate,paint});
      }
    } catch {
      host.querySelector('.message-config-status').textContent = 'Falha ao abrir o catálogo. Tente novamente.';
    } finally {
      trigger.removeAttribute('aria-busy');
      trigger.disabled = false;
      trigger.textContent = findSelection(config) ? 'Editar modelo' : 'Escolher modelo';
      trigger.setAttribute('aria-label',triggerLabel(config));
    }
  });
  paint(host,config);
}

function fieldsFor(config) {
  const fields = messageFields(config.context());
  for (const column of config.reportColumns||[]) {
    const label = column.replaceAll('_',' ');
    fields.push({key:'column:'+column,label:'Relatório · '+label,example:'['+label+']'});
  }
  return fields;
}

function triggerLabel(config) {
  return (findSelection(config) ? 'Editar ' : 'Escolher ')+config.label.toLocaleLowerCase('pt-BR');
}

function paint(host,config) {
  const model = findSelection(config);
  const available = config.models(config.channel.value).length;
  const problem = model && validate(config,model,config.value);
  const hint = !config.channel.value ? 'Selecione um canal para ver os modelos.' :
    config.value?.templateId && !model ? 'O modelo salvo ficou indisponível. Escolha outro.' :
    !available ? 'Este canal não tem modelos textuais aprovados.' :
    problem || (model ? `${model.variables.length} campo(s) · WhatsApp Oficial` : 'Escolha um modelo textual aprovado.');
  host.innerHTML = `<div class="message-config">
    <div><strong>${h(config.label)}</strong>${model ? `<p>${h(model.name)}</p>` : ''}
      <p class="hint">${h(hint)}</p><p class="hint message-config-status" role="status"></p></div>
    <button type="button" class="btn ${model && !problem ? '' : 'primary'}" aria-label="${h(triggerLabel(config))}" ${available ? '' : 'disabled'}>
      ${model ? 'Editar modelo' : 'Escolher modelo'}</button></div>`;
}

export function refreshMessageConfig(host) {
  const config = configurations.get(host);
  if (config) paint(host,config);
}

function validate(config,model,value) {
  if (!model) return 'Escolha um modelo aprovado.';
  if (config.literal && !validParameters(model.variables,value.params)) return 'Preencha todos os valores do modelo.';
  const context = config.context();
  if (!config.literal && !validContextMapping(context,model.variables,value.mapping,new Set(config.reportColumns))) {
    return context === 'csat' ? 'Preencha os campos e inclua o link individual da pesquisa.' : 'Escolha uma informação disponível para cada campo.';
  }
  return '';
}

export function readMessageConfig(host, required = true) {
  const config = configurations.get(host);
  if (!config && required) throw Error('Carregue a configuração da mensagem para continuar.');
  if (!config) return {templateId:null,mapping:{},params:[]};
  const model = findSelection(config);
  const error = required && validate(config,model,config.value);
  if (error) {
    const trigger=host.querySelector('button');
    (trigger.disabled ? config.channel : trigger).focus();
    throw Error(config.label + ' — ' + error);
  }
  return model ? config.value : {templateId:null,mapping:{},params:[]};
}

