import assert from "node:assert/strict";
import { groupRequestRows } from "../apps/web/lib/solicitudes/request-rows";
import { decodeRequestPage, appendRequestPage, type RequestFeedRow } from "../apps/web/lib/solicitudes/request-feed";
import { isKnownRequestRejection } from "../apps/web/lib/solicitudes/request-creation";
import { readRequestCollection, requestCollectionURL, safeRequestReturn } from "../apps/web/lib/solicitudes/request-navigation";
import { createPurchaseRequestSchema } from "../packages/shared/src/validators/purchase-request";
let passed=0;
function test(name:string,fn:()=>void){fn();passed++;console.log(`PASS ${name}`);}
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const categories=[{slug:"comida",nombre:"Comida"},{slug:"hogar",nombre:"Hogar"}];
const row=(n:number):RequestFeedRow=>({id:id(n),buyer_id:id(1),title:`Solicitud ${n}`,description:null,budget_estimated:0,image_url:null,status:"open",expires_at:"2099-01-01T00:00:00Z",created_at:"2026-10-01T00:00:00Z",distance_meters:400,buyer_profile:{nombre:"Vecino",avatar_url:null},categories,response_count:0});
test("all_categories_membership_dedup_and_tie_order",()=>{
 const a=row(10),b=row(11);const rows=groupRequestRows([{...a,categories:[...categories,categories[0]!]},{...b,categories},a]);
 assert.deepEqual(rows.map(row=>row.category?.slug??"recent"),["recent","comida","hogar"]);
 for(const current of rows)assert.deepEqual(current.requests.map(request=>request.id),[id(11),id(10)]);
});
test("uncategorized_history_only_in_recents",()=>{
 const rows=groupRequestRows([{...row(10),categories:[]}]);assert.equal(rows.length,1);assert.equal(rows[0]?.requests.length,1);
});
test("page_probe_raw_cursor_and_append_identity",()=>{
 const raw=Array.from({length:13},(_,i)=>row(i+1));raw[11]={...row(12),buyer_profile:null};
 const first=decodeRequestPage(raw);assert.equal(first.hasMore,true);assert.equal(first.requests.length,11);assert.deepEqual(first.cursor,{id:id(12),created_at:raw[11]!.created_at});
 assert.equal(appendRequestPage(first.requests,[row(1),row(14)]).length,12);
 assert.equal(decodeRequestPage(raw.slice(0,12)).hasMore,false);
});
test("rejection_classification_retains_transport_uncertainty",()=>{
 for(const code of ["22023","23514","42501","40001","P0001","PGRST202"])assert.equal(isKnownRequestRejection(code),true);
 for(const code of [undefined,"","08006","ECONNRESET","FETCH_ERROR","503","PGRST000"])assert.equal(isKnownRequestRejection(code),false);
});
test("validated_atomic_input_ranges_categories_and_budget",()=>{
 const input={operation_id:id(10),request_title:"Busco una silla",request_lat:17.99,request_lng:-92.94,category_slugs:["comida"],expiry_hours:72};
 assert.equal(createPurchaseRequestSchema.safeParse(input).success,true);
 for(const patch of [{request_lat:NaN},{request_lng:181},{request_budget:-1},{request_budget:Infinity},{request_title:"ab"},{category_slugs:[]},{category_slugs:["comida","comida"]},{category_slugs:["made-up"]},{expiry_hours:4},{buyer_id:id(1)}])assert.equal(createPurchaseRequestSchema.safeParse({...input,...patch}).success,false);
});
test("collection_url_preserves_home_context_and_safe_query",()=>{
 const search=new URLSearchParams("feed=solicitudes&cats=comida&radio=5000&unrelated=retained");
 const url=requestCollectionURL("/",search,"hogar");const parsed=new URL(url,"https://fixture.invalid");
 assert.equal(parsed.pathname,"/");assert.equal(parsed.searchParams.get("cats"),"comida");assert.equal(parsed.searchParams.get("unrelated"),"retained");
 assert.equal(readRequestCollection(parsed.searchParams)?.category?.slug,"hogar");
 assert.equal(readRequestCollection(new URLSearchParams("request_collection=1&request_cat=https://evil.invalid"))?.category,null);
 assert.equal(readRequestCollection(new URLSearchParams("feed=solicitudes")),null);
 assert.equal(new URL(requestCollectionURL("/",parsed.searchParams,null,true),"https://fixture.invalid").searchParams.has("request_cat"),false);
});
test("detail_return_rejects_external_controls_private_and_wrong_feed",()=>{
 const fallback="/?feed=solicitudes";
 for(const target of [undefined,["/?feed=solicitudes"],"https://evil.invalid","//evil.invalid","/\\/evil.invalid","/chat?feed=solicitudes","/?feed=comunidades","/\t/evil.invalid"])assert.equal(safeRequestReturn(target),fallback);
 const context="/?feed=solicitudes&request_collection=1&request_cat=comida&cats=hogar";assert.equal(safeRequestReturn(context),context);
 assert.equal(readRequestCollection(new URLSearchParams("request_collection=1&request_cat=categoria-historica"))?.category?.slug,"categoria-historica");
});
console.log(`Solicitudes behavior: ${passed} tests passed`);
