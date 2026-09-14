-- iniciar_conversacion: obtener o crear la conversacion y registrar la
-- intencion de compra en UNA llamada, sin duplicados aunque se pulse dos
-- veces, haya peticiones simultaneas o se reintente por mala conexion.
--
-- HOY (12-sep-2026) el flujo son dos pasos sueltos en apps/web/app/(marketplace)/
-- chat/page.tsx: get_or_create_chat (RPC) y despues un INSERT en messages con
-- el texto "quiere comprar" compuesto en el servidor. Un F5, un "atras" o un
-- doble toque sobre /chat?seller&product&intent=buy repiten el segundo paso y
-- el vendedor recibe el mismo aviso dos, tres veces. No hay clave que
-- identifique la operacion, asi que el servidor no puede saber que es la misma.
--
-- LO QUE YA EXISTE Y SE REUTILIZA (no se reinventa):
--   - idx_chats_pair: UNICO sobre (LEAST(comprador, vendedor), GREATEST(...)).
--     Es lo que garantiza UN chat por par en cualquier sentido, y se respeta
--     con ON CONFLICT + relectura en vez de confiar en un SELECT previo.
--   - get_or_create_chat (20260912130000, endurecida con ON CONFLICT en
--     20260912310000): misma busqueda simetrica del par y mismo bump de
--     ultimo_producto_id; se conserva para avisarCitaEnChat y quien la llame.
--     Esta RPC no la sustituye todavia, la complementa.
--   - Los triggers de messages (increment_unread_count, unhide_chat_on_new_message,
--     push_on_message_pgnet) hacen su trabajo con el INSERT de aqui igual que
--     con cualquier otro: no se duplican no-leidos ni push porque el mensaje se
--     inserta UNA vez.
--   - vicino_guard.bloqueados_conmigo() y vicino_guard.cuenta_suspendida()
--     (20260912100000 / 20260912120000): bloqueo bidireccional y suspension.
--
-- LO NUEVO:
--   1. messages.clave_idempotencia uuid, con indice UNICO parcial sobre
--      (autor_id, clave_idempotencia). La clave la genera el SERVIDOR al pintar
--      la ficha (una por vista), viaja en la URL de /chat y por tanto sobrevive
--      al F5, al "atras" y al reintento. Dos peticiones con la misma clave = la
--      misma operacion. Una vista nueva de la ficha = clave nueva = intencion
--      nueva (eso sigue siendo posible a proposito). Solo aplica a 'compra':
--      con 'contacto' no hay nada que duplicar y la clave se ignora.
--   2. La RPC. Deriva al comprador de auth.uid(); si la clave ya se uso,
--      devuelve LO MISMO que la primera vez ANTES de volver a mirar vendedor o
--      producto (un reintento legitimo sigue siendo idempotente aunque el
--      producto se haya agotado entre medias); comprueba vendedor y producto;
--      toma dos llaves advisory en orden fijo (actor -> par); obtiene-o-crea
--      el chat; y si la intencion es de compra inserta el mensaje con la
--      clave. Todo en una transaccion: si el registro de la intencion falla
--      (cuota, sabotaje, lo que sea), tampoco queda el chat recien creado ni
--      el bump de ultimo_producto_id, y la llamada NO reporta exito.
--   3. message_type = 'purchase_intent' para ese mensaje (hasta hoy nacian
--      como 'user_text' y eran indistinguibles de un mensaje tecleado). Sirve
--      tambien para la cuota: 30 intenciones por cuenta en 24 h contando filas
--      de messages, que no se pueden borrar por REST (no hay policy de DELETE).
--      La cuota se cuenta bajo la llave del ACTOR: sin ella, 30 peticiones en
--      paralelo hacia vendedores distintos pasaban todas (la llave del par no
--      las serializa entre si).
--   4. La policy de INSERT de messages deja de aceptar clave_idempotencia y
--      message_type arbitrarios desde el cliente. Hasta hoy cualquier
--      participante podia insertar por REST un mensaje con el texto y el tipo
--      que quisiera; con un discriminador del que dependen la cuota y el
--      pintado del chat, eso ya no es aceptable. Un INSERT directo solo puede
--      ser 'user_text' sin clave, o el 'sale_confirmed' que confirmSale escribe
--      con la sesion del usuario sobre una venta completada de la que es parte.
--
-- EL TEXTO SE COMPONE AQUI, NO EN EL CLIENTE. Igual que avisarCitaEnChat: si el
-- texto llegara como argumento, una llamada directa al RPC podria colar texto
-- ajeno con la apariencia de un aviso del sistema. Mismo formato que hoy:
-- "<carrito> <nombre> quiere comprar: <titulo> por $1,500 MXN" o, sin precio,
-- "(Cotizacion|Reservacion|Consultar)" con su acento (via chr(243), para que
-- este archivo siga siendo ASCII puro y no llegue mutilado a produccion).
--
-- LLAVES ADVISORY. Dos, siempre en este orden: 'chat:intencion:<actor>' y
-- despues 'chat:par:<menor>:<mayor>'. get_or_create_chat no toma ninguna, asi
-- que no hay ciclo posible; y es el mismo orden usuario -> recurso que usara
-- comunidades. La del actor serializa la cuota; la del par, la creacion del
-- chat y la idempotencia por clave.
--
-- ERRORES (todos con ERRCODE para que el servidor los traduzca):
--   42501 sin sesion / cuenta suspendida
--   22023 intencion invalida, compra sin producto o sin clave, chat consigo mismo
--   PT404 vendedor suspendido, inexistente o con bloqueo en cualquier sentido;
--         producto inexistente, oculto, de otro vendedor, en borrador o
--         eliminado; para 'compra', ademas no disponible.
--         PTxyz es la convencion de PostgREST: llega como HTTP 404, no como 500.
--   23514 cuota de intenciones agotada
--   PT409 la clave ya se uso en OTRA operacion (otro vendedor u otro producto):
--         error del cliente. No se usa 23505 para esto: un unique_violation
--         real dentro de la RPC debe llegar a Sentry como fallo, no disfrazado.
--
-- QUE NO HACE: no cambia pantallas (chat/page.tsx sigue igual hasta que se
-- integre) ni cambia la firma de get_or_create_chat.
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists clave_idempotencia uuid;

