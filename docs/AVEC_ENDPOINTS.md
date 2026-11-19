# Auditoria da coleção AVEC

Verificação real em 18/11/2026 da coleção **AVEC - Relatórios unidades** fornecida pelo usuário. Foram consultadas as 230 rotas GET, com o token fornecido somente no header Authorization, sem Bearer. Nenhuma alteração, envio de mensagem ou operação financeira foi executada.

O teste inicial usou página 1, limite 1 e período de 19/10/2026 a 18/11/2026. Consultas de confirmação de agenda usaram até 10 registros. Filtros de seleção vazios foram incluídos quando exigidos pela API. Não foram percorridas todas as páginas neste inventário. Uma resposta vazia valida o contrato, sem demonstrar presença de dados naquele período.

Resultado final: **223 respostas HTTP 200 e 7 respostas HTTP 400**. Dessas 223, **222 continham um relatório com result reconhecido**. A rota 0149 respondeu HTTP 200 com erro interno HY093 dentro de data.report, sem result. As rotas 0048, 0101, 0110, 0130 e 0150 retornaram report not found. As rotas 0011 e 0050 continuaram com HTTP 400 após incluir o parâmetro salao_id exigido pelo retorno. Não houve HTTP 401 ou 403 nesta auditoria.

## Contratos úteis ao FlowSuite

| Necessidade | Relatório validado | Campos e cuidados |
| --- | --- | --- |
| Clientes e aniversários | 0004 | id é o identificador local do cliente; cliente_id é outro identificador. nome, celular, telefone, email, aniversario. Importar sem substituir consentimento já cadastrado. |
| Serviços e retorno médio | 0033 | id, servico, retorno, status, categoria. retorno é número de dias (observado 30), configurável por serviço no FlowSuite. |
| Agenda sincronizada | 0155 | id estável, salao_cliente_id, servico_id, data YYYY-MM-DD, hora_ini em minutos desde meia-noite, apelido e status textual. Usar os IDs para atualizar, em vez de duplicar. O retorno inclui cancelamentos; filtrar e persistir o estado. |
| Agenda com contato | 0051 | salao_cliente_id, celular, servico, apelido, data, hora_ini, status. Exige site= e profissional_id= mesmo vazios. profissional_id=0 não equivale a todos e retornou lista vazia. |
| Atendimentos concluídos e histórico | 0186 | idItem, idComanda, reserva_id, salao_cliente_id, tipo, tipo_id, data_finalizada. Usar itens de tipo Serviço, data_finalizada válida e idItem estável. Não deduzir conclusão apenas da data agendada. Datas completas vêm como YYYY-MM-DD HH:mm:ss, sem timezone explícito; interpretar no fuso da unidade. |
| Retorno recomendado já calculado | 0320 e 0020 | salao_cliente_id, servico_id, ultima_visita, retorno, retorno_sugerido. Útil para conferir a regra calculada localmente. 0020 exige servico_id= presente mesmo vazio. |
| Chegada e andamento | 0155 e 0248 | 0248 documenta Agendado=1, Confirmado=1.5, Aguardando=2, Em Atendimento=3, Finalizado=3.5, Pago=4, Cancelado=0 e Faltou=0.6. 0155 permite acompanhar transições por ID. Aguardar ou confirmar não deve ser tratado como chegada sem definir com a unidade qual estado corresponde ao check-in. |
| Estoque abaixo do mínimo | 0046 | nome, marca, atual, estoque_minimo, diferenca. Não devolve ID do produto. Evitar alertas repetidos e informar quando houver nomes ambíguos. |
| Profissionais | 0229 | id, nome, apelido, cargo. Não devolveu telefone de contato. Cadastrar destinatário do profissional no FlowSuite. |
| Avaliações existentes no AVEC | 0224 e 0324 | Retornos agregados por profissional; 0224 expõe apelido, total e media. Não oferecem, neste contrato, resposta individual de CSAT associada a um atendimento. A pesquisa própria precisa de link de avaliação e armazenamento no FlowSuite. |

## Regras de integração

- O JSON direto da API é um objeto em data.report; o n8n normalmente exibe os itens dentro de uma lista. result e hasMore usam inicial minúscula no retorno observado.
- Parâmetros vazios fazem diferença: omitir uma chave exigida pode retornar HTTP 400, enquanto enviar chave= retorna o relatório corretamente.
- A API é de relatórios GET. O FlowSuite deve sincronizar e guardar configurações, cursores, regras e resultados no seu banco. A coleção não fornece um webhook de chegada nem um POST para registrar CSAT.
- Não enviar avisos históricos de chegada no primeiro carregamento: estabelecer a situação inicial e avisar somente nas novas transições após a ativação.
- Novos clientes devem preservar a política de autorização de contato. Disponibilidade de celular no relatório não demonstra consentimento.
- Os valores dos registros consultados e os tokens não fazem parte deste documento. O inventário lista apenas nomes de campos e o resultado técnico das consultas.

## Inventário das 230 rotas

Os parâmetros abaixo são nomes; filtros de profissionais, categorias e serviços dependem dos cadastros da própria unidade. HTTP 400 não significa credencial inválida.

