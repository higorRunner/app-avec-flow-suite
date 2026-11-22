import { h, input } from './ui.js';
import { api, brandLogo, toast } from './client.js';

const root=document.getElementById('app');
function renderLogin(message=''){
  root.innerHTML=`<main class="auth">
   <aside class="auth-story"><div class="brand">${brandLogo}</div>
    <div><h1>Cada contato.<br>Cada retorno.<br>Uma operação.</h1><p>Conecte seu atendimento, acompanhe as mensagens e cuide da jornada de cada cliente.</p></div>
    <small>Central de relacionamento</small>
   </aside>
   <section class="auth-form"><div class="auth-card stack"><div class="mobile-brand">${brandLogo}</div><div><h1>Entre no FlowSuite</h1><p class="muted">Acesse com a conta criada para sua equipe.</p></div>
    ${message?`<p class="alert" role="status">${h(message)}</p>`:''}
    <form id="login-form" class="stack">
     ${input('E-mail','email','email','','required autocomplete="username" maxlength="160"')}
     ${input('Senha','password','password','','required autocomplete="current-password" maxlength="200"')}
     <button class="btn primary" type="submit">Entrar</button>
    </form><p class="hint auth-version">Primeiro acesso ou senha esquecida? Solicite uma conta ou uma senha temporária ao administrador.</p>
   </div></section></main>`;
}

async function start(){
  let user;
  try {
    user=await api('/me');
  } catch {
    let message=sessionStorage.getItem('flowsuite-notice')||'';
    sessionStorage.removeItem('flowsuite-notice');
    try {
      const health=await (await fetch('/health')).json();
      if(!health.ok)message=health.message;
    } catch {message='Não foi possível conectar ao servidor.'}
    renderLogin(message);
    const form=document.getElementById('login-form');
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const submit=form.querySelector('button');
      if(submit.disabled)return;
      submit.disabled=true;
      submit.textContent='Entrando…';
      try {
        await api('/login','POST',Object.fromEntries(new FormData(form)));
        location.reload();
      } catch(error) {
        toast(error.message,true);
        submit.disabled=false;
        submit.textContent='Entrar';
      }
    });
    return;
  }
  const {openWorkspace}=await import('./app.js');
  await openWorkspace(user);
}

start().catch(error=>{root.innerHTML='<main class="loading" role="alert">'+h(error.message)+'</main>'});
