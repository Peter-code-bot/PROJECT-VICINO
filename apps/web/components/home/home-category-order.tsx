"use client";

import { Fragment, type ReactNode, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, GraduationCap } from "lucide-react";
import { UNIVERSITY_CATEGORY, universityStyle } from "@/lib/university";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { hapticSelection } from "@/lib/haptics";

type CategoryRow = { slug: string; name: string; content: ReactNode };

/** Only reorders server-rendered slots. No router.push, fetching or data cache. */
export function HomeCategoryOrder({ rows, intro, afterIntro, university, recent, tail, empty, viewerUniversity }: {
  viewerUniversity?: string | null;
  university?: ReactNode;
  afterIntro?: ReactNode;
  rows: CategoryRow[];
  intro: ReactNode;
  recent: ReactNode;
  tail: ReactNode;
  empty: ReactNode;
}) {
  const params = useSearchParams();
  const available = useMemo(() => {
    const s = new Set(rows.map(row => row.slug));
    if (viewerUniversity) s.add(UNIVERSITY_CATEGORY);
    return s;
  }, [rows, viewerUniversity]);

  const parse = useCallback((value: string | null) =>
    [...new Set((value ?? "").split(","))].filter(slug => available.has(slug)),
    [available]
  );

  // La seleccion vive en estado local para que el toque responda al instante y
  // se re-sincroniza cuando cambia ?cats= (volver a Home, atras/adelante). El
  // ajuste va durante el render y no en un useEffect: un setState dentro de un
  // efecto provoca un render en cascada (react-hooks/set-state-in-effect).
  const cats = params.get("cats");
  const [raw, setRaw] = useState<string | null>(cats);
  const [prevCats, setPrevCats] = useState<string | null>(cats);
  if (cats !== prevCats) {
    setPrevCats(cats);
    setRaw(cats);
  }
  const selected = useMemo(() => parse(raw), [parse, raw]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const universitySelected = selectedSet.has(UNIVERSITY_CATEGORY);

  function toggle(slug: string) {
    const next = selected.includes(slug) ? selected.filter(item => item !== slug) : [...selected, slug];
    const value = next.length ? next.join(",") : null;
    setRaw(value);
    // replaceState se integra con useSearchParams (docs de Next, Native History API).
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("cats", value);
    else url.searchParams.delete("cats");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    window.scrollTo({ top: 0, behavior: "instant" });
    void hapticSelection();
  }
  type Slot = { key: string; content: ReactNode };
  const rowSlot = (row: CategoryRow): Slot => ({ key: `category:${row.slug}`, content: <div className="px-4 pb-8">{row.content}</div> });
  // All slots stay under one parent with stable keys: moving a row preserves
  // its mounted carousel instead of creating a second copy at the top.
  // Modo Campus: al seleccionar el chip universitario, el feed se concentra
  // en las publicaciones de la universidad, ocultando los bloques globales de la ciudad.
  const slots: Slot[] = universitySelected
    ? [
        { key: "university", content: university },
        ...selected.filter(slug => slug !== UNIVERSITY_CATEGORY).flatMap(slug => rows.filter(row => row.slug === slug).map(rowSlot)),
      ]
    : [
        ...selected.flatMap((slug): Slot[] => rows.filter(row => row.slug === slug).map(rowSlot)),
        { key: "intro", content: intro },
        { key: "university", content: university },
        { key: "after-intro", content: afterIntro },
        { key: "recent", content: rows.length ? <div className="px-4 pb-8">{recent}</div> : empty },
        ...rows.filter(row => !selectedSet.has(row.slug)).map(rowSlot),
        { key: "tail", content: rows.length ? <div className="px-4 pb-8">{tail}</div> : null },
      ];
  return <>
    <section className="px-4 pb-6" aria-label="Categorías del inicio">
      <div className="max-w-7xl mx-auto">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-fg">Categorías</h2>
          <Link href="/buscar" id="home-see-all-categories" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-hi">Ver todas<ArrowRight className="h-3 w-3" /></Link>
        </div>
        {(rows.length > 0 || viewerUniversity) && <div className="-mx-4 -my-3 flex gap-3 overflow-x-auto px-4 py-3 scrollbar-hide">
          {viewerUniversity && <button type="button" id="cat-universidad" aria-label={`Comunidad Universitaria: ${viewerUniversity}`} aria-pressed={universitySelected} onClick={() => toggle(UNIVERSITY_CATEGORY)} className="group flex min-w-[72px] flex-col items-center gap-1.5 text-center">
            <span style={universitySelected ? { backgroundColor: "#000000", color: "#ffffff" } : universityStyle(viewerUniversity)} className="flex h-16 w-16 items-center justify-center rounded-[14px]"><GraduationCap className="h-[22px] w-[22px]" strokeWidth={1.8} /></span>
            <span className="text-[11px] font-medium text-fg">Comunidad<br />Universitaria</span>
          </button>}
          {rows.map(row => {
            const Icon = iconoDeCategoria(row.slug);
            const active = selectedSet.has(row.slug);
            return <button key={row.slug} type="button" id={`cat-${row.slug}`} aria-pressed={active} onClick={() => toggle(row.slug)} className="group flex min-w-[72px] flex-col items-center gap-1.5 text-center">
              <span className={`flex h-16 w-16 items-center justify-center rounded-[14px] ${active ? "category-tile-selected" : "category-tile-unselected"}`}><Icon className="h-[22px] w-[22px]" strokeWidth={1.8} /></span>
              <span className={`text-[11px] font-medium ${active ? "text-fg" : "text-fg-muted"}`}>{row.name}</span>
            </button>;
          })}
        </div>}
      </div>
    </section>
    {slots.map(slot => <Fragment key={slot.key}>{slot.content}</Fragment>)}
  </>;
}
