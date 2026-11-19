import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export const DEFAULT_API_BASE = 'https://suporteapi.clickmassa.com.br';

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 ||
      (a===100 && b>=64 && b<=127) || (a===169 && b===254) ||
      (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0)) ||
      (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return /^[23][0-9a-f]{3}:/.test(normalized) &&
      !normalized.startsWith('2001:db8:') && !normalized.startsWith('2002:') &&
      !normalized.startsWith('2001:0:');
  }
  return false;
}

function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Informe uma URL HTTPS válida da API Clickmassa.'); }
  const host = url.hostname.replace(/^\[|\]$/g,'');
  if (url.protocol!=='https:' || url.username || url.password || url.hash ||
      host==='localhost' || /\.(localhost|local|internal|lan)$/.test(host) ||
      (isIP(host) && !publicAddress(host))) {
    throw new Error('A URL da API deve usar HTTPS e um endereço público.');
  }
  return url;
}

export function apiBase(value = DEFAULT_API_BASE) {
  const url = publicUrl(value);
  if (url.search) throw new Error('Informe a URL base da API sem parâmetros.');
  return url.href.replace(/\/+$/,'');
}

export function apiEndpoint(base, path) {
  return apiBase(base) + '/' + path;
}

export function externalEndpoint(value, base = DEFAULT_API_BASE) {
  const url = publicUrl(value);
  const root = new URL(apiBase(base));
  const prefix = root.pathname.replace(/\/+$/,'');
  if (url.origin!==root.origin || url.search ||
      !/^\/v1\/api\/external\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/?$/i.test(url.pathname.slice(prefix.length)) ||
      !url.pathname.startsWith(prefix)) {
    throw new Error('A URL de envio deve pertencer à API cadastrada e conter a rota externa do canal.');
  }
  return url.href;
}

// Pin the connection to a checked address so an administrator-defined API URL
// cannot resolve to a private service between validation and connection.
export async function publicFetch(value, options = {}) {
  const url = publicUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  const addresses = isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await lookup(hostname,{all:true});
  if (!addresses.length || addresses.some(item=>!publicAddress(item.address))) {
    throw new Error('A API resolveu para um endereço de rede restrito.');
  }
  const target = addresses[0];
  return new Promise((resolve,reject)=>{
    const req = request(url,{
      method:options.method||'GET',
      headers:options.headers,
      signal:options.signal,
      agent:false,
      lookup:(_hostname,settings,callback)=>{
        if (settings.all) callback(null,[target]);
        else callback(null,target.address,target.family);
      },
    },res=>{
      const chunks=[];
      let length=0;
      res.on('data',chunk=>{
        length+=chunk.length;
        if(length>10*1024*1024) res.destroy(new Error('Resposta da API excedeu o limite.'));
        else chunks.push(chunk);
      });
      res.on('error',reject);
      res.on('end',()=>{
        const headers=new Headers();
        for(const [key,value] of Object.entries(res.headers)){
          if(Array.isArray(value)) value.forEach(item=>headers.append(key,item));
          else if(value!==undefined) headers.set(key,value);
        }
        const status=res.statusCode;
        resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers}));
      });
    });
    req.on('error',reject);
    if(options.body)req.write(options.body);
    req.end();
  });
}