comment on column public.messages.clave_idempotencia is
  'Clave generada por el servidor al pintar la ficha para que repetir la misma operacion (F5, atras, reintento, doble toque) no duplique el mensaje. Unica por autor. NULL en mensajes normales. Solo la escribe iniciar_conversacion: la policy de INSERT la rechaza desde el cliente.';

create unique index if not exists messages_autor_clave_idempotencia_unica
  on public.messages (autor_id, clave_idempotencia)
  where clave_idempotencia is not null;

-- ---------------------------------------------------------------------------
-- Policy de INSERT de messages: misma expresion viva (20260912120000, con la
-- guardia de suspension) mas el cierre del discriminador. ALTER POLICY ...
-- WITH CHECK sustituye la expresion entera, por eso se re-emite completa.
-- ---------------------------------------------------------------------------
alter policy "Participants can send messages" on public.messages
  with check (
    (select auth.uid()) = autor_id
    and exists (
      select 1 from public.chats
       where chats.id = messages.chat_id
         and (chats.comprador_id = (select auth.uid())
              or chats.vendedor_id = (select auth.uid()))
    )
    and not (select vicino_guard.cuenta_suspendida())
    -- Lo que el cliente puede escribir directamente: texto normal, o el aviso
    -- de venta confirmada sobre una venta completada de la que es parte. Los
    -- avisos de intencion de compra solo nacen en iniciar_conversacion.
    and clave_idempotencia is null
    and (
      message_type = 'user_text'
      or (
        message_type = 'sale_confirmed'
        and sale_confirmation_id is not null
        and exists (
          select 1 from public.sale_confirmations sc
           where sc.id = messages.sale_confirmation_id
             and sc.status = 'completed'::public.sale_status
             -- En el chat de ESA venta y no en otro: sin esto, quien es parte
             -- de una venta completada podia colar un "venta confirmada" con
             -- texto libre en cualquier otro chat suyo y, de paso, gastar el
             -- indice unico messages_unique_sale_confirmed para que el aviso
             -- legitimo de confirmSale muriera con 23505 en silencio.
             and sc.chat_id = messages.chat_id
             and (sc.buyer_id = (select auth.uid()) or sc.seller_id = (select auth.uid()))
        )
      )
    )
  );

