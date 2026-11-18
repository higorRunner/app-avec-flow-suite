# FlowSuite

Painel web, banco Supabase e serviço de processamento do próprio FlowSuite no EasyPanel. O navegador autentica no Supabase. O serviço privado sincroniza o catálogo e consome a fila de mensagens.

## Instalação no EasyPanel

1. Aplique as migrações `004_native_worker.sql`, `005_integration_setup.sql` e `006_native_automations.sql` nessa ordem, após `003_v3_hardening.sql`. A migração 005 usa a extensão Supabase Vault. Em uma instalação nova comece por `001_schema.sql` e configure o administrador.
2. No serviço web, selecione a fonte GitHub, branch `main`, Build Path `/`, builder `Dockerfile` e porta 80. Acompanhe o deployment até concluir e abra `/version.txt` no domínio web. O campo `git` deve corresponder ao commit da implantação. Se o commit for anterior ao esperado, confira a fonte e a revisão nos logs da implantação do serviço web.
3. Crie um segundo serviço App privado no mesmo projeto EasyPanel, no mesmo repositório e branch. Use o builder Dockerfile, caminho `Dockerfile.worker` e Build Path `/`. O processo roda em segundo plano, sem domínio ou porta pública. Atualize o serviço web e o privado a partir da mesma revisão.
4. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `FLOWSUITE_ESTABLISHMENT_ID` nas variáveis privadas do serviço. O UUID está no cartão da unidade no **Painel master**. Uma instância do serviço atende uma unidade.
5. Abra `/?admin=1`, entre com um administrador master, crie ou selecione a unidade e abra **Integrações**. Salve o token AVEC e o login do Clickmassa. Aguarde a sincronização dos canais ou use **Atualizar status** para conferir o resultado. Selecione cada canal que pode enviar, salve a URL externa sem parâmetros, o token do mesmo canal e marque **Liberar envios neste canal** quando estiver pronto para o teste.

A senha Clickmassa é usada para obter a sessão de catálogo. A sessão é obtida de novo a cada sincronização. O token de envio permanece separado para cada canal e só é trocado ao cadastrar uma nova credencial. O Supabase Vault guarda o token AVEC, a senha e as credenciais de envio, e o painel apresenta apenas o estado de configuração. [Supabase Vault](https://supabase.com/docs/guides/database/vault)

O processo registra `serviço iniciado para a unidade` ao iniciar. A conexão com o Supabase atualiza o sinal de atividade independentemente da sincronização do catálogo. Nos logs do serviço privado, uma unidade ausente ou inativa indica que é preciso conferir o UUID. Falhas de RPC incluem o nome da função, o status HTTP e o código de erro recebido do Supabase, quando disponível.

A configuração da V4 por variáveis funciona como fallback até que a primeira conta de catálogo seja salva no painel. Depois de migrar, remova `CLICKMASSA_EMAIL`, `CLICKMASSA_PASSWORD`, `CLICKMASSA_TENANT_ID` e as credenciais dos canais das variáveis do serviço. A opção `FLOWSUITE_SEND_ENABLED=false` pausa todos os envios do serviço quando configurada. Remova essa opção para o painel controlar a liberação de cada canal. Caso o login exija CAPTCHA ou MFA, use uma conta ou credencial de integração autorizada pelo Clickmassa.

Para coletar amostras AVEC, configure opcionalmente `AVEC_SNAPSHOT_CODES` com códigos separados por vírgula, como `0004`. Use relatórios que não exijam parâmetros adicionais.

## Administração e operação

- **Painel master** reúne criação e ativação de unidades, cópia do link da equipe, configuração de integrações e atribuição de acessos.
- **Área operacional** abre pelo link da unidade. Os perfis permanecem separados para leitura, operação e gestão das regras.
- **Catálogos e serviços** mostra os canais conectados, os canais prontos para envio e os modelos filtráveis pelo canal. Confira a hora da última sincronização.
- **Envio de teste** aceita um único número com DDI. Use um telefone da equipe com autorização. Escolha um canal, preencha o texto ou os campos de exemplo do modelo e confira o protocolo em **Relatórios e envios**. O modo de teste funciona antes da importação de clientes. Em **Automações → Simular**, o painel calcula a elegibilidade sem criar mensagens.

### Envio e confirmação

- O canal **Oficial (WABA)** lista os modelos textuais aprovados daquele canal. O identificador usado para enviar é `hsmId`. O FlowSuite monta `params` na ordem das posições do texto. Modelos com mídia ou parâmetros adicionais de cabeçalho ou botões são exibidos no catálogo como pendentes de validação.
- O canal **QR Code** usa texto e uma nota interna opcional. Use a URL e o token emitidos para aquele canal. A classificação segue o tipo `whatsapp` do catálogo e precisa ser confirmada com a conta de homologação.
- O Supabase reserva cada item da fila antes de enviar e confere novamente a elegibilidade do destinatário. O protocolo do FlowSuite é enviado como `externalKey`. Uma resposta `pending` aparece como **Aguardando confirmação** e o protocolo do Clickmassa fica em **Relatórios e envios**. Confirme resultados inconclusivos no Clickmassa pelo protocolo antes de refazer um envio. A consulta automática de confirmação depende do contrato de status ou de webhook do fornecedor.
- O serviço avalia as regras ativas a cada minuto. Pesquisa de satisfação, pós-atendimento, retorno, venda complementar, aniversário e inatividade usam os dados já normalizados no Supabase. As regras respeitam fuso, horário, consentimento, intervalo entre mensagens e controle de duplicidade.
- Regras marcadas como **Revisar ativação** exigem ativação explícita. A execução considera eventos cujo horário de envio é posterior à ativação. Estoque e chegada permanecem como rascunhos até confirmar as respectivas fontes de eventos.

### AVEC

Cadastre o token da unidade em **Painel master → Integrações**. Quando `AVEC_SNAPSHOT_CODES` estiver definido, o serviço coleta a primeira página dos relatórios configurados a cada hora e armazena a resposta em `avec_report_snapshots`, acessível ao servidor. A conversão desses relatórios em clientes, serviços, agendamentos e eventos de automação depende de respostas AVEC representativas. O catálogo de relatórios descreve os parâmetros conhecidos. No painel master, **Testar AVEC** consulta o relatório 0004 e mostra quantos registros retornaram na primeira página.

## Desenvolvimento

Execute na raiz:

```powershell
python -m http.server 8080 --bind 127.0.0.1
node --test --test-isolation=none tests/*.test.mjs
```

Abra `http://localhost:8080`. Para executar o serviço de processamento fora do Docker, use Node.js e as mesmas variáveis em um ambiente de homologação, com `node worker/service.mjs`. Com Playwright instalado, `python tests/browser_smoke.py` exercita o painel com Supabase simulado. A variável `FLOWSUITE_TEST_BROWSER` permite usar um Chromium ou Edge já instalado.

Após publicar o serviço web pelo Dockerfile, consulte `/version.txt` para conferir o commit e a versão dos arquivos da implantação.
