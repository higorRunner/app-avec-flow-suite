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

## Entrega na branch de modernização

- `public/` contém o bootstrap de login, a aplicação autenticada, as primitivas visuais, o contrato de automações, o seletor e o compositor de relatórios. O login importa a aplicação autenticada após a sessão. O seletor carrega o diálogo ao abrir.
- `server/` mantém a autenticação, as rotas, a fila e os serviços de AVEC, avisos, pesquisa e relatórios. `server/providers/` reúne os adaptadores e a política HTTP de saída.
- `sql/` mantém o esquema e as migrações aditivas. Esta entrega dispensa migração. `tests/` mantém as suítes e os benchmarks. `docs/` descreve o [design system](DESIGN_SYSTEM.md) e a [configuração compartilhada](AUTOMACOES.md).
- Foram centralizados tipos e estados de rotinas, validação de mapeamento por contexto, confirmação de ações, paginação e prévia da conversa. Formulários que já compartilhavam o seletor continuam usando o mesmo diálogo.
- A interface agora indica quando o modelo selecionado precisa de revisão após a mudança de contexto. O seletor restaura o foco, retira os controles da navegação durante o fechamento e adapta o formulário a telas pequenas. A pesquisa de satisfação valida o link individual. O QR Code mostra o texto livre no padrão de conversa.
- A atualização do histórico consulta apenas os envios. A consulta geral reduz dados de integração e resolve as leituras independentes em uma única etapa. O processamento indexa atendimentos e histórico da fila antes de avaliar os contatos.
- Nenhum arquivo versionado foi removido. Os arquivos de teste têm referências no script do pacote ou na documentação. `.test-deps/` contém caches e artefatos locais ignorados pelo Git.

## Medições locais

Medições de 23 de novembro de 2026 com Node.js 24, PGlite e Lighthouse 13.6.0 em Chrome headless. O benchmark de operação usa 100 mensagens e a versão anterior `3d2f18f`. O benchmark de candidatos usa a implementação existente no início do trabalho, `8b4fef6`, com 3.000 contatos, 9.000 atendimentos e 4.500 envios. Ambas as implementações retornaram os mesmos 1.500 candidatos.

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| Avaliar uma rotina, mediana de 15 execuções | 274,96 ms | 46,42 ms |
| Atualizar histórico, leituras da rota com perfil master | 13 | 2 |
| Atualizar histórico, JSON | 50.457 bytes | 17.701 bytes |
| Operação completa, leituras da rota com perfil master | 13 | 11 |
| Logo WebP | 481.804 bytes | 36.126 bytes |
| Login móvel, transferência medida pelo Lighthouse | 595.875 bytes | 77.001 bytes |
| Login móvel, Lighthouse Performance | 86 | 100 |
| Login móvel, Lighthouse Accessibility | 100 | 100 |
| Login móvel, LCP | 4,21 s | 1,46 s |
| Login móvel, CLS | 0 | 0 |

As medições do navegador representam o login local em uma rodada por versão. INP requer interações ou dados de campo. As métricas autenticadas, a memória sob carga prolongada e os resultados de produção continuam sem confirmação.

Para comparar a fila, instale as dependências em ambos os checkouts e rode `node tests/report-performance.mjs CAMINHO_ANTERIOR data` e `node tests/report-performance.mjs . jobs`. Para comparar a rotina, exporte `server/routines.mjs` do commit `8b4fef6` para um arquivo local e passe o caminho a `node tests/routine-performance.mjs`. O script valida a igualdade das saídas antes de apresentar a comparação.

## Segurança e dependências externas

- A API usa a sessão, o vínculo com a unidade e o perfil para decidir o acesso. A projeção da operação exclui identificadores externos de canais e modelos, telefone e e-mail da lista auxiliar de contatos e telefones dos profissionais. A configuração de avisos continua acessível ao gestor. O histórico de envios exclui o conteúdo da mensagem e os campos usados para preenchê-la.
- A lista de destinatários e o envio manual exigem consentimento e ausência de bloqueio. A regressão de isolamento cobre histórico, operação geral, acesso às configurações e tentativa de escrita por perfil de consulta.
- A suíte verifica revogação dos papéis públicos do Supabase no esquema, cookies HttpOnly, rejeição de origem externa nas escritas, sigilo dos diagnósticos, criptografia, isolamento de unidades e deduplicação. Os testes HTTP e de navegador usam integrações simuladas e o banco local.
- A auditoria do checkout cobre AVEC e Clickmassa. A configuração efetiva de TLS, proxy, limites distribuídos de login, credenciais, eventuais fluxos n8n e permissões Meta fica fora do que o repositório local consegue comprovar. A confirmação de entrega final pelo provedor continua dependendo de seu contrato e de validação em homologação.

## Validação e limites

| Verificação | Resultado |
| --- | --- |
| `npm test` | 24 testes aprovados |
| `node --check` | 33 módulos aprovados |
| TypeScript em modo `checkJs` | Contratos de mensagem e automação aprovados |
| ESLint com regras básicas de duplicidade, código inalcançável e variáveis sem uso | Código público, servidor e testes aprovados |
| Playwright com Chrome e dados simulados | Fluxo completo aprovado, incluindo administração master, envio, avisos, relatórios, rotinas, CSAT e pesquisa pública |
| axe | Zero violações nas páginas de login, painel, configurações, relatórios e avaliação e no seletor de modelos |
| Regressão visual do balão | A imagem da prévia foi idêntica ao reabrir a seleção. A suíte verificou overflow e salvou capturas de desktop e mobile |
| Build de produção | A aplicação roda diretamente no Node.js, sem bundler. A imagem do Docker não foi construída porque o daemon não estava disponível |

A verificação de teclado cobriu foco de entrada e saída dos diálogos e Escape. O seletor foi verificado em 360, 768, 1024 e 1440 px. Uma auditoria manual completa com tecnologias assistivas e uma matriz de navegadores permanecem pendentes.

Para executar o projeto, use Node.js 24 ou superior, configure as variáveis privadas conforme `.env.example` e inicie com `npm start`. Para validar os fluxos com banco isolado e integrações simuladas, rode `npm install`, `npm test` e siga a configuração do Playwright no [README](../README.md#desenvolvimento-e-testes).
