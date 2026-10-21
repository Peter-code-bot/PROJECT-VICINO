import "server-only";
import { PKPass } from "passkit-generator";
import type { ConfigApple } from "../config";
import type { SnapshotMembresia } from "@/lib/lealtad/esquemas";
import { buffersDelPase } from "./assets";

/**
 * Construye y firma un storeCard de Apple Wallet a partir del snapshot de la
 * membresia. El pase es una COPIA del saldo: el QR lleva el identificador
 * opaco de la membresia y nada mas (ni correo, ni telefono, ni ids internos).
 *
 * passkit-generator 3.7.0 (MIT) firma con el certificado del Pass Type ID y
 * la cadena WWDR. No se ha probado contra un certificado real de Apple: la
 * prueba automatica usa una cadena autofirmada y solo valida la estructura.
 */
export interface DatosPaseApple {
  config: ConfigApple;
  snapshot: SnapshotMembresia;
  serialNumber: string;
  authenticationToken: string;
  siteUrl: string;
}

export function hexARgb(hex: string): string {
  const limpio = /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex.slice(1) : "1F5A4E";
  const r = parseInt(limpio.slice(0, 2), 16);
  const g = parseInt(limpio.slice(2, 4), 16);
  const b = parseInt(limpio.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Texto canonico del progreso ("3 de 5"), el mismo en la app y en las carteras. */
export function textoProgreso(sellos: number, meta: number): string {
  return `${Math.max(0, sellos)} de ${meta}`;
}

export function camposDelPase(snapshot: SnapshotMembresia) {
  const { membership, program, cliente, negocio } = snapshot;
  const faltan = Math.max(0, program.meta_sellos - membership.sellos_disponibles);
  return {
    header: [{ key: "sellos", label: "SELLOS", value: textoProgreso(membership.sellos_disponibles, program.meta_sellos) }],
    primary: [{ key: "premio", label: "PREMIO", value: program.premio }],
    secondary: [
      { key: "titular", label: "TITULAR", value: cliente.nombre },
      { key: "programa", label: "PROGRAMA", value: program.nombre },
    ],
    auxiliary: [
      {
        key: "faltan",
        label: faltan === 0 ? "LISTO" : "FALTAN",
        value: faltan === 0 ? "Canjea tu premio en VICINO" : `${faltan} ${faltan === 1 ? "sello" : "sellos"}`,
      },
    ],
    back: [
      { key: "negocio", label: "Negocio", value: negocio.nombre },
      { key: "condiciones", label: "Condiciones", value: program.condiciones ?? "Sin condiciones adicionales." },
      {
        key: "como",
        label: "Cómo funciona",
        value:
          "Cada compra confirmada en VICINO suma un sello. El saldo oficial vive en VICINO; esta tarjeta es una copia que se actualiza sola. Para canjear, abre tu tarjeta en VICINO y muestra el código al negocio.",
      },
    ],
  };
}

/** El .pkpass firmado, listo para servir. */
export function construirPaseApple(datos: DatosPaseApple): Buffer {
  return armarPaseApple(datos).getAsBuffer();
}

/** La instancia sin cerrar: la prueba la inspecciona con getAsRaw(). */
export function armarPaseApple({ config, snapshot, serialNumber, authenticationToken, siteUrl }: DatosPaseApple): PKPass {
  const { program, negocio, membership } = snapshot;
  const pase = new PKPass(
    buffersDelPase(),
    {
      wwdr: config.wwdr,
      signerCert: config.signerCert,
      signerKey: config.signerKey,
      signerKeyPassphrase: config.signerKeyPassphrase,
    },
    {
      formatVersion: 1,
      passTypeIdentifier: config.passTypeId,
      teamIdentifier: config.teamId,
      serialNumber,
      organizationName: "VICINO",
      description: `Tarjeta de lealtad de ${negocio.nombre}`,
      logoText: negocio.nombre,
      webServiceURL: `${siteUrl}/api/wallet/apple`,
      authenticationToken,
      backgroundColor: hexARgb(program.color),
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(255, 255, 255)",
      sharingProhibited: true,
    },
  );
  pase.type = "storeCard";
  const campos = camposDelPase(snapshot);
  pase.headerFields.push(...campos.header);
  pase.primaryFields.push(...campos.primary);
  pase.secondaryFields.push(...campos.secondary);
  pase.auxiliaryFields.push(...campos.auxiliary);
  pase.backFields.push(...campos.back);
  pase.setBarcodes({
    message: membership.public_id,
    format: "PKBarcodeFormatQR",
    messageEncoding: "iso-8859-1",
    altText: membership.public_id,
  });
  return pase;
}
