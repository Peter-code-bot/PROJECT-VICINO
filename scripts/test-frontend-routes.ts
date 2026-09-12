import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fetchConLimite } from '../apps/web/lib/supabase/fetch-con-limite';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = require('typescript') as typeof import('typescript');
const esbuild = require(require.resolve('esbuild', { paths: [require.resolve('tsx')] })) as { build: (options: object) => Promise<{ outputFiles: Array<{ text: string }> }> };
const { createClient } = require('@supabase/supabase-js') as typeof import('../apps/web/node_modules/@supabase/supabase-js');
const web = fileURLToPath(new URL('../apps/web', import.meta.url));

export async function load(file: string, client: object, overrides: Record<string, string> = {}) {
  const source = readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mocks = new Map<string, string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier === 'next/server' || specifier.startsWith('react')) continue;
    const names = statement.importClause?.namedBindings;
    const lines: string[] = [];
    if (statement.importClause?.name) lines.push('export default ()=>null;');
    if (names && ts.isNamedImports(names)) for (const spec of names.elements) {
      if (spec.isTypeOnly) continue;
      const name = (spec.propertyName ?? spec.name).text;
      let value = '()=>null';
      if (name === 'createClient') value = 'async()=>globalThis.__testClient';
      if (name === 'createServerClient') value = '(_url,_key,options)=>{options.cookies.setAll([{name:"synthetic-refresh",value:"synthetic",options:{httpOnly:true}}]);return globalThis.__testClient;}';
      if (name === 'fetchConLimite') value = '()=>globalThis.__testFetch';
      if (name === 'cookies') value = 'async()=>({get:()=>undefined})';
      if (name === 'redirect' || name === 'notFound') value = `()=>{throw new Error("UNEXPECTED_${name}")}`;
      if (name === 'CATEGORIES') value = '[]';
      if (name === 'parseRadiusCookie') value = '()=>25000';
      lines.push(`export const ${name}=${value};`);
    }
    if (names && ts.isNamespaceImport(names)) lines.push('export const captureException=()=>{};');
    mocks.set(specifier, [mocks.get(specifier) ?? '', ...lines].join('\n'));
  }
  for (const [name, source] of Object.entries(overrides)) mocks.set(name, source);
  const result = await esbuild.build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
    plugins: [{ name: 'isolated-imports', setup(build: { onResolve: (options: object, cb: (args: { path: string; kind: string }) => unknown) => void; onLoad: (options: object, cb: (args: { path: string }) => unknown) => void }) {
      build.onResolve({ filter: /.*/ }, (args) => args.kind === 'entry-point' ? undefined : mocks.has(args.path) ? { path: args.path, namespace: 'fake' } : { path: args.path, external: true });
      build.onLoad({ filter: /.*/, namespace: 'fake' }, (args) => ({ contents: mocks.get(args.path), loader: 'js' }));
    } }],
  });
  const module = { exports: {} as { default: (props: object) => Promise<unknown>; updateSession: (request: unknown) => Promise<{ status: number; headers: Headers; cookies: { get: (name: string) => unknown } }> } };
  const context = vm.createContext({ module, exports: module.exports, require, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic' } },
    __testClient: client, __testShared: require('@vicino/shared'), __testFetch: async () => { throw new Error('unexpected transport'); }, fetch, Headers, URL, Response, crypto, console });
  new vm.Script(result.outputFiles[0].text, { filename: file }).runInContext(context);
  return module.exports;
}

function clientWithTimeout() {
  let requests = 0;
  const client = createClient('https://synthetic.invalid', 'synthetic', { accessToken: async () => 'synthetic', global: {
    fetch: fetchConLimite(async () => { requests++; throw new DOMException('VICINO_READ_TIMEOUT', 'TimeoutError'); }, 'https://synthetic.invalid'),
  } });
  return { requests: () => requests, client: { from: client.from.bind(client), rpc: client.rpc.bind(client), auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } }, error: null }) } } };
}

for (const route of ['(marketplace)/page.tsx', '(marketplace)/buscar/page.tsx', '(marketplace)/perfil/page.tsx', '(marketplace)/chat/page.tsx', '(marketplace)/chat/[id]/page.tsx', 'seller/page.tsx', 'seller/layout.tsx']) {
  test(`timeout no produce exito vacio/404/redirect: ${route}`, async () => {
    const fixture = clientWithTimeout();
    const page = await load(path.join(web, 'app', route), fixture.client);
    await assert.rejects(page.default({ params: Promise.resolve({ id: 'synthetic-chat' }), searchParams: Promise.resolve({}), children: null }), (error: { message?: string }) => {
      assert.doesNotMatch(error.message ?? '', /UNEXPECTED_/);
      assert.match(error.message ?? '', /VICINO_READ_TIMEOUT|No se pued|No se pud/);
      return true;
    });
    assert.ok(fixture.requests() > 0);
  });
}

test('middleware: timeout devuelve 503 sin conceder acceso ni perder cookies renovadas', async () => {
  const fixture = clientWithTimeout();
  const middleware = await load(path.join(web, 'lib/supabase/middleware.ts'), fixture.client);
  const { NextRequest } = require('next/server') as { NextRequest: new (url: string) => unknown };
  const response = await middleware.updateSession(new NextRequest('https://synthetic.invalid/seller'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.cookies.get('synthetic-refresh'));
});
