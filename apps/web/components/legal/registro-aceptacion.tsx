"use client";

import { useEffect } from "react";
import { registrarAceptacionLegal } from "@/app/actions/legal";

/** Marca de sesion. Una llamada por pestaña, no una por navegacion. */
const CLAVE = "vicino:aceptacion-legal-registrada";

/**
 * No pinta nada. Deja constancia de que esta persona esta usando la plataforma
 * bajo las versiones legales vigentes.
 *
 * POR QUE UN COMPONENTE DE CLIENTE Y NO UNA LLAMADA EN EL LAYOUT. El layout es
 * un componente de servidor, y escribir durante el render es un efecto
 * secundario en un sitio que puede ejecutarse varias veces y en prerender. El
 * RPC es idempotente, asi que no corromperia nada, pero seria una escritura en
 * cada render de cada pagina del marketplace: mucho trafico para un dato que
 * solo cambia cuando se publica una version nueva.
 *
 * De ahi la marca en sessionStorage: una llamada por pestaña. Y `catch` que
 * traga, porque esto es contabilidad interna — que falle no puede estropearle
 * la navegacion a nadie. Lo que no se traga es el error en el servidor: la
 * accion lo manda a Sentry antes de volver.
 *
 * sessionStorage puede lanzar (modo privado, cookies bloqueadas), asi que va
 * envuelto: perder la marca solo significa una llamada de mas, y esa llamada de
 * mas no escribe nada.
 */
export function RegistroAceptacionLegal() {
  useEffect(() => {
    let yaRegistrado = false;
    try {
      yaRegistrado = window.sessionStorage.getItem(CLAVE) === "1";
    } catch {
      yaRegistrado = false;
    }
    if (yaRegistrado) return;

    void registrarAceptacionLegal()
      .then(() => {
        try {
          window.sessionStorage.setItem(CLAVE, "1");
        } catch {
          // Sin marca, la proxima navegacion vuelve a llamar. Es idempotente.
        }
      })
      .catch(() => {
        // Silencio deliberado: ya se reporto en el servidor.
      });
  }, []);

  return null;
}
