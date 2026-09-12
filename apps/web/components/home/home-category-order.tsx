"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { hapticSelection } from "@/lib/haptics";

type CategoryRow = { slug: string; name: string; content: ReactNode };

/** Only reorders server-rendered slots. No router.push, fetching or data cache. */
export function HomeCategoryOrder({ rows, intro, recent, tail, empty }: {
  rows: CategoryRow[];
  intro: ReactNode;
  recent: ReactNode;
  tail: ReactNode;
  empty: ReactNode;
}) {
  const params = useSearchParams();
  const available = new Set(rows.map(row => row.slug));
  const parse = (value: string | null) => [...new Set((value ?? "").split(","))].filter(slug => available.has(slug));
  const selected = parse(params.get("cats"));
  const selectedSet = new Set(selected);
  function toggle(slug: string) {
    // Read the current URL so rapid consecutive taps cannot overwrite each other.
    const url = new URL(window.location.href);
    const current = parse(url.searchParams.get("cats"));
    const next = current.includes(slug) ? current.filter(item => item !== slug) : [...current, slug];
    if (next.length) url.searchParams.set("cats", next.join(","));
    else url.searchParams.delete("cats");
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
    window.scrollTo({ top: 0, behavior: "instant" });
    void hapticSelection();
  }
  const rowSlot = (row: CategoryRow) => ({ key: `category:${row.slug}`, content: <div className="px-4 pb-8">{row.content}</div> });
  // All slots stay under one parent with stable keys: moving a row preserves
  // its mounted carousel instead of creating a second copy at the top.
  const slots = [
    ...selected.flatMap(slug => rows.filter(row => row.slug === slug).map(rowSlot)),
    { key: "intro", content: intro },
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
        {rows.length > 0 && <div className="-mx-4 -my-3 flex gap-3 overflow-x-auto px-4 py-3 scrollbar-hide">
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
