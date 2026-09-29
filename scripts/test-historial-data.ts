import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixtureClient } from './fixtures/historial-client.mjs';
import { loadHistorial } from '../apps/web/lib/historial/data';
import { historialHref, parseHistorialLocation, reviewHref } from '../apps/web/lib/historial/navigation';

type Client = Parameters<typeof loadHistorial>[0];
const now = new Date('2026-09-28T12:00:00Z');
const location = { tab: 'ventas' as const, ventasPage: 1, comprasPage: 1 };
for (const total of [0,1,50,51,120]) test(`all ${total} operations are reachable once, totals and stats independent of page`, async () => {
  const fixture = createFixtureClient({ total });
  // Add foreign data: every query must still scope to the authenticated user.
  fixture.sales.push({ ...fixture.sales[0], id:'foreign', buyer_id:'foreign', seller_id:'foreign', status:'completed', created_at:now.toISOString() });
  const seen = { ventas: new Set<string>(), compras: new Set<string>() };
  for (let page=1;page<=Math.max(1,Math.ceil(total/50));page++) {
    const result = await loadHistorial(fixture as unknown as Client,'synthetic-user',{...location,ventasPage:page,comprasPage:page},now);
    for (const role of ['ventas','compras'] as const) {
      assert.equal(result[role].total,total);
      assert.equal(result[role].error,false);
      assert.equal(result[role].items.length,Math.min(50,Math.max(0,total-(page-1)*50)));
      for (const row of result[role].items) {assert(!seen[role].has(row.id));seen[role].add(row.id)}
    }
    assert.equal(result.stats?.completadas, Math.floor(total/5)*2+Math.min(total%5,2));
    assert.equal(result.stats?.enCurso, Math.floor(total/5)+(total%5>=3?1:0));
    assert.equal(result.stats?.ultimosSieteDias,total-Math.floor(total/5)-(total%5>=2?1:0));
    assert.equal(result.reviewsError,false);
  }
  for(const role of ['ventas','compras'] as const)assert.equal(seen[role].size,total);
  for(const call of fixture.calls.filter(c=>c.table==='sale_confirmations'&&!c.options.head))assert.deepEqual(call.orders,[{field:'created_at',ascending:false,nullsFirst:false},{field:'id',ascending:false}]);
  for(const call of fixture.calls.filter(c=>c.table==='reviews'))assert(call.filters.some(f=>f.field==='sale_confirmation_id'&&f.op==='in'&&f.value.length<=100));
});
for(const failure of ['ventas','compras','stats','reviews','throw'])test(`failure ${failure} stays explicit and independent`,async()=>{
  const fixture=createFixtureClient({total:51,failure});
  const result=await loadHistorial(fixture as unknown as Client,'synthetic-user',location,now);
  assert.equal(result.ventas.error,failure==='ventas'||failure==='throw');
  assert.equal(result.compras.error,failure==='compras'||failure==='throw');
  assert.equal(result.stats===null,failure==='stats'||failure==='throw');
  assert.equal(result.reviewsError,failure==='reviews');
  if(failure==='reviews')assert.deepEqual(result.reviewedSales,[]);
});
test('invalid/out-of-range parameters and internal-only review return',async()=>{
  for(const v of ['0','-1','1.5','NaN','Infinity','1000000','02',['2']])assert.equal(parseHistorialLocation({ventasPage:v}).ventasPage,1);
  assert.equal(parseHistorialLocation({tab:'https://evil.invalid'}).tab,'ventas');
  const fixture=createFixtureClient({total:51});
  const result=await loadHistorial(fixture as unknown as Client,'synthetic-user',{...location,ventasPage:999},now);
  assert.equal(result.ventas.page,2);assert.equal(result.ventas.items.length,1);
  assert.equal(result.ventas.error,false);
  const empty=await loadHistorial(createFixtureClient({total:0}) as unknown as Client,'synthetic-user',{...location,comprasPage:999},now);
  assert.equal(empty.compras.page,1);assert.equal(empty.compras.total,0);assert.equal(empty.compras.error,false);
  const destination={tab:'compras' as const,ventasPage:2,comprasPage:3};
  assert.equal(historialHref(destination),'/historial?tab=compras&ventasPage=2&comprasPage=3');
  const review=new URL(reviewHref('hidden-product-sale',destination),'https://local.invalid');
  assert.equal(review.searchParams.get('type'),'buyer_to_seller');assert.equal(review.searchParams.has('product'),false);
  assert.deepEqual(parseHistorialLocation(Object.fromEntries(review.searchParams)),destination);
});
test('seven-day rolling period excludes null, old and future dates',async()=>{
  const fixture=createFixtureClient({total:5});
  const dates=[null,'2026-09-21T11:59:59Z','2026-09-21T12:00:00.000Z','2026-09-28T12:00:00.000Z','2026-09-28T12:00:01Z'];
  fixture.sales.filter(s=>s.seller_id==='synthetic-user').forEach((row,i)=>row.created_at=dates[i]);
  const result=await loadHistorial(fixture as unknown as Client,'synthetic-user',location,now);
  assert.equal(result.stats?.ultimosSieteDias,2);
});
