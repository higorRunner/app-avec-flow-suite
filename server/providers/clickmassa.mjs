const origin = 'https://suporteapi.clickmassa.com.br';
const channelId = /^[1-9]\d*$/;
const uuidPath = /^\/v1\/api\/external\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/?$/i;

export class ProviderError extends Error {
  constructor(operation, status, ambiguous = false) {
    super(`Clickmassa: ${operation} (${status || 'resposta inconclusiva'}).`);
    this.status = status;
    this.ambiguous = ambiguous;
  }
}

export function senderEndpoint(value) {
  const url = new URL(value);
  if (url.origin !== origin || url.username || url.password || url.hash || !uuidPath.test(url.pathname)) {
    throw new Error('URL de envio Clickmassa inválida.');
  }
  const keys = [...url.searchParams.keys()];
  if (keys.length) throw new Error('Informe a URL de envio sem parâmetros e o token no campo separado.');
  return url.href;
}

async function call(url, { operation, token, body, fetchImpl = fetch }) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetchImpl(url, {
      method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), headers,
      signal: AbortSignal.timeout(20000), redirect: 'error',
    });
  } catch {
    throw new ProviderError(operation, null, true);
  }
  if (!response.ok) {
    throw new ProviderError(operation, response.status, response.status >= 500 || [408, 409, 429].includes(response.status));
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderError(operation, null, true);
  }
}

function normalizeTemplate(item, channel) {
  if (String(item.whatsappId) !== channel || !channelId.test(String(item.id)) ||
      !channelId.test(String(item.hsmId)) || typeof item.name !== 'string' || !Array.isArray(item.components)) {
    throw new Error('Modelo Clickmassa fora do formato observado ou vinculado a outro canal.');
  }
  const body = item.components.find(x => x.type === 'BODY')?.text;
  const allTokens = typeof body === 'string' ? [...body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)] : [];
  const variables = [...new Set(allTokens.map(x => x[1]))].sort((a, b) => Number(a) - Number(b));
  const bodyOnly = item.components.every(component => {
    if (component.type === 'BODY') return true;
    if (component.type === 'BUTTONS') {
      return Array.isArray(component.buttons) && component.buttons.every(button =>
        typeof button.type === 'string' && ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(button.type) &&
        !Object.values(button).some(value => typeof value === 'string' && value.includes('{{')));
    }
    return ['HEADER', 'FOOTER'].includes(component.type) && typeof component.text === 'string' &&
      !component.text.includes('{{') && (!component.format || component.format === 'TEXT');
  });
  const supported = item.templateType === 'TEXT' && typeof body === 'string' && bodyOnly &&
    variables.every((key, index) => key === String(index + 1));
  return {
    channel_external_id: channel, external_id: `clickmassa:${channel}:${item.id}`,
    provider_template_id: String(item.hsmId), name: item.name, body: body || '',
    variables, status: supported ? 'active' : 'unsupported',
  };
}

