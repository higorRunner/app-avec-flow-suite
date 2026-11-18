import assert from 'node:assert/strict';
import test from 'node:test';
import { messagePayload, ProviderError, readCatalog, senderEndpoint, sendMessage } from '../worker/clickmassa.mjs';
import { dispatchOne } from '../worker/service.mjs';

const sendUrl = 'https://suporteapi.clickmassa.com.br/v1/api/external/00000000-0000-0000-0000-000000000001';
const approved = {
  id: 42, tenantId: 10, whatsappId: 1, hsmId: '1600000000000002', name: 'Olá',
  templateType: 'TEXT', status: 'APPROVED', components: [{ type: 'BODY', text: 'Oi {{1}}, somos {{2}}' }],
};
const job = {
  id: 'job-1', phone: '(11) 99999-0000', channel_external_id: '1', channel_type: 'waba',
  provider_template_id: approved.hsmId, variable_keys: ['1','2'],
  fields: { 'customer.name': 'Pessoa', 'establishment.name': 'Unidade' },
  payload: { variable_mapping: { 1: 'customer.name', 2: 'establishment.name' } },
};
const json = data => Response.json(data);

test('separa autenticação de catálogo, pagina por canal e preserva hsmId para envio', async () => {
  const pages = [];
  const data = await readCatalog({ email:'user@example.test', password:'fake', tenantId:10, fetchImpl: async (endpoint, opts) => {
    const url = new URL(endpoint);
    assert.equal(url.host, 'suporteapi.clickmassa.com.br');
    assert.equal(opts.headers.Cookie, undefined);
    if (url.pathname === '/auth/login/') {
      assert.equal(opts.method,'POST');
      assert.deepEqual(JSON.parse(opts.body),{email:'user@example.test',password:'fake',captchaToken:''});
      return json({token:'login-fake',tenantId:10});
    }
    assert.equal(opts.headers.Authorization,'Bearer login-fake');
    if (url.pathname === '/whatsapp/') {
      assert.equal(url.searchParams.get('hideInactive'),'true');
      return json([
        {id:1,tenantId:10,name:'Oficial',type:'waba',isActive:true,status:'CONNECTED',session:'never-export'},
        {id:2,tenantId:10,name:'QR',type:'whatsapp',isActive:true,status:'CONNECTED'},
        {id:3,tenantId:10,name:'Web',type:'webchat',isActive:true,status:'CONNECTED'},
      ]);
    }
    assert.equal(url.searchParams.get('whatsappId'),'1');
    assert.equal(url.searchParams.get('status'),'APPROVED');
    const page = Number(url.searchParams.get('pageNumber'));
    pages.push(page);
    return page === 1
      ? json({templates:[approved], hasMore:true})
      : json({templates:[{...approved,id:43,templateType:'IMAGE'}],hasMore:false});
  }});
  assert.deepEqual(pages,[1,2]);
  assert.deepEqual(data.channels.map(x=>x.type),['waba','whatsapp']);
  assert.equal(data.channels[0].session,undefined);
  assert.deepEqual(data.templates.map(x=>x.status),['active','unsupported']);
  assert.equal(data.templates[0].provider_template_id,approved.hsmId);
  assert.deepEqual(data.templates[0].variables,['1','2']);
});

test('interrompe a sincronização quando a conta é de outro tenant', async () => {
  await assert.rejects(readCatalog({tenantId:11,fetchImpl:async ()=>json({tenantId:10,token:'fake'})}),/tenant/);
});

test('envia parâmetros WABA na ordem e QR com nota interna', () => {
  assert.deepEqual(messagePayload(job),{number:'5511999990000',templateId:approved.hsmId,params:['Pessoa','Unidade'],externalKey:'job-1'});
  assert.deepEqual(messagePayload({...job,channel_type:'whatsapp',payload:{body:'Texto\nlinha',note:'Equipe'}}),
    {number:'5511999990000',externalKey:'job-1',body:'Texto\nlinha',note:{body:'Equipe'}});
  assert.throws(()=>messagePayload({...job,fields:{}}),/Faltam dados/);
});

test('credencial de envio fica no header e resposta pending vira aguardando confirmação', async () => {
  assert.throws(()=>senderEndpoint(sendUrl+'?token=example'));
  assert.throws(()=>senderEndpoint(sendUrl.replace('suporteapi.clickmassa.com.br','example.test')));
  const sent = await sendMessage({url:sendUrl,token:'sender-fake'},messagePayload(job),async (url,opts)=>{
    assert.equal(url,sendUrl);
    assert.equal(opts.headers.Authorization,'Bearer sender-fake');
    assert.equal(opts.redirect,'error');
    return json({message:{id:'provider-1',status:'pending'},ticket:{status:'pending'}});
  });
  assert.deepEqual(sent,{status:'processing',externalId:'provider-1'});
});

test('worker reserva antes de enviar e mantém resultado inconclusivo sem reenvio', async () => {
  const events = [];
  await dispatchOne({
    establishment:'unit-1',senders:new Map([['1',{url:sendUrl}]]),
    rpc:async (name,payload)=>{events.push([name,payload]);if(name==='fs_claim_clickmassa_job')return job},
    submit:async()=>{events.push(['POST']);throw new ProviderError('enviar',null,true)},
  });
  assert.deepEqual(events.map(x=>x[0]),['fs_claim_clickmassa_job','POST','fs_finish_clickmassa_job']);
  assert.equal(events[2][1].p_status,'processing');
  assert.equal(events[2][1].p_external_id,null);
});
