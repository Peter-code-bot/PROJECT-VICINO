"use client";

import { Check, Store, User } from "lucide-react";
import Image from "next/image";
import { CATEGORIES } from "@vicino/shared";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { MetodosPagoSelector } from "@/components/profile/metodos-pago-selector";

export type SellerType = "casual" | "business";

export function Categoria({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Categoría de venta</legend>
      {CATEGORIES.filter((categoria) => !categoria.hidden_in_form).map((categoria) => {
        const Icono = iconoDeCategoria(categoria.slug);
        const selected = value === categoria.slug;
        return (
          <label
            key={categoria.slug}
            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors focus-within:ring-2 focus-within:ring-primary dark:focus-within:ring-brand-hi focus-within:ring-offset-2 ${
              selected ? "border-primary dark:border-brand-hi bg-primary/10" : "border-transparent hover:bg-muted"
            }`}
          >
            <input
              type="radio"
              name="seller-category"
              value={categoria.slug}
              checked={selected}
              onChange={() => onChange(categoria.slug)}
              className="sr-only"
            />
            <Icono className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{categoria.name}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{categoria.ejemplos}</span>
            </span>
            {selected && <Check className="h-5 w-5 shrink-0 text-primary dark:text-brand-hi" aria-hidden="true" />}
          </label>
        );
      })}
      <p className="pt-2 text-sm text-muted-foreground">
        Esta categoría aparecerá en tu perfil. Puedes cambiarla después.
      </p>
    </fieldset>
  );
}

export function Tipo({
  value,
  onChange,
}: {
  value: SellerType;
  onChange: (value: SellerType) => void;
}) {
  const options = [
    { value: "casual" as const, Icono: User, title: "Casual", description: "Vendo artículos personales de vez en cuando." },
    { value: "business" as const, Icono: Store, title: "Negocio", description: "Vendo con el nombre de mi tienda o negocio." },
  ];
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Tipo de vendedor</legend>
      {options.map(({ value: optionValue, Icono, title, description }) => (
        <label
          key={optionValue}
          className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left transition-colors focus-within:ring-2 focus-within:ring-primary dark:focus-within:ring-brand-hi focus-within:ring-offset-2 ${
            value === optionValue ? "border-primary dark:border-brand-hi bg-primary/10" : "border-border bg-card hover:bg-muted"
          }`}
        >
          <input
            type="radio"
            name="seller-type"
            value={optionValue}
            checked={value === optionValue}
            onChange={() => onChange(optionValue)}
            className="sr-only"
          />
          <Icono className="mt-0.5 h-5 w-5 shrink-0 text-primary dark:text-brand-hi" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-heading font-semibold">{title}</span>
            <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
          </span>
          {value === optionValue && <Check className="h-5 w-5 shrink-0 text-primary dark:text-brand-hi" aria-hidden="true" />}
        </label>
      ))}
      <p className="pt-1 text-sm text-muted-foreground">Puedes cambiar de tipo después.</p>
    </fieldset>
  );
}

export function Pagos({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  return <MetodosPagoSelector metodosSeleccionados={value} onChange={onChange} />;
}

export function Activar({
  nombre,
  categoria,
  tipo,
  username,
  foto,
  descripcion,
  pagos,
  activo = false,
}: {
  nombre: string;
  categoria: string | null;
  tipo: SellerType;
  username?: string;
  foto?: string | null;
  descripcion?: string | null;
  pagos?: string | null;
  activo?: boolean;
}) {
  const categoryName = CATEGORIES.find((item) => item.slug === categoria)?.name;
  return (
    <div className="space-y-5 text-sm">
      <p>{activo ? "Esto se muestra en tu perfil público:" : "Al activar el Modo Vendedor, esto se mostrará en tu perfil público:"}</p>
      {foto && <Image src={foto} alt="Tu foto de perfil" width={80} height={80} unoptimized className="h-20 w-20 rounded-full object-cover" />}
      <dl className="space-y-4 rounded-2xl border border-border bg-card p-4">
        {username && <div><dt className="text-muted-foreground">ID de usuario</dt><dd className="mt-1 break-words font-medium">@{username}</dd></div>}
        <div>
          <dt className="text-muted-foreground">{tipo === "business" ? "Nombre del negocio" : "Nombre"}</dt>
          <dd className="mt-1 break-words font-medium">{nombre.trim() || "Tu nombre público"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Categoría</dt>
          <dd className="mt-1 font-medium">{categoryName || "Por elegir"}</dd>
        </div>
        <div><dt className="text-muted-foreground">Tipo de vendedor</dt><dd className="mt-1 font-medium">{tipo === "business" ? "Negocio" : "Casual"}</dd></div>
        {descripcion && <div><dt className="text-muted-foreground">Descripción</dt><dd className="mt-1 whitespace-pre-wrap break-words">{descripcion}</dd></div>}
        {tipo === "business" && pagos && <div><dt className="text-muted-foreground">Métodos de pago</dt><dd className="mt-1 break-words">{pagos}</dd></div>}
        <div>
          <dt className="text-muted-foreground">Zona</dt>
          <dd className="mt-1">La colonia que registres, sin tu dirección exacta.</dd>
        </div>
      </dl>
      <p className="text-muted-foreground">
        Puedes desactivarlo desde Configuración. Tus publicaciones se pausarán y dejarán de verse; se conservarán.
      </p>
      <p className="text-xs text-muted-foreground">
        Consulta los <a href="/terminos" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Términos</a> y el <a href="/privacidad" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Aviso de Privacidad</a>.
      </p>
    </div>
  );
}
