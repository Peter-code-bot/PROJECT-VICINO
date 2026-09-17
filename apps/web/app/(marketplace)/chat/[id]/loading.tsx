import { SkeletonLineas } from "@/components/shared/loading-skeletons";

/**
 * Fallback del DETALLE de la conversacion.
 *
 * Sin este archivo, Next usaba el de `/chat` para sus hijos: al tocar una
 * conversacion se volvia a pintar la LISTA de chats —ahora desde memoria, o
 * sea identica a la que la persona acaba de tocar— y el toque parecia no haber
 * hecho nada. Aqui la forma es la de la conversacion, asi que se ve de
 * inmediato que se esta abriendo.
 *
 * Las burbujas alternan lado como en el chat real y el alto es el mismo que
 * impone chat/[id]/layout.tsx, para que al llegar los mensajes no salte nada.
 */
export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <span className="sr-only" role="status" aria-live="polite">
        Abriendo la conversación
      </span>
      <div aria-hidden="true" className="esqueleto-demorado flex h-full flex-col">
        {/* Cabecera: volver, avatar y nombre */}
        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
          <div className="h-6 w-6 shrink-0 rounded-md skeleton" />
          <div className="h-10 w-10 shrink-0 rounded-full skeleton" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-1/3 skeleton rounded-md" />
            <div className="h-3 w-1/5 skeleton rounded-md" />
          </div>
        </div>

        {/* Mensajes */}
        <div className="flex-1 space-y-4 overflow-hidden px-4 py-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={i % 2 === 0 ? "flex justify-start" : "flex justify-end"}>
              <div className={`max-w-[72%] rounded-2xl p-3 ${i % 2 === 0 ? "bg-card" : "bg-[color:var(--card-2)]"}`}>
                <div className="w-48">
                  <SkeletonLineas n={i % 3 === 0 ? 2 : 1} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Caja de escribir */}
        <div className="flex items-center gap-2 border-t border-border/40 px-4 py-3">
          <div className="h-11 flex-1 skeleton rounded-2xl" />
          <div className="h-11 w-11 shrink-0 skeleton rounded-full" />
        </div>
      </div>
    </div>
  );
}
