import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A frozen fast-glob baseline, captured before replacing its dependency tree,
// avoids reinstalling the vulnerable package just to test the migration.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/glob-consumers-baseline.json', import.meta.url), 'utf8'));
const fixture = path.join(repo, 'apps/web/test-results/glob-consumers/fixtures');
const forward = value => value.replace(/\\/g, '/');
const resolveFixture = value => typeof value === 'string'
  ? value.replace('$FIXTURE', forward(fixture))
  : value;

for (const [relative, contents] of Object.entries(baseline.files)) {
  const target = path.resolve(fixture, relative);
  assert(target.startsWith(fixture + path.sep), 'Fixture must stay within the ignored test directory');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

const webRequire = createRequire(path.join(repo, 'apps/web/package.json'));
const pwaEntry = webRequire.resolve('@ducanh2912/next-pwa');
const pwaRoot = path.dirname(path.dirname(pwaEntry));
const pwaRequire = createRequire(pwaEntry);
const tinyManifest = pwaRequire('tinyglobby/package.json');
assert.equal(tinyManifest.version, '0.2.16', 'Revalidate the baseline before changing tinyglobby');
const pwaCjs = pwaRequire(pwaEntry);
const pwaEsm = await import(pathToFileURL(path.join(pwaRoot, 'dist/index.js')).href);
const compatPath = path.join(pwaRoot, 'dist/glob-compat.cjs');
const cjsCompat = pwaRequire(compatPath);
const esmCompat = await import(pathToFileURL(compatPath).href);

// Load both production entry points, then exercise the shared adapter they use.
for (const [name, factory] of [['CJS', pwaCjs.default ?? pwaCjs], ['ESM', pwaEsm.default]]) {
  assert.equal(typeof factory, 'function', `${name} PWA public entry must load`);
  assert.equal(typeof factory({ disable: true })({}).webpack, 'function');
}
for (const filename of ['index.cjs', 'index.js']) {
  const source = fs.readFileSync(path.join(pwaRoot, 'dist', filename), 'utf8');
  assert(source.includes('./glob-compat.cjs'), `${filename} must use the tested adapter`);
  assert(!/['"]fast-glob['"]/.test(source), `${filename} must not import fast-glob`);
}

const configEntry = webRequire.resolve('eslint-config-next');
const configRequire = createRequire(configEntry);
const pluginEntry = configRequire.resolve('@next/eslint-plugin-next');
const pluginRoot = path.dirname(path.dirname(pluginEntry));
const { getRootDirs } = configRequire(path.join(pluginRoot, 'dist/utils/get-root-dirs.js'));
const pluginRequire = createRequire(pluginEntry);
assert.equal(pluginRequire('tinyglobby/package.json').version, '0.2.16');

console.log(`Node ${process.version}; platform=${process.platform}; tinyglobby=${tinyManifest.version}`);
console.log(`Baseline: ${baseline.baseline}`);
let comparisons = 0;
for (const [format, consumer] of [['CJS', cjsCompat], ['ESM', esmCompat.default]]) {
  assert.equal(typeof consumer.sync, 'function');
  for (const test of baseline.pwa) {
    const options = { ...test.options, cwd: resolveFixture(test.options.cwd) };
    if (test.relativeCwd) options.cwd = path.relative(process.cwd(), options.cwd);
    if (test.label === 'cwd_windows_separator' && process.platform === 'win32') options.cwd = options.cwd.replace(/\//g, '\\');
    const actual = consumer.sync(test.patterns, options).sort();
    const expected = test.expected.map(resolveFixture).sort();
    assert.deepEqual(actual, expected, `${format}: ${test.label}`);
    comparisons++;
    console.log(`PASS ${format} ${test.label}: ${actual.length} entries`);
  }
  const backslashPattern = path.join(resolveFixture('$FIXTURE'), 'public', 'nested', '*.js').replace(/\//g, '\\');
  const actualBackslash = consumer.sync([backslashPattern], { absolute: true }).sort();
  const expectedForward = consumer.sync([backslashPattern.replace(/\\/g, '/')], { absolute: true }).sort();
  assert(actualBackslash.length > 0, `${format}: backslash pattern must match entries`);
  assert.deepEqual(actualBackslash, expectedForward, `${format}: backslash parity`);
  comparisons++;
  console.log(`PASS ${format} backslash pattern normalizer: ${actualBackslash.length} entries`);
}

// The real Next consumer resolves configured rootDir patterns from process.cwd,
// while an unset rootDir returns context.cwd. Exercise strings and arrays.
const previousCwd = process.cwd();
try {
  process.chdir(fixture);
  for (const rootType of ['string', 'array']) {
    for (const test of baseline.next) {
      let pattern = resolveFixture(test.pattern);
      if (test.backslash && process.platform === 'win32') pattern = pattern.replace(/\//g, '\\');
      const rootDir = rootType === 'array' ? [pattern] : pattern;
      const actual = getRootDirs({ cwd: fixture, settings: { next: { rootDir } } }).sort();
      assert.deepEqual(actual, test.expected.map(resolveFixture).sort(), `Next ${rootType}: ${test.label}`);
      comparisons++;
      console.log(`PASS Next ${rootType} ${test.label}: ${actual.length} entries`);
    }
  }
  assert.deepEqual(getRootDirs({ cwd: fixture, settings: {} }), [fixture]);
  assert.deepEqual(getRootDirs({ cwd: fixture, settings: { next: { rootDir: ['apps/web', null, 42] } } }), ['apps/web']);
  comparisons += 2;
} finally {
  process.chdir(previousCwd);
}

// Picomatch does not implement micromatch's padded or step ranges. Neither is
// used by next-pwa's four current call sites or this project's rootDir config.
// Keep those differences visible; this is a supported-subset compatibility test.
for (const test of baseline.ranges) {
  const actual = cjsCompat.sync(test.pattern, { cwd: path.join(fixture, 'ranges') }).sort();
  assert.notDeepEqual(actual, test.expected);
  console.log(`DOCUMENTED_DIFFERENCE ${test.pattern}: ${JSON.stringify({ fastGlob: test.expected, tinyglobby: actual })}`);
}
const config = fs.readFileSync(path.join(repo, 'apps/web/next.config.ts'), 'utf8');
assert(!/\bpublicExcludes\s*:/.test(config), 'Extend the range fixture coverage if publicExcludes becomes configurable');
console.log(`RESULT ${comparisons}/${comparisons} consumer comparisons passed; failures=0`);
