// Copie para config.js e preencha com valores do projeto Supabase.
// A anon/publishable key é pública. NUNCA coloque service_role nem tokens de integrações aqui.
window.FLOWSUITE_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseAnonKey: 'SUA_CHAVE_PUBLICA_ANON_OU_PUBLISHABLE',
  appName: 'FlowSuite',
  // Somente URL do webhook. O n8n DEVE validar JWT e estabelecimento antes de executar.
  n8nWebhookBase: '',
  // Origens exatas autorizadas para postMessage, ex.: ['https://crm.exemplo.com'].
  // Nunca use '*' em produção.
  allowedParentOrigins: [],
  // Opcional: URL pública definitiva; se vazio utiliza window.location.origin.
  publicBaseUrl: ''
};
