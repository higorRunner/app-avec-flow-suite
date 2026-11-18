/** Cliente de relatórios AVEC para uso SOMENTE no servidor/n8n. */
export const AVEC_BASE_URL = 'https://api.avec.beauty';
const REPORT_CODE = /^[A-Z0-9]{4}$/;
const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const MAX_PAGES = 100;
const BLOCKED = new Set(['token','authorization','apikey','api_key']);

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
  throw new Error('Resposta AVEC sem HasMore reconhecido: valide contrato real antes de processar');
}
export async function fetchReportPage({code,token,params={},fetchImpl=fetch,timeoutMs=20000,baseUrl=AVEC_BASE_URL}){
  if(typeof token!=='string'||!token.trim())throw new Error('Token AVEC não informado');
  const url=requestUrl(code,params,baseUrl);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{method:'GET',headers:{Authorization:token,'Content-Type':'application/json','Accept':'application/json'},signal:controller.signal,redirect:'error'});
    if(!response.ok)throw new Error(`Falha HTTP AVEC ${response.status} no relatório ${code}`);
    const json=await response.json();
    if(!json||typeof json!=='object'||Array.isArray(json))throw new Error('Resposta JSON inesperada');
    const result=findData(json);
    if(!result)throw new Error('Resposta sem Result reconhecido: valide exemplo real');
    return {result,hasMore:hasMore(json),raw:json};
  }finally{clearTimeout(timer)}
}
export async function fetchReportAll({code,token,params={},fetchImpl=fetch,maxPages=MAX_PAGES,timeoutMs=20000}){
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES)throw new Error('maxPages inválido');
  const results=[];let pages=0,more=true;
  while(more&&pages<maxPages){
    const page=pages+1;
    const res=await fetchReportPage({code,token,params:{...params,page},fetchImpl,timeoutMs});
    results.push(...res.result);pages++;more=res.hasMore;
  }
  if(more)throw new Error(`Relatório ${code} excedeu ${maxPages} páginas; resultado parcial descartado`);
  return {code,pages,records:results.length,result:results};
}
