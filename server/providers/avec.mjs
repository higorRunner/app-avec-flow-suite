/** Cliente de relatórios AVEC usado exclusivamente pelo servidor FlowSuite. */
import { responseShape, diagnosticUrl } from '../diagnostics.mjs';
export const AVEC_BASE_URL = 'https://api.avec.beauty';
const REPORT_CODE = /^[A-Z0-9]{4}$/;
const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const MAX_PAGES = 100;
const BLOCKED = new Set(['token','authorization','apikey','api_key']);

export class AvecError extends Error {
  constructor(stage, message, status = null) {
    super(`AVEC: ${stage}${status ? ' (HTTP '+status+')' : ''}. ${message}`);
    this.status = status;
  }
}

export function avecBirthday(value) {
  if(typeof value!=='string')return null;
  const raw=value.trim();
  const brazilian=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!brazilian&&!iso)return null;
  const [year,month,day]=brazilian?[brazilian[3],brazilian[2],brazilian[1]]:iso.slice(1);
  const normalized=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
  const date=new Date(normalized+'T12:00:00Z');
  return Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==normalized||date>Date.now()?null:normalized;
}

export function formatAvecDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('Data inválida');
  const dd = String(value.getUTCDate()).padStart(2,'0');
  const mm = String(value.getUTCMonth()+1).padStart(2,'0');
  return `${dd}/${mm}/${value.getUTCFullYear()}`;
}
export function requestUrl(code,params={},baseUrl=AVEC_BASE_URL){
  if (!REPORT_CODE.test(code)) throw new Error('Código de relatório inválido');
  const base = new URL(baseUrl);
  if(base.protocol !== 'https:' || base.hostname !== 'api.avec.beauty' || base.username || base.password || base.search || base.hash || !['','/'].includes(base.pathname)) throw new Error('URL base AVEC não autorizada');
  const u=new URL(`/reports/${code}`,base);
  const page=Number(params.page??1),limit=Number(params.limit??250);
  if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>250) throw new Error('Paginação inválida: limite máximo é 250');
  u.searchParams.set('page',String(page));u.searchParams.set('limit',String(limit));
  for(const [key,value] of Object.entries(params)){
    if(key==='page'||key==='limit'||value===null||value===undefined||value==='')continue;
    if(BLOCKED.has(key.toLowerCase())||!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key))throw new Error('Parâmetro não permitido');
    if(Array.isArray(value)||typeof value==='object')throw new Error('Parâmetros devem ser escalares');
    if(['inicio','fim','inicio1','fim1','inicio2','fim2'].includes(key)&&!DATE.test(String(value)))throw new Error(`${key}: use DD/MM/AAAA`);
    u.searchParams.set(key,String(value));
  }
  return u.toString();
}
function reportPayload(json) {
  const envelope=Array.isArray(json)&&json.length===1?json[0]:json;
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)){
    throw new AvecError('ler resposta','A API não retornou um objeto de relatório reconhecido.');
  }
  if(envelope.code!==undefined){
    const code=Number(envelope.code);
    if(!Number.isInteger(code)||code<200||code>=300){
      throw new AvecError('validar resposta','A API informou falha no resultado da consulta.',
        Number.isInteger(code)&&code>=100&&code<=599?code:null);
    }
  }
  const report=envelope.data?.report??envelope.Data?.Report??envelope;
  if(!report||typeof report!=='object'||Array.isArray(report)){
    throw new AvecError('ler relatório','O conteúdo do relatório não tem a estrutura esperada.');
  }
  return report;
}
function findData(json){
  if(json && typeof json==='object'){
    if(Array.isArray(json.Result))return json.Result;
    if(Array.isArray(json.Data?.Result))return json.Data.Result;
    if(Array.isArray(json.data?.result))return json.data.result;
    if(Array.isArray(json.result))return json.result;
  }
  return null;
}
function hasMore(json){
  const v=json?.HasMore??json?.Data?.HasMore??json?.data?.hasMore??json?.hasMore;
  if(typeof v==='boolean')return v;
  if(v===1 || v==='1' || v==='true' || v==='TRUE')return true;
  if(v===0 || v==='0' || v==='false' || v==='FALSE')return false;
  throw new AvecError('ler paginação','A API retornou dados sem HasMore reconhecido. É necessário validar o formato da resposta.');
}
export async function fetchReportPage({code,token,params={},fetchImpl=fetch,timeoutMs=20000,baseUrl=AVEC_BASE_URL,onTrace}){
  if(typeof token!=='string'||!token.trim())throw new Error('Token AVEC não informado');
  const url=requestUrl(code,params,baseUrl);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const started=Date.now();
  const trace=info=>onTrace?.({url:diagnosticUrl(url),method:'GET',...info,duration_ms:Date.now()-started});
  try{
    await trace({stage:'request',state:'info'});
    let response;
    try {
      response=await fetchImpl(url,{method:'GET',headers:{Authorization:token,'Content-Type':'application/json','Accept':'application/json'},signal:controller.signal,redirect:'error'});
    } catch {
      throw new AvecError('conectar','Falha de conexão ou tempo limite ao acessar a API.');
    }
    const contentType=(response.headers.get('content-type')||'').split(';')[0];
    await trace({stage:'http',state:response.ok?'info':'error',http_status:response.status,
      content_type:/^[\w.+-]+\/[\w.+-]+$/.test(contentType)?contentType:'não informado'});
    if(!response.ok){
      const descriptions={
        401:'A API recusou o token informado.',
        403:'A API negou o acesso ao relatório desta unidade.',
        404:'O relatório não foi encontrado nesta rota.',
        429:'O limite de chamadas foi atingido. Aguarde antes de tentar novamente.',
      };
      throw new AvecError('consultar relatório '+code,descriptions[response.status]||'A API recusou a consulta.',response.status);
    }
    let json;
    try { json=await response.json(); }
    catch { throw new AvecError('ler resposta','A API respondeu com conteúdo diferente de JSON.',response.status); }
    await trace({stage:'response_structure',state:'info',shape:responseShape(json)});
    const payload=reportPayload(json);
    const result=findData(payload);
    if(!result)throw new AvecError('ler registros','O campo Result não foi reconhecido. É necessário validar a estrutura de resposta da API.');
    const more=hasMore(payload);
    await trace({stage:'parsed',state:'ok',records:result.length,has_more:more});
    return {result,hasMore:more,raw:json};
  }catch(error){
    if(error instanceof AvecError)await trace({stage:'failed',state:'error',message:error.message});
    throw error;
  }finally{clearTimeout(timer)}
}
export async function fetchReportAll({code,token,params={},fetchImpl=fetch,maxPages=MAX_PAGES,timeoutMs=20000,onTrace}){
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES)throw new Error('maxPages inválido');
  const results=[];let pages=0,more=true;
  while(more&&pages<maxPages){
    const page=pages+1;
    const res=await fetchReportPage({code,token,params:{...params,page},fetchImpl,timeoutMs,onTrace});
    results.push(...res.result);pages++;more=res.hasMore;
  }
  if(more)throw new AvecError('paginar relatório '+code,`O relatório ultrapassou ${maxPages} páginas. A importação foi interrompida.`);
  return {code,pages,records:results.length,result:results};
}
