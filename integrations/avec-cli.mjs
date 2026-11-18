#!/usr/bin/env node
// Uso local/servidor: AVEC_TOKEN=... node integrations/avec-cli.mjs 0004
// Nunca execute no navegador. Não registra token em logs.
import {fetchReportAll} from './avec-client.mjs';
const code=process.argv[2];
const params={};for(const arg of process.argv.slice(3)){const [k,...values]=arg.split('=');if(k&&values.length)params[k]=values.join('=')}
try{
 const res=await fetchReportAll({code,token:process.env.AVEC_TOKEN,params,maxPages:Math.min(100,Number(process.env.AVEC_MAX_PAGES||10))});
 // Por padrão retorna somente contagens e chaves, evitando expor informações pessoais de clientes.
 console.log(JSON.stringify({code:res.code,pages:res.pages,records:res.records,first_record_fields:Object.keys(res.result[0]||{})},null,2));
}catch(e){console.error(`Falha de validação AVEC: ${e.message}`);process.exitCode=1}
