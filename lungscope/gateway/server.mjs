import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const FRONTEND_DIR = resolve(process.env.FRONTEND_DIR || join(here, '../frontend/dist'));
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY = Number(process.env.MODEL_PROXY_MAX_BODY || 4_200_000);
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_PROXY_TIMEOUT_MS || 300_000);
const MODEL_SERVICE_URL = String(process.env.MODEL_SERVICE_URL || '').replace(/\/+$/, '');
const MODEL_SERVICE_BEARER_TOKEN = String(process.env.MODEL_SERVICE_BEARER_TOKEN || '');

const ALLOWED_MODEL_PATHS = new Set(['/v1/health','/v1/head/info','/v1/warmup','/v1/infer','/v1/ast','/v1/opera','/v1/opera/encode','/v1/benchmark/info','/v1/benchmark']);
const MIME = new Map([['.html','text/html; charset=utf-8'],['.json','application/json; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.wav','audio/wav'],['.ico','image/x-icon'],['.txt','text/plain; charset=utf-8']]);

function json(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}
async function readBody(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){const e=new Error('model payload too large');e.statusCode=413;throw e;}chunks.push(chunk);}return Buffer.concat(chunks);}
function normalizeModelPath(raw){if(!raw||raw.includes('://')||raw.includes('..')||!raw.startsWith('/v1/'))return null;let u;try{u=new URL(raw,'http://lungscope.local');}catch{return null;}if(!ALLOWED_MODEL_PATHS.has(u.pathname))return null;return `${u.pathname}${u.search}`;}
async function proxyModel(req,res,url){
  if(!MODEL_SERVICE_URL)return json(res,503,{detail:'MODEL_SERVICE_URL is not configured'});
  if(!['GET','POST','OPTIONS'].includes(req.method||''))return json(res,405,{detail:'method not allowed'});
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  const modelPath=normalizeModelPath(url.searchParams.get('path')||''); if(!modelPath)return json(res,400,{detail:'invalid or non-public model-service path'});
  const headers={}; for(const name of ['content-type','x-sample-rate','x-cycles','x-pcm-format']){const value=req.headers[name];if(value)headers[name]=value;}
  if(MODEL_SERVICE_BEARER_TOKEN)headers.authorization=MODEL_SERVICE_BEARER_TOKEN.startsWith('Bearer ')?MODEL_SERVICE_BEARER_TOKEN:`Bearer ${MODEL_SERVICE_BEARER_TOKEN}`;
  let body; try{if(req.method==='POST')body=await readBody(req);}catch(err){return json(res,err.statusCode||400,{detail:err.message||String(err)});}
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),MODEL_TIMEOUT_MS);
  try{
    const upstream=await fetch(`${MODEL_SERVICE_URL}${modelPath}`,{method:req.method,headers,body:req.method==='POST'?body:undefined,signal:controller.signal,redirect:'manual'});
    res.statusCode=upstream.status;res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');res.setHeader('Cache-Control','no-store');res.end(Buffer.from(await upstream.arrayBuffer()));
  }catch(err){json(res,err?.name==='AbortError'?504:502,{detail:err?.name==='AbortError'?'model service proxy timed out':`model service proxy failed: ${err?.message||err}`});}
  finally{clearTimeout(timer);}
}
async function serveStatic(req,res,url){
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{pathname='/';} if(pathname==='/')pathname='/index.html';
  const rel=normalize(pathname).replace(/^([/\\])+/,''); let target=resolve(FRONTEND_DIR,rel); if(!target.startsWith(FRONTEND_DIR))return json(res,403,{detail:'forbidden'});
  try{const info=await stat(target);if(info.isDirectory())target=join(target,'index.html');const data=await readFile(target);res.statusCode=200;res.setHeader('Content-Type',MIME.get(extname(target).toLowerCase())||'application/octet-stream');res.setHeader('Cache-Control',target.endsWith('index.html')||target.endsWith('runtime_config_v090.json')?'no-store':'public, max-age=3600');return res.end(data);}
  catch{try{const data=await readFile(join(FRONTEND_DIR,'index.html'));res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(data);}catch{return json(res,404,{detail:'not found'});}}
}
const server=createServer(async(req,res)=>{const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);try{if(url.pathname==='/healthz')return json(res,200,{ok:true,service:'lungscope-gateway',modelConfigured:Boolean(MODEL_SERVICE_URL)});if(url.pathname==='/api/model')return await proxyModel(req,res,url);return await serveStatic(req,res,url);}catch(err){console.error('[gateway] unhandled request error',err);return json(res,500,{detail:'gateway internal error'});}});
server.listen(PORT,'0.0.0.0',()=>console.log(`LungScope gateway listening on :${PORT} · model proxy ${MODEL_SERVICE_URL?'configured':'not configured'}`));
