/** S12 reconciliation with a strict synthetic SDK; no Apple/network/DB calls. */
import assert from 'node:assert/strict';
import type { MapFeature } from '../packages/shared/src/validators/publications-map';
import { PublicationMarkerLayer } from '../apps/web/lib/geo/publication-markers';

type CoordinateValue = { latitude: number; longitude: number };
type Write = { marker: Marker; property: string; value: unknown };
const writes: Write[] = [];
const instances: Marker[] = [];
class Coordinate {
  constructor(public latitude: number, public longitude: number) {}
}
class Marker {
  draggable = false;
  readonly listeners = new Map<string, Set<() => void>>();
  readonly values: Record<string, unknown>;
  constructor(coordinate: unknown, options: Record<string, unknown> = {}) {
    this.values = { coordinate, ...options };
    instances.push(this);
  }
  private write(property: string, value: unknown) { writes.push({ marker: this, property, value }); this.values[property] = value; }
  get coordinate() { return this.values.coordinate as CoordinateValue; }
  set coordinate(value: CoordinateValue) { this.write('coordinate', value); }
  // Deliberately normalized: reconciliation must compare its applied values.
  get color() { return this.values.color === 'green' ? 'rgb(0, 128, 0)' : this.values.color as string | undefined; }
  set color(value: string | undefined) { this.write('color', value); }
  get title() { return this.values.title as string | null | undefined; }
  set title(value: string | null | undefined) { this.write('title', value); }
  get accessibilityLabel() { return this.values.accessibilityLabel as string | null; }
  set accessibilityLabel(value: string | null) { this.write('accessibilityLabel', value); }
  get glyphText() { return this.values.glyphText as string | null; }
  set glyphText(value: string | null) { this.write('glyphText', value); }
  get selected() { return this.values.selected === true; }
  set selected(value: boolean) { this.write('selected', value); if (value) this.select(); }
  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set<() => void>(); set.add(listener); this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener); }
  select() { for (const listener of this.listeners.get('select') ?? []) listener(); }
}
const sdk = { Coordinate, MarkerAnnotation: Marker, FeatureVisibility: { Adaptive: 'adaptive', Hidden: 'hidden', Visible: 'visible' } };
const attached = new Set<Marker>();
const operations: { kind: 'add' | 'remove'; marker: Marker; attached: number }[] = [];
const map = {
  addAnnotation(value: unknown) { const marker = value as Marker; assert.ok(!attached.has(marker)); attached.add(marker); operations.push({ kind: 'add', marker, attached: attached.size }); },
  removeAnnotation(value: unknown) { const marker = value as Marker; assert.ok(attached.delete(marker), 'remove only an attached annotation'); operations.push({ kind: 'remove', marker, attached: attached.size }); },
};
const selected: MapFeature[] = [];
const layer = new PublicationMarkerLayer(map, sdk, feature => selected.push(feature));
function feature(id: string, count = 1, seller_count = 1): MapFeature {
  return { id, count, seller_count, public_lat: 19.04, public_lng: -98.21, bounds: { west: -98.21, east: -98.21, south: 19.04, north: 19.04 } };
}
function reset() { operations.length = 0; writes.length = 0; }
function check(name: string, run: () => void) { run(); passed++; console.log('PASS ' + name); }
let passed = 0;

