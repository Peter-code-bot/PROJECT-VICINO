import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Exercise the dependency actually loaded by Sentry, without a DSN or network.
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const next = createRequire(web.resolve('@sentry/nextjs'));
const sentryNode = createRequire(next.resolve('@sentry/node'));
const core = sentryNode('@opentelemetry/core');
const api = sentryNode('@opentelemetry/api');
assert.equal(sentryNode('@opentelemetry/core/package.json').version, '2.8.0');
console.log('PASS Sentry resolves patched OpenTelemetry core 2.8.0');

const propagator = new core.W3CBaggagePropagator();
const carrier = {baggage: Array.from({length:1000}, (_, i) => `k${i}=value`).join(',')};
const context = propagator.extract(api.ROOT_CONTEXT, carrier, api.defaultTextMapGetter);
const entries = api.propagation.getBaggage(context)?.getAllEntries() ?? [];
assert.ok(entries.length > 0 && entries.length <= 180);
console.log(`PASS hostile baggage is bounded (${entries.length} entries from 1000)`);

const normal = propagator.extract(api.ROOT_CONTEXT, {baggage:'channel=web'}, api.defaultTextMapGetter);
assert.equal(api.propagation.getBaggage(normal).getEntry('channel').value, 'web');
console.log('PASS normal baggage is preserved');

const {BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor} = sentryNode('@opentelemetry/sdk-trace-base');
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({spanProcessors:[new SimpleSpanProcessor(exporter)]});
const span = provider.getTracer('release-compatibility').startSpan('test-local');
span.setAttribute('release.check', true); span.end();
await provider.forceFlush();
assert.equal(exporter.getFinishedSpans().length, 1);
assert.equal(exporter.getFinishedSpans()[0].attributes['release.check'], true);
await provider.shutdown();
console.log('PASS installed trace SDK exports a span in memory; no external telemetry');
