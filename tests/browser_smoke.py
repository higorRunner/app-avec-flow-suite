"""Teste de interface com navegador real e Supabase simulado."""
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://localhost"
MOCK = r"""
const customers=Array.from({length:30},(_,i)=>({
  id:`person-${i+1}`,name:`Cliente ${String(i+1).padStart(2,'0')}`,
  phone:`119999900${String(i+1).padStart(2,'0')}`,marketing_opt_in:true
}));
let automations=[{ id:'rule-1', type:'csat', name:'Pesquisa antiga', channel_id:'c1', template_id:'t1',
  rules:{service_ids:['s1'],extra_legacy:true}, variable_mapping:{'1':'legacy.full_name'}, send_time:'09:00' }];
const role=window.FLOWSUITE_TEST_ROLE||'owner';
window.testCalls={jobs:[],rules:[],queries:[]};
window.supabase={createClient:()=>({
 auth:{
  getSession:async()=>({data:{session:{access_token:'test',user:{id:'u1',email:'test@example.com'}}}}),
  onAuthStateChange:()=>{}
 },
 from(table){
  const filters={};
  let range=null, search='', write=null, single=false;
  const result=()=>{
   let data=[];
   if(table==='profiles') data={id:'u1',master_admin:false,full_name:'Usuária de teste'};
   if(table==='establishments') data=[{id:'e1',name:'Ambiente de teste',slug:'teste',active:true,timezone:'America/Sao_Paulo'}];
   if(table==='memberships') data=[{establishment_id:'e1',role}];
   if(table==='integration_status') data={establishment_id:'e1',avec_configured:false,clickmassa_configured:false};
   if(table==='channels') data=[{id:'c1',name:'WhatsApp principal',type:'waba',active:true,dispatch_ready:true},{id:'c2',name:'Atendimento QR',type:'whatsapp',active:true,dispatch_ready:true}];
   if(table==='templates') data=[{id:'t1',name:'Boas-vindas',status:'active',clickmassa_channel_id:'c1',body:'Olá, {{1}}!',variables:[{key:'1',label:'Primeiro nome'}]}];
   if(table==='services') data=[{id:'s1',name:'Corte',active:true}];
   if(table==='customers'){
    data=customers.filter(c=>(!filters.id||c.id===filters.id)&&(!search||c.name.includes(search)||c.phone.includes(search)));
    if(filters['appointments.service_id']) data=data.filter(c=>c.id==='person-1');
    if(range) data=data.slice(range[0],range[1]+1);
   }
   if(table==='appointments') data=[{scheduled_at:'2026-11-18T15:00:00Z',status:'completed',services:{name:'Corte'},amount:100}];
   if(table==='automations'){
    if(write){
     window.testCalls.rules.push(write);
     automations=filters.id?automations.map(x=>x.id===filters.id?{...x,...write}:x):[...automations,{id:'new',...write}];
     return {data:{id:filters.id||'new'},error:null};
    }
    data=automations;
   }
   if(table==='message_jobs'&&write) window.testCalls.jobs.push(write);
   if(table==='customers') window.testCalls.queries.push({filters,range,search});
   return {data:single&&Array.isArray(data)?data[0]||null:data,error:null};
  };
  const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q},is:()=>q,not:()=>q,neq:()=>q,
    order:()=>q,limit:()=>q, range:(a,b)=>{range=[a,b];return q},
    or:(value,options)=>{if(!options) search=value.split('%')[1];return q},
    single:async()=>{single=true;return result()},maybeSingle:async()=>result(),
    insert:value=>{write=value;return q},update:value=>{write=value;return q},
    then:(resolve,reject)=>Promise.resolve().then(result).then(resolve,reject)};
  return q;
 }
})};
"""


def fulfill(route):
    request = urlsplit(route.request.url)
    if request.hostname == "cdn.jsdelivr.net":
        return route.fulfill(content_type="text/javascript", body=MOCK)
    if request.hostname != "localhost":
        return route.fulfill(status=204, body="")
    if request.path == "/config.js":
        return route.fulfill(content_type="text/javascript", body=(
            "window.FLOWSUITE_CONFIG={supabaseUrl:'https://example.supabase.test',"
            "supabaseAnonKey:'public-test-key'};"
        ))
    path = "index.html" if request.path == "/" or request.path.startswith("/e/") else request.path[1:]
    file = ROOT / path
    mime = {".html":"text/html",".css":"text/css",".js":"text/javascript",".json":"application/json"}
    if not file.is_file() or file.suffix not in mime:
        return route.fulfill(status=404, body="")
    headers = {}
    if file.suffix == ".html":
        nginx = (ROOT / "nginx.conf").read_text(encoding="utf-8")
        headers["Content-Security-Policy"] = re.search(r'Content-Security-Policy "([^"]+)"', nginx)[1]
        html = file.read_text(encoding="utf-8").replace("v=local", "v=smoke-build").replace(
            'name="flowsuite-asset-version" content="local"',
            'name="flowsuite-asset-version" content="smoke-build"',
        )
        return route.fulfill(body=html, content_type=mime[file.suffix], headers=headers)
    return route.fulfill(body=file.read_bytes(), content_type=mime[file.suffix], headers=headers)


def navigate(page, label, mobile=False):
    if mobile:
        page.get_by_role("button",name="Menu",exact=True).click()
    page.get_by_role("navigation").get_by_role("button",name=label,exact=False).click()


