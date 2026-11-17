import type { ReactNode } from "react";

/** Fila etiqueta + campo del formulario de perfil (antes vivia dentro de profile-form.tsx). */
export function FieldRow({ label, htmlFor, hint, children, last = false }: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  const Etiqueta = htmlFor ? "label" : "span";
  return (
    <div className={`group/field flex items-start gap-3 py-3 ${last ? "" : "border-b border-border/10"}`}>
      <Etiqueta
        htmlFor={htmlFor}
        className="w-24 shrink-0 pt-0.5 text-[13px] text-muted-foreground transition-colors group-focus-within/field:text-primary"
      >
        {label}
      </Etiqueta>
      <div className="min-w-0 flex-1">
        {children}
        {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
