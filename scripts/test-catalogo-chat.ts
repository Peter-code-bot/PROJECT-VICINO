import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadChatCatalog } from '../apps/web/lib/chat/catalogo-chat';
import { getChatProductsSchema } from '../packages/shared/src/validators/sale-confirmation';

const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
function fixture(totals=[51,1],fail='') {
  const products=totals.flatMap((total,index)=>Array.from({length:total},(_,i)=>({id:`${index}-${i}`,creador_id:[a,b][index],titulo:`Producto ${i}`,estatus:'disponible',is_hidden:false})));
  const calls: {table:string;filters:[string,unknown][];limit:number;search:string}[]=[];
  const client={from(table:string){
    const call={table,filters:[] as [string,unknown][],limit:Infinity,search:''};calls.push(call);
    const q={select(){return q},eq(k:string,v:unknown){call.filters.push([k,v]);return q},in(k:string,v:unknown){call.filters.push([k,v]);return q},order(){return q},limit(n:number){call.limit=n;return q},ilike(_k:string,v:string){call.search=v;return q},then(resolve:(v:unknown)=>unknown){
      if(fail===table)return Promise.resolve({data:null,error:{message:'synthetic failure'}}).then(resolve);
      const rows=table==='profiles'?[{id:a,nombre:'Primero',foto:null},{id:b,nombre:'Segundo',foto:null}]:products;
      const filtered=rows.filter(row=>call.filters.every(([k,v])=>Array.isArray(v)?v.includes(row[k as keyof typeof row]):row[k as keyof typeof row]===v));
      return Promise.resolve({data:(call.search?filtered.filter(row=>('titulo'in row)&&row.titulo.includes(call.search.slice(1,-1))):filtered).slice(0,call.limit),error:null}).then(resolve);
    }};return q;
  }};
  return {client:client as unknown as Parameters<typeof loadChatCatalog>[0],calls,products};
}
test('eligibility is independent of 50-row limit and query; no seller means choose first',async()=>{
  const f=fixture();const r=await loadChatCatalog(f.client,[a,b]);
  assert.equal(r.sellers.length,2);assert.equal(r.sellerId,null);assert.deepEqual(r.data,[]);
  const second=await loadChatCatalog(f.client,[a,b],b,'missing');
  assert.equal(second.sellers.length,2);assert.equal(second.sellerId,b);assert.deepEqual(second.data,[]);
});
test('only selected participant products are returned before limit',async()=>{
  const f=fixture();const r=await loadChatCatalog(f.client,[a,b],b);
  assert.equal(r.data.length,1);assert(r.data.every(p=>p.creador_id===b));
  const first=await loadChatCatalog(f.client,[a,b],a);assert.equal(first.data.length,50);
});
test('single eligible seller is automatic; hidden and unavailable products do not qualify',async()=>{
  const f=fixture([1,2]);f.products[0]!.is_hidden=true;f.products[1]!.estatus='pausado';
  const r=await loadChatCatalog(f.client,[a,b],a);assert.equal(r.sellers.length,1);assert.equal(r.sellerId,b);assert.equal(r.data.length,1);
});
test('empty and failures are distinct',async()=>{
  const f=fixture([0,0]);assert.deepEqual(await loadChatCatalog(f.client,[a,b]),{data:[],sellers:[],sellerId:null});
  for(const table of ['profiles','products_services'])await assert.rejects(loadChatCatalog(fixture([1,1],table).client,[a,b],a));
});
test('foreign seller rejected before querying, UUID contract validates seller',async()=>{
  const f=fixture();await assert.rejects(loadChatCatalog(f.client,[a,b],'foreign'));assert.equal(f.calls.length,0);
  assert.equal(getChatProductsSchema.safeParse({chatId:a,sellerId:'foreign'}).success,false);
});
test('LIKE wildcard search is literal',async()=>{
  const f=fixture();await loadChatCatalog(f.client,[a,b],a,'%_');
  assert.equal(f.calls.at(-1)!.search,'%\\%\\_%');
});
