# Auditoria e checklist de segurança — FlowSuite v3

## Sobre o token visível em Network

- `anon` e `publishable`: são chaves **públicas**, destinadas ao browser, acompanhadas de RLS.
- JWT `access_token`: é necessário em aplicações SPA que usam Supabase Auth diretamente. Pode ser inspecionado pelo próprio usuário no DevTools; trate como credencial sensível de sessão. Não o coloque em URL, analytics ou log.
- `service_role`, `AVEC_TOKEN`, `CLICKMASSA_TOKEN`: **jamais** no frontend, em resposta de `/rest/v1/` ou em `config.js`. Se aparecerem, é uma vulnerabilidade.
- O `localStorage` da SPA mantém a sessão para sobreviver ao refresh. Isso aumenta o risco caso exista XSS. Para eliminar token acessível ao JavaScript, é necessária mudança arquitetural para **backend-for-frontend (BFF)** com cookie `HttpOnly`, `Secure`, `SameSite` apropriado, proteção CSRF e sessão no servidor. A v3 **não implementa BFF**.

## Revisão efetuada no código

- Não foi encontrado SELECT browser direto de `integration_secrets`. A tabela base desabilita RLS e não concede política SELECT; o arquivo 003 reforça REVOKE.
- O método de atualização de credenciais transmite o novo valor no corpo HTTPS quando o master salva, e não devolve o segredo. Isso é esperado ao cadastrar um token manualmente.
- A migração verifica vínculos de clientes, canais, modelos e automações. Na fila manual, o banco exige estabelecimento ativo, consentimento vigente, telefone preenchido e, quando há filtro, atendimento concluído para o serviço.
- Nginx e Apache declaram CSP com as origens do Supabase e do CRM configurados em `config.js`. Atualize os cabeçalhos se essas origens mudarem.
- Conteúdo recebido via postMessage é verificado por `event.origin` + `event.source`, mas **não autentica o cliente do ticket**; ações sensíveis exigem servidor.
- A tela não deve afirmar “Ambiente seguro” sem validação de auditoria. v3 substitui o rótulo por “Conectado”.
- Chave pública do Supabase no `config.js` deve ser **regenerada se ainda for de demonstração**. Nunca publicar chaves service role.

## A fazer para produção

1. Migrar credenciais AVEC/Clickmassa para cofre/criptografia por coluna; rotacionar segredos expostos.
2. Revisar permissões `GRANT` efetivas e funções SECURITY DEFINER no banco real; executar testes como usuário de outra unidade.
3. BFF + cookie HttpOnly para reduzir exposição de JWT à execução JavaScript (decisão de arquitetura).
4. Validar a CSP no domínio de homologação, incluindo abertura dentro do CRM autorizado.
5. Avaliar hospedagem local com verificação de integridade do `supabase-js`, cuja versão está fixada no HTML.
6. Aplicar rate limiting, auditoria de login, MFA para master, backup/restore do PostgreSQL, alertas e política de retenção LGPD.
7. Verificar que RLS nega SELECT em `integration_secrets` com chave pública e JWT de operador (teste negativo).
8. Configurar CORS e cookies de acordo com a origem específica do CRM; nunca usar `'*'` para `postMessage`.

## Teste manual de isolamento

1. Criar estabelecimentos A e B e usuários A/B com membership isolada.
2. JWT do usuário A não deve retornar linhas de B em `customers`, `jobs`, `automations`, `channels`, `templates`.
3. JWT A não pode consultar `integration_secrets` nem via URL REST.
4. Tentativa de criar `message_jobs` de A usando `channel_id` ou `customer_id` de B deve falhar com violação de vínculo.
5. Usuário não-master não deve conseguir executar `update_integration_credentials` nem `create_establishment`.
6. Uma origem não autorizada em `postMessage` não deve alterar o contexto do ticket.