| Código | Relatório | HTTP final | Resultado | Parâmetros além de page e limit | Campos observados |
| --- | --- | --- | --- | --- | --- |
| 0001 | Clientes aniversariantes | 200 | Relatório reconhecido | inicio, fim | DATE_FORMAT(datanasc, '%m%d'), datanasc, nome, email, telefone, celular, email_mkt, sms_mkt |
| 0002 | Clientes atendidos | 200 | Relatório reconhecido | inicio, fim, como_conheceu | nome, celular, email, todas_os_profissionais, total_visitas, total_faturado, ultima_visita |
| 0003 | Como clientes nos conheceram no período | 200 | Relatório reconhecido | inicio, fim | como_conheceu, qtd_clientes, percentual |
| 0004 | Lista de dados de todos os clientes | 200 | Relatório reconhecido | — | id, codigo, cliente_id, nome, email, cidade, salao_cliente_id_origem, aniversario, telefone, celular, sexo, cpf, endereco, numero, cep, datacad, bairro, como_conheceu, obs, estado, profissao, complemento, rg |
| 0005 | Clientes que fizeram um serviço de alguma categoria de serviços e não de outra | 200 | Válido, sem linhas no período | inicio, fim, categoria_id, categoria_nao_id | — |
| 0006 | Clientes com crédito e/ou débito | 200 | Relatório reconhecido | tipo | nome, valor, email, celular, ultima, email_mkt, sms_mkt, importacao_id |
| 0007 | Taxa de retorno dos clientes do estabelecimento | 200 | Válido, sem linhas no período | inicio1, fim1, inicio2, fim2 | — |
| 0008 | Clientes que fizeram um serviço em específico | 200 | Relatório reconhecido | inicio, fim, servico_id, profissional_id | nome, telefone, celular, email, data, email_mkt, sms_mkt, qtd_visitas, visitas, total_em_servicos |
| 0009 | Clientes classificados por faixa etária | 200 | Relatório reconhecido | — | tipo, total |
| 0010 | Clientes com celulares duplicados | 200 | Relatório reconhecido | — | clientes, celular |
| 0011 | Taxa de retorno dos clientes do profissional | 400 | Revisão do fornecedor/filtros | inicio1, fim1, inicio2, fim2, profissional_id, salao_id | — |
| 0012 | Clientes cadastrados no período | 200 | Relatório reconhecido | inicio, fim | id, salao_id, cliente_id, codigo, estrelas, dinheiro, favorito, cliente, recomendacao, datarec, nome, nome_social, email, foto, datanasc, telefone, celular, operadora, rg, cpf, profissao, como_conheceu, sexo, endereco, numero, bairro, cod_cidade, cidade, estado, obs, cep, apelido, email_mkt, sms_mkt, emissao_nota, whatsapp_mkt, facebook_id, datacad, UA, agendamento_online, complemento, responsavel, responsavel_ua, importacao_id, ddi_celular, ddi_telefone, data_primeira_comanda, data_ultima_comanda, salao_cliente_id_origem, aceita_atendimento_ia, aceita_comunicacao_whatsapp, consentimento_avecia, foto_existe, celular_whatsapp |
| 0013 | Clientes com crédito e/ou débito por período | 200 | Relatório reconhecido | inicio, fim | data, nome, valor, descricao, responsavel |
| 0014 | Clientes que não informaram dados básicos | 200 | Relatório reconhecido | inicio, fim | nome, telefone, email, datanasc, endereco, numero, bairro, cidade, estado, cep |
| 0015 | Clientes classificados por perfil de compra | 200 | Relatório reconhecido | inicio, fim | nome, telefone, email, total_servicos, total_produtos, total, tipo_consumo |
| 0016 | Clientes por bairro | 200 | Relatório reconhecido | — | bairro, total |
| 0017 | Clientes novos que fizeram serviço no período | 200 | Relatório reconhecido | inicio, fim | nome, telefone, celular, email, primeira_visita, valor_faturado, como_conheceu, email_mkt, sms_mkt |
| 0018 | Clientes com e-mails duplicados | 200 | Válido, sem linhas no período | — | — |
| 0019 | Clientes cadastrados por "Como conheceu" no período | 200 | Relatório reconhecido | inicio, fim, como_conheceu | como_conheceu, nome, celular, telefone, email, email_mkt, sms_mkt, datacad, ultima_visita |
| 0020 | Clientes que fizeram serviço com retorno recomendado e não retornaram | 200 | Relatório reconhecido | servico_id | salao_cliente_id, servico_id, cliente_id, nome, telefone, celular, email, ultima_visita, retorno, servico, email_mkt, sms_mkt, data, retorno_sugerido, dias_ultrapassados_do_sugerido |
| 0021 | Faturamento, nº de comandas e ticket médio por profissional no período | 200 | Relatório reconhecido | inicio, fim, tipo | nome, total_servicos, faturamento, comandaQtd, mediaFaturamento |
| 0022 | Profissional e as comissões dos seus assistentes por período (comissionamento antigo) | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0023 | Profissionais e caixinhas recebidas por período | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0024 | Serviços por profissional | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0025 | Profissionais por serviço | 200 | Válido, sem linhas no período | inicio, fim, servico_id | — |
| 0026 | Profissionais e desconto de produtos no período | 200 | Relatório reconhecido | inicio, fim, profissional_id | nome_profissional, data, quantidade, motivo, titulo, tipo_saida, nome, marca, valor, numero, respPC, respSE |
| 0027 | Profissionais e os clientes atendidos por período | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0028 | Todas as comissões pagas no período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0029 | Todos os descontos para um profissional no período | 200 | Relatório reconhecido | inicio, fim, profissional_id | data, titulo, valor, categoria, comanda |
| 0030 | Itens que não geraram comissão | 200 | Relatório reconhecido | inicio, fim | data, numero, apelido, item, valor_cobrado, comissao_item, comissao_cadastrada |
| 0031 | Serviços realizados no período | 200 | Relatório reconhecido | inicio, fim | valor_total, valor, desconto, categoria, quantidade, tipo_id, profissional, dayname, idComanda, data, numero, item, nome, cpf, telefone, celular, endereco, numeroEndereco, estado, cidade, bairro, comissaoPercentual, comandaId, servicoId, clienteId, profissionalId, itemId, pacote |
| 0032 | Serviços mais vendidos | 200 | Relatório reconhecido | inicio, fim | id, servico, categoria, faturamento, quantidade, valor_sessao |
| 0033 | Tabela de preços dos serviços | 200 | Relatório reconhecido | — | id, codigo_interno, categoria_id, categoria_mkt_id, salao_id, servico, descricao, retorno, pontuacao, salao_fidelidade_id, tempo, valor, comissao, apartir, tipo_valor, ordem, status, custo, agendamento_paralelo, agendamento_online, item_lista_servico, tributo_municipio, iss_aliquota, tributo_cliente_servico, descritivo_servico, cnae, datacad, UA, responsavel, responsavel_ua, nivel_paralelo, importacao_id, franquia_id, pontuacao_troca, enviar_lista_automatica, folga_reserva, atendimento_em_casa, bloqueado, logo, jwt_cliente, pontos_assinatura, categoria |
| 0034 | Total faturado pelas categorias de serviços | 200 | Relatório reconhecido | inicio, fim | categoria, total, atendimentos, servicos, comissao, media, rateio |
| 0036 | Serviços/Produtos com descontos | 200 | Válido, sem linhas no período | inicio, fim, tipo | — |
| 0037 | Vendas de produtos por marca | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0038 | Diferença entre serviços agendados e realizados no período | 200 | Relatório reconhecido | inicio, fim | data, nome, servicos_reservados, num_reservas, servicos_comanda, num_comandas |
| 0039 | Clientes por gênero | 200 | Relatório reconhecido | sexo | id, salao_id, cliente_id, codigo, estrelas, dinheiro, favorito, cliente, recomendacao, datarec, nome, nome_social, email, foto, datanasc, telefone, celular, operadora, rg, cpf, profissao, como_conheceu, sexo, endereco, numero, bairro, cod_cidade, cidade, estado, obs, cep, apelido, email_mkt, sms_mkt, emissao_nota, whatsapp_mkt, facebook_id, datacad, UA, agendamento_online, complemento, responsavel, responsavel_ua, importacao_id, ddi_celular, ddi_telefone, data_primeira_comanda, data_ultima_comanda, salao_cliente_id_origem, aceita_atendimento_ia, aceita_comunicacao_whatsapp, consentimento_avecia |
| 0040 | Comandas alteradas no período | 200 | Relatório reconhecido | inicio, fim, apos_finalizacao | numero, data, nome, responsavel, responsavel_ua, datacad, UA, status |
| 0041 | Produtos vendidos | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0042 | Produtos mais vendidos | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0043 | Valores dos produtos | 200 | Relatório reconhecido | — | nome, marca, valor, valor_profissional, uso_interno, custo |
| 0044 | Produtos com entradas e saídas, por motivos | 200 | Relatório reconhecido | inicio, fim | id, comanda_id, comanda_item_id, datacad, data, qtd_absoluta, codigo_interno, nome, produto_id, quantidade, motivo, responsavel, validade, custo |
| 0045 | Produtos no estoque, com custo total | 200 | Relatório reconhecido | tipo_produto | codigo_interno, nome, marca, linha, valor, categoria, custo, medida, qtd_medida, estoque_atual, atual, custoTotal |
| 0046 | Produtos abaixo do estoque mínimo | 200 | Relatório reconhecido | — | nome, medida, qtd_medida, marca, atual, estoque_minimo, diferenca, consumoMesAnterior, sugestao |
| 0047 | Produtos e seus respectivos lucros | 200 | Relatório reconhecido | — | nome, valor, custo, comissao, margem, lucro |
| 0048 | Produtos com saídas | 400 | Relatório não encontrado | inicio, fim | — |
| 0049 | Produtos com o custo médio | 200 | Relatório reconhecido | inicio, fim | nome, custo, valor, categoria, marca, qtd_medida, medida, custo_medio, estoque_atual, media, custo_total |
| 0050 | Taxa de retorno dos clientes por serviço | 400 | Revisão do fornecedor/filtros | inicio1, fim1, inicio2, fim2, servico_id, salao_id | — |
| 0051 | Clientes com agendamentos | 200 | Relatório reconhecido | inicio, fim, site, profissional_id | salao_cliente_id, data_cadastro, data, hora_ini, cliente_nome, celular, email, cadastro_cliente, servico, apelido, responsavel, responsavel_ua, tipoAgendamento, status, data_comanda, numero, obs |
| 0052 | Clientes com agendamentos cancelados | 200 | Relatório reconhecido | inicio, fim | UA, datacad, responsavel, responsavel_ua, data, cliente_nome, cliente_tel, profissional, obs, valor, servico |
| 0053 | Valor total dos agendamentos | 200 | Relatório reconhecido | inicio, fim | data, hora_ini, cliente_nome, valor, servico |
| 0056 | Agendamentos e o meio pelo qual este foi feito | 200 | Relatório reconhecido | inicio, fim | tipoAgendamento, total |
| 0057 | Clientes que não retornaram ao estabelecimento, comparado ao mês anterior | 200 | Válido, sem linhas no período | inicio1, fim1, inicio2, fim2 | — |
| 0058 | Agendamentos com filtro por serviço | 200 | Válido, sem linhas no período | inicio, fim, servico_id | — |
| 0059 | Clientes com agendamentos que não retornaram ao estabelecimento, comparado ao mês anterior, por prof | 200 | Válido, sem linhas no período | inicio1, fim1, inicio2, fim2, profissional_id | — |
| 0060 | Profissionais com agendamentos | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0061 | Pacotes mais vendidos | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0062 | Pacotes e pré-vendas vendidas | 200 | Relatório reconhecido | inicio, fim | data, numero, nome, cpf, celular, email, apelido, item, quantidade, valor, desconto, total |
| 0063 | Clientes que possuem pacotes ativos | 200 | Relatório reconhecido | — | nome, pacote, servico, id, total, quantidade, validade, comanda_item_id, compra, valor_pacote |
| 0064 | Pacotes utilizados | 200 | Relatório reconhecido | inicio, fim | data, numero, nome, item, quantidade, apelido, valor, pacote, unidadeCompra, dataCompra, numCompra, profCompra |
| 0065 | Pacotes vendidos por profissional | 200 | Relatório reconhecido | inicio, fim, profissional_id | data, numero, nome, pacote, quantidade, valor |
| 0066 | Pacotes utilizados por profissional | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0070 | Auditoria das comissões | 200 | Relatório reconhecido | inicio, fim, tipo, status | data, titulo, valor, nome, datacad, UA, responsavel, responsavel_ua, status |
| 0071 | Integração ZeroPaper | 200 | Relatório reconhecido | inicio, fim | tipo_lancamento, data_pagamento, data_competencia, descricao, valor, categoria, tipo, fornecedor, pago, detalhes, conta_bancaria, numero_documento, forma_pagamento |
| 0072 | Integração ContaAzul | 200 | Relatório reconhecido | inicio, fim | data, data_competencia, descricao, categoria, valor, tipo, centro_custo, fornecedor, observacoes |
| 0073 | Consulta cliente pelo código de importação | 200 | Válido, sem linhas no período | codigo | — |
| 0080 | Auditoria de uma comanda | 200 | Válido, sem linhas no período | inicio, numero | — |
| 0081 | Entradas por formas de pagamento | 200 | Relatório reconhecido | inicio, fim | formaPagamento, faturamento |
| 0082 | Saídas por centro de custos | 200 | Relatório reconhecido | inicio, fim, tipo | tags, total, percentual |
| 0083 | Faturamento e ticket médio por clientes | 200 | Relatório reconhecido | inicio, fim | cliente, celular, email, comandas, faturamento, media |
| 0084 | Ítens das comandas sem profissionais | 200 | Válido, sem linhas no período | inicio, fim, tipo | — |
| 0085 | Evolução do faturamento mensal | 200 | Relatório reconhecido | inicio, fim | faturamento, comandaQtd, mediaFaturamento, dataMesAno |
| 0086 | Emissão de nota fiscal eletrônica | 200 | Relatório reconhecido | inicio, fim, tipo_item | data, numCom, formaPag, total, item, nome, cpf, cep, endereco, numero, bairro, cidade, estado, email, rg |
| 0087 | Vales-presentes vendidos por período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0088 | Faturamento do estabelecimento por dia do mês | 200 | Relatório reconhecido | inicio, fim | faturamento, comandaQtd, mediaFaturamento, data, dataMes, dayname |
| 0089 | Comandas com serviços e/ou produtos | 200 | Relatório reconhecido | inicio, fim | numero, data, situacao |
| 0090 | Comandas deletadas | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0091 | Detalhamento dos caixas do período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0092 | Faturamento por ítens | 200 | Relatório reconhecido | inicio, fim | faturamento, quantidade, quantidade_uso, item |
| 0093 | Itens excluídos de uma comanda | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0094 | Despesas por sub-categorias financeiras | 200 | Relatório reconhecido | inicio, fim, tipo | categoria, total |
| 0095 | Diferença entre Entradas e Saídas e AvecPay | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0096 | AvecConta - Contas de profissionais bloqueadas | 200 | Válido, sem linhas no período | — | — |
| 0097 | Taxas de cartões geradas no período | 200 | Relatório reconhecido | inicio, fim | numero, data, valor, tipo_pagamento, taxa, taxaAntecipacao |
| 0098 | Evolução do faturamento por dias da semana | 200 | Relatório reconhecido | inicio, fim | faturamento, comandaQtd, mediaFaturamento, dayname |
| 0099 | Comandas por tipos de consumo | 200 | Relatório reconhecido | inicio, fim | total_servicos, total_produtos, servicos_e_produtos, total_comandas, total_pacotes, perc_servicos_total, perc_produtos_total, perc_servicos_e_produtos_total, perc_pacotes_total |
| 0100 | Auditoria de comanda, sobre formas de recebimento | 200 | Relatório reconhecido | inicio, fim | titulo, tipo_pagamento, datacad, ua, responsavel, responsavel_ua |
| 0101 | Consumo de SMS | 400 | Relatório não encontrado | inicio, fim | — |
| 0102 | Cortesias dadas no período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0103 | Clientes que não informaram celular | 200 | Relatório reconhecido | — | nome, telefone, celular, email, datacad, responsavel |
| 0104 | Avaliações dos clientes no app | 200 | Relatório reconhecido | inicio, fim | datacad, estrelas, avaliacao, nome, email, celular, data, numero, notas_profissionais |
| 0105 | Clientes deletados | 200 | Relatório reconhecido | inicio, fim | id, nome, email, datanasc, telefone, celular, UA, responsavel_ua |
| 0107 | Clientes que não retornam há dias | 200 | Relatório reconhecido | dias | nome, email_mkt, sms_mkt, email, telefone, celular, ultima_visita, dias_desde_a_ultima_visita |
| 0108 | Lista de Promoções | 200 | Relatório reconhecido | — | id, titulo, desconto, descricao, data_ini, data_fim, semana |
| 0110 | Comanda vinculada por transação | 400 | Relatório não encontrado | zoop_id | — |
| 0111 | Clientes que já fizeram algum agendamento online | 200 | Relatório reconhecido | — | id, salao_id, cliente_id, codigo, estrelas, dinheiro, favorito, cliente, recomendacao, datarec, nome, nome_social, email, foto, datanasc, telefone, celular, operadora, rg, cpf, profissao, como_conheceu, sexo, endereco, numero, bairro, cod_cidade, cidade, estado, obs, cep, apelido, email_mkt, sms_mkt, emissao_nota, whatsapp_mkt, facebook_id, datacad, UA, agendamento_online, complemento, responsavel, responsavel_ua, importacao_id, ddi_celular, ddi_telefone, data_primeira_comanda, data_ultima_comanda, salao_cliente_id_origem, aceita_atendimento_ia, aceita_comunicacao_whatsapp, consentimento_avecia |
| 0112 | Premiações de fidelidade | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0113 | Pontos de fidelidade acumulados por cliente | 200 | Relatório reconhecido | inicio, fim | nome, celular, email, pontosGerados, ultimaPontuacao, saldoAtual |
| 0114 | Clientes que visitaram no período sem cadastro completo | 200 | Relatório reconhecido | inicio, fim | nome, cpf, telefone, email, datanasc, endereco, numero, bairro, cidade, estado, cep, responsavel, data |
| 0115 | Ficha de Anamnese por Cliente | 200 | Relatório reconhecido | idStart | id, salao_cliente_id, nome, numero, data, tipo_ficha, name, campo, comanda_id, salao_anamnese_id, valor, datacad |
| 0116 | Fichas de Prontuário por data | 200 | Relatório reconhecido | inicio, fim | id, salao_cliente_id, nome, numero, data, tipo_ficha, name, campo, comanda_id, salao_anamnese_id, valor, datacad |
| 0120 | Caixinhas recebidas por período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0121 | Profissional e produtos vendidos no período | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0122 | Profissional e custos dos serviços por período | 200 | Relatório reconhecido | inicio, fim, profissional_id | nome, data, numero, item, valor, custo, quantidade |
| 0123 | Profissionais e todas as comissões por período | 200 | Relatório reconhecido | inicio, fim | nome, tipo_contratacao, cargo, banco, agencia, conta, valor_cobrado, rateio_servico, rateio_produtos, rateio_outros, caixinha, descontos, a_pagar, valor_casa |
| 0124 | Profissionais aniversariantes | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0125 | Profissionais e a realização de serviços como assistente por período | 200 | Relatório reconhecido | inicio, fim, profissional_id | numero, data, item, nome, profissional, valor_cobrado |
| 0126 | Profissionais e suas taxas de ocupação no período (Produtividade) | 200 | Relatório reconhecido | inicio, fim, minutos | apelido, cargo, disponivel, trabalhadas, dias_uteis, total_disponivel, ocupacao |
| 0127 | Profissionais e desconto de produtos no período | 200 | Válido, sem linhas no período | inicio, fim, tipo_saida | — |
| 0129 | Clientes atendidos por profissional | 200 | Relatório reconhecido | inicio, fim, profissional_id | nome, datacad, email, telefone, celular, total_visitas, total_faturado, ultima_visita |
| 0130 | Despesas e Receitas excluidas no período | 400 | Relatório não encontrado | inicio, fim | — |
| 0132 | Serviços mais vendidos somando pré-venda | 200 | Relatório reconhecido | inicio, fim, categoria_id | id, servico, categoria, faturamento, quantidade |
| 0137 | Lucratividade dos serviços item a item | 200 | Relatório reconhecido | inicio, fim, custo, tipo_desconto, profissional_id | id, data, comissao, numero, apelido, categoria_id, servico, categoria, faturado, quantidade, custo_servico, custo_comissao, custo_produtos_descontato, custo_produtos, total_custos, total_lucro, percentual_lucro |
| 0141 | Produtos e seus respectivos lucros | 200 | Relatório reconhecido | inicio, fim | nome, categoria, custo, valor_antes, valor, desconto, item_valor, comissao, saidas, lucro, lucro_total, id |
| 0142 | Categorias de produtos, com custos em valor e percentual | 200 | Relatório reconhecido | inicio, fim | categoria, custo, final |
| 0143 | Produtos com informações de nota fiscal | 200 | Relatório reconhecido | — | id, salao_id, nome, descricao, medida, custo_medio, custo, validade_proxima, usa_validade, valor, comissao, vendas, status, categoria, cod_barra, marca, linha, compoem_outros, peso, estoque_minimo, estoque_atual, estoque_pedido_padrao, ncm, codigo_interno, qtd_medida, tamanho, valor_profissional, uso_interno, icms, tributacao, csosn, valor_tributo, cfop, datacad, UA, responsavel, responsavel_ua, responsavel_url, responsavel_ua_url, local_estoque_id, item_consumo, item_produzido, fornecedor_id, prazo_entrega, desconta_cliente, importacao_id, solicita_saida, proibe_negativo, franquia_id, ipi_cst, ipi_valor, icms_cst, icms_valor, pis_cst, pis_valor, cofins_cst, cofins_valor, cest, origem_mercadoria, emite_nota, utiliza_margem_lucro, margem_lucro, grava_fcp, venda_ecommerce, ibs_cbs_cst, c_class_trib, aliquota_cbs, aliquota_ibs_total, aliquota_ibs_uf, aliquota_ibs_municipio |
| 0144 | Produtos vendidos por categorias, e seus respectivos lucros | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0146 | Produtos com maior representatividade no faturamento | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0147 | Profissional e seus respectivos usos de produto, por comanda | 200 | Válido, sem linhas no período | inicio, fim, profissional_id, marca | — |
| 0148 | Faturamento por dia por local estoque | 200 | Válido, sem linhas no período | inicio, fim, local_estoque_id | — |
| 0149 | Posição de Estoque | 200 | Erro interno HY093 | inicio, marca, linha, categoria, local | — |
| 0150 | Taxa de retorno dos clientes por categoria de serviço | 400 | Relatório não encontrado | inicio1, fim1, inicio2, fim2, categoria_id | — |
| 0151 | Clientes com agendamentos, com filtro para um determinado profissional | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0152 | Serviços com profissionais diferentes na comanda e na agenda | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0153 | Quantidade de agendamentos por profissionais | 200 | Relatório reconhecido | inicio, fim | total_reservas, responsavel |
| 0154 | Quantidade de dias trabalhados por profissional | 200 | Relatório reconhecido | inicio, fim | apelido, diasTrabalhados, totalReservas, mediaPorDia |
| 0155 | Agendamentos, por quem os agendou e data de cadastro | 200 | Relatório reconhecido | inicio, fim | id, salao_cliente_id, datacad, data, hora_ini, cliente_nome, apelido, servico, servico_id, status, responsavel |
| 0156 | Agendamentos feitos pelo Avec+ | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0157 | Número de agendamentos por dia | 200 | Relatório reconhecido | inicio, fim | data, reservas |
| 0158 | Agendamentos com filtro por categoria | 200 | Válido, sem linhas no período | inicio, fim, categoria_id | — |
| 0159 | Bloqueios da agenda | 200 | Relatório reconhecido | inicio, fim, profissional_id | id, data_inicio, data_fim, hora_inicio, hora_fim, apelido, titulo, obs, dias_semana, responsavel |
| 0162 | Pacotes e pré-vendas vendidas agrupado por comanda | 200 | Relatório reconhecido | inicio, fim | data, numero, nome, cpf, celular, email, apelido, total |
| 0163 | Tabela de preços dos pacotes | 200 | Relatório reconhecido | — | id, pacote, descricao, comissao, valor, desconto, vender_online |
| 0175 | Faturamentos de serviço por profissional | 200 | Relatório reconhecido | inicio, fim | nome, cargo, faturamento, profissional, salao |
| 0180 | Todos os serviços e produtos vendidos | 200 | Relatório reconhecido | inicio, fim | profissional, data, numero, nome, valor, quantidade, tipo, cliente |
| 0181 | Vales-presentes consumidos no período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0182 | Observações nas comandas do período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0183 | Comandas com diferenças nas entradas e itens | 200 | Relatório reconhecido | inicio, fim | data, numero, valor_itens, valor_financeiro, diferenca |
| 0184 | Faturamento por tipos de venda | 200 | Relatório reconhecido | inicio, fim | tipo_venda, quantidade, faturamento, percentual |
| 0185 | Serviços vendidos com promoção | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0186 | Todos os ítens das comandas e comissões do período | 200 | Relatório reconhecido | inicio, fim | idComanda, idItem, promocao_id, profissional_id, assistente1_id, assistente2_id, salao_cliente_id, data, codigo_interno, tipo, tipo_id, numero, item, assistente1, assistente2, UA, profissional, reserva_id, datacad, comissao_percentual, data_finalizada, responsavel_comanda, responsavel_item, nome, cpf, telefone, celular, cel_cli, email, endereco, cidade, estado, bairro, descontar_pacote, num_endereco, valor, desconto, quantidade, custo, comissao, liquido, categoria |
| 0187 | Entradas por caixa | 200 | Válido, sem linhas no período | inicio, fim, tipo, caixa | — |
| 0188 | Bandeiras de cartões, faturamentos e taxas no período | 200 | Relatório reconhecido | inicio, fim | bandeira, faturamento, taxa |
| 01889 | Dia da semana preferido e número de visitas de cliente específico | 200 | Relatório reconhecido | inicio, fim | id, nome, telefone, celular, email, Segunda, Terça, Quarta, Quinta, Sexta, Sábado, Domingo, Total |
| 0189 | Movimentações do caixa | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0202 | Vales presentes vencidos e não utilizados | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0203 | Todos os clientes por gênero | 200 | Relatório reconhecido | — | total, sexo |
| 0204 | Avaliações por nota total | 200 | Relatório reconhecido | — | estrelas, num |
| 0208 | Profissional e faturamentos diários | 200 | Relatório reconhecido | inicio, fim, profissional_id | faturamento, comandaQtd, mediaFaturamento, data, dataMes, dayname |
| 0209 | Cargo de profissionais e evolução dos faturamentos diários | 200 | Válido, sem linhas no período | inicio, fim, cargo | — |
| 0210 | Clientes com CPF duplicados | 200 | Relatório reconhecido | — | clientes, cpf |
| 0213 | Comandas do período com detalhamento de dívidas acumuladas | 200 | Relatório reconhecido | inicio, fim | data, numero, nome, datacad, data_finalizada, caixa, total, pagamentos, credito_divida, obs |
| 0220 | Cargos de profissionais e totais vendidos em atendimentos no período | 200 | Relatório reconhecido | inicio, fim | cargo, total, atendimentos, servicos, comissao, media |
| 0221 | Ranking de profissionais por venda de produtos no período | 200 | Válido, sem linhas no período | inicio, fim, cargo | — |
| 0222 | Profissional e as comissões dos seus assistentes por período | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0223 | Profissional e comissões detalhadas | 200 | Relatório reconhecido | profissional_id | servico, comissao, comissao_assistente, tempo |
| 0224 | Profissionais e as avaliações de clientes no período | 200 | Relatório reconhecido | inicio, fim | apelido, total, media |
| 0225 | Ranking de vendas de pacotes de serviços dos profissionais no período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0226 | Recibos das comissões pagas aos profissionais no período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0227 | Ranking de realização de serviços como assistente por período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0228 | Comissões líquidas por dia da semana no período definido | 200 | Relatório reconhecido | inicio, fim, profissional_id | data, dayname, valor_liquido |
| 0229 | Lista de Profissionais | 200 | Relatório reconhecido | — | id, nome, cargo, cpf, apelido, especialidade, tipo_contratacao, datacad, grupo_acesso |
| 0231 | Reservas estornadas | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0237 | Lucratividade dos serviços por categoria | 200 | Relatório reconhecido | inicio, fim, custo, tipo_desconto | comissao, categoria_id, categoria, faturado, quantidade, custo_servico, custo_comissao, custo_produtos, total_custos, total_lucro, percentual_lucro |
| 0241 | Produtos vendidos por categorias, por meio de gráfico | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0242 | Custo de estoque por marcas | 200 | Relatório reconhecido | — | marca, custoTotal |
| 0243 | Custo de estoque por categorias | 200 | Relatório reconhecido | — | categoria, custoTotal |
| 0244 | Produtos com entradas, por motivos | 200 | Relatório reconhecido | inicio, fim | data, nome, codigo_interno, marca, categoria, quantidade, custo, motivo, validade |
| 0245 | Produtos com saídas, pelo estoque, por usos pessoais dos profissionais | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0246 | Produtos utilizados em serviços com os respectivos gastos | 200 | Relatório reconhecido | inicio, fim | data, numero, tipo, id, item, valor_servico, saida, valor, custo_compra, nome |
| 0247 | Produtos deletados | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0248 | Agendamentos por status | 200 | Relatório reconhecido | inicio, fim, status | UA, datacad, responsavel, responsavel_ua, data, cliente_nome, cliente_tel, profissional, servico, obs, status |
| 0249 | Gerar etiquetas por base em pedido de compras | 200 | Válido, sem linhas no período | inicio, codigo | — |
| 0251 | Clientes únicos com agendamento | 200 | Relatório reconhecido | inicio, fim | data, nome, celular, id, email, email_mkt, sms_mkt |
| 0280 | Comandas com valores diferentes entre comissões e NF por cada empresa do "Multiempresas" | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0281 | Entradas por formas de pagamento que geram caixa | 200 | Relatório reconhecido | inicio, fim | valor, tipo_pagamento |
| 0282 | Pagamentos recebidos pelo aplicativo | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0283 | Cheques recebidos no período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0284 | Valor total de NF por cada empresa do "Multiempresas" | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0285 | Notas Fiscais emitidas no período por empresa | 200 | Válido, sem linhas no período | inicio, fim, multiempresa_id, tipo_nota, status | — |
| 0286 | Informações detalhadas para emissão de nota fiscal do profissional parceiro | 200 | Válido, sem linhas no período | inicio, fim, processamento, multiempresa_id | — |
| 0308 | Faturamento por "Como Conheceu?" | 200 | Relatório reconhecido | inicio, fim | como_conheceu, servicos, produtos, faturamento, total, ticket |
| 0320 | Clientes com retorno recomendado e não retornaram | 200 | Relatório reconhecido | — | salao_cliente_id, categoria, servico_id, cliente_id, nome, telefone, celular, email, ultima_visita, retorno, servico, email_mkt, sms_mkt, retorno_sugerido, dias_ultrapassados_do_sugerido |
| 0321 | Ranking de venda de produtos por marca | 200 | Válido, sem linhas no período | inicio, fim, marca | — |
| 0322 | Custos e valores dos serviços realizados por cargo no período | 200 | Relatório reconhecido | inicio, fim | cargo, valor, custo |
| 0323 | Produtos que deram entrada pelos pedidos de compra no período | 200 | Relatório reconhecido | inicio, fim | pedido_compras_id, fornecedor_id, documento, empresa, numero_nota_fiscal, nota_data_envio_mercadoria, nota_serie, valor_total_pago, numero_pedido, data, data_entrega, produto_id, quantidade, valor, imposto, desconto, valor_pago, item, codigo_interno, cod_barra |
| 0324 | Ranking de Avaliações por Profissional | 200 | Relatório reconhecido | — | apelido, total, media |
| 0326 | Percentual de agendamentos preferenciais | 200 | Relatório reconhecido | inicio, fim | apelido, cargo, preferencial, semPreferencia, percentualPreferencial |
| 0341 | Produtos com seus respectivos preços | 200 | Relatório reconhecido | — | id, salao_id, nome, descricao, medida, custo_medio, custo, validade_proxima, usa_validade, valor, comissao, vendas, status, categoria, cod_barra, marca, linha, compoem_outros, peso, estoque_minimo, estoque_atual, estoque_pedido_padrao, ncm, codigo_interno, qtd_medida, tamanho, valor_profissional, uso_interno, icms, tributacao, csosn, valor_tributo, cfop, datacad, UA, responsavel, responsavel_ua, responsavel_url, responsavel_ua_url, local_estoque_id, item_consumo, item_produzido, fornecedor_id, prazo_entrega, desconta_cliente, importacao_id, solicita_saida, proibe_negativo, franquia_id, ipi_cst, ipi_valor, icms_cst, icms_valor, pis_cst, pis_valor, cofins_cst, cofins_valor, cest, origem_mercadoria, emite_nota, utiliza_margem_lucro, margem_lucro, grava_fcp, venda_ecommerce, ibs_cbs_cst, c_class_trib, aliquota_cbs, aliquota_ibs_total, aliquota_ibs_uf, aliquota_ibs_municipio, tipo, total |
| 0344 | Produtos com saídas, por motivos | 200 | Relatório reconhecido | inicio, fim | data, nome, cod_barra, marca, categoria, linha, quantidade, custo, motivo, profissional, valor |
| 0345 | Produtos e seus respectivos custos no estoque | 200 | Relatório reconhecido | inicio, fim, local_estoque_id | nome, custo, codigo_interno, valor, medida, qtd_medida, atual, custoTotal, valorTotal, estoque_atual |
| 0346 | Comissão de Produto de Consumo por Profissional | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 0347 | Comissão de Produto de Consumo | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0348 | Número de reservas por status com filtro por serviço | 200 | Relatório reconhecido | inicio, fim, servico_id | status, total |
| 0349 | Custo médio ponderado dos produtos utilizados no período | 200 | Relatório reconhecido | inicio, fim | data, nome, categoria, marca, linha, codigo_interno, cod_barra, quantidade, custo_medio_anterior, tipo_saida, custo_saida |
| 0383 | Faturamento e ticket médio por clientes (pelos pagamentos) | 200 | Relatório reconhecido | inicio, fim | cliente, celular, email, comandas, faturamento, media |
| 0384 | NF acumuladas dos profissionais por cada empresa do "Multiempresas" | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0385 | Todas as entradas e saídas das comandas por período | 200 | Relatório reconhecido | inicio, fim | id, data, data_cobranca, data_pagamento, titulo, tipo_pagamento, informacao, valor, valor_original, valor_bruto_total, valor_liquido_total, categoria, descricao, observacoes, numero, idComanda, bandeira_id, subadquirente_transacao_id |
| 0386 | Despesas do entradas e saídas | 200 | Relatório reconhecido | inicio, fim, tipo | numero_nota, parcela, data_competencia, razao_social, observacoes, pagamento, data_cobranca, valor, valor_pago, descricao, data_pagamento, categoria, titulo |
| 0387 | Entradas e Saídas Analítico | 200 | Relatório reconhecido | inicio, fim, tipo | id, data, data_cobranca, data_pagamento, titulo, tipo_pagamento, centro_custo, categoria, valor, valor_original, status, fornecedor_id, empresa, documento, descricao, observacoes, fornecedor_cliente |
| 0388 | Entrada por forma de pagamento e cliente | 200 | Relatório reconhecido | inicio, fim, tipo, cliente, forma_pagamento | — |
| 0441 | Lucratividade dos produtos vendidos no período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 0485 | Notas Fiscais emitidas no período | 200 | Válido, sem linhas no período | inicio, fim | — |
| 1041 | Produtos vendidos por estoque | 200 | Válido, sem linhas no período | inicio, fim | — |
| 1083 | Faturamento e ticket médio de vendas que foram utilizadas pelos clientes | 200 | Relatório reconhecido | inicio, fim | cliente, celular, email, comandas, faturamento, media, group_concat(comanda_id) |
| 1088 | Faturamento diario por categoria de serviço | 200 | Válido, sem linhas no período | inicio, fim, categoria_id | — |
| 1127 | Vendas totais dos profissionais por categoria de serviços | 200 | Válido, sem linhas no período | inicio, fim, categoria_id | — |
| 1128 | Vendas totais de um profissional por categorias de serviço | 200 | Válido, sem linhas no período | inicio, fim, profissional_id | — |
| 1186 | Todos os ítens das comandas por profissional | 200 | Relatório reconhecido | inicio, fim, tipo, profissional_id | idComanda, salao_cliente_id, data, codigo_interno, tipo, tipo_id, numero, item, assistente1, assistente2, UA, profissional, reserva_id, datacad, comissao_percentual, data_finalizada, responsavel_comanda, responsavel_item, nome, cpf, telefone, celular, email, endereco, cidade, estado, bairro, num_endereco, valor, desconto, quantidade, custo, comissao, liquido, categoria |
| 1280 | Comandas com valores diferentes entre comissões e NF | 200 | Válido, sem linhas no período | inicio, fim, tipo_nota | — |
| 1281 | Comparar valores das comandas, das NF dos profissionais e das NF do estabelecimento | 200 | Relatório reconhecido | inicio, fim | id, data, numero, notas_salao, notas_prof, valor_comandas |
| 2033 | Tabela de preço dos serviços com custos detalhados | 200 | Relatório reconhecido | — | id, codigo_interno, categoria_id, categoria_mkt_id, salao_id, servico, descricao, retorno, pontuacao, salao_fidelidade_id, tempo, valor, comissao, apartir, tipo_valor, ordem, status, custo, agendamento_paralelo, agendamento_online, item_lista_servico, tributo_municipio, iss_aliquota, tributo_cliente_servico, descritivo_servico, cnae, datacad, UA, responsavel, responsavel_ua, nivel_paralelo, importacao_id, franquia_id, pontuacao_troca, enviar_lista_automatica, folga_reserva, atendimento_em_casa, bloqueado, logo, jwt_cliente, pontos_assinatura, categoria, custo_produtos |
| 2034 | Lucratividade por taxa de conveniência | 200 | Válido, sem linhas no período | inicio, fim | — |
| 2115 | Ficha de Anamnese por data de atualização do campo | 200 | Relatório reconhecido | inicio, fim | id, salao_cliente_id, nome, numero, data, tipo_ficha, name, campo, comanda_id, salao_anamnese_id, valor, datacad |
| 2148 | Clientes atendidos por local estoque | 200 | Válido, sem linhas no período | inicio, fim, local_estoque_id | — |
| 2386 | Entradas do entradas e saídas | 200 | Relatório reconhecido | inicio, fim | data_competencia, data_pagamento, tipo_pagamento, informacao, data_cobranca, valor, valor_liquido, conta, parcela, titulo |
| 3123 | Itens que geram comissões para profissional no período | 200 | Relatório reconhecido | inicio, fim, profissional_id | data, numero, item, nome, valor, tipo_pagamento, comissao, desconto_cartao, desconto_taxa_adm, custo_servico, custo_produto, comissaoValor, assistente1, assistente2, data_pago |
| 4123 | Todas as comissões geradas via cartão e via outros | 200 | Relatório reconhecido | inicio, fim | nome, cargo, banco, agencia, conta, a_pagar_cartao, a_pagar_outros |
| 5123 | Profissional e comissões brutas no período | 200 | Relatório reconhecido | inicio, fim, profissional_id | data, numero, item, nome, valor, comissao, comissionado |
| 6123 | Todas as comissões brutas geradas via cartão, via dinheiro e via outros | 200 | Relatório reconhecido | inicio, fim | nome, cargo, banco, agencia, conta, a_pagar_cartao, a_pagar_dinheiro, a_pagar_outros |
| 7123 | Comissão Líquida por Profissional | 200 | Relatório reconhecido | inicio, fim, profissional_id | data, numero, item, nome, valor_bruto, valor, tipo_pagamento, comissao, data_pagamento, pago_split, comissaoValor, valor_faturado |
| 8123 | Profissionais e todas as comissões por período DETALHADO | 200 | Relatório reconhecido | inicio, fim | nome, cargo, banco, agencia, conta, valor_cobrado, rateio_servico, rateio_produtos, rateio_outros, caixinha, gasto_produtos, taxa_cartao, taxa_adm, desconto_assistente, descontos, a_pagar, valor_casa |
| 9123 | Comissões individuais de profissional com split ativado | 200 | Relatório reconhecido | inicio, fim, isSplit, profissional_id | data, numero, titulo, nome, tipo_pagamento, split, data_pagamento, valor, data_pago, valor_cobrado, recibo_comissao_id, zoop_id |
| 9323 | Localizando Comissões por data da comanda | 200 | Relatório reconhecido | inicio, fim, numero | data, numero, item, apelido, tipo_pagamento, valor, dataComissao, data_pago, split |
| B048 | Produtos com entradas e saídas, por valores absolutos | 200 | Relatório reconhecido | inicio, fim | nome, marca, entradas, saidas_vendas, saidas_internas, total, total_anterior |
| N186 | Notas Fiscais emitidas separadas por itens | 200 | Válido, sem linhas no período | inicio, fim | — |
| X126 | Tipo de reservas dos agendamentos do profissional (Função Customizada) | 200 | Relatório reconhecido | inicio, fim, profissional_id | status_agendamento, quantidade |
| X226 | Tipos de agendamentos dos profissionais no período (Função Customizada) | 200 | Relatório reconhecido | inicio, fim | apelido, cargo, nome, preferencial, primeiraVez, indicacao, semPreferencia, noiva, naoInformado |
| X326 | Produtos e seus respectivos lucros, quando fabricados | 200 | Relatório reconhecido | — | nome, categoria, marca, valor, custo, custo_insumos, lucratividade |
