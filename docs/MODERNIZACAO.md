# Modernização do FlowSuite

## Auditoria inicial

O produto usa Node.js 24 sem bundler, HTML renderizado por módulos ES no navegador, PostgreSQL via API privada do Supabase e um executor de fila no mesmo processo HTTP. Os conectores versionados são AVEC e Clickmassa. O canal Oficial chega ao WhatsApp pelo Clickmassa. O checkout não contém configuração de n8n ou integração direta com a Meta.

- `public/app.js` concentra operações, renderização, navegação e eventos. `report-composer.js` já isola a revisão de relatórios, mas mantém seu próprio seletor e seus campos. O fluxo manual compartilha parte da renderização com as rotinas. Os avisos usam um terceiro caminho.
- `server/application.mjs` verifica sessão, vínculo e papel e usa `deliveryConfig` para verificar canal, modelo e unidade. As listas de variáveis são replicadas na interface e em três fluxos da API.
- A consulta de operação agrega 11 leituras de dados depois da autorização. A atualização dos relatórios carrega essa resposta inteira para redesenhar apenas a tabela da fila. As linhas da fila incluem o payload de entrega, que a tabela não usa.
- O CSS tem primitivas reutilizáveis de formulário, cartão e tabela, com regras posteriores que voltam a definir parte do tema. A pesquisa CSAT pública tem uma folha independente.
- Os SQL versionados definem índices, vínculos compostos por unidade, RLS, revogações de acesso e migrações aditivas. Os scripts da pasta ignorada `.test-deps` são auxiliares locais anteriores. Os comandos oficiais usam `tests/` e a dependência de desenvolvimento PGlite.
- A linha de base da suíte Node tem 22 testes aprovados. O servidor E2E usa PostgreSQL local e conectores simulados.

## Plano

1. Unificar seleção, mapeamento, exemplos e validação de mensagens aprovadas. Manter os contratos HTTP, as permissões e as etapas de revisão de cada fluxo.
2. Refinar o sistema visual e a navegação. Verificar diálogos, preview e relatórios em desktop e mobile.
3. Reduzir as leituras da atualização de envios e os dados de entrega retornados ao navegador. Acrescentar regressões de isolamento, papéis e mapeamento.
4. Executar as verificações locais e registrar métricas comparáveis e dependências externas que limitam a aceitação.
