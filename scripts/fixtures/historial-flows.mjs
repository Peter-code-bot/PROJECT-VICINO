import assert from 'node:assert/strict';

export async function runHistorialFlows(browser, url, results) {
  async function scenario(name, callback) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(15000);
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    try { await callback(page); assert.deepEqual(errors,[]);results.push({browser:browser.version(),name,passed:true}); }
    finally {await page.close()}
  }
  for(const total of [0,1,50,51,120])await scenario(`pagination ${total}`, async page=>{
    await page.goto(`${url}/historial?total=${total}`);
    await page.getByRole('button',{name:`Mis ventas ${total}`,exact:true}).waitFor();
    for(const role of ['ventas','compras']) {
      await page.getByRole('button',{name:new RegExp(role==='ventas'?'Mis ventas':'Mis compras')}).click();
      let seen=0;
      do {
        assert.equal(await page.getByRole('button',{name:new RegExp(role==='ventas'?`Mis ventas ${total}$`:`Mis compras ${total}$`)}).getAttribute('aria-pressed'),'true');
        seen+=await page.locator('h3').count();
        const next=page.getByRole('link',{name:'Siguiente',exact:true});
        if(!await next.count())break;
        await next.click();await page.waitForLoadState();await page.getByRole('button',{name:/Mis ventas/}).waitFor();
      }while(true);
      assert.equal(seen,total);
      if(total===0)await page.getByText(role==='ventas'?'Sin ventas aún':'Sin compras aún',{exact:true}).waitFor();
    }
  });
  for(const failure of ['ventas','compras','reviews','stats'])await scenario(`visible/retry failure ${failure}`,async page=>{
    await page.goto(`${url}/historial?fail=${failure}`);
    await page.getByRole('button',{name:/Mis ventas/}).waitFor();
    if(failure==='compras')await page.getByRole('button',{name:/Mis compras/}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText(/Sin (ventas|compras) aún/).count(),0);
    if(failure==='reviews')assert.equal(await page.getByRole('link',{name:'Dejar reseña →'}).count(),0);
    // Remove fault injection, then exercise the actual UI retry handler.
    await page.evaluate(()=>{const u=new URL(location.href);u.searchParams.delete('fail');history.replaceState(null,'',u)});
    await page.getByRole('button',{name:'Reintentar',exact:true}).click();
    await page.getByRole('alert').waitFor({state:'detached'});
    assert.equal(await page.locator('h3').count(),5);
  });
  for(const role of ['ventas','compras'])for(const finish of ['manual','automatic'])await scenario(`review cancel/save/duplicate ${role}/${finish}`,async page=>{
    await page.goto(`${url}/historial?total=120&hidden=1&tab=${role}&ventasPage=2&comprasPage=2`);
    await page.getByRole('link',{name:'Dejar reseña →'}).first().waitFor();
    const link=page.getByRole('link',{name:'Dejar reseña →'}).first();
    const reviewUrl=await link.getAttribute('href');
    await link.click();await page.getByRole('button',{name:'Cancelar y volver al historial'}).waitFor();
    await page.getByRole('button',{name:'Cancelar y volver al historial'}).click();
    await page.getByText('Página 2 de 3',{exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('tab'),role);
    await page.goto(url+reviewUrl);
    await page.getByRole('button',{name:'5 estrellas',exact:true}).click();
    await page.getByRole('button',{name:'Enviar reseña',exact:true}).click();
    await page.getByText('¡Reseña enviada con éxito!',{exact:true}).waitFor();
    if(finish==='manual')await page.getByRole('button',{name:'← Volver al historial',exact:true}).click();
    await page.waitForURL(u=>u.pathname==='/historial');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('synthetic-reviews')));
    assert.equal(saved.at(-1).product_id,'synthetic-product');
    assert.equal(new URL(page.url()).searchParams.get('tab'),role);
    await page.getByText('Página 2 de 3',{exact:true}).waitFor();
    // Reopening an already reviewed sale follows the same safe return URL.
    await page.goto(url+reviewUrl);await page.waitForURL(u=>u.pathname==='/historial');
    assert.equal(new URL(page.url()).searchParams.get('tab'),role);
  });
  await scenario('invalid role and return URL cannot escape history',async page=>{
    await page.goto(url+'/historial/review?sale=ventas-0000&type=buyer_to_seller&tab=https://evil.invalid&ventasPage=-4');
    await page.waitForURL(u=>u.pathname==='/historial');
    assert.equal(new URL(page.url()).origin,new URL(url).origin);
    assert.equal(new URL(page.url()).searchParams.get('tab'),'ventas');
  });
}
