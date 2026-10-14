/** Actual community components/current CSS in Chromium. Only app boundaries
 * (auth, RPC, storage, navigation, map) are fixtures; no remote mutations. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const web = path.resolve("apps/web");
const req = createRequire(path.join(web, "package.json"));
const esbuild = req(req.resolve("esbuild", { paths: [req.resolve("tsx")] }));
const { chromium, expect } = req("@playwright/test");
const origin = "https://communities-fixture.invalid";
async function main() {
  const mocks: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>window.fixture.router;",
    "next/link": "import React from 'react';export default function Link({href,prefetch,children,...props}){return <a {...props} href={href}>{children}</a>;}",
    "next/image": "import React from 'react';export default function Image({fill,sizes,priority,...props}){return <img {...props}/>;}",
    "@/hooks/use-favorite": "export const useFavorite=()=>({isFavorite:false,isPending:false,toggle:async()=>{}});",
    "@/lib/haptics": "export const hapticLight=async()=>{};export const hapticMedium=async()=>{};export const hapticSelection=async()=>{};",
    "@/lib/geo/location-storage": "export const readLocation=()=>null;",
    "@/hooks/useGeolocation": "export const useGeolocation=()=>({state:{status:'idle'},request:()=>{}});",
    "./muro-comunidad": "export const MuroComunidad=()=>null;",
    "@/components/map/location-picker": "import React from 'react';export default function Picker(){return <div>Zona de prueba</div>;}",
    "@/lib/supabase/client": "export const createClient=()=>({auth:{getUser:async()=>({data:{user:{id:'20000000-0000-4000-8000-000000000001'}}})}});",
    "@/lib/comunidades/group-photo": "export const uploadCommunityPhoto=async()=>{throw new Error('fixture photo upload failure');};export const removeCommunityPhoto=async()=>{};export const cleanupUnreferencedCommunityPhoto=async()=>{};",
    "@/app/(marketplace)/comunidades/actions": `
      export const fundarComunidad=async input=>{window.fixture.creations.push(input);return {data:{id:'20000000-0000-4000-8000-000000000010',nombre:input.nombre,es_privada:input.es_privada}};};
      export const editarIdentidad=async()=>({data:{}});export const estadoCuotaFundacion=async()=>({puede_fundar:true,siguiente_en:null,motivo:null});
      export const cargarDescubrir=async()=>({items:[]});export const cancelarSolicitud=async()=>({data:{}});
      export const alternarMembresia=async()=>({data:{soy_miembro:true,miembros_count:4}});export const solicitarUnion=async()=>({data:{}});export const cancelarSolicitudPropia=async()=>({data:{}});`,
  };
  const fixture = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{CommunityCarousel}from'./components/comunidades/community-carousel';
    import{ComunidadesFeed}from'./components/comunidades/comunidades-feed';
    import{FundarDrawer}from'./components/comunidades/fundar-drawer';
    import{ProductCard}from'./components/product/product-card';
    import{MuroSesionProvider}from'./components/auth/muro-sesion';
    const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const common={descripcion:null,miembros_count:3,publicaciones_count:2,ultima_publicacion_at:'2026-10-13T12:00:00Z',disponible:true,es_privada:false,soy_miembro:false,mi_rol:null,solicitud_pendiente:false,puedo_entrar:true,distancia_m:500};
    const items=[{...common,id:id(20),nombre:'vecinos',categoria_id:'comunidad-vecinal',foto_url:null},
      {...common,id:id(21),nombre:'Grupo con nombre largo para probar filas',categoria_id:'comunidad-vecinal',descripcion:'Descripción larga para comprobar el mismo tamaño de tarjeta.',es_privada:true,mi_rol:'owner',foto_url:'${origin}/bad-photo.webp'},
      {...common,id:id(22),nombre:'Tecnología',categoria_id:'tecnologia',foto_url:null}];
    function App(){const[open,setOpen]=useState(false),[feedPayload,setFeedPayload]=useState(0);return <MuroSesionProvider haySesion={true}><main style={{maxWidth:512,padding:16,margin:'auto'}}>
      <div data-testid='card-fixture'><CommunityCarousel items={items} conBoton/></div><button onClick={()=>setOpen(true)}>Abrir fundador</button>
      <div className='w-40 sm:w-48'><ProductCard id={id(99)} slug='parati-reference' titulo='Producto para comparar tamaños' imagen={null} precio={100} categoria='tecnologia' vendedor={{nombre:'Vendedor',trust_level:'nuevo'}} rating={0} reviewsCount={0} categories={[{slug:'tecnologia',nombre:'Tecnología'}]}/></div>
      <button onClick={()=>setFeedPayload(1)}>Nueva zona del servidor</button><button onClick={()=>setFeedPayload(2)}>Membresía fresca del servidor</button>
      <div data-testid='feed-fixture'><ComunidadesFeed user={{id:id(1),nombre:'Persona',foto:null}} userLat={feedPayload===1?18:17.99} userLng={-92.94} initialTab='descubrir' muro={{posts:[],cursor:null}} mias={[{...common,id:id(40),nombre:'Mi comunidad lejana',categoria_id:'otros',soy_miembro:true}]} misSolicitudes={[]}
        cercanas={feedPayload===2?[]:[{...common,id:id(feedPayload===1?42:41),nombre:feedPayload===1?'Descubrir zona B':'Descubrir zona A',categoria_id:'tecnologia'}]} cuota={{puede_fundar:true,siguiente_en:null,motivo:null}}/></div>
      {open&&<FundarDrawer lat={17.99} lng={-92.94} cuotaInicial={{puede_fundar:true,siguiente_en:null,motivo:null}} onClose={()=>setOpen(false)}/>}</main></MuroSesionProvider>;}
    window.fixture={creations:[],routes:[],router:{push:route=>window.fixture.routes.push(route),refresh:()=>{}}};createRoot(document.getElementById('root')).render(<App/>);`;
  const bundle = await esbuild.build({ stdin: { contents: fixture, loader: "tsx", resolveDir: web }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "app-boundaries", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: web }));
    } }] });
  const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
  const cssFile = path.join(web, "app/globals.css");
  const { css } = await postcss([req("@tailwindcss/postcss")({ base: web })]).process(readFileSync(cssFile, "utf8"), { from: cssFile });
  const browser = await chromium.launch({ headless: true });
  let passed = 0;
  const pass = (name: string) => { passed++; console.log(`PASS ${name}`); };
  try {
    for (const width of [375, 768]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.addInitScript("window.__name=(target)=>target;");
      await page.route("**/*", async (route: any) => {
        if (route.request().isNavigationRequest()) await route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width,initial-scale=1'><body><div id='root'></div></body></html>" });
        else await route.abort();
      });
      await page.goto(origin);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const cards = page.locator("[data-testid='card-fixture'] article");
      await expect(cards).toHaveCount(3);
      const boxes = await cards.evaluateAll((elements: Element[]) => elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, nestedActions: element.querySelectorAll("a button, a a").length })));
      const productBox = await page.locator("#product-parati-reference").boundingBox();
      console.log(`MEASURE ${width}px ProductCard=${productBox.width}x${productBox.height} CommunityCard=${boxes[0].width}x${boxes[0].height}`);
      assert.ok(boxes.every((box: any) => box.width === (width < 640 ? 160 : 192) && box.height === boxes[0].height));
      assert.ok(Math.abs(boxes[0].height - productBox.height) < 1, "community geometry matches the measured Para ti reference");
      assert.ok(boxes.every((box: any) => box.nestedActions === 0)); pass(`${width}px_equal_card_geometry_and_no_nested_actions`);
      await expect(page.getByRole("region", { name: "Comunidad vecinal" })).toHaveCount(1);
      assert.equal(await page.locator("[data-testid='card-fixture'] section[aria-label='Comunidad vecinal'] article").count(), 2);
      assert.equal(await page.locator("[data-testid='card-fixture'] section[aria-label='Tecnología'] article").count(), 1); pass(`${width}px_category_rows`);
      await expect(cards.nth(0)).toContainText("V");
      await expect(cards.nth(1).locator("img")).toHaveCount(0);
      await expect(cards.nth(1)).toContainText("G"); pass(`${width}px_uppercase_initial_and_image_error_fallback`);
      await expect(cards.nth(1)).toContainText("Privada");
      await expect(cards.nth(1)).toContainText("admin");
      await expect(cards.nth(0)).toContainText("500 m");
      await expect(cards.nth(0)).toContainText("3 personas"); pass(`${width}px_privacy_role_counts_distance_preserved`);
      const joins = await cards.evaluateAll((elements: Element[]) => elements.map(element => {
        const button = element.querySelector("button"); const card = element.getBoundingClientRect(); const box = button?.getBoundingClientRect();
        return { bottomOffset: box ? card.bottom - box.bottom : null, inside: box ? box.bottom <= card.bottom && box.top >= card.top : false };
      }));
      assert.ok(joins.every((join: any) => join.inside && Math.abs(join.bottomOffset - joins[0].bottomOffset) < 1)); pass(`${width}px_long_titles_and_join_alignment`);
      const directory = page.locator("[data-testid='feed-fixture']");
      await expect(directory).toContainText("Descubrir zona A");
      await page.getByRole("button", { name: "Nueva zona del servidor" }).click();
      await expect(directory).toContainText("Descubrir zona B"); await expect(directory).not.toContainText("Descubrir zona A");
      await page.getByRole("button", { name: "Membresía fresca del servidor" }).click();
      await expect(directory).toContainText("Ya estás en todas las comunidades cercanas"); await expect(directory).not.toContainText("Descubrir zona B");
      await directory.getByRole("tab", { name: "Mis comunidades" }).click();
      await expect(directory).toContainText("Mi comunidad lejana"); pass(`${width}px_server_payload_refreshes_discover_and_keeps_far_memberships`);
      await page.getByRole("button", { name: "Abrir fundador" }).click();
      await page.getByLabel("Nombre", { exact: true }).fill("Grupo nuevo");
      const submit = page.getByRole("dialog", { name: "Fundar comunidad" }).getByRole("button", { name: "Fundar comunidad", exact: true });
      await expect(submit).toBeDisabled();
      await page.getByLabel("Categoría", { exact: true }).selectOption("comunidad-vecinal");
      await expect(submit).toBeEnabled();
      const order = await page.locator("#fundar-categoria,#fundar-descripcion").evaluateAll((elements: Element[]) => elements.map(element => element.id));
      assert.deepEqual(order, ["fundar-categoria", "fundar-descripcion"]); pass(`${width}px_required_category_before_optional_description`);
      await page.getByRole("switch").click();
      // Select and crop a real PNG with the existing cropper, then fail only storage.
      await page.locator("input[type=file]").setInputFiles({ name: "grupo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM8sAAAAASUVORK5CYII=", "base64") });
      await page.getByRole("button", { name: "Recortar y usar" }).click();
      await submit.click();
      await expect(page.getByRole("dialog", { name: "Fundar comunidad" })).toHaveCount(0);
      const result = await page.evaluate(() => (window as any).fixture);
      assert.equal(result.creations.length, 1); assert.equal(result.creations[0].categoria_id, "comunidad-vecinal"); assert.equal(result.creations[0].es_privada, true);
      assert.equal(result.routes[0], "/comunidades/20000000-0000-4000-8000-000000000010"); pass(`${width}px_photo_failure_keeps_single_private_creation_and_navigates`);
      assert.deepEqual(errors, []); pass(`${width}px_no_uncaught_errors`);
      await page.close();
    }
    console.log(`COMMUNITY_UI=${passed}/${passed} (Chromium; RPC/auth/storage mocked)`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
