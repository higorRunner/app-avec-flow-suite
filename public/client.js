export const brandLogo='<img class="brand-logo" src="/logo.webp" alt="FlowSuite" width="218" height="73">';

export async function api(path,method='GET',data) {
  const response=await fetch('/api'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},
    body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});
  let result;
  try{result=await response.json()}catch{throw Error('O servidor não retornou uma resposta válida.')}
  if(!response.ok){
    if(response.status===401 && path!=='/me' && path!=='/login')location.reload();
    throw Error(result.error||'Não foi possível concluir.');
  }
  return result;
}
export function toast(message,error=false){
  const el=document.createElement('div');
  el.className='toast'+(error?' error':'');el.setAttribute('role',error?'alert':'status');el.textContent=message;
  const notifications=document.getElementById('notifications');
  notifications.append(el);
  while(notifications.children.length>3)notifications.firstElementChild.remove();
  setTimeout(()=>el.remove(),4500);
}