create or replace function public.iniciar_conversacion(
  p_vendedor_id uuid,
  p_producto_id uuid default null,
  p_intencion   text default 'contacto',
  p_clave       uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor       uuid := (select auth.uid());
  v_compra      boolean;
  v_chat        uuid;
  v_chat_nuevo  boolean := false;
  v_msg         uuid;
  v_msg_nuevo   boolean := false;
  v_repetida    boolean := false;
  v_prod        record;
  v_previo      record;
  v_nombre      text;
  v_texto       text;
  v_intentos    integer;
begin
  -- 1. Sesion y argumentos. El comprador NO es un argumento: es quien llama.
  if v_actor is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_intencion is null or p_intencion not in ('contacto', 'compra') then
    raise exception 'intencion invalida: usa contacto o compra' using errcode = '22023';
  end if;
  v_compra := (p_intencion = 'compra');
  if v_compra and (p_producto_id is null or p_clave is null) then
    raise exception 'la intencion de compra necesita producto y clave de idempotencia'
      using errcode = '22023';
  end if;
  if (select vicino_guard.cuenta_suspendida()) then
    raise exception 'Tu cuenta esta suspendida.' using errcode = '42501';
  end if;
  if p_vendedor_id is null or p_vendedor_id = v_actor then
    raise exception 'no puedes iniciar un chat contigo mismo' using errcode = '22023';
  end if;

  -- 2. Idempotencia por clave, ANTES de mirar vendedor o producto: si esta
  --    operacion ya se registro, se devuelve exactamente lo mismo que la
  --    primera vez aunque el producto se haya agotado o el vendedor se haya
  --    ocultado entre medias. Un reintento no puede dar otra respuesta.
  --    La clave identifica UNA operacion (autor + vendedor + producto): con
  --    otro vendedor u otro producto es un error del cliente, no una
  --    respuesta repetida.
  if v_compra then
    select m.id, m.chat_id, m.publicacion_id into v_previo
      from messages m
     where m.autor_id = v_actor and m.clave_idempotencia = p_clave;
    if found then
      -- publicacion_id es ON DELETE SET NULL: si el producto se borro
      -- fisicamente entre la primera llamada y el reintento, NULL no es
      -- "otro producto", es "ya no se puede comparar" y el par manda.
      if (v_previo.publicacion_id is not null and v_previo.publicacion_id <> p_producto_id)
         or not exists (
           select 1 from chats c
            where c.id = v_previo.chat_id
              and (c.vendedor_id = p_vendedor_id or c.comprador_id = p_vendedor_id)
         )
      then
        raise exception 'la clave de idempotencia ya se uso en otra operacion'
          using errcode = 'PT409';
      end if;
      return jsonb_build_object(
        'chat_id', v_previo.chat_id, 'message_id', v_previo.id,
        'chat_nuevo', false, 'mensaje_nuevo', false, 'repetida', true);
    end if;
  end if;

  -- 3. Vendedor: suspendido, inexistente o con bloqueo en cualquier sentido
  --    reciben la MISMA respuesta, para no confirmar bloqueos.
  if not exists (select 1 from profiles p where p.id = p_vendedor_id and p.is_hidden = false)
     or p_vendedor_id = any (vicino_guard.bloqueados_conmigo())
  then
    raise exception 'vendedor no disponible' using errcode = 'PT404';
  end if;

  -- 4. Producto: tiene que ser de ESE vendedor, visible y no en borrador ni
  --    eliminado (la RLS se los esconde al comprador; la RPC no puede
  --    confirmar que existen). Para comprar, ademas disponible. Asi una
  --    llamada directa no puede colgar en el chat un producto ajeno, oculto
  --    o borrado.
  if p_producto_id is not null then
    select ps.titulo, ps.precio, ps.modo_precio, ps.creador_id, ps.estatus, ps.is_hidden
      into v_prod
      from products_services ps
     where ps.id = p_producto_id;
    if not found
       or v_prod.creador_id <> p_vendedor_id
       or v_prod.is_hidden
       or v_prod.estatus in ('borrador', 'eliminado')
    then
      raise exception 'producto no disponible' using errcode = 'PT404';
    end if;
    if v_compra and v_prod.estatus <> 'disponible' then
      raise exception 'producto no disponible' using errcode = 'PT404';
    end if;
  end if;

  -- 5. Llaves, en orden fijo actor -> par. La del actor serializa la cuota
  --    (30 intenciones en paralelo hacia 30 vendedores distintos entran de
  --    una en una y la 31.a ve las 30). La del par serializa la creacion del
  --    chat y la clave: dos peticiones gemelas entran de una en una y la
  --    segunda ya ve lo que dejo la primera.
  perform pg_advisory_xact_lock(hashtextextended('chat:intencion:' || v_actor::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'chat:par:' || least(v_actor, p_vendedor_id)::text || ':' || greatest(v_actor, p_vendedor_id)::text, 0));

  -- 6. Obtener o crear el chat. ON CONFLICT sobre la expresion de idx_chats_pair
  --    cubre a quien cree el chat por OTRO camino sin la llave: si pierde la
  --    carrera, relee en vez de morir con 23505.
  select c.id into v_chat
    from chats c
   where (c.comprador_id = v_actor and c.vendedor_id = p_vendedor_id)
      or (c.comprador_id = p_vendedor_id and c.vendedor_id = v_actor);

  if v_chat is null then
    insert into chats (comprador_id, vendedor_id, ultimo_producto_id)
    values (v_actor, p_vendedor_id, p_producto_id)
    on conflict (least(comprador_id, vendedor_id), greatest(comprador_id, vendedor_id)) do nothing
    returning id into v_chat;
    if v_chat is null then
      select c.id into v_chat
        from chats c
       where (c.comprador_id = v_actor and c.vendedor_id = p_vendedor_id)
          or (c.comprador_id = p_vendedor_id and c.vendedor_id = v_actor);
    else
      v_chat_nuevo := true;
    end if;
  end if;

  -- 7. Segunda comprobacion de la clave, YA con las llaves: la primera fue
  --    sin ellas y pudo perder contra una peticion gemela que commiteo entre
  --    medias. Ahora ademas se exige que el mensaje encontrado sea de ESTE
  --    chat: la llave es por par, y una clave repetida hacia otro vendedor no
  --    se serializa con esta.
  if v_compra then
    select m.id, m.chat_id, m.publicacion_id into v_previo
      from messages m
     where m.autor_id = v_actor and m.clave_idempotencia = p_clave;
    if found then
      -- Mismo criterio que el paso 2 (autor + vendedor + producto): dos
      -- peticiones gemelas hacia el mismo vendedor con productos distintos
      -- se serializan aqui, y la segunda no puede "heredar" el aviso de la
      -- primera como si fuera suyo.
      if v_previo.chat_id <> v_chat
         or (v_previo.publicacion_id is not null and v_previo.publicacion_id <> p_producto_id)
      then
        raise exception 'la clave de idempotencia ya se uso en otra operacion'
          using errcode = 'PT409';
      end if;
      return jsonb_build_object(
        'chat_id', v_chat, 'message_id', v_previo.id,
        'chat_nuevo', false, 'mensaje_nuevo', false, 'repetida', true);
    end if;
  end if;

  -- 8. Mismo criterio que get_or_create_chat: con producto, el chat sube en
  --    la lista y apunta al producto de la ficha desde la que se llego.
  if not v_chat_nuevo and p_producto_id is not null then
    update chats
       set ultimo_producto_id = p_producto_id, updated_at = now()
     where id = v_chat;
  end if;

  -- Solo el lado de quien llama (mismo criterio que get_or_create_chat desde
  -- 20260912130000); el de la otra persona lo reabre el trigger cuando llegue
  -- un mensaje de verdad.
  update chats
     set oculto_para_comprador = case when comprador_id = v_actor then false else oculto_para_comprador end,
         oculto_para_vendedor  = case when vendedor_id  = v_actor then false else oculto_para_vendedor  end
   where id = v_chat;

  -- 9. La intencion de compra. Cuota (bajo la llave del actor), texto
  --    compuesto aqui, e INSERT con ON CONFLICT sobre la clave por si una
  --    peticion gemela entro por otro camino: nunca dos mensajes con la misma
  --    clave. Si algo de esto falla, la transaccion entera se deshace: ni chat
  --    nuevo, ni bump, ni des-ocultar.
  if v_compra then
    select count(*) into v_intentos
      from messages m
     where m.autor_id = v_actor
       and m.message_type = 'purchase_intent'
       and m.created_at > now() - interval '24 hours';
    if v_intentos >= 30 then
      raise exception 'Demasiadas intenciones de compra hoy. Intentalo manana.'
        using errcode = '23514';
    end if;

    select p.nombre into v_nombre from profiles p where p.id = v_actor;

    v_texto := chr(128722) || ' ' || coalesce(nullif(btrim(v_nombre), ''), 'Un comprador')
      || ' quiere comprar: ' || v_prod.titulo || ' '
      || case
           when v_prod.precio is not null then
             -- FM deja "1,500." para un entero y "1,500.5" para un decimal: se
             -- quitan ceros de cola y despues el punto suelto, en ese orden.
             'por $' || rtrim(rtrim(to_char(v_prod.precio, 'FM999,999,999,990.99'), '0'), '.') || ' MXN'
           else
             '(' || case v_prod.modo_precio
                      when 'cotizacion'  then 'Cotizaci' || chr(243) || 'n'
                      when 'reservacion' then 'Reservaci' || chr(243) || 'n'
                      else 'Consultar'
                    end || ')'
         end;

    insert into messages (chat_id, autor_id, texto, publicacion_id, message_type, clave_idempotencia)
    values (v_chat, v_actor, v_texto, p_producto_id, 'purchase_intent', p_clave)
    on conflict (autor_id, clave_idempotencia) where clave_idempotencia is not null do nothing
    returning id into v_msg;

    if v_msg is null then
      select m.id, m.chat_id, m.publicacion_id into v_previo
        from messages m
       where m.autor_id = v_actor and m.clave_idempotencia = p_clave;
      if not found
         or v_previo.chat_id <> v_chat
         or (v_previo.publicacion_id is not null and v_previo.publicacion_id <> p_producto_id)
      then
        raise exception 'la clave de idempotencia ya se uso en otra operacion'
          using errcode = 'PT409';
      end if;
      v_msg := v_previo.id;
      v_repetida := true;
    else
      v_msg_nuevo := true;
    end if;
  end if;

  return jsonb_build_object(
    'chat_id', v_chat, 'message_id', v_msg,
    'chat_nuevo', v_chat_nuevo, 'mensaje_nuevo', v_msg_nuevo, 'repetida', v_repetida);
end;
$function$;

comment on function public.iniciar_conversacion(uuid, uuid, text, uuid) is
  'Obtiene o crea la conversacion comprador->vendedor y, si p_intencion = compra, registra el mensaje "quiere comprar" con clave de idempotencia. El comprador es auth.uid(), nunca un argumento. Misma clave = misma respuesta que la primera vez, sin duplicar y antes de re-validar nada; clave nueva = intencion nueva. Mismo chat_id para peticiones equivalentes (llaves advisory actor -> par + idx_chats_pair). Todo o nada: si falla el registro de la intencion no queda ni el chat recien creado. Con contacto la clave se ignora.';

revoke execute on function public.iniciar_conversacion(uuid, uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.iniciar_conversacion(uuid, uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFY (ejercido en el proyecto de pruebas el 12-sep-2026; ver ademas
-- scripts/probar-iniciar-conversacion.mjs para la concurrencia REAL por HTTP).
-- Todo dentro de BEGIN ... ROLLBACK, con A vendedora, B y C compradores y el
-- producto P de A.
--
-- 1. Doble llamada con la misma clave: mismo chat, mismo mensaje, 1 fila.
--   SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub":"<B>",...}';
--   SELECT public.iniciar_conversacion('<A>', '<P>', 'compra', '<k1>');  -- chat_nuevo true, mensaje_nuevo true
--   SELECT public.iniciar_conversacion('<A>', '<P>', 'compra', '<k1>');  -- repetida true, mismos ids
--   SELECT count(*) FROM public.messages WHERE clave_idempotencia = '<k1>';  -- 1
--
-- 2. Clave nueva = intencion nueva, en el MISMO chat:
--   SELECT public.iniciar_conversacion('<A>', '<P>', 'compra', '<k2>');  -- mismo chat_id, mensaje_nuevo true
--
-- 3. Contacto: crea/obtiene el chat, no inserta nada y la clave se ignora:
--   SELECT public.iniciar_conversacion('<A>', '<P>');                     -- message_id null
--   SELECT public.iniciar_conversacion('<A>', '<P>', 'contacto', '<k1>'); -- message_id null, repetida false
--
-- 4. Reintento tras cambiar el estado: la respuesta no cambia.
--   ... '<k1>' registrada; UPDATE products_services SET estatus = 'agotado' WHERE id = '<P>';
--   SELECT public.iniciar_conversacion('<A>', '<P>', 'compra', '<k1>');  -- repetida true (no PT404)
--
-- 5. No autorizado:
--   (anon)  SELECT public.iniciar_conversacion('<A>');                    -- 42501
--   (B)     SELECT public.iniciar_conversacion('<B>');                    -- 22023 contigo mismo
--   (B)     SELECT public.iniciar_conversacion('<C>', '<P>', 'compra', gen_random_uuid()); -- PT404: P no es de C
--   (B)     ... 'compra' sin clave                                          -- 22023
--   (B, con C bloqueando a B) SELECT public.iniciar_conversacion('<C>');   -- PT404
--   (B suspendida) SELECT public.iniciar_conversacion('<A>');             -- 42501
--   (B, P en borrador) SELECT public.iniciar_conversacion('<A>', '<P>');  -- PT404
--   (B, misma clave, otro producto u otro vendedor)                        -- PT409
--
-- 6. Fallo parcial = nada queda. Se sabotea el INSERT del mensaje con un
--    trigger temporal y se comprueba que el chat recien creado NO existe:
--   CREATE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS $t$
--     BEGIN IF NEW.message_type = 'purchase_intent' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $t$;
--   CREATE TRIGGER boom BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
--   (C) SELECT public.iniciar_conversacion('<A>', '<P>', 'compra', gen_random_uuid()); -- boom
--   SELECT count(*) FROM public.chats WHERE comprador_id = '<C>' AND vendedor_id = '<A>';  -- 0
--
-- 7. La policy de INSERT ya no deja forjar el aviso:
--   (B, participante) INSERT INTO public.messages (chat_id, autor_id, texto, message_type)
--     VALUES ('<chat>', '<B>', 'falso', 'purchase_intent');                      -- 42501
--   (B) INSERT ... (chat_id, autor_id, texto, clave_idempotencia) VALUES (..., gen_random_uuid()); -- 42501
--   (B) INSERT ... (chat_id, autor_id, texto) VALUES ('<chat>', '<B>', 'hola');  -- 1 fila (user_text)
--
-- 8. Cuota: 30 entran, la 31.a da 23514 aunque vaya a otro vendedor; contacto sigue.
--
-- 9. Sin sobrecargas y ACL correcto:
--   SELECT count(*) FROM pg_proc WHERE proname = 'iniciar_conversacion';   -- 1
--   SELECT has_function_privilege('anon', 'public.iniciar_conversacion(uuid,uuid,text,uuid)', 'EXECUTE'); -- false
-- ---------------------------------------------------------------------------
