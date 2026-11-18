# FlowSuite v3 — Contrato proposto de API central n8n

> **Estado:** contrato de implementação, NÃO endpoints já publicados. Sem a documentação Clickmassa/Proton CRM e respostas de teste AVEC, envios devem permanecer desligados.

## Premissas de arquitetura

- Browser: Supabase Auth (anon key pública + JWT de usuário) e queries RLS para ler suas próprias configurações.
- n8n: PostgreSQL privado (credencial no n8n), token AVEC e Clickmassa lidos SOMENTE por workflow autenticado e autorizado.
- Webhook externo: validar JWT por consulta `GET {SUPABASE_URL}/auth/v1/user` usando Bearer do solicitante; NUNCA aceitar `establishment_id` como autorização suficiente. Conferir associação do `user.id` ao estabelecimento no banco; papel e status ativo.
- Executar todas as mutações sensíveis pelo backend, usando parâmetros SQL e idempotência por evento de negócio.
- Nunca devolver token de integração, `service_role`, URL interna, nem corpo completo dos relatórios brutos.

## Contratos HTTP a criar no n8n (propostas)

| Método | Rota | Acesso | Payload mínimo | Retorno sem segredos |
|---|---|---|---|---|
| GET | `/webhook/flowsuite/v1/health` | Público; sem dados internos | — | `{status:"ok"}` |
| POST | `/webhook/flowsuite/v1/integrations/avec/test` | Master | `{establishment_id}` | `{ok,checked_at,reason?}` |
| POST | `/webhook/flowsuite/v1/sync/avec` | Master/manager | `{establishment_id,report_code}` | `{run_id,queued:true}` |
| POST | `/webhook/flowsuite/v1/sync/clickmassa` | Master/manager | `{establishment_id}` | `{run_id,queued:true}` |
| GET | `/webhook/flowsuite/v1/customers/history` | Membro autenticado | Query `establishment_id`, `customer_id` | Histórico paginado e mínimo necessário |
| POST | `/webhook/flowsuite/v1/messages/preview` | Manager/operator | `{establishment_id,channel_id,template_id,customer_ids}` | Mapeamento de variáveis sem envio |
| POST | `/webhook/flowsuite/v1/messages/enqueue` | Manager/operator | `{establishment_id,channel_id,template_id,customer_ids,idempotency_key}` | `{queued,skipped}` |
| GET | `/webhook/flowsuite/v1/jobs` | Membro autenticado | `establishment_id`, `page`, `limit` | Status paginado |
| POST | `/webhook/flowsuite/v1/automations/run` | Master/manager | `{establishment_id,automation_id,dry_run:true}` | `{eligible,blocked,preview}` |
| POST | `/webhook/flowsuite/v1/ticket/lookup` | Membro autenticado | `{establishment_id,ticket_id}` | Resumo após cruzamento confiável no servidor |

**Não exponha** webhook do n8n diretamente com validação feita apenas por API-key compartilhada em `config.js`. A origem de postMessage também não autentica o usuário.

## Sequência de autenticação por webhook

1. Receber HTTPS, `Authorization: Bearer <JWT do usuário>`.
2. Chamar Supabase Auth `/auth/v1/user`, autenticando o JWT do usuário. Recusar `401` se inválido/expirado.
3. Ler o usuário retornado por Auth; consultar associação `memberships` ao `establishment_id` pelo Postgres **com query parametrizada**. Master permitido somente após consulta ao campo `profiles.master_admin` no servidor.
4. Para operações de escrita, exigir `owner`/`manager`; para envio manual, permitir `operator` quando aplicável. Não aceitar `role` enviado pelo navegador.
5. Registrar `request_id`, hora, usuário, tenant, operação e status **sem tokens e sem PII em texto livre**.
6. Responder sem credenciais; usar códigos 400/401/403/409/422/429/500 conforme o caso.

## Integração AVEC — comprovado na coleção

Host documentado da coleção: variável `basehost`; a implementação v2 usa `https://api.avec.beauty`, a confirmar no ambiente real. `GET /reports/{code}` com header `Authorization: <token>`, `page` a partir de 1 e `limit` máximo 250. `HasMore` informa novas páginas; `Result` contém linhas e `RequiredParams` os filtros necessários.

**Não copie literalmente** expressões `date('d/m/Y')` dos exemplos: substitua por datas calculadas e confirme o formato retornado.

| Automação | Relatórios | Validação ainda necessária |
|---|---|---|
| CSAT | 0031 / 0008 / 0004 | Identificador de evento concluído e telefone |
| Inativos | 0107 / 0004 / 0051 | Consulta futura e opt-in |
| Pós-serviço | 0031 / 0038 / 0248 | Status exato e janela de atraso |
| Retorno | 0020 / 0320 | Retorno configurado, atrasos e reserva futura |
| Aniversário | 0001 / 0004 | Formato de nascimento e consentimento |
| Cross-sell | 0005 / 0008 / 0033 | Serviços fonte/alvo, evitando ofertas já consumidas |
| Histórico | 0002 / 0008 / 0031 / 0051 | ID estável do cliente, vinculação ao ticket |
| Estoque | 0046 / 0149 | Código do produto e mínimo, deduplicação |
| Chegada | 0248 | Confirmar existência de check-in; não ativar ainda |

## Rotinas n8n finais (a desenvolver após amostras reais)

- `Cron 15 min → selecionar estabelecimento e automações ativas → relatório AVEC paginado → normalizar e identificar evento → verificar consentimento, elegibilidade, intervalo, fuso horário → INSERT ... ON CONFLICT DO NOTHING em message_jobs`.
- `Worker 1 min → claim atômico por SKIP LOCKED → buscar credenciais do tenant e canal/template → enviar pelo endpoint REAL Clickmassa → atualizar status com ID externo, tentativas limitadas, backoff e dead-letter`.
- `Cron 6 h → renovar credencial Clickmassa pelo mecanismo real → gravar novo token no Supabase sem devolver valor ao frontend`.
- `Webhook de delivery → validar autenticidade, atualizar message_jobs de forma idempotente`.
- `Sincronização de cadastros → upsert por (establishment_id,external_id), só campos necessários, não habilitar marketing_opt_in automaticamente`.

### Importante sobre envios

Não foi fornecida a documentação dos endpoints Clickmassa (listagem de canais/templates, variáveis, envio, status e renovação). Portanto **nenhum dos workflows incluídos envia mensagens**. Não é seguro inventar URL, body ou requisitos de autenticação.

## Política operacional

- Filtrar tenant em toda query; impedir referências cruzadas a entidades de outro tenant.
- Segredos exclusivamente em credenciais do n8n, banco sob acesso restrito e conexões HTTPS; rotacionar e auditar. Evitar salvar dados de execução completos no n8n.
- Proteger n8n em rede privada quando possível; aplicar HTTPS, limites de taxa e logs sanitizados.
- Armazenamento de tokens no `integration_secrets` no PostgreSQL **não equivale, sozinho, a criptografia por coluna**. Planejar Vault ou criptografia de aplicação com chave fora do banco.
- Consentimento e opt-out são critérios de envio. Sem base legítima de contato, não disparar campanhas.
- Retentativas exigem controle de status para não gerar envio duplicado; reconciliar mensagens de status incerto antes de reenviar.
