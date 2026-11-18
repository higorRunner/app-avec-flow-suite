# Referência histórica da integração n8n

O FlowSuite atual usa o seu próprio serviço de processamento. As instruções de instalação estão no [README](../README.md). Este arquivo registra a proposta anterior de contratos para n8n.

O painel **não chama diretamente APIs do AVEC/Clickmassa** e **não contém service_role**.
Os dados retornados das APIs devem ser sincronizados pelo n8n com as tabelas Supabase.

## 1. Credenciais

- `integration_secrets.establishment_id`: UUID do estabelecimento.
- `integration_secrets.avec_token`: token AVEC.
- `integration_secrets.clickmassa_token`: token Clickmassa atualizado pelo n8n a cada 6h.
- `integration_secrets.clickmassa_url`: URL da instância Clickmassa.
- Não existe `apiId`.
- O n8n, com credenciais de servidor (Supabase service_role), busca por `establishment_id`. **Não envie segredos para o navegador.**
- Exija HTTPS e proteja o painel n8n; nunca guarde credenciais em logs.

## 2. Sincronização necessária

- AVEC -> `services` (`external_id`, `name`, `default_return_days` preservado), `customers` (`external_id`, `marketing_opt_in` conforme base legal real), `appointments`.
- Clickmassa -> `channels` (`external_id`, `name`, `type`: `waba` ou `whatsapp`), `templates` (`external_id`, `name`, `body`, `variables`, `status`).
- Atualize `integration_status.last_avec_sync` e `last_clickmassa_sync` ao concluir.
- Registre logs resumidos em `integration_logs`.
- Use UPSERT com UNIQUE `(establishment_id, external_id)` e conserve valores configurados no painel.
- A existência do catálogo **não garante** que o endpoint externo suporte envio; precisa ser testado.

## 3. Mensagens manuais

O painel cria registros `message_jobs` com:

```json
{
  "establishment_id": "UUID",
  "source": "manual",
  "status": "queued",
  "customer_id": "UUID",
  "channel_id": "UUID",
  "template_id": "UUID",
  "payload": {"service_id": null, "requested_by": "UUID", "variable_mapping": {"1": "customer.name"}},
  "idempotency_key": "manual:UUID:UUID"
}
```

O fluxo deve:
1. Buscar jobs elegíveis (`queued` e `scheduled_for <= now()`), **com reserva atômica** ou worker único para impedir concorrência.
2. Conferir estabelecimento ativo, consentimento atual, opt-out, horário permitido e validade do template/canal.
3. Carregar tokens do Supabase via service_role no próprio n8n.
4. Converter `variable_mapping` / dados do cliente em variáveis reais conforme API Clickmassa.
5. Efetuar requisição usando a URL e o token privados. **O formato HTTP definitivo depende da API que ainda será enviada.**
6. Atualizar `status`, `sent_at`, `external_message_id`, `attempts`, `error_message`.
7. Para timeout após envio, reconciliar pelo ID externo antes de tentar novamente.

## 4. Automações

Cada linha `automations` representa uma regra independente e contém:
- `type`: `csat`, `inactive`, `post_service`, `return`, `birthday`, `cross_sell`, `stock`, `arrival`.
- `channel_id`, `template_id`, `variable_mapping`.
- `delay_days`, `send_time`, `rules.service_ids`, `rules.cooldown_days`, `rules.date_basis`.
- `rules.cross_sell_target_service_id`, `rules.min_stock`, `rules.recipient_phone` conforme módulo.

Seu scheduler n8n precisa implementar a semântica de cada gatilho:
- `csat`: X dias após conclusão.
- `inactive`: X dias desde evento configurado e sem próximos agendamentos.
- `post_service`: X dias após atendimento concluído.
- `return`: `services.default_return_days` após serviço concluído (fallback `delay_days`).
- `birthday`: data de nascimento (com política para 29/02 e fuso horário).
- `cross_sell`: recomendar serviço relacionado, sem duplicar oferta recentemente aceita.
- `stock`: disparar por evento real de estoque zerado/abaixo do limite.
- `arrival`: disparar por evento real de check-in.

Para eventos automáticos, produza chave de idempotência estável, por exemplo `auto:{automation_id}:{customer_id}:{appointment_id}:{YYYY-MM-DD}` e faça UPSERT para não gerar duplicações.

## 5. Eventos do CRM no iframe

Exemplo **ilustrativo** de postMessage aceito pelo frontend:

```js
iframe.contentWindow.postMessage({
  origin: 'https://crm.seudominio.com',
  ticket: {id: 123, contact: {id: 456, phone: '+5584999999999'}}
}, 'https://seusistema.com');
```

Configure `allowedParentOrigins` com a origem exata real. O código valida `event.origin` e `event.source` e usa o ticket só para exibir contexto. A identidade do ticket **não é confiável apenas por postMessage**: qualquer ação sensível deverá consultar o ticket com autenticação pelo servidor.

## 6. Endpoints ainda necessários

Para integrar sem adivinhar: autenticação AVEC, clientes, serviços, agendamentos/conclusão/check-in, estoque, canais, templates/variáveis, envio Clickmassa, consulta de status e webhooks (se existirem).

Não declare automações prontas para disparar antes de implementar e testar os fluxos n8n acima.
