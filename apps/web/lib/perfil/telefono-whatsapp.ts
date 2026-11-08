import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/core";
import metadata from "libphonenumber-js/metadata.min.json";

export type TelefonoWhatsApp = { pais: CountryCode | ""; nacional: string };
const paises = getCountries(metadata);
const nombres = new Intl.DisplayNames(["es"], { type: "region" });

export const PAISES_WHATSAPP = paises.map((pais) => ({
  pais,
  lada: getCountryCallingCode(pais, metadata),
  nombre: nombres.of(pais) ?? pais,
})).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

export function desglosarWhatsApp(numero: string): TelefonoWhatsApp {
  const digitos = numero.replace(/\D/g, "");
  if (!digitos) return { pais: "MX", nacional: "" };
  const parsed = parsePhoneNumberFromString(`+${digitos}`, metadata);
  if (parsed?.country) {
    return { pais: parsed.country, nacional: digitos.slice(parsed.countryCallingCode.length) };
  }
  const codigo = PAISES_WHATSAPP.find(({ lada }) => digitos.startsWith(lada));
  return codigo
    ? { pais: codigo.pais, nacional: digitos.slice(codigo.lada.length) }
    : { pais: "", nacional: digitos };
}

export function digitosWhatsApp({ pais, nacional }: TelefonoWhatsApp): string {
  if (!pais || !nacional) return nacional;
  const lada = getCountryCallingCode(pais, metadata);
  const parsed = parsePhoneNumberFromString(nacional, { defaultCountry: pais, extract: false }, metadata);
  if (parsed?.countryCallingCode === lada && parsed.isPossible()) return parsed.number.slice(1);
  return lada + nacional;
}

export function mostrarWhatsApp({ pais, nacional }: TelefonoWhatsApp): string {
  if (!pais) return nacional;
  const formateado = new AsYouType(pais, metadata).input(nacional);
  return formateado.replace(/[()]/g, "").replace(/-/g, " ").replace(/\s+/g, " ");
}
