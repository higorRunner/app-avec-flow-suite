import { fixture } from './support.mjs';
import { passwordHash } from '../server/security.mjs';
import { createAppServer } from '../server/main.mjs';

const f=await fixture();
await f.db.rpc('fs_bootstrap',{p_email:'admin@example.test',p_name:'Admin de teste',p_hash:await passwordHash('temporary-password')});
const {server}=createAppServer({db:f.db,app:f.app,secure:false});
server.listen(8771,'127.0.0.1',()=>console.log('Teste local em http://127.0.0.1:8771'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  server.close(async()=>{await f.pg.close();process.exit(0)});
});
