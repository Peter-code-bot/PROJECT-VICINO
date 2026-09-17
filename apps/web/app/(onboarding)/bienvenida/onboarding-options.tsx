"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { guardarPasoOnboarding } from "@/app/(onboarding)/completar-perfil/actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Los dos botones ya NO dan el onboarding por terminado.
 *
 * Antes los dos llamaban a completeOnboarding, que consume una bandera de UN
 * SOLO USO. O sea que quien tocaba «Quiero explorar» entraba a la app sin
 * nombre, sin foto, sin descripcion y sin intereses, y no podia volver a
 * elegir nunca. Ahora solo registran QUE CAMINO se eligio; la bandera se gasta
 * al final del ultimo paso.
 */
/**
 * El paso de notificaciones va INTERCALADO, no anadido al final.
 *
 * Los tres pasos de /completar-perfil los gobierna profiles.onboarding_paso,
 * cuyo CHECK solo admite perfil, intereses y ubicacion: meter un cuarto exige
 * migracion y toca el guard de /bienvenida. Y ponerlo al final, despues de
 * completeOnboarding, es ponerlo donde nadie lo ve: esa funcion ya manda a "/".
 *
 * Aqui no cuesta nada: el destino viaja en la URL y la pantalla de permiso no
 * escribe una sola fila, asi que la reanudacion sigue siendo exactamente la de
 * antes. Quien abandone en la pantalla de permiso vuelve por donde volvia —
 * «vender» a los dos botones (no guardo nada, igual que hoy) y «explorar» a
 * /completar-perfil por su onboarding_paso. Lo unico que se pierde al abandonar
 * ahi es ver el permiso, que es opcional por diseno.
 */
function conPermisoAntes(destino: string): string {
  return `/activar-notificaciones?siguiente=${encodeURIComponent(destino)}`;
}

export function OnboardingOptions() {
  const [isPending, startTransition] = useTransition();
  // Cual de los dos se toco, para que solo ese muestre el spinner. `isPending`
  // es uno solo para los dos botones: sin esto, tocar uno pone a girar los dos
  // y parece que la app hace dos cosas a la vez.
  const [tocado, setTocado] = useState<"vender" | "explorar" | null>(null);
  const router = useRouter();

  function elegir(camino: "vender" | "explorar") {
    setTocado(camino);

    // VENDER NO ESCRIBE NADA AQUI, y esto es una correccion de un fallo real.
    //
    // La primera version guardaba camino='vender' antes de navegar, y eso
    // encerraba a la persona en la app: /bienvenida veia ese camino y reenviaba
    // a /empezar-a-vender en cada visita, el alta ya no tiene «x» de salida, y
    // su unico control que avanza es «Activar Modo Vendedor». Quien tocaba
    // «Quiero vender» por curiosidad y se arrepentia no podia volver a elegir,
    // ni llegar al home, ni a /buscar, ni a su perfil: la unica salida era
    // hacerse vendedor.
    //
    // Y no hace falta guardarlo: los dos pasos del alta que van antes de la
    // activacion (categoria y tipo) viven en el cliente a proposito —lo dice la
    // migracion 20260826320000— porque perderlos al cerrar la app cuesta menos
    // que mantener estado de servidor para ellos. El camino se registra al
    // ACTIVAR, junto con el paso, que es cuando ya hay algo que reanudar.
    if (camino === "vender") {
      router.push(conPermisoAntes("/empezar-a-vender"));
      return;
    }

    startTransition(async () => {
      // Explorar si entra directo a los pasos compartidos, asi que guarda las
      // dos cosas: el camino y donde reanudar.
      const result = await guardarPasoOnboarding({ camino, paso: "perfil" });
      if (result.error) {
        setTocado(null);
        toast.error(result.error);
        return;
      }
      router.push(conPermisoAntes("/completar-perfil"));
    });
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      <Button
        onClick={() => elegir("vender")}
        loading={isPending && tocado === "vender"}
        disabled={isPending}
        variant="primary"
        size="lg"
        className="w-full py-4 text-lg h-auto font-medium rounded-xl !bg-[#121212] !text-white !shadow-none dark:!bg-[#F4F1EB] dark:!text-[#121212]"
      >
        Quiero vender
      </Button>

      <Button
        onClick={() => elegir("explorar")}
        loading={isPending && tocado === "explorar"}
        disabled={isPending}
        variant="primary"
        size="lg"
        className="w-full py-4 text-lg h-auto font-medium rounded-xl !bg-brand-hi !text-white !shadow-none"
      >
        Quiero explorar
      </Button>
    </div>
  );
}
