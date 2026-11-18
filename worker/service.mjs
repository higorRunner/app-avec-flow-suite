import { setTimeout as sleep } from 'node:timers/promises';
import { fetchReportPage } from '../integrations/avec-client.mjs';
import { readCatalog, sendMessage, senderEndpoint, messagePayload, ProviderError } from './clickmassa.mjs';

function required(env, key) {
  if (!env[key]?.trim()) throw new Error(`Configure ${key} no serviço do FlowSuite.`);
  return env[key].trim();
}

function sendersFrom(env, tenantId) {
  const senders = new Map();
  for (const key of Object.keys(env)) {
    const match = key.match(/^CLICKMASSA_SEND_URL_([1-9]\d*)$/);
    if (!match) continue;
    const id = match[1];
    const url = senderEndpoint(required(env, key));
    const token = required(env, `CLICKMASSA_SEND_TOKEN_${id}`);
    let claims;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error();
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new Error(`O canal ${id} precisa de um token de envio da API externa.`);
    }
    // These claims prevent configuration mix-ups. Clickmassa authenticates the token on send.
    if (String(claims?.sessionId) !== id || String(claims?.tenantId) !== tenantId ||
        !Number.isFinite(claims?.exp) || claims.exp <= Date.now() / 1000) {
      throw new Error(`O token de envio do canal ${id} está vencido ou pertence a outro canal ou tenant.`);
    }
    senders.set(id, { url, token, type: claims.channelType });
  }
  for (const key of Object.keys(env)) {
    const match = key.match(/^CLICKMASSA_SEND_TOKEN_([1-9]\d*)$/);
    if (match && !senders.has(match[1])) throw new Error(`Configure CLICKMASSA_SEND_URL_${match[1]}.`);
  }
  return senders;
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
    if (!response.ok) throw new Error(`Supabase: ${name} retornou HTTP ${response.status}.`);
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

export async function run(env) {
  const establishment = required(env, 'FLOWSUITE_ESTABLISHMENT_ID');
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(establishment)) throw new Error('UUID do estabelecimento inválido.');
  const rpc = supabaseRpc(env);
  const p_est = establishment;
  const email = required(env, 'CLICKMASSA_EMAIL');
  required(env, 'CLICKMASSA_PASSWORD');
  const password = env.CLICKMASSA_PASSWORD;
  const tenantId = required(env, 'CLICKMASSA_TENANT_ID');
  const senders = sendersFrom(env, tenantId);
  const dispatchEnabled = env.FLOWSUITE_SEND_ENABLED === 'true';
  const reportCodes = [...new Set((env.AVEC_SNAPSHOT_CODES || '').split(',').map(code => code.trim()).filter(Boolean))];
  if (reportCodes.some(code => !/^\d{4}$/.test(code))) throw new Error('Informe códigos AVEC de quatro dígitos.');
  const controller = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => controller.abort());

  let synced = false;
  const catalog = poll(async () => {
    synced = false;
    const { channels, templates } = await readCatalog({ email, password, tenantId });
    for (const channel of channels) {
      const sender = senders.get(channel.external_id);
      channel.dispatch_ready = dispatchEnabled && channel.active && sender?.type === channel.type;
    }
    await rpc('fs_sync_clickmassa_catalog', { p_est, p_channels: channels, p_templates: templates });
    synced = true;
    console.log(`Clickmassa: catálogo atualizado (${channels.length} canais e ${templates.length} modelos).`);
  }, 15 * 60_000, 'catálogo Clickmassa', controller.signal);

  const queue = poll(async () => {
    if (!synced || !dispatchEnabled || !senders.size) return;
    for (let i = 0; i < 10 && !controller.signal.aborted; i++) {
      if (!await dispatchOne({ rpc, establishment, senders })) break;
    }
  }, 5000, 'fila Clickmassa', controller.signal);

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

  await Promise.all([catalog, queue, avec]);
}

if (process.argv[1] && process.argv[1].replaceAll('\\','/').endsWith('/worker/service.mjs')) {
  run(process.env).catch(error => {
    console.error(`FlowSuite: ${error.message}`);
    process.exitCode = 1;
  });
}
