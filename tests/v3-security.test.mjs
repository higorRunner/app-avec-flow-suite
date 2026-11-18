import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const js=readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../sql/003_v3_hardening.sql',import.meta.url),'utf8');
const config=readFileSync(new URL('../config.js',import.meta.url),'utf8');
assert(js.includes('function setupChecklist()'));
assert(!js.includes('Ambiente seguro'));
assert(js.includes('allowedParentOrigins'));
assert(sql.includes('fs_check_jobs_tenant'));
assert(sql.includes('REVOKE ALL ON public.integration_secrets'));
assert(!config.includes('SERVICE_ROLE_KEY='));
for(const name of ['01-avec-teste-manual','02-fila-auditoria-dry-run','03-estoque-consulta-dry-run']){const w=JSON.parse(readFileSync(new URL('../n8n/'+name+'.json',import.meta.url),'utf8'));assert.equal(w.active,false);assert(w.nodes.length>=3);assert(w.settings.saveDataSuccessExecution==='none');}
console.log('7 verificações de segurança/estrutura passaram (testes estáticos).');
