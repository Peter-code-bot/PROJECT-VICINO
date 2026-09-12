import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

const requireLocal = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = requireLocal(requireLocal.resolve("esbuild", { paths: [requireLocal.resolve("tsx")] }));
type Fixture = Window & { profileFixture: {
  drag: (event: { active: { id: string }; over: { id: string } }) => void;
  update: () => void; saved: Array<{ id: string; sort_order: number }>;
} };
let script: string;
test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const mocks: Record<string, string> = {
    "next/navigation": "export const useSearchParams=()=>new URLSearchParams('edit=products');export const usePathname=()=>'/perfil';export const useRouter=()=>({push:()=>{},refresh:()=>{}});",
    "next/link": "export default function Link({children}){return children;}",
    "next/image": "export default ()=>null;",
    "@/lib/utils": "export const cn=(...parts)=>parts.filter(Boolean).join(' ');",
    "@vicino/shared": "export const formatPrice=()=>'';export const formatDate=()=>'';export const primaryCategorySlug=()=>null;",
    "@/lib/price-mode": "export const priceFallbackLabel=()=>'';",
    "@/lib/video-thumbnail": "export const posterUrl=x=>x;",
    "@/components/shared/rating-stars": "export const RatingStars=()=>null;",
    "@/components/shared/review-product-link": "export const ReviewProductLink=()=>null;",
    "@/components/moderation/report-menu-button": "export const ReportMenuButton=()=>null;",
    "./actions": "export const updateProductsOrder=async updates=>{window.profileFixture.saved=updates;return {};};",
    "sonner": "export const toast={error:()=>{}};",
    "@dnd-kit/core": "export const MouseSensor=null,TouchSensor=null,closestCenter=null,useSensor=()=>null,useSensors=()=>[];export function DndContext({children,onDragEnd}){window.profileFixture.drag=onDragEnd;return children;}",
    "@dnd-kit/sortable": "export const rectSortingStrategy=null;export const SortableContext=({children})=>children;export const useSortable=()=>({attributes:{},listeners:{},setNodeRef:()=>{}});export const arrayMove=(items,from,to)=>{const next=items.slice();next.splice(to,0,next.splice(from,1)[0]);return next;};",
    "@dnd-kit/utilities": "export const CSS={Transform:{toString:()=>undefined}};",
  };
  const result = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {ProfileTabs} from './app/(marketplace)/perfil/profile-tabs';
      window.profileFixture={saved:[],drag:()=>{},update:()=>{}};
      const product=id=>({id,titulo:id,precio:null,imagen_principal:null,categoria:'hogar',slug:null,estatus:'disponible',ventas_count:0});
      function App(){const [products,setProducts]=useState([product('a'),product('b')]);
        window.profileFixture.update=()=>setProducts([product('a'),product('b'),product('c')]);
        return <ProfileTabs products={products} reviewsAsSeller={[]} reviewsAsBuyer={[]} isVendedor={true} currentUserId="local"/>;}
      createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: web },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "isolated-profile", setup(build: {
      onResolve: (options: object, callback: (args: { path: string }) => unknown) => void;
      onLoad: (options: object, callback: (args: { path: string }) => unknown) => void;
    }) {
      build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js", resolveDir: web }));
    } }],
  });
  script = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: script });
  await expect(page.getByRole("button", { name: "Guardar", exact: true })).toBeVisible();
});

test("switching tabs preserves an unsaved product order", async ({ page }) => {
  await page.evaluate(() => (window as Fixture).profileFixture.drag({ active: { id: "a" }, over: { id: "b" } }));
  await page.getByRole("button", { name: "Reseñas" }).click();
  await expect(page.getByText("Sin reseñas aún")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Productos", exact: true }).click();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  expect(await page.evaluate(() => (window as Fixture).profileFixture.saved.map(item => item.id))).toEqual(["b", "a"]);
});

test("refresh during editing retains the draft; cancel restores the latest server order", async ({ page }) => {
  await page.evaluate(() => (window as Fixture).profileFixture.drag({ active: { id: "a" }, over: { id: "b" } }));
  await page.evaluate(() => (window as Fixture).profileFixture.update());
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  expect(await page.evaluate(() => (window as Fixture).profileFixture.saved.map(item => item.id))).toEqual(["b", "a"]);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  expect(await page.evaluate(() => (window as Fixture).profileFixture.saved.map(item => item.id))).toEqual(["a", "b", "c"]);
});
