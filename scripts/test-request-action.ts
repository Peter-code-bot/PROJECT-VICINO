/** Executes the real Server Action with only Supabase/rate-limit boundaries
 * stubbed in a Node VM. No remote auth, database or Redis calls. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
const web=path.resolve("apps/web");
const req=createRequire(path.join(web,"package.json"));
const esbuild=req(req.resolve("esbuild",{paths:[req.resolve("tsx")]}));
const userId="30000000-0000-4000-8000-000000000001";
const operationId="30000000-0000-4000-8000-000000000010";
let passed=0;
const mocks:Record<string,string>={
 "@/lib/supabase/server":"export async function createClient(){return globalThis.fixture.client}",
 "@/lib/rate-limit":"export const writeRateLimit={kind:'write'};export async function enforce(limiter,key){globalThis.fixture.order.push('rate');globalThis.fixture.rateCalls.push({limiter,key});return globalThis.fixture.rate}",
};
async function main(){
 const fixture:any={order:[],rateCalls:[],rpcCalls:[],rate:{ok:true},user:{id:userId},response:{data:operationId,error:null}};
 fixture.client={auth:{getUser:async()=>{fixture.order.push('auth');return {data:{user:fixture.user},error:null}}},rpc:async(name:string,args:any)=>{fixture.order.push('rpc');fixture.rpcCalls.push({name,args});return fixture.response}};
 const bundle=await esbuild.build({entryPoints:[path.join(web,"app/actions/purchase-request.ts")],bundle:true,platform:"node",packages:"external",format:"cjs",write:false,tsconfig:path.join(web,"tsconfig.json"),plugins:[{name:"server-boundaries",setup(build:any){build.onResolve({filter:/.*/},(args:any)=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:"mock"}:undefined);build.onLoad({filter:/.*/,namespace:"mock"},(args:any)=>({contents:mocks[args.path],loader:"js",resolveDir:web}));}}]});
 const mod={exports:{} as {createPurchaseRequest:(input:unknown)=>Promise<any>}};
 new vm.Script(bundle.outputFiles[0].text).runInNewContext({module:mod,exports:mod.exports,require:req,fixture,URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:"https://supabase-fixture.invalid"}}});
 const create=mod.exports.createPurchaseRequest;
 const input={operation_id:operationId,request_title:"Busco una silla",request_lat:17.99,request_lng:-92.94,category_slugs:["comida"],expiry_hours:72};
 async function test(name:string,fn:()=>Promise<void>){fixture.order=[];fixture.rateCalls=[];fixture.rpcCalls=[];fixture.rate={ok:true};fixture.user={id:userId};fixture.response={data:operationId,error:null};await fn();passed++;console.log(`PASS ${name}`)}
 await test("write_rate_limit_after_auth_stops_before_rpc",async()=>{fixture.rate={ok:false,error:"Demasiadas publicaciones. Espera un momento."};const result=await create(input);assert.equal(result.status,"rejected");assert.equal(result.message,fixture.rate.error);assert.equal(fixture.rpcCalls.length,0);assert.deepEqual(fixture.order,["auth","rate"]);assert.equal(fixture.rateCalls[0].key,`write:${userId}`);assert.equal(fixture.rateCalls[0].limiter.kind,"write")});
 await test("missing_auth_stops_before_rate_and_rpc",async()=>{fixture.user=null;assert.equal((await create(input)).status,"rejected");assert.deepEqual(fixture.order,["auth"]);assert.equal(fixture.rpcCalls.length,0)});
 await test("validation_rejects_before_external_calls",async()=>{assert.equal((await create({...input,request_lat:91})).status,"rejected");assert.deepEqual(fixture.order,[])});
 await test("authenticated_atomic_rpc_uses_validated_identity",async()=>{const result=await create({...input,request_title:"  Busco una silla  "});assert.equal(result.status,"success");assert.equal(result.id,operationId);assert.deepEqual(fixture.order,["auth","rate","rpc"]);assert.equal(fixture.rpcCalls[0].name,"create_purchase_request_v2");assert.equal(fixture.rpcCalls[0].args.request_title,"Busco una silla");assert.equal(fixture.rpcCalls[0].args.operation_id,operationId)});
 await test("transport_or_server_error_retains_uncertainty",async()=>{fixture.response={data:null,error:{code:"PGRST000"}};assert.equal((await create(input)).status,"uncertain");fixture.response={data:null,error:{code:"08006"}};assert.equal((await create(input)).status,"uncertain")});
 await test("known_sql_rejection_and_foreign_media_are_rejected",async()=>{fixture.response={data:null,error:{code:"23514"}};assert.equal((await create(input)).status,"rejected");fixture.rpcCalls=[];assert.equal((await create({...input,request_image_url:"https://evil.invalid/storage/v1/object/public/product-media/"+userId+"/solicitudes-"+operationId+".png"})).status,"rejected");assert.equal(fixture.rpcCalls.length,0)});
 console.log(`Solicitudes action: ${passed} tests passed (real action; auth/rate/RPC fixtures)`);
}
main().catch(e=>{console.error(e.stack??e.message);process.exitCode=1});
