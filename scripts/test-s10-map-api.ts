/** Actual Next route and auth resolver; database/rate transport are fixtures. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
const web=path.resolve(__dirname,'../apps/web'),req=createRequire(path.join(web,'package.json'));
const esbuild=req(req.resolve('esbuild',{paths:[req.resolve('tsx')]}));
async function main(){
  const out=path.join(web,'test-results/s10');mkdirSync(out,{recursive:true});
  const mocks:Record<string,string>={
    'server-only':'',
    '@/lib/supabase/server':`export async function createClient(){globalThis.mapTest.clients++;return {auth:{getUser:async()=>globalThis.mapTest.auth},rpc:(name,args)=>{globalThis.mapTest.calls.push({name,args});return {abortSignal:async()=>globalThis.mapTest.rpc};}};}`,
    '@/lib/rate-limit':`export const readHeavyRateLimit=null;export const getClientIp=h=>h.get('x-real-ip')||'unknown';export const enforce=async()=>({ok:!globalThis.mapTest.limited});`,
  };
  const bundle=await esbuild.build({entryPoints:[path.join(web,'app/api/publications/map/route.ts')],bundle:true,write:false,platform:'node',format:'cjs',tsconfig:path.join(web,'tsconfig.json'),external:['next/*','@supabase/supabase-js'],plugins:[{name:'seams',setup(b:any){b.onResolve({filter:/.*/},(a:any)=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},(a:any)=>({contents:mocks[a.path],loader:'ts',resolveDir:web}));}}]});
  const file=path.join(out,'api.cjs');writeFileSync(file,bundle.outputFiles[0].text);const {POST}=req(file);
  const f=(globalThis as any).mapTest={clients:0,calls:[],limited:false,auth:{data:{user:null},error:{name:'AuthSessionMissingError'}},rpc:{data:null,error:null}};
  const base={bounds:{west:-98.4,south:18.9,east:-98,north:19.2}};
  let n=0,passed=0;
  const send=(q:unknown=base)=>POST(new Request('https://local.invalid/api/publications/map',{method:'POST',headers:{'Content-Type':'application/json','x-real-ip':'test-'+(++n)},body:JSON.stringify(q)}));
  async function test(name:string,run:()=>Promise<void>){await run();passed++;console.log('PASS '+name);}
  await test('feature flag refuses before contacting auth or RPC',async()=>{process.env.NEXT_PUBLIC_VICINO_MAP_ENABLED='false';const r=await send();assert.equal(r.status,503);assert.equal(f.clients,0);assert.equal(r.headers.get('cache-control'),'private, no-store');});
  process.env.NEXT_PUBLIC_VICINO_MAP_ENABLED='true';
  await test('invalid and oversized body never query database',async()=>{assert.equal((await send({...base,unknown:1})).status,400);assert.equal((await send({...base,q:'x'.repeat(9000)})).status,413);assert.equal(f.clients,0);});
  await test('transient auth failure is not downgraded to guest',async()=>{f.auth={data:{user:null},error:{name:'AuthRetryableFetchError',status:503}};assert.equal((await send()).status,503);assert.equal(f.calls.length,0);});
  f.auth={data:{user:null},error:{name:'AuthSessionMissingError'}};
  await test('valid guest response strips private fields and passes canonical filters',async()=>{
    f.rpc={error:null,data:{query_key:'a'.repeat(32),projection_version:1,as_of:'2026-09-30',features:[],listings:[],total:0,seller_total:0,list_total:0,next_cursor:null,ubicacion_geo:'private'}};
    const r=await send({...base,q:' cafe ',center:{lat:19,lng:-98}});assert.equal(r.status,200);assert.equal(r.headers.get('vary'),'Cookie');assert.ok(!JSON.stringify(await r.json()).includes('private'));
    assert.equal(f.calls.at(-1).name,'search_map_publications_v1');assert.equal(f.calls.at(-1).args.p_query.q,'cafe');assert.equal(f.calls.at(-1).args.p_query.center,null);
  });
  await test('production release is enabled when the optional flag is absent',async()=>{
    delete process.env.NEXT_PUBLIC_VICINO_MAP_ENABLED;
    assert.equal((await send()).status,200);
    process.env.NEXT_PUBLIC_VICINO_MAP_ENABLED='true';
  });
  await test('bad SQL response and SQL failures expose generic errors only',async()=>{
    f.rpc={data:{ubicacion_geo:'private'},error:null};assert.equal((await send()).status,503);
    f.rpc={data:null,error:{code:'XX000',message:'sensitive SQL details'}};const r=await send();assert.equal(r.status,503);assert.ok(!(await r.text()).includes('sensitive'));
    f.rpc.error.code='22023';assert.equal((await send()).status,409);
  });
  await test('quota returns retry delay before database access',async()=>{f.limited=true;const before=f.clients;const r=await send();assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.equal(f.clients,before);});
  console.log(`S10 API: ${passed}/${passed} PASS`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
