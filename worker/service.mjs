import { setTimeout as sleep } from 'node:timers/promises';
import { fetchReportPage } from '../integrations/avec-client.mjs';
import { readCatalog, sendMessage, senderEndpoint, messagePayload, ProviderError } from './clickmassa.mjs';

function required(env, key) {
  if (!env[key]?.trim()) throw new Error(`Configure ${key} no serviço do FlowSuite.`);
  return env[key].trim();
}

function validateSender(id, { url, token }, tenantId) {
  const endpoint = senderEndpoint(url);
  let claims;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error(`Token de envio inválido para o canal ${id}.`);
  }
  // These claims detect configuration mistakes. Clickmassa authenticates the token when sending.
  if (String(claims?.sessionId) !== id || String(claims?.tenantId) !== tenantId ||
      !Number.isFinite(claims?.exp) || claims.exp <= Date.now() / 1000) {
    throw new Error(`O token de envio do canal ${id} está vencido ou pertence a outro canal ou empresa.`);
  }
  return { url:endpoint, token, type:claims.channelType };
}

function environmentSettings(env) {
  if (!env.CLICKMASSA_EMAIL && !env.CLICKMASSA_PASSWORD && !env.CLICKMASSA_TENANT_ID) return null;
  const email = required(env, 'CLICKMASSA_EMAIL');
  required(env, 'CLICKMASSA_PASSWORD');
  const tenantId = required(env, 'CLICKMASSA_TENANT_ID');
  const senders = {};
  for (const key of Object.keys(env)) {
    const match = key.match(/^CLICKMASSA_SEND_URL_([1-9]\d*)$/);
    if (!match) continue;
    senders[match[1]] = { url: env[key], token:env[`CLICKMASSA_SEND_TOKEN_${match[1]}`] };
  }
  return { email, password:env.CLICKMASSA_PASSWORD, tenantId, senders };
}

export async function syncClickmassa({ rpc, establishment, settings, revision, dispatchEnabled, lookup=readCatalog }) {
  const p_est = establishment;
  const publish = (state, catalog)=>rpc('fs_commit_clickmassa_sync',{
    p_est,p_revision:revision,p_channels:catalog?.channels??null,p_templates:catalog?.templates??null,p_state:state,
  });
  const senders = new Map();
  let senderError = false;
  if(dispatchEnabled){
    for(const [id, credentials] of Object.entries(settings.senders||{})){
      try { senders.set(id, validateSender(id, credentials, settings.tenantId)); }
      catch { senderError = true; }
    }
  }
  let catalog;
  try {
    catalog = await lookup({ email:settings.email,password:settings.password,tenantId:settings.tenantId });
  } catch(error) {
    await publish([401,403,422].includes(error.status)?'auth_error':'sync_error');
    throw error;
  }
  for(const channel of catalog.channels){
    const sender = senders.get(channel.external_id);
    if(sender && sender.type !== channel.type) senderError = true;
    channel.dispatch_ready = channel.active && sender?.type === channel.type;
  }
  const accepted = await publish(senderError?'sender_error':'ready',catalog);
  if(accepted) console.log(`Clickmassa: catálogo atualizado (${catalog.channels.length} canais e ${catalog.templates.length} modelos).`);
  return { accepted, senders };
}

function supabaseRpc(env) {
  const root = new URL(required(env, 'SUPABASE_URL'));
  if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash) {
    throw new Error('SUPABASE_URL deve ser um endereço HTTPS sem credenciais.');
  }
  const key = required(env, 'SUPABASE_SERVICE_ROLE_KEY');
  return async (name, input) => {
    const url = new URL(`/rest/v1/rpc/${name}`, root);
    const response = await fetch(url, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      let code = '';
      try {
        const result = await response.json();
        if (/^[A-Z0-9]{5,12}$/.test(result?.code || '')) code = ` [${result.code}]`;
      } catch { /* The HTTP status still identifies an invalid response. */ }
      throw new Error(`Supabase: ${name} retornou HTTP ${response.status}${code}.`);
    }
    if (response.status !== 204) return response.json();
  };
}

export async function dispatchOne({ rpc, establishment, senders, submit = sendMessage }) {
  const p_est = establishment;
  const job = await rpc('fs_claim_clickmassa_job', { p_est, p_channel_ids: [...senders.keys()] });
  if (!job) return false;
  if (job.skipped) return true;

  let outcome;
  let body;
  try {
    body = messagePayload(job);
  } catch (error) {
    outcome = { status: 'failed', error: error.message };
  }
  if (body) {
    try {
      outcome = await submit(senders.get(job.channel_external_id), body);
    } catch (error) {
      outcome = error instanceof ProviderError && !error.ambiguous
        ? { status: 'failed', error: error.message }
        : { status: 'processing', error: 'Resposta de envio inconclusiva. Confira o protocolo no Clickmassa antes de reenviar.' };
    }
  }
  await rpc('fs_finish_clickmassa_job', { p_est, p_job: job.id, p_status: outcome.status,
    p_external_id: outcome.externalId ?? null, p_error: outcome.error ?? null });
  return true;
}

