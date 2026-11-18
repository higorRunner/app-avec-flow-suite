# FlowSuite

Painel web, banco Supabase e serviço de processamento do próprio FlowSuite no EasyPanel. O navegador autentica no Supabase. O serviço privado sincroniza o catálogo e consome a fila de mensagens.

## Instalação no EasyPanel

1. Aplique `sql/004_native_worker.sql` depois de `sql/003_v3_hardening.sql`. Em instalação nova, aplique primeiro `001_schema.sql` e configure o administrador.
2. No serviço web atual, mantenha o builder `Dockerfile`, o caminho de build `/` e a porta 80. O arquivo `config.js` contém a URL, a chave pública do Supabase e as origens do CRM. Se trocar esses domínios, atualize também a CSP em `nginx.conf` e, se usar Apache, em `.htaccess`.
3. Crie um **segundo serviço App** no mesmo projeto EasyPanel, a partir deste mesmo repositório. Use o builder Dockerfile com caminho **`Dockerfile.worker`** e Build Path `/`. Esse serviço executa em segundo plano e funciona sem domínio ou porta pública.
4. Configure as variáveis privadas do serviço de processamento conforme a tabela abaixo. Inicie com `FLOWSUITE_SEND_ENABLED=false` para conferir o catálogo. Após conferir o código e o tipo dos canais e configurar as credenciais de envio, use `true` para liberar um teste com destinatário autorizado. Comece com um serviço por estabelecimento.

| Variável no serviço privado | Valor |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS do mesmo Supabase usado pelo painel |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave privada `service_role` do Supabase |
| `FLOWSUITE_ESTABLISHMENT_ID` | UUID da unidade, exibido em **Configurações** no FlowSuite |
| `CLICKMASSA_TENANT_ID` | ID numérico da empresa na resposta do login do Clickmassa |
| `CLICKMASSA_EMAIL` e `CLICKMASSA_PASSWORD` | Conta Clickmassa autorizada a listar canais e modelos |
| `CLICKMASSA_SEND_URL_<ID>` | URL HTTPS da API externa de envio daquele canal, sem parâmetros de URL. Substitua `<ID>` pelo código de canal em **Catálogos e serviços** |
| `CLICKMASSA_SEND_TOKEN_<ID>` | Token da API externa para o mesmo canal; configure um par URL/token para cada canal que pode enviar |
| `FLOWSUITE_SEND_ENABLED` | `true` libera o processamento da fila e os canais com credencial correspondente |
| `AVEC_SNAPSHOT_CODES` | Opcional. Lista separada por vírgula de relatórios AVEC sem parâmetros adicionais obrigatórios, por exemplo `0004` |

O serviço de processamento faz a primeira sincronização ao iniciar e repete a cada 15 minutos. Consulte os logs do serviço e a data de sincronização no painel. O endpoint de login observado aceita e-mail e senha no formato capturado. Se a conta exigir CAPTCHA ou MFA nessa chamada, use uma credencial de integração autorizada pelo fornecedor.

### Envio e confirmação

- O canal **Oficial (WABA)** lista os modelos textuais aprovados daquele canal. O identificador usado para enviar é `hsmId`. O FlowSuite monta `params` na ordem das posições do texto. Modelos com mídia ou parâmetros adicionais de cabeçalho ou botões são exibidos no catálogo como pendentes de validação.
- O canal **QR Code** usa texto e uma nota interna opcional. Use a URL e o token emitidos para aquele canal. A classificação segue o tipo `whatsapp` do catálogo e precisa ser confirmada com a conta de homologação.
- O Supabase reserva cada item da fila antes de enviar e confere novamente a elegibilidade do destinatário. O protocolo do FlowSuite é enviado como `externalKey`. Uma resposta `pending` aparece como **Aguardando confirmação** e o protocolo do Clickmassa fica em **Relatórios e envios**. Confirme resultados inconclusivos no Clickmassa pelo protocolo antes de refazer um envio. A consulta automática de confirmação depende do contrato de status ou de webhook do fornecedor.
- O serviço processa envios manuais criados pelo painel atualizado. Itens antigos da fila e regras salvas devem ser revisados antes de uma eventual migração para disparo automático.

### AVEC

Cadastre o token da unidade em **Painel master → Credenciais**. Quando `AVEC_SNAPSHOT_CODES` estiver definido, o serviço coleta a primeira página dos relatórios configurados a cada hora e armazena a resposta em `avec_report_snapshots`, acessível ao servidor. A conversão desses relatórios em clientes, serviços, agendamentos e eventos de automação depende de respostas AVEC representativas. O catálogo de relatórios descreve os parâmetros conhecidos.

## Desenvolvimento

Execute na raiz:

```powershell
python -m http.server 8080 --bind 127.0.0.1
node --test --test-isolation=none tests/*.test.mjs
```

Abra `http://localhost:8080`. Para executar o serviço de processamento fora do Docker, use Node.js e as mesmas variáveis em um ambiente de homologação, com `node worker/service.mjs`. Com Playwright instalado, `python tests/browser_smoke.py` exercita o painel com Supabase simulado. A variável `FLOWSUITE_TEST_BROWSER` permite usar um Chromium ou Edge já instalado.

Após publicar o serviço web pelo Dockerfile, consulte `/version.txt` para conferir o commit e a versão dos arquivos da implantação.
