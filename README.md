# FlowSuite — painel AVEC / Clickmassa

Aplicação web estática (HTML + CSS + JS), login por e-mail no Supabase, painel master, painel de estabelecimentos, configurações de 8 automações, envio manual em fila, catálogos, relatórios e leitura de `window.postMessage` do plugin.

**Importante:** há 9 funcionalidades de negócio: as funções 1–6 e 8–9 configuram automações; a função 7 é o módulo independente de histórico. A aplicação persiste configurações e fila. **Os disparos reais dependem de workflows n8n e dos endpoints das APIs ainda não fornecidos.**

## Pastas

```text
avec-proton-system/
  index.html
  config.js               <-- editar este arquivo
  config.example.js
  assets/css/app.css
  assets/js/app.js
  sql/001_schema.sql
  sql/002_first_admin.sql
  docs/CONTRATO_N8N.md
  Dockerfile
  nginx.conf
  .htaccess
```

## Passo a passo — Supabase

1. Crie um projeto Supabase.
2. No SQL Editor, execute **todo** o conteúdo de `sql/001_schema.sql`.
3. Em **Authentication → Providers → Email**, habilite e-mail e confirmação de e-mail. Configure SMTP adequado para produção.
4. Em **Authentication → URL Configuration**, configure a URL oficial do sistema em **Site URL**, incluindo os URLs de redirecionamento necessários.
5. Em **Project Settings → API**, copie apenas **Project URL** e **anon/public/publishable key** para `config.js`.
6. Acesse seu site, clique **Criar conta** e confirme o e-mail.
7. No SQL Editor, edite e execute `sql/002_first_admin.sql` para promover **somente seu e-mail** a master.
8. Faça logout e login novamente, acesse **Painel master** e crie seu primeiro estabelecimento.
9. Crie contas para os operadores (cada um confirma seu e-mail). No painel master, use **Acesso** para vincular e-mail ao estabelecimento.
10. No painel master, configure token AVEC e URL/token Clickmassa. O n8n poderá atualizar o token Clickmassa diretamente em `integration_secrets` via service_role.

**Segurança:** `service_role` deve estar **exclusivamente** no n8n/servidor. Nunca no `config.js`, HTML, JavaScript do navegador nem repositório público. A tabela `integration_secrets` não possui políticas SELECT de browser. Alterações de tokens ocorrem por RPC restrita a master.

## Implantar no EasyPanel (Docker)

1. Faça upload da pasta para um repositório privado Git (ou envie a pasta com Dockerfile para seu servidor).
2. Configure `config.js` com a URL e a chave pública antes do build; **não publique tokens privados**.
3. EasyPanel → New Project → App → fonte Git → Build via Dockerfile.
4. Porta interna **80**. Configure domínio e HTTPS no EasyPanel.
5. Configure DNS do domínio apontando para seu servidor.
6. No Supabase, informe o domínio definitivo no Site URL/Redirect URLs.
7. Teste login, cadastro de estabelecimento e regras.
8. Configuração `allowedParentOrigins` deve conter a origem do Proton CRM/Clickmassa que realmente incorpora o iframe (ex.: `https://crm.exemplo.com`).
9. Abra `https://dominio.com/?estabelecimento=slug&embed=1` no plugin lateral. Sem `embed=1`, interface de painel completo.

## Implantar na Hostinger (hospedagem HTML/PHP)

1. Envie `index.html`, `config.js`, `assets/` e `.htaccess` para `public_html/`.
2. **Não** envie `sql/`, `docs/`, `README.md` ou credenciais privadas para o diretório público.
3. Certifique-se de que HTTPS está ativo.
4. Cadastre o domínio no Supabase Auth.
5. Abra `https://dominio.com/?estabelecimento=slug`.

## N8n — tarefas obrigatórias

1. A cada 6 horas: renovar token Clickmassa e salvar na tabela `integration_secrets` (e atualizar `integration_status`).
2. Sincronizar AVEC (clientes, serviços, agendamentos) e Clickmassa (canais, templates, variáveis) em tabelas correspondentes.
3. Executar scheduler de automações, respeitar critérios, consentimento, limites e idempotência.
4. Consumir `message_jobs` com status `queued`, buscar credenciais por estabelecimento e enviar pela API real.
5. Atualizar status de mensagens, histórico e logs.
6. Para produção, implementar fila/claim atômico, tentativas seguras e política de retenção conforme LGPD.

Leia `docs/CONTRATO_N8N.md` antes de montar os fluxos. Os workflows n8n **não estão incluídos**, pois faltam contratos de API e regras finais de negócio.

## Observações

- O mapeamento de variáveis fica em JSON porque ainda não há contrato de campos da API.
- O painel limita tabelas a 500/1000 registros para não carregar indefinidamente; implemente busca/relatórios server-side para volumes grandes.
- O `postMessage` não autentica o ticket. Apenas apresenta informações recebidas de origens autorizadas.
- Para uso em iframe, configure os headers CSP / `frame-ancestors` adequados no proxy, sempre restringindo ao CRM real. Evite bloqueio por `X-Frame-Options: DENY`.
- Arquivos de configuração de exemplo não devem ser usados para produção sem preenchimento.
