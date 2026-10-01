import type { MapFeature } from '@vicino/shared';
import type { MapKitGlobal } from '@/hooks/use-mapkit';

type Marker = InstanceType<MapKitGlobal['MarkerAnnotation']>;
type AnnotationMap = Pick<InstanceType<MapKitGlobal['Map']>, 'addAnnotation' | 'removeAnnotation'>;
type MarkerSDK = Pick<MapKitGlobal, 'Coordinate' | 'MarkerAnnotation' | 'FeatureVisibility'>;
interface Appearance { lat: number; lng: number; color: string | undefined; label: string; glyph: string; selected: boolean }
interface Entry { marker: Marker; feature: MapFeature | null; appearance: Appearance; select: () => void }

function appearance(feature: MapFeature, selected: string | null, brand?: string, active?: string): Appearance {
  return {
    lat: feature.public_lat, lng: feature.public_lng, color: selected === feature.id ? active : brand,
    label: `${feature.count} ${feature.count === 1 ? 'publicación' : 'publicaciones'}${feature.seller_count > 0 ? ` · ${feature.seller_count} ${feature.seller_count === 1 ? 'vendedor' : 'vendedores'}` : ''} · ubicación aproximada${selected === feature.id ? ' · seleccionado' : ''}`,
    glyph: feature.count > 99 ? '99+' : String(feature.count),
    selected: selected === feature.id,
  };
}

/** One layer per MapKit map. Public group IDs preserve annotation identity. */
export class PublicationMarkerLayer {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly map: AnnotationMap, private readonly sdk: MarkerSDK, private readonly onSelect: (feature: MapFeature) => void) {}

  update(features: MapFeature[], selected: string | null, brand?: string, active?: string) {
    const wanted = new Set<string>();
    for (const feature of features) {
      wanted.add(feature.id);
      const next = appearance(feature, selected, brand, active);
      const entry = this.entries.get(feature.id);
      if (entry) {
        // Update the event payload even when no visible property changed.
        entry.feature = feature;
        const previous = entry.appearance;
        entry.appearance = next;
        if (previous.lat !== next.lat || previous.lng !== next.lng) entry.marker.coordinate = new this.sdk.Coordinate(next.lat, next.lng);
        if (previous.color !== next.color) entry.marker.color = next.color;
        if (previous.label !== next.label) {
          entry.marker.title = next.label;
          entry.marker.accessibilityLabel = next.label;
        }
        if (previous.glyph !== next.glyph) entry.marker.glyphText = next.glyph;
        // Native taps also set selected. Closing must deselect so another tap
        // can emit select again; programmatic selection must not reopen details.
        if (entry.marker.selected !== next.selected) entry.marker.selected = next.selected;
        continue;
      }
      const marker = new this.sdk.MarkerAnnotation(new this.sdk.Coordinate(next.lat, next.lng), {
        color: next.color, draggable: false, calloutEnabled: false, selected: next.selected,
        title: next.label, accessibilityLabel: next.label, titleVisibility: this.sdk.FeatureVisibility.Hidden,
        glyphText: next.glyph,
      });
      const created: Entry = { marker, feature, appearance: next, select: () => {
        if (created.feature && !created.appearance.selected) this.onSelect(created.feature);
      } };
      marker.addEventListener('select', created.select);
      this.entries.set(feature.id, created);
      this.map.addAnnotation(marker);
    }
    // Add incoming groups first so a legitimate regroup never empties the layer.
    for (const [id, entry] of this.entries) {
      if (!wanted.has(id)) {
        this.remove(entry);
        this.entries.delete(id);
      }
    }
  }

  dispose() {
    for (const entry of this.entries.values()) this.remove(entry);
    this.entries.clear();
  }

  private remove(entry: Entry) {
    entry.feature = null;
    entry.marker.removeEventListener('select', entry.select);
    this.map.removeAnnotation(entry.marker);
  }
}
