// SQL PostgreSQL en WASM y acciones reales; sin red, cuentas ni claves reales.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const actor = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
let checks = 0;
async function check(name: string, fn: () => Promise<void>) { await fn(); checks++; console.log(`PASS ${name}`); }

async function main() {
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
    CREATE TABLE profiles(id uuid PRIMARY KEY);
    CREATE TABLE user_roles(user_id uuid REFERENCES profiles(id),role app_role,PRIMARY KEY(user_id,role));
    CREATE FUNCTION public.has_role(p_id uuid,p_role app_role) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_id AND role=p_role)$$;
    INSERT INTO profiles VALUES ('${actor}'),('${target}');
    INSERT INTO user_roles VALUES ('${actor}','admin');
    GRANT INSERT,UPDATE,DELETE ON user_roles TO authenticated;
    GRANT INSERT(role),UPDATE(role) ON user_roles TO authenticated;
  `);
  await db.exec(await readFile(path.join(root,"supabase/migrations/20260826200000_admin_set_user_role_rpc.sql"),"utf8"));
  const migration = await readFile(path.join(root,"supabase/migrations/20261011213000_admin_roles_solo_servidor.sql"),"utf8");
  await db.exec(migration);
  async function rpc(role: string, id: string | null = actor, grant = true, to = target) {
    await db.query("SELECT set_config('request.jwt.claim.role',$1,false)",[role]);
    await db.exec(`SET ROLE ${role}`);
    try { await db.query("SELECT public.admin_set_user_role_secure($1,$2,'admin',$3)",[id,to,grant]); }
    finally { await db.exec("RESET ROLE"); }
  }
  for (const role of ["anon","authenticated"]) {
    await check(`${role} no puede invocar RPC nuevo ni histórico`,async()=>{
      for(const signature of ["public.admin_set_user_role_secure(uuid,uuid,public.app_role,boolean)","public.admin_set_user_role(uuid,public.app_role,boolean)"]){
        const {rows}=await db.query<{allowed:boolean}>("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,signature]); assert.equal(rows[0].allowed,false);
      }
      await assert.rejects(()=>rpc(role), (e:any)=>e.code==="42501");
    });
    await check(`${role} no conserva escritura de tabla ni de columna`,async()=>{
      const {rows}=await db.query<{write:boolean}>("SELECT has_table_privilege($1,'public.user_roles','INSERT,UPDATE,DELETE') OR has_any_column_privilege($1,'public.user_roles','INSERT,UPDATE') AS write",[role]);assert.equal(rows[0].write,false);
    });
  }
  await check("service_role con actor no admin no concede roles",async()=>{await assert.rejects(()=>rpc("service_role",target),(e:any)=>e.code==="42501");});
  await check("service_role sin actor rechaza entrada",async()=>{await assert.rejects(()=>rpc("service_role",null),(e:any)=>e.code==="22023");});
  await check("canal correcto concede de forma idempotente",async()=>{await rpc("service_role");await rpc("service_role");const {rows}=await db.query<{count:number}>("SELECT count(*)::int AS count FROM user_roles WHERE user_id=$1 AND role='admin'",[target]);assert.equal(rows[0].count,1);});
  await check("auto-retiro bloqueado, otro retiro permitido",async()=>{await assert.rejects(()=>rpc("service_role",actor,false,actor),(e:any)=>e.code==="22023");await rpc("service_role",actor,false);const {rows}=await db.query<{count:number}>("SELECT count(*)::int AS count FROM user_roles WHERE user_id=$1 AND role='admin'",[target]);assert.equal(rows[0].count,0);});
  await check("actor revocado tras la lectura web no puede escribir",async()=>{await db.query("DELETE FROM user_roles WHERE user_id=$1",[actor]);await assert.rejects(()=>rpc("service_role"),(e:any)=>e.code==="42501");await db.query("INSERT INTO user_roles VALUES ($1,'admin')",[actor]);});
  await check("claims no-service bloqueados incluso con permiso de dueño",async()=>{await db.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");await assert.rejects(()=>db.query("SELECT admin_set_user_role_secure($1,$2,'admin',true)",[actor,target]),(e:any)=>e.code==="42501");});
  await check("migración reaplicable conserva contrato",async()=>{await db.exec(migration);const {rows}=await db.query<{allowed:boolean}>("SELECT has_function_privilege('authenticated','public.admin_set_user_role_secure(uuid,uuid,public.app_role,boolean)','EXECUTE') AS allowed");assert.equal(rows[0].allowed,false);});
} finally { await db.close(); }

const mocks: Record<string,string> = {
  "server-only":"export {};",
  "@/lib/supabase/server":"export const createClient=async()=>globalThis.state.client;",
  "@/lib/supabase/admin":"export const createAdminClient=()=>{globalThis.state.adminCreated++;return {rpc:async(name,args)=>{globalThis.state.calls.push({name,args});return globalThis.state.rpcResult;}};};",
  "@/lib/rate-limit":"export const writeRateLimit={};export const adminSecurityRateLimit={};export const enforce=async()=>globalThis.state.rate;",
};
const bundle = await esbuild.build({entryPoints:[path.join(root,"apps/web/app/admin/users/actions.ts")],bundle:true,platform:"node",format:"cjs",write:false,tsconfig:path.join(root,"apps/web/tsconfig.json"),plugins:[{name:"boundaries",setup(build:any){build.onResolve({filter:/.*/},(a:any)=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:"mock"}:undefined);build.onLoad({filter:/.*/,namespace:"mock"},(a:any)=>({contents:mocks[a.path],loader:"js"}));}}]});
function fixture(options:any={}) {
  const key = randomBytes(32).toString("base64url");
  const state:any={calls:[],adminCreated:0,rpcResult:options.rpcResult??{error:null},rate:options.rate??{ok:true}};
  state.client={auth:{getUser:async()=>({data:{user:options.guest?null:{id:actor}}})},from:()=>({select:()=>({eq:()=>({eq:()=>({single:async()=>({data:options.nonAdmin?null:{role:"admin"}})})})})}),rpc:()=>{throw Error("Client RPC forbidden");}};
  const module={exports:{} as any};
  const context=vm.createContext({module,exports:module.exports,require,state,process:{env:options.unconfigured?{}:{ADMIN_SECURITY_PASSWORD:key}},Buffer,Date,console,setTimeout,clearTimeout});
  new vm.Script(bundle.outputFiles[0].text).runInContext(context);
  return {state,key,api:module.exports};
}
for (const method of ["assignRole","removeRole"]) {
  for(const options of [{guest:true},{nonAdmin:true}]) await check(`${method}: sesión y admin antes de cliente privilegiado`,async()=>{const f=fixture(options);await assert.rejects(()=>f.api[method](target,"admin",f.key));assert.equal(f.state.adminCreated,0);});
  for(const mode of ["unconfigured","empty","wrong"]) await check(`${method}: clave ${mode} no llega al RPC`,async()=>{const f=fixture({unconfigured:mode==="unconfigured"});const result=await f.api[method](target,"admin",mode==="empty"?"":mode==="wrong"?randomBytes(24).toString("hex"):f.key);assert.ok(result.error);assert.equal(f.state.adminCreated,0);});
  await check(`${method}: datos inválidos no llegan al RPC`,async()=>{const f=fixture();assert.ok((await f.api[method]("not-uuid","admin",f.key)).error);assert.equal(f.state.adminCreated,0);});
  await check(`${method}: canal correcto liga actor verificado y decisión`,async()=>{const f=fixture();assert.equal((await f.api[method](target,"admin",f.key)).success,true);assert.deepEqual(JSON.parse(JSON.stringify(f.state.calls)),[{name:"admin_set_user_role_secure",args:{p_actor_id:actor,p_user_id:target,p_role:"admin",p_grant:method==="assignRole"}}]);});
  await check(`${method}: fallo SQL no informa éxito`,async()=>{const f=fixture({rpcResult:{error:{message:"denegado"}}});const result=await f.api[method](target,"admin",f.key);assert.equal(result.error,"denegado");assert.equal(result.success,undefined);});
}
await check("clave correcta sigue respetando límite",async()=>{const f=fixture({rate:{ok:false,error:"limitado"}});assert.equal((await f.api.assignRole(target,"admin",f.key)).error,"limitado");assert.equal(f.state.adminCreated,0);});
console.log(`PASS ${checks}/${checks} seguridad de roles: SQL y acciones reales aisladas. Sin red ni claves reales.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
