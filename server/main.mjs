import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { application } from './application.mjs';
import { database } from './database.mjs';
import { AppError, assert, digest, passwordHash, passwordMatches, secretBox, sessionToken, text } from './security.mjs';

const files = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']],
]);
const cookieName='flowsuite_session';

export function createAppServer({ db, app, version='rebuild-1', secure=true }) {
  let readiness={ok:false,message:'Verificando o banco.'};
  const attempts=new Map();
  const cookie=(token,age)=>`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
  async function health() {
    try {
      await db.select('fs_runtime',{limit:1});
      readiness={ok:true,message:'Aplicação e banco conectados.'};
    } catch(error) {readiness={ok:false,message:error.message}}
    return readiness;
  }
  async function body(req) {
    const chunks=[];
    let size=0;
    for await(const chunk of req){
      size+=chunk.length;
      if(size>100000) throw new AppError('Solicitação muito grande.',413);
      chunks.push(chunk);
    }
    try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw new AppError('Solicitação inválida.')}
  }
  async function session(req) {
    const encoded=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if(!encoded || !/^[a-zA-Z0-9_-]{43}$/.test(encoded)) return null;
    const rows=await db.select('fs_sessions',{token_hash:'eq.'+digest(encoded),expires_at:'gt.'+new Date().toISOString(),limit:1});
    if(!rows[0]) return null;
    const users=await db.select('fs_users',{id:'eq.'+rows[0].user_id,active:'eq.true',limit:1});
    return users[0]||null;
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self' https://cs.clickmassa.com.br; form-action 'self'");
    res.setHeader('Cache-Control','no-store');
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))};
    try {
      const url=new URL(req.url,'http://localhost');
      if(files.has(url.pathname)&&req.method==='GET'){
        const [file,type]=files.get(url.pathname);
        const data=await readFile(new URL('../public/'+file,import.meta.url));
        res.writeHead(200,{'Content-Type':type});res.end(data);return;
      }
      if(url.pathname==='/health'&&req.method==='GET'){
        const state=await health();
        json(state.ok?200:503,{...state,version});return;
      }
      assert(url.pathname.startsWith('/api/'),'Página não encontrada.',404);
      if(!['GET','POST','DELETE'].includes(req.method)) throw new AppError('Método inválido.',405);
      if(req.method!=='GET'){
        assert(req.headers['content-type']?.startsWith('application/json'),'Use uma solicitação JSON.',415);
        const expectedOrigin=(secure?'https':'http')+'://'+req.headers.host;
        assert(req.headers.origin===expectedOrigin,'Origem da solicitação inválida.',403);
      }
      const input=req.method==='GET'?Object.fromEntries(url.searchParams):await body(req);
      assert(input&&typeof input==='object'&&!Array.isArray(input),'Solicitação inválida.');
      if(url.pathname==='/api/login'&&req.method==='POST'){
        const email=text(input.email,160).toLowerCase();
        const key=req.socket.remoteAddress+'|'+email;
        if(attempts.size>=5000&&!attempts.has(key)){
          for(const [stored,entry]of attempts)if(entry.until<Date.now())attempts.delete(stored);
          assert(attempts.size<5000,'Aguarde alguns minutos antes de tentar novamente.',429);
        }
        const window=attempts.get(key)||{count:0,until:Date.now()+900000};
        if(window.until<Date.now()) {window.count=0;window.until=Date.now()+900000}
        assert(window.count<10,'Aguarde alguns minutos antes de tentar novamente.',429);
        window.count++;attempts.set(key,window);
        if(attempts.size>1000) for(const [key,value]of attempts)if(value.until<Date.now())attempts.delete(key);
        const user=(await db.select('fs_users',{email:'eq.'+email,active:'eq.true',limit:1}))[0];
        const valid=await passwordMatches(input.password,user?.password_hash||
          'scrypt:00000000000000000000000000000000:'+ '0'.repeat(128));
        assert(user&&valid,'E-mail ou senha incorretos.',401);
        attempts.delete(key);
        const token=sessionToken(),age=8*60*60;
        await db.insert('fs_sessions',{user_id:user.id,token_hash:digest(token),expires_at:new Date(Date.now()+age*1000).toISOString()});
        res.setHeader('Set-Cookie',cookie(token,age));
        json(200,{ok:true});return;
      }
      const user=await session(req);
      assert(user,'Entre na sua conta para continuar.',401);
      if(url.pathname==='/api/me'&&req.method==='GET'){
        const {id,email,name,master,must_change_password}=user;
        json(200,{id,email,name,master,must_change_password,version});return;
      }
      if(url.pathname==='/api/logout'&&req.method==='POST'){
        const token=req.headers.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        if(token)await db.remove('fs_sessions',{token_hash:'eq.'+digest(token)});
        res.setHeader('Set-Cookie',cookie('',0));
        json(200,{ok:true});return;
      }
      const result=await app.route(user,req.method,url.pathname.slice(4),input);
      if(result?.loginAgain) res.setHeader('Set-Cookie',cookie('',0));
      json(200,result??{ok:true});
    } catch(error) {
      if(!(error instanceof AppError))console.error('FlowSuite:',error.name);
      json(error instanceof AppError?error.status:500,{error:error instanceof AppError?error.message:'Falha ao concluir a operação. Confira os logs do serviço.'});
    }
  });
  server.requestTimeout=30000;
  server.headersTimeout=10000;
  return {server,health};
}

export async function start(env=process.env) {
  const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no serviço do FlowSuite.');
  const db=database({url,key});
  const app=application({db,secrets:secretBox(env.APP_SECRET||key)});
  const {server,health}=createAppServer({db,app,secure:env.COOKIE_SECURE!=='false',version:env.GIT_SHA||'rebuild-1'});
  const state=await health();
  if(!state.ok) throw new Error(state.message);
  const masters=await db.select('fs_users',{master:'eq.true',limit:1});
  if(!masters.length){
    assert(env.ADMIN_EMAIL&&env.ADMIN_PASSWORD,'Configure ADMIN_EMAIL e ADMIN_PASSWORD para criar o primeiro administrador.');
    await db.rpc('fs_bootstrap',{p_email:env.ADMIN_EMAIL.trim().toLowerCase(),p_name:'Administrador',
      p_hash:await passwordHash(env.ADMIN_PASSWORD)});
  }
  server.listen(Number(env.PORT)||3000,'0.0.0.0',()=>console.log('FlowSuite iniciado. API, site e rotinas no mesmo serviço.'));
  const run=()=>app.tick().catch(error=>console.error('Processamento:',error.message));
  const timer=setInterval(run,5000);
  run();
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
    clearInterval(timer);server.close(()=>process.exit(0));
    setTimeout(()=>process.exit(1),25000).unref();
  });
  return server;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  start().catch(error=>{console.error('Inicialização:',error.message);process.exitCode=1});
}