async function poll(task, delay, label, signal) {
  while (!signal.aborted) {
    try {
      await task();
    } catch (error) {
      console.error(`FlowSuite / ${label}: ${error.message}`);
    }
    try { await sleep(delay, undefined, { signal }); } catch { if (!signal.aborted) throw new Error('Pausa interrompida.'); }
  }
}

export async function run(env, { rpcImpl, signal, lookup = readCatalog } = {}) {
  const establishment = required(env, 'FLOWSUITE_ESTABLISHMENT_ID');
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(establishment)) throw new Error('UUID do estabelecimento inválido.');
  const rpc = rpcImpl || supabaseRpc(env);
  const p_est = establishment;
  const reportCodes = [...new Set((env.AVEC_SNAPSHOT_CODES || '').split(',').map(code => code.trim()).filter(Boolean))];
  if (reportCodes.some(code => !/^\d{4}$/.test(code))) throw new Error('Informe códigos AVEC de quatro dígitos.');
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, shutdown);
  signal?.addEventListener('abort', shutdown, { once: true });
  if(signal?.aborted) controller.abort();
  console.log(`FlowSuite: serviço iniciado para a unidade ${establishment}.`);

  let synced = false;
  let workerState = null;
  let revisionSeen;
  let nextSync = 0;
  let senders = new Map();
  const heartbeat = poll(async () => {
    try {
      workerState = await rpc('fs_clickmassa_worker_state',{ p_est });
      if(!workerState) {
        synced = false;
        console.error('FlowSuite: unidade ausente ou inativa. Confira o UUID do serviço.');
      }
    } catch(error) {
      workerState = null;
      synced = false;
      throw error;
    }
  }, 10_000, 'conexão com Supabase', controller.signal);

  const catalog = poll(async () => {
    if(!workerState){
      synced = false;
      return;
    }
    const revision = workerState.revision;
    if(revision===revisionSeen && Date.now()<nextSync) return;
    const changed = revision!==revisionSeen;
    if(changed) synced = false;
    revisionSeen = revision;
    nextSync = Date.now() + 60_000;
    const settings = revision
      ? await rpc('fs_clickmassa_worker_settings',{ p_est,p_revision:revision })
      : environmentSettings(env);
    if(!settings) {
      synced = false;
      return;
    }
    synced = false;
    const dispatchEnabled = revision ? env.FLOWSUITE_SEND_ENABLED!=='false' : env.FLOWSUITE_SEND_ENABLED==='true';
    const result = await syncClickmassa({rpc,establishment,settings,revision,dispatchEnabled,lookup});
    if(result.accepted){
      senders = result.senders;
      synced = true;
      nextSync = Date.now() + 15 * 60_000;
    }
  }, 10_000, 'catálogo Clickmassa', controller.signal);

  const queue = poll(async () => {
    if (!synced || !senders.size) return;
    for (let i = 0; i < 10 && !controller.signal.aborted; i++) {
      if (!await dispatchOne({ rpc, establishment, senders })) break;
    }
  }, 5000, 'fila Clickmassa', controller.signal);

  const automations = poll(async () => {
    if (!synced || !senders.size) return;
    const queued = await rpc('fs_schedule_automations', { p_est });
    if (queued > 0) console.log(`Automações: ${queued} envio(s) adicionado(s) à fila.`);
  }, 60_000, 'agendamento de rotinas', controller.signal);

  const avec = reportCodes.length ? poll(async () => {
    const token = await rpc('fs_worker_avec_token', { p_est });
    if (!token) throw new Error('Cadastre o token AVEC no painel master.');
    for (const code of reportCodes) {
      if (controller.signal.aborted) break;
      let raw;
      try {
        ({ raw } = await fetchReportPage({ code, token, params: { page: 1 } }));
      } catch {
        throw new Error(`Falha na coleta AVEC do relatório ${code}. Confira o token, os parâmetros e o formato da resposta.`);
      }
      await rpc('fs_save_avec_sample', { p_est, p_code: code, p_payload: raw });
      console.log(`AVEC: primeira página do relatório ${code} registrada.`);
    }
  }, 60 * 60_000, 'consulta AVEC', controller.signal) : Promise.resolve();

  const avecTest = poll(async () => {
    const request = await rpc('fs_pending_avec_test',{p_est});
    if(!request) return;
    const token = await rpc('fs_worker_avec_token',{p_est});
    let report = null;
    if(token){
      try { report = await fetchReportPage({code:'0004',token,params:{page:1}}); }
      catch { console.error('AVEC: a consulta de teste não retornou um relatório reconhecido.'); }
    }
    await rpc('fs_complete_avec_test',{
      p_est,p_request:request,p_records:report?.result.length??null,p_payload:report?.raw??null,
    });
  }, 10_000, 'teste AVEC', controller.signal);

  try {
    await Promise.all([heartbeat, catalog, queue, automations, avec, avecTest]);
  } finally {
    for (const event of ['SIGTERM', 'SIGINT']) process.removeListener(event, shutdown);
    signal?.removeEventListener('abort', shutdown);
  }
}

if (process.argv[1] && process.argv[1].replaceAll('\\','/').endsWith('/worker/service.mjs')) {
  run(process.env).catch(error => {
    console.error(`FlowSuite: ${error.message}`);
    process.exitCode = 1;
  });
}
