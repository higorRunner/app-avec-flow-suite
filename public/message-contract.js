// @ts-check

/** @type {Record<string, [string, string]>} */
const fields = {
  'customer.name': ['Nome do cliente', 'Mariana'],
  'customer.phone': ['Telefone do cliente', '+55 11 99999-0000'],
  'customer.email': ['E-mail do cliente', 'mariana@example.com'],
  'customer.birthday': ['Nascimento', '18/11'],
  'establishment.name': ['Nome da unidade', 'Studio Azul'],
  'service.name': ['Nome do serviço', 'Corte'],
  'appointment.scheduled_at': ['Horário do agendamento', '18/11 às 14:00'],
  'appointment.completed_at': ['Conclusão do atendimento', '18/11 às 15:00'],
  'feedback.url': ['Link individual da pesquisa de satisfação', 'https://example.com/avaliar/link-individual'],
  'professional.name': ['Nome do profissional', 'Rafael'],
  'product.name': ['Nome do produto', 'Shampoo'],
  'product.quantity': ['Quantidade atual', '2'],
  'product.minimum': ['Estoque mínimo', '5'],
};

const customer = ['customer.name','customer.phone','customer.email','customer.birthday','establishment.name'];
const appointment = ['service.name','appointment.scheduled_at','appointment.completed_at'];
const contexts = {
  manual: customer,
  rule: [...customer,...appointment],
  csat: [...customer,...appointment,'feedback.url'],
  arrival: ['professional.name','customer.name','service.name','appointment.scheduled_at','establishment.name'],
  stock: ['professional.name','product.name','product.quantity','product.minimum','establishment.name'],
  report: ['customer.name','customer.phone'],
};

/** @typedef {keyof typeof contexts} MessageContext */
/** @typedef {{key: string, label: string, example: string}} MessageField */
export const maxParameterLength = 1024;

/** @param {MessageContext} context @returns {MessageField[]} */
export function messageFields(context) {
  return contexts[context].map(key => ({key,label:fields[key][0],example:fields[key][1]}));
}

/** @param {string[]} variables @param {unknown} mapping @param {(source: string) => boolean} allows */
export function validMapping(variables,mapping,allows) {
  if (!variables.length) return true;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return false;
  const entries = /** @type {Record<string,unknown>} */ (mapping);
  return variables.every(key => {
    const value = entries[key];
    return Object.hasOwn(entries,key) && typeof value === 'string' && allows(value);
  });
}

/**
 * @param {MessageContext} context
 * @param {string[]} variables
 * @param {Record<string,string>} mapping
 * @param {Set<string>} [columns]
 */
export function validContextMapping(context,variables,mapping,columns) {
  const allowed = contexts[context];
  return validMessageMapping(context,variables,mapping,source => allowed.includes(source) ||
    (context === 'report' && source.startsWith('column:') && Boolean(columns?.has(source.slice(7)))));
}

/**
 * @param {MessageContext} context
 * @param {string[]} variables
 * @param {Record<string,string>} mapping
 * @param {(source:string)=>boolean} allows
 */
export function validMessageMapping(context,variables,mapping,allows) {
  return validMapping(variables,mapping,allows) &&
    (context !== 'csat' || variables.some(key => mapping[key] === 'feedback.url'));
}

/** @param {string[]} variables @param {unknown} params */
export function validParameters(variables,params) {
  return Array.isArray(params) && params.length === variables.length &&
    params.every(value => typeof value === 'string' && Boolean(value.trim()) && value.length <= maxParameterLength);
}

/** @param {string} body @param {(key: string) => string | undefined} resolve */
export function interpolateMessage(body,resolve) {
  return body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(placeholder,key) => resolve(key) || placeholder);
}