with sync_playwright() as p:
    browser_path = os.environ.get("FLOWSUITE_TEST_BROWSER")
    options = {"executable_path":browser_path} if browser_path else {}
    browser = p.chromium.launch(headless=True, **options)
    page = browser.new_page(viewport={"width":1280,"height":860})
    page.set_default_timeout(8000)
    errors = []
    page.on("pageerror",lambda error: errors.append(str(error)))
    page.route("**/*",fulfill)
    with page.expect_request("**/assets/js/app.js?v=smoke-build"):
        page.goto(BASE+"/e/teste")
    expect(page.get_by_role("heading",name="Visão geral")).to_be_visible()

    with page.expect_request("**/assets/data/avec-reports.json?v=smoke-build"):
        navigate(page,"Relatórios AVEC")
    expect(page.get_by_role("heading",name="Catálogo de relatórios (230)")).to_be_visible()
    page.get_by_label("Pesquisar por código ou assunto").fill("0107")
    page.locator(".avec-report-list").get_by_role("button",name=re.compile("0107")).click()
    expect(page.get_by_text("Clientes que não retornam há dias",exact=False).last).to_be_visible()

    navigate(page,"Automações")
    page.get_by_role("button",name="Editar",exact=True).click()
    expect(page.get_by_role("dialog")).to_be_visible()
    expect(page.get_by_label("Campo Primeiro nome")).to_have_value("__saved")
    page.get_by_role("button",name="Salvar automação").click()
    expect(page.get_by_role("dialog")).to_have_count(0)
    saved = page.evaluate("window.testCalls.rules[0]")
    assert saved["variable_mapping"] == {"1":"legacy.full_name"}, saved
    assert saved["rules"]["extra_legacy"] is True
    page.get_by_role("button",name="Nova regra").click()
    page.get_by_label("Tipo de automação").select_option("stock")
    expect(page.get_by_label("Telefone do responsável com DDI")).to_be_visible()
    expect(page.get_by_label("Serviço recomendado")).to_be_hidden()
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog")).to_have_count(0)

    page.set_viewport_size({"width":390,"height":844})
    navigate(page,"Envio manual",mobile=True)
    page.get_by_label("Canal",exact=True).select_option("c1")
    page.get_by_label("Modelo de mensagem").select_option("t1")
    page.get_by_label("Campo Primeiro nome").select_option("customer.name")
    expect(page.locator("[data-template-preview]")).to_have_text("Olá, Mariana!")
    page.get_by_role("button",name="Próxima").click()
    page.get_by_role("checkbox",name=re.compile("Cliente 26")).check()
    page.get_by_label("Buscar por nome ou telefone").fill("Cliente 01")
    page.get_by_role("checkbox",name=re.compile("Cliente 01")).check()
    expect(page.locator("#manual-count")).to_have_text("2 selecionados de 100")
    page.get_by_label("Serviço já realizado").select_option("s1")
    expect(page.locator("#manual-count")).to_have_text("0 selecionados de 100")
    page.get_by_role("checkbox",name=re.compile("Cliente 01")).check()
    expect(page.get_by_label("Campo Primeiro nome")).to_have_value("customer.name")
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    page.get_by_role("checkbox",name="Confirmo que os destinatários autorizaram este envio.").check()
    page.get_by_role("button",name="Adicionar à fila").click()
    expect(page.get_by_role("heading",name="Relatórios de envios")).to_be_visible()
    jobs = page.evaluate("window.testCalls.jobs[0]")
    assert len(jobs) == 1 and jobs[0]["customer_id"] == "person-1", jobs
    assert jobs[0]["payload"]["variable_mapping"] == {"1":"customer.name"}

    navigate(page,"Envio manual",mobile=True)
    page.get_by_label("Canal",exact=True).select_option("c2")
    expect(page.get_by_label("Modelo de mensagem")).to_be_hidden()
    page.get_by_label("Mensagem",exact=True).fill("Olá, contato de teste")
    page.get_by_label("Nota interna (opcional)").fill("Apenas equipe")
    page.get_by_role("checkbox",name=re.compile("Cliente 01")).check()
    page.get_by_role("checkbox",name="Confirmo que os destinatários autorizaram este envio.").check()
    page.get_by_role("button",name="Adicionar à fila").click()
    expect(page.get_by_role("heading",name="Relatórios de envios")).to_be_visible()
    qr = page.evaluate("window.testCalls.jobs[1][0]")
    assert qr["template_id"] is None and qr["payload"]["transport"] == "clickmassa"
    assert qr["payload"]["body"] == "Olá, contato de teste" and qr["payload"]["note"] == "Apenas equipe"

    navigate(page,"Clientes e histórico",mobile=True)
    page.get_by_label("Buscar por nome ou telefone").fill("Cliente 30")
    expect(page.get_by_text("Cliente 30",exact=True)).to_be_visible()
    page.get_by_role("button",name="Histórico",exact=True).click()
    expect(page.get_by_role("dialog").get_by_text("Concluído")).to_be_visible()
    page.keyboard.press("Escape")

    viewer = browser.new_page()
    viewer.route("**/*",fulfill)
    viewer.set_default_timeout(8000)
    viewer.add_init_script("window.FLOWSUITE_TEST_ROLE='viewer'")
    viewer.goto(BASE)
    navigate(viewer,"Envio manual")
    expect(viewer.get_by_text("Um operador ou gestor pode adicionar mensagens à fila.")).to_be_visible()
    expect(viewer.get_by_role("button",name="Adicionar à fila")).to_have_count(0)
    assert not errors, errors
    browser.close()
print("PASS browser: desktop e celular, catálogo, formulário legado, fila, histórico e perfil de leitura.")
