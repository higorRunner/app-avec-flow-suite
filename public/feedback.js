const status=document.getElementById('status'),form=document.getElementById('survey');
const token=location.hash.slice(1);
const endpoint='/api/feedback/'+encodeURIComponent(token);
async function request(method='GET',input){
  const response=await fetch(endpoint,{method,headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined,credentials:'omit',referrerPolicy:'no-referrer'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Não foi possível acessar a avaliação.');
  return data;
}
try{
  const survey=await request();
  status.textContent=survey.answered?'Esta avaliação já foi respondida. Obrigado pela sua opinião!':'';
  form.hidden=survey.answered;
}catch(error){status.textContent=error.message}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const data=new FormData(form),button=form.querySelector('button');
  button.disabled=true;button.textContent='Enviando…';
  try{
    await request('POST',{score:Number(data.get('score')),comment:data.get('comment')});
    form.hidden=true;document.getElementById('intro').hidden=true;
    document.querySelector('h1').textContent='Obrigado pela sua avaliação!';
    status.textContent='Sua resposta foi registrada.';
  }catch(error){status.textContent=error.message}
  finally{button.disabled=false;button.textContent='Enviar avaliação'}
});
