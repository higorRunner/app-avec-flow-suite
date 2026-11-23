# Configuração compartilhada de automações e envios

## Caminho comum

1. O formulário escolhe um canal e monta `mountMessageConfig` com um catálogo filtrado, a configuração salva e o contexto.
2. `message-picker.js` mostra o resumo e importa `message-dialog.js` ao abrir o diálogo. Busca por nome ou corpo, rascunho por modelo e prévia funcionam da mesma forma em todos os fluxos.
3. `message-contract.js` oferece as fontes de variáveis, seus exemplos e as validações por contexto. O browser usa exemplos para a prévia. A revisão de relatório recebe os parâmetros reais resolvidos pelo servidor.
4. `readMessageConfig` devolve a seleção validada. O formulário mantém sua própria operação de gravação ou envio e repassa ao servidor o ID do modelo e o mapeamento ou os parâmetros literais.
5. O servidor usa `deliveryConfig` para verificar o canal e o modelo no estabelecimento e executa o mesmo contrato de validação antes de gravar ou enfileirar.

| Entrada | Contexto | Operação |
| --- | --- | --- |
| Teste no canal Oficial | Valores literais | Enfileirar para o telefone informado após confirmação |
| Envio aos clientes no Oficial | `manual` | Resolver campos dos clientes autorizados |
| Pós-atendimento, aniversário, inatividade, retorno e venda complementar | `rule` | Salvar regra, serviço, estados, horário e intervalos |
| Pesquisa de satisfação | `csat` | Salvar regra e exigir o link individual em um campo real do modelo |
| Chegada e estoque baixo | `arrival` e `stock` | Salvar avisos e validar cada configuração habilitada |
| Envio a partir de relatório AVEC | `report` | Combinar campos do cliente com colunas do snapshot e revisar os destinatários |

O canal QR Code aceita texto livre. Sua prévia usa o mesmo componente de conversa. As regras de catálogo e de autorização se aplicam no servidor conforme o canal.

## Tipos, horários e execução

`public/automation-contract.js` relaciona os tipos de rotina, os estados de atendimento e os requisitos de configuração. O formulário usa o contrato para exibir as opções e campos condicionais. A API usa o mesmo contrato para validar tipos, estados e serviços recomendados. As restrições SQL continuam protegendo as gravações no banco.

`server/routines.mjs` recebe o contexto autorizado e calcula candidatos pelo fuso da unidade, horário do dia, estado do atendimento, autorização, intervalo e histórico. O índice em memória por cliente separa os atendimentos uma vez por avaliação. A chave de evento preserva a deduplicação e a tabela da fila impõe unicidade por unidade.

Ao adicionar um contexto, registre suas fontes no contrato compartilhado, use o seletor existente e associe o salvamento à operação da API. O agendador deve resolver os campos disponíveis em dados reais do estabelecimento.
