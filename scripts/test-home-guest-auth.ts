/** Server-rendered component contract; router boundary only is simulated. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const mocks: Record<string, string> = {
  "next/navigation": "export const useRouter=()=>({push(){}});",
  "next/link": "import React from 'react';export default function Link({prefetch,children,...props}){return React.createElement('a',props,children);}",
};
const rendering = esbuild.build({
  stdin: { contents: `import React from 'react';import {renderToString} from 'react-dom/server';
    import {MuroSesionProvider} from './components/auth/muro-sesion';
    import {GuestAuthCta} from './components/home/guest-auth-cta';
    export const render=haySesion=>renderToString(<MuroSesionProvider haySesion={haySesion}><GuestAuthCta destino='/?feed=parati'/></MuroSesionProvider>);`,
    resolveDir: web, loader: "tsx" },
  bundle: true, platform: "node", packages: "external", format: "cjs", write: false,
  jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
  plugins: [{ name: "router-boundary", setup(build: any) {
    build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
    build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "js", resolveDir: web }));
  } }],
}).then((bundle: any) => {
  const module = { exports: {} as { render: (session: boolean) => string } };
  new vm.Script(bundle.outputFiles[0].text).runInNewContext({ module, exports: module.exports, require, URL, URLSearchParams });
  return module.exports.render;
});

test("invitado: SSR incluye ambos accesos con destino Home", async () => {
  const html = (await rendering)(false);
  assert.match(html, /Crea tu cuenta/);
  assert.match(html, /Ya tengo cuenta · Iniciar sesión/);
  assert.match(html, /href="\/register\?next=%2F%3Ffeed%3Dparati"/);
  assert.match(html, /href="\/login\?next=%2F%3Ffeed%3Dparati"/);
});
test("sesión iniciada: SSR omite por completo el bloque", async () => {
  assert.equal((await rendering)(true), "");
});