export async function readCatalog({ email, password, tenantId, fetchImpl = fetch }) {
  const login = await call(`${origin}/auth/login/`, {
    operation: 'autenticação do catálogo', body: { email, password, captchaToken: '' }, fetchImpl,
  });
  if (!/^[1-9]\d*$/.test(String(login?.tenantId)) || (tenantId && String(login.tenantId) !== String(tenantId)) || typeof login?.token !== 'string' || !login.token) {
    throw new Error('O login Clickmassa não confirmou o tenant ou não retornou uma sessão de catálogo.');
  }
  tenantId = String(login.tenantId);
  const token = login.token;
  const response = await call(`${origin}/whatsapp/?hideInactive=true`, { operation: 'listar canais', token, fetchImpl });
  if (!Array.isArray(response)) throw new Error('Lista de canais Clickmassa fora do formato observado.');
  const channels = [];
  const templates = new Map();
  for (const item of response) {
    if (String(item.tenantId) !== String(tenantId)) throw new Error('O catálogo retornou um canal de outro tenant.');
    if (!['waba', 'whatsapp'].includes(item.type)) continue;
    const id = String(item.id);
    if (!channelId.test(id) || typeof item.name !== 'string') throw new Error('Identificador de canal inválido.');
    const active = item.isActive === true && item.isDeleted !== true && item.status === 'CONNECTED';
    channels.push({ external_id: id, name: item.name, type: item.type, active });
    if (item.type !== 'waba') continue;
    for (let page = 1; ; page++) {
      if (page > 100) throw new Error('O catálogo Clickmassa ultrapassou o limite de páginas.');
      const query = new URLSearchParams({ pageNumber: String(page), search: '', status: 'APPROVED', whatsappId: id });
      const result = await call(`${origin}/templates?${query}`, { operation: 'listar modelos', token, fetchImpl });
      if (!Array.isArray(result?.templates) || typeof result.hasMore !== 'boolean' || (result.hasMore && !result.templates.length)) {
        throw new Error('Paginação de modelos Clickmassa fora do formato observado.');
      }
      for (const item of result.templates) {
        if (String(item.tenantId) !== String(tenantId)) throw new Error('O catálogo retornou um modelo de outro tenant.');
        if (item.status !== 'APPROVED' || item.deletedAt) continue;
        const template = normalizeTemplate(item, id);
        templates.set(template.external_id, template);
      }
      if (!result.hasMore) break;
    }
  }
  return { tenantId, channels, templates: [...templates.values()] };
}

function valueFor(job, field) {
  const value = Object.hasOwn(job.fields, field) ? job.fields[field] : undefined;
  if (value === undefined || value === null || !String(value).trim()) {
    throw new Error('Faltam dados para preencher um campo do modelo.');
  }
  return String(value);
}

export function messagePayload(job) {
  const raw = String(job.phone || '').trim();
  const number = raw.replace(/[^0-9]/g, '');
  const localBrazilian = !raw.startsWith('+') && (number.length === 10 || number.length === 11);
  const international = localBrazilian ? `55${number}` : number;
  if (!/^\+?[0-9().\s-]+$/.test(raw) || !/^[1-9]\d{7,14}$/.test(international) ||
      (!raw.startsWith('+') && international.length < 12)) throw new Error('Telefone inválido.');
  const common = { number: international, externalKey: job.id };
  if (job.channel_type === 'whatsapp') {
    const body = String(job.payload.body || '').trim();
    if (!body || body.length > 4096) throw new Error('Texto do WhatsApp inválido.');
    const note = String(job.payload.note || '').trim();
    return { ...common, body, ...(note ? { note: { body: note } } : {}) };
  }
  if (job.channel_type !== 'waba' || !channelId.test(job.provider_template_id || '')) throw new Error('Modelo WABA sem identificador de envio.');
  const fields = job.variable_keys;
  const mapping = job.payload.variable_mapping || {};
  if (!Array.isArray(fields) || !fields.every((key, index) => key === String(index + 1))) {
    throw new Error('Modelo WABA com parâmetros não suportados.');
  }
  const params = job.test_run ? job.payload.test_params : fields.map(key => valueFor(job, mapping[key]));
  if (!Array.isArray(params) || params.length !== fields.length ||
      params.some(value => typeof value !== 'string' || !value.trim() || value.length > 1024)) {
    throw new Error('Parâmetros do modelo inválidos.');
  }
  return { ...common, templateId: job.provider_template_id, params };
}

export async function sendMessage({ url, token }, body, fetchImpl = fetch) {
  const result = await call(senderEndpoint(url), { operation: 'enviar mensagem', token, body, fetchImpl });
  if (typeof result?.message?.id !== 'string' || !result.message.id.trim()) {
    throw new ProviderError('envio sem confirmação de recebimento', null, true);
  }
  const status = ['sent', 'delivered', 'read'].includes(result.message.status) ? result.message.status : 'processing';
  return { status, externalId: result.message.id };
}
