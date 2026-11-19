const technicalKeys=new Set([
  'code','data','Data','report','Report','result','Result','hasMore','HasMore','total','count',
  'description','requiredParams','error','message','status','success','token','tenantId',
  'templates','whatsappId','page','limit',
]);

function nodeShape(value) {
  if(Array.isArray(value))return {type:'array',length:value.length};
  if(value===null)return {type:'null'};
  if(typeof value==='object'){
    const keys=Object.keys(value);
    return {type:'object',keys:keys.filter(key=>technicalKeys.has(key)),otherKeys:keys.filter(key=>!technicalKeys.has(key)).length};
  }
  return {type:typeof value};
}

// Only protocol metadata is recorded. Report rows and error body values never
// enter the diagnostic record.
export function responseShape(json) {
  const shape={root:nodeShape(json)};
  const envelope=Array.isArray(json)&&json.length===1?json[0]:json;
  if(Array.isArray(json)&&json.length===1)shape.envelope=nodeShape(envelope);
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))return shape;
  if(typeof envelope.code==='number'&&Number.isInteger(envelope.code)&&envelope.code>=100&&envelope.code<=599){
    shape.responseCode=envelope.code;
  }
  let report=envelope;
  let path=Array.isArray(json)?'[0]':'$';
  if(envelope.data?.report!==undefined){report=envelope.data.report;path+='.data.report'}
  else if(envelope.Data?.Report!==undefined){report=envelope.Data.Report;path+='.Data.Report'}
  shape.report={path,...nodeShape(report)};
  if(report&&typeof report==='object'&&!Array.isArray(report)){
    const results=report.Result??report.Data?.Result??report.data?.result??report.result;
    shape.records=nodeShape(results);
    const more=report.HasMore??report.Data?.HasMore??report.data?.hasMore??report.hasMore;
    shape.pagination=nodeShape(more);
    if(typeof more==='boolean')shape.pagination.hasMore=more;
  }
  return shape;
}

export function diagnosticUrl(value) {
  const url=new URL(value);
  url.username='';url.password='';url.hash='';
  const safeQuery=new Set(['page','limit','pageNumber','status','whatsappId','inicio','fim','dias']);
  for(const key of [...url.searchParams.keys()]){
    const value=url.searchParams.get(key);
    const safe=safeQuery.has(key)&&/^[A-Za-z0-9 /-]{0,40}$/.test(value);
    if(!safe)url.searchParams.set(key,'[oculto]');
  }
  return url.href;
}
