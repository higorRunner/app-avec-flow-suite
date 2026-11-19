# FlowSuite

Site, API e execução das rotinas rodam no mesmo processo Node.js. O Supabase fornece o banco PostgreSQL e a API privada de acesso ao banco.

## Atualizar a instalação existente

1. No SQL Editor do Supabase, execute **[sql/ATUALIZAR_INTEGRACAO_AVEC.sql](sql/ATUALIZAR_INTEGRACAO_AVEC.sql)**. É uma atualização aditiva, repetível, que preserva contas, unidades, credenciais e configurações. Não execute o script de reinicialização para atualizar.
2. Nas variáveis privadas do FlowSuite no EasyPanel, configure **PUBLIC_ORIGIN** com a URL pública HTTPS do próprio FlowSuite, sem caminho (por exemplo, https://app-avec-flow-suite.sizrit.easypanel.host). Esse endereço gera os links individuais de avaliação CSAT.
3. Envie todas as alterações para o repositório e faça Deploy. A versão publicada aparece em /health e no diagnóstico master.
4. No painel master, confira o token AVEC e as credenciais Clickmassa. Abra a operação da unidade e vá a **Configurações**. Habilite a sincronização AVEC, escolha a frequência e o período de histórico e salve. Tokens de franquia podem informar o ID da unidade AVEC.
5. Em **Clientes**, revise a autorização de contato. Clientes sem telefone continuam no histórico; complete o número antes de enviar. As importações preservam a autorização existente e novos clientes começam sem autorização.
6. Em **Configurações**, revise os prazos de retorno de cada serviço e cadastre os telefones dos profissionais que autorizam receber avisos. Escolha canal, modelos aprovados e os campos dos avisos de chegada e estoque. Habilite somente os avisos desejados.
7. Em **Automações**, crie as regras e simule antes de ativar. Para CSAT, use intervalo de um dia e inclua a opção **Link individual da pesquisa de satisfação** em um parâmetro do modelo aprovado. Os clientes respondem por um formulário próprio, com nota de 1 a 5 e comentário. O painel **Satisfação** mostra as últimas 500 pesquisas geradas e suas respostas; notas 4 e 5 são consideradas satisfeitas.

O teste real das 230 consultas está documentado em **[docs/AVEC_ENDPOINTS.md](docs/AVEC_ENDPOINTS.md)**. O explorador em **Relatórios** permite escolher a consulta e preencher filtros sem editar JSON. Profissionais e serviços importados aparecem como seleções nos filtros correspondentes. Consultas financeiras completas exigem perfil gestor ou master.

## Dados AVEC e funcionamento das rotinas

A sincronização consulta os relatórios 0004 (clientes), 0033 (serviços e retorno), 0229 (profissionais), 0155 (agenda com ID real, horário e estado), 0186 (itens de comandas finalizadas) e 0046 (produtos abaixo do mínimo). A frequência padrão é de 15 minutos, configurável entre 5 minutos e uma hora pela interface. O histórico padrão é de 90 dias e a agenda futura de 30 dias. Amplie o histórico para abranger os intervalos desejados das regras.

O sistema atualiza os registros pelos IDs AVEC, conserva consentimentos e permite substituir o prazo de retorno de um serviço localmente. Datas de nascimento sem ano são preservadas apenas como dia e mês, sem inventar a idade. A conclusão depende da data real de finalização da comanda; um horário planejado passado não é considerado serviço concluído. A mesma visita pode aparecer como agendamento e como item da comanda no histórico. CSAT e pós-atendimento usam os itens efetivamente finalizados.

Pós-atendimento e CSAT consideram a data de conclusão e os dias configurados, no horário da unidade. A rotina recupera execuções perdidas desde sua ativação. Retorno usa o prazo médio do serviço; inatividade considera a última conclusão e a ausência de agenda futura; venda complementar permite selecionar serviço de origem e serviço oferecido. Aniversário usa a data de nascimento. Retorno e inatividade incluem clientes cujo prazo já venceu, com controle de intervalo e evento para impedir repetição. Agendamentos futuros e cancelamentos são revalidados antes do envio. Todas as rotinas de clientes exigem telefone e autorização.

O aviso de chegada observa o estado **Aguardando** registrado na agenda AVEC, após a ativação do aviso. A chegada precisa ser marcada pela equipe na AVEC. Os avisos são enviados após a próxima sincronização; a coleção contém relatórios GET, sem webhook de eventos. Estoque usa o mínimo configurado na AVEC e possui intervalo entre avisos. Profissionais precisam ter telefone e avisos habilitados no FlowSuite, pois o relatório AVEC não fornece seus telefones. Alterar configurações, cancelar o atendimento ou repor o produto invalida os avisos ainda na fila.

Falhas de sincronização ficam visíveis no diagnóstico e adiam envios automáticos até a próxima consulta válida. Nenhuma chamada grava dados na AVEC. A fila e as avaliações ficam no Supabase; a execução ocorre no próprio serviço FlowSuite.

## Reinstalar

1. Exporte um backup dos dados atuais e pare o antigo serviço executor, se ele tiver sido criado.
2. No SQL Editor do seu Supabase, execute **[sql/RECRIAR_FLOWSUITE.sql](sql/RECRIAR_FLOWSUITE.sql)** e depois **[sql/ATUALIZAR_INTEGRACAO_AVEC.sql](sql/ATUALIZAR_INTEGRACAO_AVEC.sql)**. O primeiro arquivo apaga as tabelas e funções das versões do FlowSuite; o segundo instala os recursos AVEC e CSAT. Os dados e as contas do FlowSuite serão apagados somente pelo primeiro script. A infraestrutura de autenticação, armazenamento e extensões do Supabase continua disponível.
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
2. Cadastre a **URL base da API Clickmassa**, o e-mail e a senha e clique em **Salvar e importar catálogo**. O servidor acrescenta as rotas de login, canais e modelos à base cadastrada. A empresa é identificada pelo retorno do login. Canais e modelos são importados e o estado aparece na mesma página.
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

Em **Painel master → Integrações → Diagnóstico das integrações**, acompanhe a versão publicada, a URL consultada, a etapa, o status HTTP e a estrutura reconhecida da resposta. O painel atualiza a cada cinco segundos e permite copiar o diagnóstico. O log AVEC mostra o caminho do relatório, a quantidade de registros e a paginação. Senhas, tokens, valores da resposta e dados dos clientes não entram nesses registros. Os diagnósticos são exclusivos do master, ficam por sete dias no banco e aparecem também nos logs do serviço. A tela consulta as últimas 100 etapas. A estrutura existente de fs_events é suficiente; esta melhoria não exige reset nem novo SQL.

A URL base aceita HTTPS e um endereço público, incluindo um prefixo de caminho quando necessário. As contas já cadastradas mantêm a API anterior como padrão até você alterá-la. Trocar a URL base desativa a liberação dos canais, pausa as regras e ignora os itens ainda na fila dessa unidade para revisão. Configure novamente o envio dos canais antes de reativar as rotinas.

O ID numérico do canal identifica o canal retornado pelo catálogo e é conferido com o campo sessionId do token externo. O envio usa a URL externa completa cadastrada para esse canal, dentro da mesma base da API. O UUID da rota externa precisa ser fornecido pelo Clickmassa.

O painel master permite validar o token pelo relatório 0004 e configurar campos de importação manual, se necessário. A sincronização completa da operação reconhece automaticamente os contratos de clientes, serviços, agenda, histórico, profissionais e estoque validados nesta coleção.

As rotinas disponíveis são pós-atendimento, satisfação, retorno, aniversário, inatividade e venda complementar. O serviço avalia as regras a cada minuto e processa a fila a cada cinco segundos. Usa os dados da unidade, fuso horário, autorização, intervalo entre mensagens e chave de evento para evitar duplicidade. Simulações respeitam o horário configurado e não criam mensagens. Após o horário configurado, a regra avalia os eventos elegíveis a cada minuto e recupera execuções perdidas desde sua ativação. Aniversários de 29/02 usam o próprio dia em anos bissextos.

Modelos WABA com mídia ou parâmetros especiais de cabeçalho e botões precisam de contrato de envio adicional. Respostas inconclusivas ficam reservadas para conferência pelo protocolo, pois o comportamento de idempotência e a consulta de status do fornecedor ainda precisam ser comprovados.

## Desenvolvimento e testes

Use Node.js 24 ou superior. O servidor de produção usa módulos nativos e inicia diretamente com **node server/main.mjs**. Para HTTP local, configure COOKIE_SECURE=false e acesse http://localhost:3000. Essa variável deve ficar ausente no domínio HTTPS de produção.

Para instalar as ferramentas de desenvolvimento, execute **npm install**. Para rodar os testes, execute **npm test**.

Os testes usam PostgreSQL local em WebAssembly e respostas Clickmassa simuladas. Eles verificam o reset SQL, permissões, criptografia, sessões, isolamento entre unidades, importação de catálogo e fila de envio. A validação de integração com contas e telefones reais é feita pelo envio de teste no painel.