const first = feature('cell:1:-9821:1904');
const second = feature('cell:1:-9822:1904', 120, 0);
layer.update([first, second], null, 'green', 'black');
const [a, b] = [...attached]; assert.ok(a && b);
check('first render creates one annotation and one listener per public group', () => {
  assert.equal(instances.length, 2); assert.equal(operations.length, 2); assert.equal(writes.length, 0);
  assert.equal(a.listeners.get('select')?.size, 1); assert.equal(b.listeners.get('select')?.size, 1);
  assert.equal(a.glyphText, '1'); assert.equal(b.glyphText, '99+');
  assert.match(a.accessibilityLabel!, /1 publicación · 1 vendedor/); assert.doesNotMatch(b.accessibilityLabel!, /vendedores/);
});
check('fresh arrays, reordering and normalized SDK getters preserve identity with zero writes', () => {
  reset();
  for (let i = 0; i < 100; i++) layer.update([{ ...second, bounds: { ...second.bounds } }, { ...first }], null, 'green', 'black');
  assert.deepEqual([...attached], [a, b]); assert.equal(instances.length, 2); assert.equal(operations.length, 0); assert.equal(writes.length, 0);
});
check('selection and closing change only color and accessible labels', () => {
  reset(); layer.update([first, second], first.id, 'green', 'black');
  assert.deepEqual(writes.map(w => [w.marker === a, w.property]), [[true, 'color'], [true, 'title'], [true, 'accessibilityLabel'], [true, 'selected']]);
  assert.equal(selected.length, 0, 'programmatic selection cannot reopen the drawer');
  assert.equal(operations.length, 0); assert.equal(instances.length, 2);
  reset(); layer.update([first, second], null, 'green', 'black');
  assert.deepEqual(writes.map(w => w.property), ['color', 'title', 'accessibilityLabel', 'selected']); assert.equal(operations.length, 0);
  assert.equal(a.selected, false);
});
check('theme changes update color without position, text, listener or layer churn', () => {
  reset(); layer.update([first, second], null, 'teal', 'black');
  assert.deepEqual(writes.map(w => w.property), ['color', 'color']); assert.equal(operations.length, 0);
  assert.equal(a.listeners.get('select')?.size, 1); assert.equal(b.listeners.get('select')?.size, 1);
});
const revised = { ...first, count: 2, public_lat: 19.05, bounds: { ...first.bounds, north: 19.05 } };
check('changed coordinate and count update only their attributes on the same object', () => {
  reset(); layer.update([revised, second], null, 'teal', 'black');
  assert.deepEqual(writes.map(w => w.property), ['coordinate', 'title', 'accessibilityLabel', 'glyphText']);
  assert.equal(operations.length, 0); assert.equal(instances.length, 2); assert.equal(a.coordinate.latitude, 19.05);
});
const metadata = { ...revised, bounds: { ...revised.bounds, east: -98.20 } };
check('the single selection listener reads the newest feature even without visible changes', () => {
  reset(); layer.update([metadata, second], null, 'teal', 'black'); a.select();
  assert.equal(selected.at(-1), metadata); assert.equal(writes.length, 0); assert.equal(a.listeners.get('select')?.size, 1);
});
check('counts above 99 update labels while leaving the unchanged 99+ glyph alone', () => {
  reset(); layer.update([metadata, { ...second, count: 121 }], null, 'teal', 'black');
  assert.deepEqual(writes.map(w => w.property), ['title', 'accessibilityLabel']); assert.equal(b.glyphText, '99+'); assert.equal(operations.length, 0);
});
const retiredSelect = [...a.listeners.get('select')!][0]!;
check('partial changes add only new IDs before retiring absent IDs and disable retired callbacks', () => {
  reset(); const replacement = feature('cell:1:-9823:1904', 3); layer.update([second, replacement], null, 'teal', 'black');
  assert.deepEqual(operations.map(o => o.kind), ['add', 'remove']); assert.ok(attached.has(b)); assert.ok(!attached.has(a));
  assert.equal(a.listeners.get('select')?.size, 0); const prior = selected.length; retiredSelect(); assert.equal(selected.length, prior);
});
check('complete legitimate regroup adds the incoming layer before removing the old layer', () => {
  reset(); layer.update([feature('cell:2:-4910:952')], null, 'teal', 'black');
  assert.deepEqual(operations.map(o => o.kind), ['add', 'remove', 'remove']); assert.ok(operations.every(o => o.attached > 0));
});
check('300 groups across 50 camera-like updates retain all objects with no SDK mutations', () => {
  const batch = Array.from({ length: 300 }, (_, i) => feature('cell:1:' + i + ':1904', i + 1));
  layer.update(batch, null, 'teal', 'black'); const original = [...attached]; const count = instances.length;
  reset(); for (let i = 0; i < 50; i++) layer.update(batch.map(f => ({ ...f })), null, 'teal', 'black');
  assert.deepEqual([...attached], original); assert.equal(instances.length, count); assert.equal(operations.length, 0); assert.equal(writes.length, 0);
});
check('empty results remove every annotation and its listener exactly once', () => {
  reset(); const current = [...attached]; layer.update([], null, 'teal', 'black');
  assert.equal(operations.length, 300); assert.ok(operations.every(o => o.kind === 'remove'));
  assert.ok(current.every(m => m.listeners.get('select')?.size === 0)); assert.equal(attached.size, 0);
});
check('dispose is idempotent and never reuses markers on another map', () => {
  layer.update([first], null, 'green', 'black'); const marker = [...attached][0]!; const callback = [...marker.listeners.get('select')!][0]!;
  reset(); layer.dispose(); layer.dispose(); assert.equal(operations.length, 1); assert.equal(attached.size, 0); assert.equal(marker.listeners.get('select')?.size, 0);
  const prior = selected.length; callback(); assert.equal(selected.length, prior);
  const newLayer = new PublicationMarkerLayer(map, sdk, f => selected.push(f)); newLayer.update([first], null, 'green', 'black');
  assert.notEqual([...attached][0], marker); newLayer.dispose();
});
console.log(`PASS ${passed}/${passed} S12 marker reconciliation checks (synthetic SDK; no device-render claim)`);
