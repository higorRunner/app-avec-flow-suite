# FlowSuite v3 — UX, Segurança e kit n8n

Versão evolutiva **baseada na v2**. Arquivos estáticos para o EasyPanel, módulo de catálogo AVEC e 3 workflows n8n de diagnóstico **sem envio de mensagens**.

## O que mudou

- Dashboard com assistente de implantação contextual: AVEC, Clickmassa, canais, templates e clientes.
- Interface responsiva com menu para celular, formulários por tipo de automação, seleção dos campos do modelo e prévia da mensagem.
- Envio manual com busca paginada por nome ou telefone, filtro por serviço concluído e seleção de até 100 clientes por lote.
- Histórico consultado ao abrir o cliente, com datas no fuso do estabelecimento. O catálogo AVEC carrega quando a tela é acessada.
- Substituído o indicador de segurança absoluto por indicador de sessão conectada.
- Verificação no navegador para canal e template ativos do estabelecimento em envio manual.
- SQL `003_v3_hardening.sql`: valida vínculos entre unidades, editor de regras, consentimento, canal, modelo e histórico dos destinatários. Restringe o acesso a segredos e relatórios brutos.
- Docs de API n8n completa em formato de contratos (propostos, não endpoints já ativos), checklist de segurança e workflows para testar consultas reais.

## Como instalar

Para abrir no VS Code, execute na raiz:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Acesse `http://localhost:8080`. O painel usa o Supabase definido em `config.js`. Use uma configuração de homologação para fazer testes de gravação. O servidor simples é para desenvolvimento local. O Dockerfile serve a aplicação na raiz do domínio via Nginx na porta 80.

1. Faça backup do banco e aplique `sql/003_v3_hardening.sql` em homologação, após o schema `001`. O SQL pode ser reaplicado.
2. No `config.js`, configure a URL e a chave **pública** do Supabase, além das origens autorizadas do CRM. Alinhe `connect-src` e `frame-ancestors` no `nginx.conf` sempre que trocar esses domínios. Para Apache, ajuste também o `.htaccess` e habilite `mod_rewrite` e `mod_headers`.
3. Para testar integrações, importe os workflows da pasta `n8n/` em **Workflows → Import from File**. Configure a conexão PostgreSQL e o estabelecimento no próprio n8n. Esses workflows são de diagnóstico e chegam desativados.
4. Valide permissões, dados e fluxos em homologação antes de publicar a imagem no EasyPanel.

## Testes

```powershell
node --test --test-isolation=none tests/*.test.mjs
```

O teste de interface usa Playwright e um Supabase simulado. Com Playwright instalado, execute `python tests/browser_smoke.py`. Defina `FLOWSUITE_TEST_BROWSER` com o caminho para o Edge ou Chromium local se preferir usar um navegador já instalado.

## Arquivos centrais

- `docs/API_N8N_CONTRATOS.md` — rotas propostas, autenticação e lógica das 9 funcionalidades.
- `docs/SEGURANCA_AUDITORIA.md` — interpretação do token em Network, limites atuais e controles de produção.
- `sql/003_v3_hardening.sql` — constraints de tenant e tabela privada de relatórios brutos.
- `n8n/01-avec-teste-manual.json` — consulta 1 página, não envia mensagens.
- `n8n/02-fila-auditoria-dry-run.json` — consulta fila a cada 15 minutos, somente leitura.
- `n8n/03-estoque-consulta-dry-run.json` — diagnóstico estoque da primeira página; **não** dispara alertas.
- `integrations/avec-client.mjs` e seus testes — cliente HTTP de relatórios fornecido na v2.

## Limitações e segurança

Ainda não temos exemplos de resposta AVEC nem documentação do envio Clickmassa. Este pacote **não é um sistema com automações disparando em produção**. Também não há acesso administrativo ao n8n do usuário para teste integrado de credenciais e execução de workflows.

Os workflows dependem da versão dos nodes instalados no seu n8n. Importe e valide manualmente os campos e credenciais antes de ativar.
