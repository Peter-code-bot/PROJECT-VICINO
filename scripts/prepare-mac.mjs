#!/usr/bin/env node
// Checks and optional dependency/Capacitor setup. No credentials, DB writes,
// archive, upload, deployment or global tool installation.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = path.join(root, 'apps/web');
const args = new Set(process.argv.slice(2));
const allowed = new Set(['--check', '--install', '--sync-ios']);
if ([...args].some(arg => !allowed.has(arg))) {
  console.error('Uso: node scripts/prepare-mac.mjs [--check] [--install] [--sync-ios]');
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager)) {
  throw new Error('packageManager debe fijar una versión exacta de pnpm.');
}
const invoke = (command, argv, cwd = root) => spawnSync(command, argv, {
  cwd, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
});
const report = (label, ok, detail) => console.log(`${ok ? 'OK' : 'PENDIENTE'} ${label}: ${detail}`);
const nodeOk = Number(process.versions.node.split('.')[0]) >= 22;
report('Node', nodeOk, process.version);
report('Gestor fijado', true, pkg.packageManager);
if (process.platform !== 'darwin') {
  report('macOS', false, 'Ejecutar en la Mac. No se han modificado dependencias ni archivos iOS.');
  process.exit(1);
}
if (!nodeOk) process.exit(1);

const xcode = invoke('xcodebuild', ['-version']);
const xcodeMajor = Number(xcode.stdout?.match(/Xcode (\d+)/)?.[1] ?? 0);
const xcodeOk = xcode.status === 0 && xcodeMajor >= 26;
report('Xcode', xcodeOk, xcodeOk ? xcode.stdout.trim().replace(/\n/g, ' / ') : 'Seleccionar Xcode 26 o posterior y completar su primer arranque.');
const sdk = invoke('xcrun', ['--sdk', 'iphoneos', '--show-sdk-version']);
const sdkOk = sdk.status === 0 && Number(sdk.stdout.trim().split('.')[0]) >= 26;
report('SDK iOS', sdkOk, sdkOk ? sdk.stdout.trim() : 'Se requiere SDK iOS 26 o posterior para este release.');
const codex = invoke('codex', ['--version']);
report('Codex CLI', codex.status === 0, codex.status === 0 ? codex.stdout.trim() : 'Configurar Codex en Terminal y su conexión a Notion.');
const envPresent = existsSync(path.join(web, '.env.local'));
report('Entorno web', envPresent, envPresent ? 'Archivo local presente; sus valores no fueron leídos ni validados.' : 'Configurar por canal seguro cuando se necesiten servicios reales. No es necesario para sincronizar Capacitor.');

function runPnpm(argv, cwd = root) {
  console.log(`Ejecutando ${pkg.packageManager} ${argv.join(' ')}`);
  const result = spawnSync('npx', ['--yes', pkg.packageManager, ...argv], {
    cwd, stdio: 'inherit', timeout: 15 * 60_000,
  });
  if (result.error) console.error('No se pudo completar el comando:', result.error.code);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (args.has('--install')) runPnpm(['install', '--frozen-lockfile']);
if (args.has('--sync-ios')) {
  if (!xcodeOk || !sdkOk) process.exit(1);
  if (!existsSync(path.join(web, 'node_modules/@capacitor/cli/package.json'))) {
    console.error('Faltan dependencias. Ejecutar primero con --install.');
    process.exit(1);
  }
  runPnpm(['exec', 'cap', 'sync', 'ios'], web);
}
console.log('Revisar git diff después de la sincronización. Abrir apps/web/ios/App/App.xcodeproj.');
console.log('La firma, App Store Connect, Notion y las pruebas en dispositivo requieren comprobación en la Mac.');
console.log('Continuar P0–P4 del plan de Notion antes del candidato; la app configurada carga la web remota.');
process.exitCode = xcodeOk && sdkOk && codex.status === 0 ? 0 : 1;
