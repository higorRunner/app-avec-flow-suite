# AVEC — integração v2 (baseada na coleção fornecida)

## Escopo verificado

- A coleção `AVEC - Relatórios unidades.postman_collection.json` contém 230 operações GET de relatórios. A origem é `https://api.avec.beauty`; o token é enviado em `Authorization` (valor sem prefixo Bearer na coleção).
- O limite máximo de `limit` é 250. Paginamos por `page`, até `HasMore=false`; interrompemos com erro quando não há estrutura de resposta reconhecível.
- A coleção **não traz responses de exemplo**. Os nomes de campos reais (cliente, telefone, atendimento etc.) **não estão comprovados**, então esta versão não grava clientes no banco nem habilita envio de mensagens automaticamente.
- Os parâmetros de data apresentados na coleção são pseudoexpressões, não valores literais para enviar. Usar `DD/MM/AAAA` efetivo e confirmar formato com chamada autenticada.

## Mapa relevante

| Módulo | Relatórios | O que falta validar |
| --- | --- | --- |
| CSAT | 0031, 0008, 0004 | data/status real da conclusão e identidade do cliente |
| Inativos | 0107, 0004 | significado exato de `dias`, agendamentos futuros |
| Pós-serviço | 0031, 0038, 0248 | idempotência do evento e estados possíveis |
| Retorno | 0020, 0320 | prazo recomendado e último atendimento por cliente |
| Aniversário | 0001, 0004 | formato de nascimento e filtro diário |
| Venda complementar | 0005, 0008, 0033 | IDs de categoria, clientes elegíveis |
| Histórico no plugin | 0002, 0008, 0031, 0248 | vinculação por telefone e histórico individual |
| Estoque | 0046 | ID do produto, quantidade atual, estoque mínimo |
| Chegada | 0248 | **não confirma check-in/chegada**, não automatizar sem outra API |

## Teste real, somente em servidor de confiança

No n8n ou máquina de desenvolvimento com Node.js 20+, configure `AVEC_TOKEN` como variável de ambiente **fora do repositório** e execute:

```sh
node integrations/avec-cli.mjs 0107 dias=30
node integrations/avec-cli.mjs 0004
node integrations/avec-cli.mjs 0046
```

Por padrão, a CLI imprime apenas quantidade de páginas, registros e nomes dos campos do primeiro registro, sem nomes/telefones de clientes. O limite de páginas é 10 (`AVEC_MAX_PAGES`, até 100). Nunca execute essa CLI no navegador e não copie tokens para o `config.js`.

### Backend/n8n

1. Um workflow autenticado recebe `establishment_id` do FlowSuite ou do agendador.
2. Autoriza esse estabelecimento no banco; uma identidade de servidor lê `integration_secrets.avec_token`. O navegador não deve ter permissão de leitura de segredos.
3. O fluxo obtém o código e filtros permitidos para a automação (não aceite URL arbitrária do usuário), consulta o relatório e percorre `HasMore`.
4. Depois de validar os **campos reais da resposta**, normaliza dados para `customers`, `services` e `appointments` e faz upserts associados ao estabelecimento.
5. Verifica consentimento, supressão, evento concluído, duplicidade e cooldown. Somente então cria job com `idempotency_key` determinístico.
6. Outro fluxo lê `message_jobs` e envia via Clickmassa: **a coleção AVEC não documenta essa API**; precisamos da documentação Clickmassa antes de implementá-lo.
7. Atualiza status e logs. Em caso de resposta desconhecida, falhar fechado (não enviar).

## Testes efetuados nesta entrega

- 230 itens estruturados a partir da coleção; cada item possui código, nome, parâmetros e descrição.
- `node --test tests/avec-client.test.mjs` — testes de paginação, header, formato de datas, bloqueio de host, limites, erro sem vazamento do token e prevenção de paginação parcial.
- `node --check assets/js/app.js` — validação de sintaxe JS.
- `python tests/browser_smoke.py` — teste funcional da tela de catálogos com dados simulados (sem Supabase real).

## Limitações e próximos testes reais

- Não executamos chamadas AVEC reais, pois não recebemos token de teste do estabelecimento. Não houve login em Supabase de produção e não executamos SQL remotamente.
- Não testamos envio Clickmassa; endpoints e templates ainda não foram enviados.
- Não podemos garantir o formato `Data.Result` até receber um exemplo de resposta. O cliente tenta também `Result` e `data.result`, mas nunca inventa dados.
- Relatório de status não confirma evento de chegada.
