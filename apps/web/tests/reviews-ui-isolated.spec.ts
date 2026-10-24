import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const requireLocal = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = requireLocal(requireLocal.resolve("esbuild", { paths: [requireLocal.resolve("tsx")] })) as { build: (options: object) => Promise<{ outputFiles: Array<{ text: string }> }> };
let script: string;
let css: string;

test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const result = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {ReviewsSummary} from './components/product/reviews-summary';
      import {LocalReviewDialog} from './components/product/local-review-dialog';
      import {ProductReviewsDrawer} from './components/product/product-reviews-drawer';
      const root=createRoot(document.getElementById('root'));
      const profile={nombre:'Ana',foto:null};
      const review=(id,verified=false)=>({id,rating:4,comentario:'Experiencia '+id,created_at:'2026-10-22',review_type:'buyer_to_seller',reviewer_id:'author',respuesta:null,respuesta_fecha:null,is_verified:verified,origen:'venta',sale_confirmation_id:'untrusted',profiles:profile,products_services:null});
      window.calls=0; window.publishes=[]; window.refreshes=0;
      window.publish=(input)=>{window.publishes.push(input); return new Promise(resolve=>{window.resolveSave=resolve})};
      window.load=async()=>{window.calls++;return {success:true,snapshot:{reviews:[review('third')],summary:{count:3,average:4,buckets:{1:0,2:0,3:0,4:3,5:0}},own_local_review:null}}};
      function Session({kind}){ const [open,setOpen]=useState(false); const [own,setOwn]=useState({id:'own',rating:4,comentario:'Mi experiencia anterior',visible:false});
        return <><button id='opener' onClick={()=>setOpen(true)}>Abrir formulario</button>{kind==='local'?<LocalReviewDialog open={open} onClose={()=>setOpen(false)} sellerId='seller' sellerName='Tienda verde' ownReview={own} onSuccess={setOwn}/>:<ProductReviewsDrawer open={open} onClose={()=>setOpen(false)} sellerId='seller' sellerName='Tienda verde' sellerAvatar={null} reviews={[review('first',true),review('second')]} averageRating={4} reviewsCount={3} currentUserId={null} currentProductId='product' side='right'/>}</>;
      }
      window.mount=(kind)=>flushSync(()=>root.render(<Session key={kind} kind={kind}/>));
      window.summary=(count)=>flushSync(()=>root.render(<ReviewsSummary reviews={count?[review('one')]:[]} summary={{count,average:count?4.9:0,buckets:{1:count?1:0,2:0,3:0,4:0,5:count?count-1:0}}} onOpenReviews={()=>{}} onAddReview={()=>{}}/>));`, resolveDir: web, loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "review-boundaries", setup(build: { onResolve: (options: object, callback: (args: { path: string }) => object | null) => void; onLoad: (options: object, callback: (args: { path: string }) => object) => void }) {
      build.onResolve({ filter: /^next\/navigation$|^next\/image$|^next\/link$|^@vicino\/shared$|^@\/app\/\(marketplace\)\/reviews\/actions$|^@\/components\/moderation\/report-menu-button$/ }, ({path:file}) => ({path:file,namespace:"review-stub"}));
      build.onLoad({filter:/.*/,namespace:"review-stub"}, ({path:file}) => ({ contents: file.includes("actions") ? "export const publishLocalReview=(input)=>window.publish(input); export const loadSellerReviews=()=>window.load();" : file.includes("navigation") ? "export const useRouter=()=>({refresh:()=>window.refreshes++});" : file.includes("report-menu") ? "export const ReportMenuButton=()=>null;" : file.includes("shared") ? "export {publicProfileName} from '../../packages/shared/src/utils/profile-name'; export const primaryCategorySlug=()=>null;" : file.includes("link") ? "import React from 'react'; export default function Link(p){return React.createElement('a',p,p.children)}" : "import React from 'react'; export default function Image(p){return React.createElement('img',{src:p.src,alt:p.alt})}",loader:"js",resolveDir:web}));
    }}],
  });
  script=result.outputFiles[0].text;
  const postcss = requireLocal(requireLocal.resolve("postcss", {paths:[requireLocal.resolve("@tailwindcss/postcss")]})) as (plugins: unknown[]) => {process:(source:string,options:object)=>Promise<{css:string}>};
  const source = readFileSync(path.join(web,"app/globals.css"),"utf8")
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/product";\n@source "../components/ui/dialog.tsx";\n@source "../components/shared/rating-stars.tsx";');
  css=(await postcss([requireLocal("@tailwindcss/postcss")()]).process(source,{from:path.join(web,"app/globals.css")})).css;
});

test.beforeEach(async ({page}) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*",route=>route.abort());
  await page.setContent('<html lang="es"><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:css}); await page.addScriptTag({content:script});
  expect(errors).toEqual([]);
});

for (const theme of ["light","dark"]) test(`summary uses full distribution and separate48px add action (${theme})`,async({page})=>{
  await page.evaluate((dark)=>document.documentElement.classList.toggle('dark',dark),theme==='dark');
  for (const count of [0,64]) {
    await page.evaluate((n)=>(window as unknown as {summary:(n:number)=>void}).summary(n),count);
    const add=page.getByRole('button',{name:'Escribir reseña del local'});
    await expect(add).toBeVisible();
    const box=await add.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(48);expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(await add.evaluate(node=>Boolean(node.parentElement?.closest('button')))).toBe(false);
    if(count){await expect(page.getByRole('button',{name:'Ver 64 reseñas'})).toBeVisible();await expect(page.getByText('63',{exact:true})).toBeVisible();}
  }
});

test('own hidden review prefills; saving blocks dismissal; reset and focus restore',async({page})=>{
  await page.evaluate(()=>(window as unknown as {mount:(kind:string)=>void}).mount('local'));
  const opener=page.getByRole('button',{name:'Abrir formulario'});await opener.click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Comentario (opcional)')).toHaveValue('Mi experiencia anterior');
  await expect(page.getByRole('button',{name:'4 estrellas',exact:true})).toHaveAttribute('aria-pressed','true');
  for (const name of ['Cerrar formulario','1 estrella','5 estrellas','Guardar cambios']) expect((await page.getByRole('button',{name,exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(48);
  for(let n=0;n<12;n++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);}
  await page.getByRole('button',{name:'Guardar cambios'}).click();await expect(page.getByRole('button',{name:'Guardando…'})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  await page.mouse.click(1,1);await expect(dialog).toBeVisible();
  await page.evaluate(()=>(window as unknown as {resolveSave:(value:unknown)=>void}).resolveSave({success:true,review:{id:'own',rating:4,comentario:'Mi experiencia anterior',visible:false}}));
  await expect(page.getByRole('status')).toContainText('continúa oculta por moderación');
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();await expect(opener).toBeFocused();
  await opener.click();await expect(page.getByRole('button',{name:'Guardar cambios'})).toBeVisible();await expect(page.getByRole('status')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {publishes:unknown[]}).publishes.length)).toBe(1);
});

test('drawer trusts server verified field, exposes explanation, pages all reviews and omits fake product block',async({page})=>{
  await page.evaluate(()=>(window as unknown as {mount:(kind:string)=>void}).mount('drawer'));
  const opener=page.getByRole('button',{name:'Abrir formulario'});await opener.click();
  await expect(page.getByRole('button',{name:'Reseña verificada',exact:true})).toHaveCount(1);
  await expect(page.getByText('Producto no disponible')).toHaveCount(0);
  const badge=page.getByRole('button',{name:'Reseña verificada',exact:true});await badge.focus();await expect(page.getByRole('tooltip')).toContainText('compra completada');
  await page.keyboard.press('Tab');await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByRole('button',{name:'Cargar más reseñas'}).click();await expect(page.locator('article')).toHaveCount(3);await expect(page.getByRole('button',{name:'Cargar más reseñas'})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {calls:number}).calls)).toBe(1);
  await page.getByRole('button',{name:'Cerrar reseñas'}).click();await expect(opener).toBeFocused();
  await opener.click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(opener).toBeFocused();
});
