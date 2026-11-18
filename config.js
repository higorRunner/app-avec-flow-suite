// Copie para config.js e preencha com valores do projeto Supabase.
// A anon/publishable key é pública. NUNCA coloque service_role nem tokens de integrações aqui.
window.FLOWSUITE_CONFIG = {
  supabaseUrl: 'https://proton-crm-supabase.sizrit.easypanel.host',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE',
  appName: 'FlowSuite',
  // Somente URL do webhook. O n8n DEVE validar JWT e estabelecimento antes de executar.
  n8nWebhookBase: '',
  // Origens exatas autorizadas para postMessage, ex.: ['https://crm.exemplo.com'].
  // Nunca use '*' em produção.
  allowedParentOrigins: [*],
  // Opcional: URL pública definitiva; se vazio utiliza window.location.origin.
  publicBaseUrl: ''
};
