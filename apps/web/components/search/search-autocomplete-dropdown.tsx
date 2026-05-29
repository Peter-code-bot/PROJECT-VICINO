"use client";

import { Clock, Trash2, X, Search, Users, Loader2, PackageOpen } from "lucide-react";
import type { SearchHistoryEntry } from "@/hooks/use-search-history";
import { useSearchSuggestions } from "@/hooks/use-search-suggestions";

interface SearchAutocompleteDropdownProps {
  query: string;
  history: SearchHistoryEntry[];
  onSelect: (query: string) => void;
  onRemoveHistory: (query: string) => void;
  onClearHistory: () => void;
  onSearchUsers: (query: string) => void;
  onSearchProducts: (query: string) => void;
}

export function SearchAutocompleteDropdown({
  query,
  history,
  onSelect,
  onRemoveHistory,
  onClearHistory,
  onSearchUsers,
  onSearchProducts,
}: SearchAutocompleteDropdownProps) {
  const { suggestions, loading } = useSearchSuggestions(query);

  const isTyping = query.trim().length > 0;

  // Prevent default on mousedown so focus doesn't leave the input
  // This is CRITICAL for keeping the dropdown open when interacting with it.
  const handleMouseDown = (e: React.MouseEvent) => e.preventDefault();

  if (!isTyping && history.length === 0) return null;

  return (
    <div
      onMouseDown={handleMouseDown}
      className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border bg-card shadow-lg overflow-hidden flex flex-col"
    >
      {!isTyping ? (
        // STATE 1: HISTORY (No query)
        <>
          <div className="px-4 py-2 text-[10px] font-medium text-muted-foreground border-b border-border/50 uppercase tracking-wide flex justify-between items-center">
            Búsquedas recientes
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClearHistory();
              }}
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" /> Borrar todo
            </button>
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveHistory(entry.query);
                  }}
                  aria-label={`Eliminar "${entry.query}" del historial`}
                  className="shrink-0 mr-2 p-1.5 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        // STATE 2: SUGGESTIONS + SWITCH (Query entered)
        <>
          <div className="px-4 py-2 text-[10px] font-medium text-muted-foreground border-b border-border/50 uppercase tracking-wide">
            Sugerencias
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {loading ? (
              <li className="px-4 py-4 flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>Buscando...</span>
              </li>
            ) : suggestions.length > 0 ? (
              suggestions.map((suggestion, i) => (
                <li key={i} className="hover:bg-muted/60 transition-colors">
                  <button
                    type="button"
                    onClick={() => onSelect(suggestion)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground"
                  >
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                    <span className="truncate">{suggestion}</span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-4 py-3 text-sm text-muted-foreground text-center italic">
                Sin sugerencias exactas.
              </li>
            )}
          </ul>
          
        </>
      )}
    </div>
  );
}
