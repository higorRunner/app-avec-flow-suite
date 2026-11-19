import { fixture } from './support.mjs';
import { passwordHash } from '../server/security.mjs';
import { createAppServer } from '../server/main.mjs';
import { application } from '../server/application.mjs';
import { feedback } from '../server/feedback.mjs';
import { secretBox } from '../server/security.mjs';
import { writeFile } from 'node:fs/promises';

const f=await fixture();
await f.db.rpc('fs_bootstrap',{p_email:'admin@example.test',p_name:'Admin de teste',p_hash:await passwordHash('temporary-password')});
const survey=feedback({db:f.db,publicOrigin:'http://127.0.0.1:8771',secret:'browser-only-secret'});
const app=application({db:f.db,secrets:secretBox('private-test-key'),catalog:f.catalog,survey,
  send:async()=>({status:'processing',externalId:'browser-delivery-id'})});
const surveyUnit=(await f.db.insert('fs_units',{name:'Avaliação de teste',slug:'survey-fixture'}))[0];
const contact=(await f.db.insert('fs_contacts',{unit_id:surveyUnit.id,name:'Cliente privado de teste',phone:'+5511999990002'}))[0];
const link=await survey.issue({unit:surveyUnit,contact,jobKey:'browser-survey-fixture'});
await writeFile(new URL('../.test-deps/feedback-browser-url.txt',import.meta.url),link.url);
const {server}=createAppServer({db:f.db,app,survey,secure:false});
server.listen(8771,'127.0.0.1',()=>console.log('Teste local em http://127.0.0.1:8771'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  server.close(async()=>{await f.pg.close();process.exit(0)});
});
