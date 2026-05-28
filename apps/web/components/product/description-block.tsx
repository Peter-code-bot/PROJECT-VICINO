interface DescriptionBlockProps {
  descripcion: string | null;
}

export function DescriptionBlock({ descripcion }: DescriptionBlockProps) {
  if (!descripcion || descripcion.trim().length === 0) return null;

  return (
    <section className="flex flex-col gap-2 px-1">
      <h3 className="font-display text-base font-semibold text-fg">
        Descripción
      </h3>
      <p className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--fg-muted)]">
        {descripcion}
      </p>
    </section>
  );
}
