import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const web = path.join(root, 'apps/web');
const output = path.join(root, 'node_modules/.cache/vicino-ios-lab');
const requireWeb = createRequire(path.join(web, 'package.json'));
const esbuild = requireWeb(requireWeb.resolve('esbuild', { paths: [requireWeb.resolve('tsx')] }));
const mode = process.argv[2] ?? 'serve';
if (!['serve', 'build', 'prepare-ios'].includes(mode)) throw new Error('Use serve, build or prepare-ios');

await mkdir(output, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(here, 'entry.jsx')], bundle: true, outfile: path.join(output, 'lab.js'),
  platform: 'browser', format: 'iife', jsx: 'automatic', minify: true,
  nodePaths: [path.join(web, 'node_modules')], tsconfig: path.join(web, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'local-router', setup(build) {
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.join(here, 'router.jsx') }));
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'lab' }));
    build.onLoad({ filter: /.*/, namespace: 'lab' }, () => ({ contents: 'export {Link as default} from "./router.jsx"', resolveDir: here }));
  } }],
});
const postcss = requireWeb(requireWeb.resolve('postcss', { paths: [requireWeb.resolve('@tailwindcss/postcss')] }));
const tailwind = requireWeb('@tailwindcss/postcss');
const source = path.join(web, 'app/globals.css');
const css = (await postcss([tailwind({ base: web })]).process(await readFile(source, 'utf8'), { from: source })).css;
await writeFile(path.join(output, 'lab.css'), css + '\n' + await readFile(path.join(here, 'lab.css'), 'utf8'));
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; form-action 'none'; base-uri 'none'">
<title>VICINO · Prueba local de fluidez</title><link rel="stylesheet" href="/lab.css"></head>
<body><div id="root"></div><script src="/lab.js"></script></body></html>`);
console.log(`Local fixture built: ${output}`);

if (mode === 'prepare-ios') {
  // Sync the existing SPM project, then change ONLY ignored generated resources.
  const sync = spawnSync(process.execPath, [path.join(web, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'ios'], { cwd: web, stdio: 'inherit' });
  if (sync.status !== 0) process.exit(sync.status ?? 1);
  const native = path.join(web, 'ios/App/App');
  await mkdir(path.join(native, 'public'), { recursive: true });
  for (const file of ['index.html', 'lab.js', 'lab.css']) {
    await cp(path.join(output, file), path.join(native, 'public', file));
  }
  const configPath = path.join(native, 'capacitor.config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.server = { hostname: 'localhost', iosScheme: 'capacitor', allowNavigation: [] };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('iOS fixture ready: capacitor://localhost (bundled resources, no remote server.url).');
  console.log('A later cap sync/copy restores the source production config; re-run prepare-ios before a lab build.');
}

if (mode === 'serve') {
  const files = { '/lab.js': ['lab.js', 'text/javascript'], '/lab.css': ['lab.css', 'text/css'] };
  const routes = new Set(['/', '/buscar', '/chat', '/perfil']);
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1:4173').pathname;
      const file = files[pathname] ?? (routes.has(pathname) ? ['index.html', 'text/html'] : null);
      if (!file || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(path.join(output, file[0])));
    } catch (error) { console.error(error); response.writeHead(500).end(); }
  });
  server.listen(4173, '127.0.0.1', () => console.log('VICINO local: http://127.0.0.1:4173 — Ctrl+C to stop'));
}
