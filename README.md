# FlowSuite

Site, API e execução das rotinas rodam no mesmo processo Node.js. O Supabase fornece o banco PostgreSQL e a API privada de acesso ao banco.

## Reinstalar

1. Exporte um backup dos dados atuais e pare o antigo serviço executor, se ele tiver sido criado.
2. No SQL Editor do seu Supabase, execute **[sql/RECRIAR_FLOWSUITE.sql](sql/RECRIAR_FLOWSUITE.sql)**. Esse arquivo apaga as tabelas e funções das versões do FlowSuite e cria toda a estrutura desta versão em uma transação. Os dados e as contas do FlowSuite serão apagados. A infraestrutura de autenticação, armazenamento e extensões do Supabase continua disponível. O script pode ser executado novamente para outro reset.
3. No serviço web atual do EasyPanel, use o repositório deste projeto, branch **main**, Build Path **/** e builder **Dockerfile** com caminho **Dockerfile**.
4. Configure as variáveis abaixo nas variáveis privadas desse mesmo serviço.
5. No domínio do serviço, altere a porta de destino para **3000** e faça **Deploy**.
6. Abra o site em HTTPS e entre com o e-mail e a senha iniciais. Defina sua senha pessoal no primeiro acesso.

| Variável | Conteúdo |
| --- | --- |
| SUPABASE_URL | URL HTTPS da API do seu Supabase |
| SUPABASE_SERVICE_ROLE_KEY | Chave privada service_role dessa instalação Supabase |
| ADMIN_EMAIL | E-mail do primeiro administrador master |
| ADMIN_PASSWORD | Senha inicial, com pelo menos 10 caracteres |

Na instalação própria do Supabase, a chave privada costuma estar nas variáveis do serviço ou Compose do Supabase como SERVICE_ROLE_KEY ou SUPABASE_SERVICE_KEY. Copie esse valor para SUPABASE_SERVICE_ROLE_KEY do FlowSuite. A chave permanece exclusivamente no servidor.

Depois do primeiro cadastro, as variáveis ADMIN_EMAIL e ADMIN_PASSWORD podem ser removidas. A aplicação cria o administrador somente quando o banco está sem uma conta master. O endereço **/health** confirma a conexão com o banco e mostra o commit implantado.

As credenciais de integração são criptografadas com AES-256-GCM. O servidor usa APP_SECRET, quando configurada, ou a chave privada do Supabase como material de criptografia. Mantenha esse valor estável. Ao trocá-lo, recadastre as credenciais no painel master.

## Primeiro uso

1. No painel master, crie a unidade e abra **Integrações**.
2. Cadastre e-mail e senha Clickmassa e clique em **Salvar e importar catálogo**. A empresa é identificada pelo retorno do login. Canais e modelos são importados e o estado aparece na mesma página.
3. Em **Canais de envio**, configure a URL da API externa e o token emitido para cada canal. Uma URL contendo o parâmetro token pode ser colada diretamente. O token será extraído e enviado pelo servidor no header de autorização.
4. Marque **Liberar envios neste canal** e abra a operação da unidade.
5. Em **Envios → Envio de teste**, informe um telefone da equipe que autorizou o teste, selecione o canal e revise o conteúdo. No Oficial, use um modelo textual aprovado. No QR Code, preencha a mensagem e, se desejar, uma nota interna.
6. Em **Relatórios**, confira o protocolo. **Aceita pelo Clickmassa** confirma que a API recebeu a mensagem. Consulte o atendimento do Clickmassa para confirmar a entrega.
7. Cadastre os clientes e a autorização de contato. Em **Serviços e agenda**, registre serviços e atendimentos concluídos. Crie uma automação, simule a elegibilidade e ative a regra no horário desejado.
8. No painel master, conceda acesso aos usuários da equipe e copie o link da unidade.

## Perfis

- **Master** cria unidades, configura credenciais, concede acesso e pode abrir a operação.
- **Gestor** administra clientes, agenda, envios e rotinas da unidade.
- **Operador** administra clientes, agenda e envios.
- **Consulta** visualiza os dados da unidade.

O login do FlowSuite é próprio. As senhas são armazenadas com scrypt e salt individual. As sessões usam cookies HttpOnly com validade de oito horas. O acesso aos dados passa pela API do servidor, que verifica o vínculo com a unidade e o perfil antes de consultar o banco. Os papéis públicos do Supabase ficam sem acesso às tabelas da aplicação.

## Conexões e rotinas

O catálogo Clickmassa sincroniza ao salvar a conta e a cada 15 minutos. Salvar uma credencial mantém a senha antiga quando o campo fica vazio. A senha de catálogo e o token externo de envio são independentes.

O relatório AVEC 0004 pode ser consultado no painel master. Após uma resposta válida, selecione as colunas de nome e telefone para importar os clientes. E-mail e nascimento são opcionais. A importação mantém o consentimento já cadastrado e deixa novos clientes sem autorização até revisão individual. As datas de nascimento importadas devem usar AAAA-MM-DD. As demais rotas AVEC e a importação de serviços e agenda exigem contratos de resposta validados. Serviços e atendimentos já podem ser cadastrados no próprio FlowSuite.

As rotinas disponíveis são pós-atendimento, satisfação, retorno, aniversário, inatividade e venda complementar. O serviço avalia as regras a cada minuto e processa a fila a cada cinco segundos. Usa os dados da unidade, fuso horário, autorização, intervalo entre mensagens e chave de evento para evitar duplicidade. Simulações respeitam o horário configurado e não criam mensagens. Ativar uma regra depois do horário diário inicia a execução no próximo evento elegível. Aniversários de 29/02 usam o próprio dia em anos bissextos.

Modelos WABA com mídia ou parâmetros especiais de cabeçalho e botões precisam de contrato de envio adicional. Respostas inconclusivas ficam reservadas para conferência pelo protocolo, pois o comportamento de idempotência e a consulta de status do fornecedor ainda precisam ser comprovados.

## Desenvolvimento e testes

Use Node.js 24 ou superior. O servidor de produção usa módulos nativos e inicia diretamente com **node server/main.mjs**. Para HTTP local, configure COOKIE_SECURE=false e acesse http://localhost:3000. Essa variável deve ficar ausente no domínio HTTPS de produção.

Para instalar as ferramentas de desenvolvimento, execute **npm install**. Para rodar os testes, execute **npm test**.

Os testes usam PostgreSQL local em WebAssembly e respostas Clickmassa simuladas. Eles verificam o reset SQL, permissões, criptografia, sessões, isolamento entre unidades, importação de catálogo e fila de envio. A validação de integração com contas e telefones reais é feita pelo envio de teste no painel.
