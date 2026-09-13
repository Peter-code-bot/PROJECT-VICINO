const mxnFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatPrice(
  amount: number | string | null | undefined,
): string | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return null;
  return mxnFormatter.format(n);
}

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatDate(date: string | Date): string {
  return dateFormatter.format(new Date(date));
}

const relativeFormatter = new Intl.RelativeTimeFormat("es-MX", {
  numeric: "auto",
});

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);

  if (Math.abs(diffMinutes) < 1) return "ahora";
  if (Math.abs(diffMinutes) < 60) return relativeFormatter.format(diffMinutes, "minute");
  if (Math.abs(diffHours) < 24) return relativeFormatter.format(diffHours, "hour");
  if (Math.abs(diffDays) < 30) return relativeFormatter.format(diffDays, "day");
  return formatDate(date);
}

const REPAIR_PATTERNS: Array<[RegExp, string]> = [
  [/Rodr[\uFFFD]guez/gi, "Rodríguez"],
  [/Mart[\uFFFD]nez/gi, "Martínez"],
  [/Garc[\uFFFD]a/gi, "García"],
  [/Hern[\uFFFD]ndez/gi, "Hernández"],
  [/Gonz[\uFFFD]lez/gi, "González"],
  [/P[\uFFFD]rez/gi, "Pérez"],
  [/S[\uFFFD]nchez/gi, "Sánchez"],
  [/L[\uFFFD]pez/gi, "López"],
  [/D[\uFFFD]az/gi, "Díaz"],
  [/Ram[\uFFFD]rez/gi, "Ramírez"],
  [/Guti[\uFFFD]rrez/gi, "Gutiérrez"],
  [/V[\uFFFD]zquez/gi, "Vázquez"],
  [/Jim[\uFFFD]nez/gi, "Jiménez"],
  [/Mu[\uFFFD]oz/gi, "Muñoz"],
  [/Pe[\uFFFD]a/gi, "Peña"],
  [/M[\uFFFD]xico/gi, "México"],
  [/Jes[\uFFFD]s/gi, "Jesús"],
  [/Jos[\uFFFD]/gi, "José"],
  [/Mar[\uFFFD]a/gi, "María"],
  [/Sebasti[\uFFFD]n/gi, "Sebastián"],
  [/Adri[\uFFFD]n/gi, "Adrián"],
  [/Juli[\uFFFD]n/gi, "Julián"],
  [/Mart[\uFFFD]n/gi, "Martín"],
  [/Ángel/gi, "Ángel"],
  [/[\uFFFD]ngel/gi, "Ángel"],
];

/**
 * Sanitiza y repara nombres de usuario que puedan contener caracteres corruptos
 * o el caracter de reemplazo Unicode (\uFFFD / ) debido a codificaciones de BD antiguas.
 */
export function cleanDisplayName(name: string | null | undefined): string {
  if (!name || typeof name !== "string") return "Usuario";

  let cleaned = name.trim();
  if (!cleaned) return "Usuario";

  // Reparar patrones comunes con \uFFFD
  for (const [pattern, replacement] of REPAIR_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => {
      const first = match.charAt(0);
      if (first && first === first.toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement.toLowerCase();
    });
  }

  // Eliminar cualquier caracter de reemplazo Unicode (\uFFFD) remanente
  cleaned = cleaned.replace(/\uFFFD+/g, "").trim();

  // Limpiar espacios dobles producidos por la remoción
  cleaned = cleaned.replace(/\s{2,}/g, " ");

  return cleaned || "Usuario";
}
