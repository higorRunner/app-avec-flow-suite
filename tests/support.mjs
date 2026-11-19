import { readFile } from 'node:fs/promises';
import { application } from '../server/application.mjs';
import { secretBox } from '../server/security.mjs';

const {PGlite}=await import(process.env.FLOWSUITE_TEST_DB||'@electric-sql/pglite');
const identifier=value=>{
  if(!/^[a-z_]+$/.test(value))throw Error('Invalid identifier');
  return '"'+value+'"';
};

export async function fixture() {
  const pg=new PGlite();
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid);");
  const schema=(await readFile(new URL('../sql/RECRIAR_FLOWSUITE.sql',import.meta.url),'utf8'))+'\n'+
    (await readFile(new URL('../sql/ATUALIZAR_INTEGRACAO_AVEC.sql',import.meta.url),'utf8'));
  await pg.exec(schema);
  const data={pg,schema};
  function where(params,values) {
    const clauses=[];
    for(const [key,raw]of Object.entries(params)){
      if(['select','order','limit','offset'].includes(key))continue;
      if(key==='or'){
        const query=raw.slice(1,-1).split(',');
        const expressions=query.map(part=>{
          const [field,operator,...rest]=part.split('.');
          if(operator!=='ilike')throw Error('Unknown filter');
          values.push(rest.join('.').replaceAll('*','%'));
          return identifier(field)+' ILIKE $'+values.length;
        });
        clauses.push('('+expressions.join(' OR ')+')');continue;
      }
      if(raw.startsWith('in.(')){
        const list=raw.slice(4,-1).split(',');
        values.push(list);clauses.push(identifier(key)+'::text = ANY($'+values.length+'::text[])');continue;
      }
      const [op,...rest]=raw.split('.');
      const value=rest.join('.');
      const comparison={eq:'=',neq:'<>',gt:'>',lt:'<'}[op];
      if(!comparison)throw Error('Unknown filter '+raw);
      values.push(value);clauses.push(identifier(key)+comparison+'$'+values.length);
    }
    return clauses.length?' WHERE '+clauses.join(' AND '):'';
  }
  const db={
    async select(table,params={}){
      const values=[];
      const nested=table==='fs_memberships'&&params.select?.includes('fs_users(');
      let columns=params.select&&!nested?params.select.split(',').map(identifier).join(','):'*';
      let sql='SELECT '+columns+' FROM public.'+identifier(table)+where(params,values);
      if(params.order)sql+=' ORDER BY '+params.order.split(',').map(term=>{
        const [field,dir]=term.split('.');
        return identifier(field)+(dir==='desc'?' DESC':' ASC');
      }).join(',');
      if(params.limit!==undefined){values.push(params.limit);sql+=' LIMIT $'+values.length}
      if(params.offset!==undefined){values.push(params.offset);sql+=' OFFSET $'+values.length}
      const {rows}=await pg.query(sql,values);
      if(nested)for(const row of rows){
        const user=(await db.select('fs_users',{id:'eq.'+row.user_id}))[0];
        row.fs_users={id:user.id,email:user.email,name:user.name,active:user.active};
      }
      return JSON.parse(JSON.stringify(rows));
    },
    async insert(table,input){
      const rows=Array.isArray(input)?input:[input],result=[];
      for(const row of rows){
        const keys=Object.keys(row).filter(k=>row[k]!==undefined);
        const values=keys.map(k=>row[k]);
        const response=await pg.query('INSERT INTO public.'+identifier(table)+' ('+keys.map(identifier).join(',')+
          ') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',values);
        result.push(...response.rows);
      }
      return result;
    },
    async update(table,params,row){
      const keys=Object.keys(row);
      const values=Object.values(row);
      const sql='UPDATE public.'+identifier(table)+' SET '+keys.map((key,i)=>identifier(key)+'=$'+(i+1)).join(',')+where(params,values)+' RETURNING *';
      return (await pg.query(sql,values)).rows;
    },
    async remove(table,params){
      const values=[];
      await pg.query('DELETE FROM public.'+identifier(table)+where(params,values),values);
    },
    async upsert(table,input,conflict){
      const records=Array.isArray(input)?input:[input],result=[];
      for(const row of records){
        const keys=Object.keys(row),cols=keys.map(identifier),values=Object.values(row);
        const sql='INSERT INTO public.'+identifier(table)+' ('+cols.join(',')+') VALUES ('+
          keys.map((_,i)=>'$'+(i+1)).join(',')+') ON CONFLICT ('+conflict.split(',').map(identifier).join(',')+
          ') DO UPDATE SET '+cols.map(key=>key+'=excluded.'+key).join(',')+' RETURNING *';
        result.push(...(await pg.query(sql,values)).rows);
      }
      return result;
    },
    async rpc(name,args={}){
      const values=Object.values(args);
      return (await pg.query('SELECT public.'+identifier(name)+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') AS value',values)).rows[0].value;
    },
    async all(table,params){return db.select(table,params)},
  };
  let deliveries=0;
  const catalog=async()=>({tenantId:'10',channels:[{external_id:'1',name:'Oficial teste',type:'waba',active:true},
    {external_id:'2',name:'QR teste',type:'whatsapp',active:true}],
    templates:[{channel_external_id:'1',external_id:'model-1',provider_template_id:'444',name:'Bem-vindo',
      body:'Olá {{1}}',variables:['1'],status:'active'}]});
  const send=async()=>{deliveries++;return {status:'processing',externalId:'provider-'+deliveries}};
  const app=application({db,secrets:secretBox('private-test-key'),catalog,send,
    report:async()=>({records:1,result:[{Nome:'Contato AVEC',Telefone:'11999990001'}]})});
  return {...data,db,app,catalog,get deliveries(){return deliveries}};
}
