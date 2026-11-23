/** @typedef {'rule'|'csat'} RoutineMessageContext */

export const routines = Object.freeze({
  post_service: {label:'Pós-atendimento', description:'Envia uma mensagem após a conclusão do atendimento.', statusFilter:true, recommendedService:false},
  csat: {label:'Pesquisa de satisfação', description:'Use 1 dia para enviar no dia seguinte. Vincule o link individual da pesquisa a um campo do modelo.', statusFilter:true, recommendedService:false},
  return: {label:'Sugestão de retorno', description:'Usa o prazo de retorno do serviço. O intervalo desta regra serve como alternativa.', statusFilter:true, recommendedService:false},
  birthday: {label:'Aniversário', description:'Use zero dias para enviar na data de aniversário.', statusFilter:false, recommendedService:false},
  inactive: {label:'Clientes inativos', description:'Conta os dias desde o último atendimento concluído e verifica se há um agendamento futuro.', statusFilter:true, recommendedService:false},
  cross_sell: {label:'Venda complementar', description:'Oferece um serviço complementar após o atendimento concluído.', statusFilter:true, recommendedService:true},
});

export const appointmentStatusLabels = Object.freeze({
  scheduled:'Agendado', confirmed:'Confirmado', waiting:'Aguardando', in_progress:'Em atendimento',
  finalized:'Finalizado', paid:'Pago', canceled:'Cancelado', missed:'Faltou',
});

export const defaultAppointmentStatuses = Object.freeze(['finalized','paid']);
export const ruleTypes = Object.keys(routines);
export const appointmentStatuses = Object.keys(appointmentStatusLabels);

/** @param {string} type @returns {RoutineMessageContext} */
export function routineMessageContext(type) {
  return type === 'csat' ? 'csat' : 'rule';
}
