"""Teste visual de interface com mock local Supabase. Não usa credenciais reais."""
from pathlib import Path
import subprocess,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
MOCK='''window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fake',user:{id:'u1',email:'test@example.com'}}}}),onAuthStateChange:()=>{}},from:(table)=>{const state={};const response=()=>{let data=[];if(table==='profiles') data={id:'u1',master_admin:true,full_name:'Tester'};if(table==='establishments')data=[{id:'e1',name:'Ambiente de teste',slug:'teste',active:true,timezone:'America/Sao_Paulo'}];if(table==='integration_status')data={establishment_id:'e1',avec_configured:false,clickmassa_configured:false};return {data,error:null}};const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>response(),single:async()=>response(),then:(r)=>Promise.resolve(response()).then(r)};return q;}})};'''
server=subprocess.Popen(['python','-m','http.server','8766','--bind','127.0.0.1'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 time.sleep(0.5)
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1280,'height':860});errors=[]
  page.on('pageerror',lambda error: errors.append(str(error)))
  page.set_content('<html><body><div id="app"></div><div id="toast-root"></div></body></html>')
  page.evaluate('Object.defineProperty(window, "localStorage", {configurable:true, value:{getItem:()=>null,setItem:()=>{}}})')
  page.evaluate(MOCK)
  page.evaluate('window.FLOWSUITE_CONFIG = {supabaseUrl: "https://example.supabase.test", supabaseAnonKey: "public-test-key"}')
  catalog=(ROOT/'assets/data/avec-reports.json').read_text(encoding='utf-8')
  page.evaluate('(catalog) => { window.fetch=async ()=>({ok:true,json:async()=>JSON.parse(catalog)}) }',catalog)
  page.evaluate((ROOT/'assets/js/app.js').read_text(encoding='utf-8'))
  page.get_by_text('Relatórios AVEC',exact=True).first.click()
  page.get_by_text('Catálogo de relatórios (230)').wait_for(timeout=4000)
  page.locator('#avec-search').fill('0107')
  page.get_by_role('button',name='0107').last.click()
  assert 'Clientes que não retornam há dias' in page.locator('body').inner_text()
  assert not errors,errors
  page.screenshot(path=str(ROOT/'tests'/'ui-avec.png'),full_page=True)
  print('PASS browser: catálogo 230, busca, seleção e ausência de erros JS')
  browser.close()
finally:server.terminate();server.wait()
