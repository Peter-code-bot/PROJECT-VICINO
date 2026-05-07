"use client";

import { Clock, Trash2, X } from "lucide-react";
import type { SearchHistoryEntry } from "@/hooks/use-search-history";

interface SearchHistoryDropdownProps {
  history: SearchHistoryEntry[];
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onClearAll: () => void;
}

export function SearchHistoryDropdown({
  history,
  onSelect,
  onRemove,
  onClearAll,
}: SearchHistoryDropdownProps) {
  if (history.length === 0) return null;

  return (
    <div
      // Prevent the parent input from losing focus when the user clicks the
      // dropdown — keeps the search-filters focus state aligned with
      // perceived UX while the click handlers below execute.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border bg-card shadow-lg overflow-hidden"
    >
      <div className="px-4 py-2 text-[10px] font-medium text-muted-foreground border-b border-border/50 uppercase tracking-wide">
        Búsquedas recientes
      </div>
      <ul className="max-h-80 overflow-y-auto">
        {history.map((entry) => (
          <li
            key={entry.query}
            className="flex items-center gap-1 hover:bg-muted/60 transition-colors"
          >
            <button
              type="button"
              onClick={() => onSelect(entry.query)}
              className="flex-1 flex items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground min-w-0"
            >
              <Clock
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-hidden
              />
              <span className="truncate">{entry.query}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(entry.query)}
              aria-label={`Eliminar "${entry.query}" del historial`}
              className="shrink-0 mr-2 p-1.5 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClearAll}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground border-t border-border/50 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Borrar todo
      </button>
    </div>
  );
}
