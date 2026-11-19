import { assert, phone, text, uuid } from './security.mjs';

const eq=value=>'eq.'+value;
const scalar=value=>['string','number','boolean'].includes(typeof value)?String(value).trim():'';
const number=value=>{try{return phone(scalar(value))}catch{return null}};

// Report values remain on the server. The browser submits row indexes and
// column names; it cannot replace recipients or values during dispatch.
export function reportDispatch({db,deliveryConfig}){
  async function issue({unit,user,code,rows}){
    assert(Array.isArray(rows)&&rows.length<=250&&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)),
      'Este relatório não possui linhas compatíveis com a seleção de destinatários.');
    const [preview]=await db.insert('fs_report_previews',{unit_id:unit,user_id:user,report_code:code,rows});
    return {snapshot_id:preview.id,expires_at:preview.expires_at};
  }
  async function load(unit,user,input){
    const [snapshot]=await db.select('fs_report_previews',{id:eq(uuid(input.snapshot_id)),unit_id:eq(unit),user_id:eq(user),limit:1});
    assert(snapshot&&Date.parse(snapshot.expires_at)>Date.now(),'Esta consulta expirou. Consulte o relatório novamente.',410);
    assert(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=100&&new Set(input.rows).size===input.rows.length&&
      input.rows.every(index=>Number.isInteger(index)&&index>=0&&index<snapshot.rows.length),'Selecione de 1 a 100 itens válidos.');
    const columns=new Set(snapshot.rows.flatMap(row=>row&&typeof row==='object'?Object.keys(row):[]));
    for(const column of [input.phone_column,input.id_column])assert(!column||columns.has(column),'Coluna de destinatário inválida.');
    assert(input.phone_column||input.id_column,'Selecione a coluna de telefone ou de identificação do cliente.');
    return {snapshot,columns};
  }
  async function resolve(unit,user,input){
    const {snapshot,columns}=await load(unit,user,input);
    const contacts=await db.all('fs_contacts',{unit_id:eq(unit)});
    const phones=new Map(contacts.filter(c=>c.phone).map(c=>[c.phone,c]));
    const localIds=new Map(contacts.filter(c=>c.external_id).map(c=>[c.external_id,c]));
    const globalIds=new Map(contacts.filter(c=>c.avec_global_id).map(c=>[c.avec_global_id,c]));
    const rows=input.rows.map(index=>{
      const row=snapshot.rows[index];
      const rawId=input.id_column&&Object.hasOwn(row,input.id_column)?scalar(row[input.id_column]):'';
      const rawPhone=input.phone_column&&Object.hasOwn(row,input.phone_column)?scalar(row[input.phone_column]):'';
      const byId=rawId?(input.id_column==='cliente_id'?globalIds:localIds).get(rawId):null;
      const parsed=number(rawPhone),byPhone=parsed?phones.get(parsed):null;
      let reason='';
      if(rawId&&!byId)reason='Cliente não localizado pelo ID. Sincronize a AVEC ou confira a coluna escolhida.';
      if(byId&&byPhone&&byId.id!==byPhone.id)reason='ID e telefone identificam clientes diferentes.';
      if(byId&&parsed&&byId.phone&&parsed!==byId.phone)reason='O telefone do relatório difere do cadastro deste cliente.';
      const contact=byId||byPhone;
      const destination=contact?.phone||parsed;
      if(!destination)reason='Telefone ausente ou inválido.';
      if(contact&&!contact.consent)reason='Cliente sem autorização de contato. Revise o cadastro antes de enviar.';
      const name=contact?.name||scalar(row.nome??row.cliente_nome??row.cliente??row.name)||'Destinatário do relatório';
      return {index,row,contact,phone:destination,name,new_contact:!contact&&!reason,reason};
    });
    return {snapshot,columns,rows};
  }
  async function prepare(unit,user,input){
    const result=await resolve(unit,user,input);
    const {channel,template}=await deliveryConfig(unit,uuid(input.channel_id),input.template_id);
    assert(channel.type==='waba','Escolha um canal Oficial com modelo aprovado para o envio por relatório.');
    for(const variable of template.variables){
      const value=input.mapping?.[variable];
      assert(typeof value==='string'&&(['customer.name','customer.phone'].includes(value)||value.startsWith('column:')&&result.columns.has(value.slice(7))),
        'Selecione uma informação para cada campo do modelo.');
    }
    const rows=result.rows.map(row=>{
      const params=template.variables.map(variable=>{
        const source=input.mapping[variable];
        return source==='customer.name'?row.name:source==='customer.phone'?row.phone||'':
          scalar(Object.hasOwn(row.row,source.slice(7))?row.row[source.slice(7)]:null);
      });
      const invalid=params.some(value=>!value||value.length>1024);
      return {...row,params,reason:row.reason||(invalid?'Há um campo do modelo vazio, composto ou com mais de 1.024 caracteres.':'')};
    });
    return {...result,channel,template,rows};
  }
  async function preview(unit,user,input){
    const result=await prepare(unit,user,input);
    return {snapshot_id:result.snapshot.id,expires_at:result.snapshot.expires_at,body:result.template.body,
      rows:result.rows.map(({index,name,phone,params,reason,new_contact})=>({index,name,phone,params,reason,new_contact})),
      ready:result.rows.filter(row=>!row.reason).length,blocked:result.rows.filter(row=>row.reason).length};
  }
  async function enqueue(unit,user,input){
    assert(input.confirm===true,'Confirme a revisão dos destinatários e a autorização do envio.');
    const result=await prepare(unit,user,input);
    assert(result.rows.every(row=>!row.reason),'Existem itens bloqueados na seleção. Corrija ou remova esses itens.');
    assert(!result.rows.some(row=>row.new_contact)||input.confirm_new_contacts===true,
      'Confirme a autorização para cadastrar os novos destinatários ou remova esses itens.');
    const jobs=[];
    for(const row of result.rows){
      let contact=row.contact;
      if(!contact){
        // Only an explicit acknowledgement creates new consent. Existing
        // withheld consent is never overridden by a report send.
        const [existing]=await db.select('fs_contacts',{unit_id:eq(unit),phone:eq(row.phone),limit:1});
        assert(!existing||existing.consent,'O destinatário possui um cadastro sem autorização.');
        contact=existing||(await db.insert('fs_contacts',{unit_id:unit,name:text(row.name,120),phone:row.phone,consent:true,source:'report'}))[0];
      }
      const fields=Object.fromEntries(result.template.variables.map((key,index)=>['report.'+key,row.params[index]]));
      jobs.push({channel_id:result.channel.id,template_id:result.template.id,contact_id:contact.id,phone:row.phone,kind:'manual',
        idempotency_key:`report:${result.snapshot.id}:${row.index}:${result.channel.id}`,
        payload:{fields,mapping:Object.fromEntries(result.template.variables.map(key=>[key,'report.'+key])),
          report_code:result.snapshot.report_code,report_snapshot:result.snapshot.id,report_row:row.index}});
    }
    const queued=await db.rpc('fs_enqueue',{p_unit:unit,p_rows:jobs});
    return {queued};
  }
  return {issue,preview,enqueue};
}
