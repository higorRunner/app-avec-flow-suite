import { createHmac } from 'node:crypto';
import { assert, digest, AppError } from './security.mjs';

// The public token is derived from the immutable job key. Only its hash is
// stored, so retrying a scheduler pass returns the same link without exposing
// another customer's survey or replacing a submitted answer.
export function feedback({db, publicOrigin, secret}) {
  let origin;
  if(publicOrigin){
    const url=new URL(publicOrigin);
    assert((url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))&&
      !url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/',
      'PUBLIC_ORIGIN deve conter a origem pública HTTPS do FlowSuite.');
    origin=url.origin;
  }
  const hashToken=token=>{
    assert(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token),'Avaliação não encontrada.',404);
    return digest(token);
  };
  async function issue({unit,contact,appointment,jobKey}){
    assert(origin&&typeof secret==='string'&&secret.length>0,
      'Configure PUBLIC_ORIGIN no servidor para gerar os links de avaliação.',503);
    const unitId=typeof unit==='string'?unit:unit.id;
    const contactId=typeof contact==='string'?contact:contact.id;
    const appointmentId=typeof appointment==='string'?appointment:appointment?.id||null;
    assert(typeof jobKey==='string'&&jobKey.length>0,'Evento de avaliação inválido.');
    const token=createHmac('sha256',secret).update('flowsuite-survey-v1\0'+JSON.stringify([unitId,contactId,appointmentId,jobKey])).digest('base64url');
    const row=await db.rpc('fs_feedback_issue',{p_unit:unitId,p_contact:contactId,p_appointment:appointmentId,
      p_event:jobKey,p_token_hash:digest(token)});
    assert(row?.token_hash===digest(token),'A chave da avaliação mudou. Confira APP_SECRET do servidor.',503);
    return {id:row.id,url:origin+'/avaliar#'+token};
  }
  async function inspect(token){
    const rows=await db.select('fs_feedback',{token_hash:'eq.'+hashToken(token),limit:1});
    const row=rows[0];
    assert(row,'Avaliação não encontrada.',404);
    assert(Date.parse(row.expires_at)>Date.now(),'O prazo desta avaliação terminou.',410);
    return {answered:row.score!==null,expires_at:row.expires_at};
  }
  async function answer(token,input){
    const hash=hashToken(token);
    assert(Number.isInteger(input?.score)&&input.score>=1&&input.score<=5,'Selecione uma nota de 1 a 5.');
    assert(input.comment===undefined||typeof input.comment==='string','Comentário inválido.');
    const comment=(input.comment||'').trim();
    assert(comment.length<=1000,'O comentário deve ter até 1.000 caracteres.');
    const result=await db.rpc('fs_feedback_answer',{p_token_hash:hash,p_score:input.score,p_comment:comment});
    if(result==='not_found')throw new AppError('Avaliação não encontrada.',404);
    if(result==='expired')throw new AppError('O prazo desta avaliação terminou.',410);
    if(result==='answered')throw new AppError('Esta avaliação já foi respondida. Obrigado!',409);
    assert(result==='saved','Não foi possível salvar a avaliação.',503);
    return {saved:true};
  }
  return {issue,inspect,answer,configured:!!origin&&!!secret};
}
