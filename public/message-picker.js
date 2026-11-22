import { h } from './ui.js';
import { validMessageMapping, validParameters } from './message-contract.js';

const configurations = new WeakMap();
export function messageBubble(text) {
  return `<div class="message-conversation"><p class="message-bubble">${h(text)}</p></div>`;
}

function findSelection(config) {
  return config.models(config.channel.value).find(model => model.id === config.value?.templateId);
}

/**
 * @typedef {{id:string,name:string,body:string,variables:string[]}} MessageTemplate
 * @typedef {{templateId:string|null,mapping:Record<string,string>,params:string[]}} MessageSelection
 * @typedef {{label:string,channel:HTMLSelectElement,models:(channel:string)=>MessageTemplate[],
 * fields:()=>import('./message-contract.js').MessageField[],value?:MessageSelection|null,
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
    trigger.textContent = 'Abrindo…';
    try {
      const {openPicker} = await import('./message-dialog.js');
      if (host.isConnected && host.contains(trigger)) {
        openPicker(host,config,{saved:findSelection(config),validate,paint});
      }
    } catch {
      host.querySelector('.hint').textContent = 'Falha ao abrir o catálogo. Tente novamente.';
    } finally {
      trigger.removeAttribute('aria-busy');
      trigger.disabled = false;
      trigger.textContent = findSelection(config) ? 'Editar modelo' : 'Escolher modelo';
    }
  });
  paint(host,config);
}

function paint(host,config) {
  const model = findSelection(config);
  const available = config.models(config.channel.value).length;
  const hint = !config.channel.value ? 'Selecione um canal para ver os modelos.' :
    !available ? 'Este canal não tem modelos textuais aprovados.' :
    config.value?.templateId && !model ? 'O modelo salvo ficou indisponível. Escolha outro.' :
    model ? `${model.variables.length} campo(s) · WhatsApp Oficial` : 'Escolha um modelo textual aprovado.';
  host.innerHTML = `<div class="message-config">
    <div><strong>${h(config.label)}</strong>${model ? `<p>${h(model.name)}</p>` : ''}
      <p class="hint">${h(hint)}</p></div>
    <button type="button" class="btn ${model ? '' : 'primary'}" aria-label="${h((model ? 'Editar ' : 'Escolher ')+config.label.toLocaleLowerCase('pt-BR'))}" ${available ? '' : 'disabled'}>
      ${model ? 'Editar modelo' : 'Escolher modelo'}</button></div>`;
}

function validate(config,model,value) {
  if (!model) return 'Escolha um modelo aprovado.';
  if (config.literal && !validParameters(model.variables,value.params)) return 'Preencha todos os valores do modelo.';
  const context = config.context();
  if (!config.literal && !validMessageMapping(context,model.variables,value.mapping,source => config.fields().some(field => field.key === source))) {
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
    host.querySelector('button').focus();
    throw Error(config.label + ' — ' + error);
  }
  return model ? config.value : {templateId:null,mapping:{},params:[]};
}

