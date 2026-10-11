-- UI10–UI11. The migration runner owns the transaction; no nested BEGIN/COMMIT.
-- Historical uso_continuado rows retain their original mode and date.
ALTER TABLE public.legal_acceptances
  ADD COLUMN confirmacion_en timestamptz,
  ADD COLUMN confirmacion_tipo text CHECK (confirmacion_tipo IN ('aceptacion_terminos', 'acuse_aviso')),
  ADD COLUMN confirmacion_origen text,
  ADD COLUMN confirmacion_evidencia text;

ALTER TABLE public.profiles
  ADD COLUMN onboarding_revision integer NOT NULL DEFAULT 0 CHECK (onboarding_revision >= 0),
  ADD COLUMN seller_visibility_confirmed_at timestamptz,
  ADD COLUMN seller_visibility_version text;
GRANT SELECT (onboarding_revision) ON public.profiles TO authenticated;

CREATE TABLE public.onboarding_operation_receipts (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  payload jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id)
);
ALTER TABLE public.onboarding_operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.onboarding_operation_receipts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.estado_confirmacion_legal() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_docs jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_agg(jsonb_build_object('documento', d.documento, 'version', d.version,
    'confirmada', EXISTS (SELECT 1 FROM public.legal_acceptances a
      WHERE a.user_id = v_uid AND a.documento = d.documento AND a.version = d.version
        AND a.confirmacion_en IS NOT NULL
        AND a.confirmacion_tipo = CASE d.documento WHEN 'terminos' THEN 'aceptacion_terminos' ELSE 'acuse_aviso' END))
    ORDER BY d.documento) INTO v_docs
  FROM (SELECT DISTINCT ON (documento) documento, version FROM public.legal_documents
    WHERE vigente_desde <= now() ORDER BY documento, vigente_desde DESC, publicado_en DESC) d;
  IF jsonb_array_length(COALESCE(v_docs, '[]'::jsonb)) <> 2 THEN
    RAISE EXCEPTION 'No se pudieron comprobar los documentos vigentes' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('documents', v_docs, 'confirmed', NOT EXISTS
    (SELECT 1 FROM jsonb_array_elements(v_docs) d WHERE NOT (d->>'confirmada')::boolean));
END;
$$;
REVOKE ALL ON FUNCTION public.estado_confirmacion_legal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estado_confirmacion_legal() TO authenticated;

CREATE FUNCTION public.exigir_confirmacion_legal() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  LOCK TABLE public.legal_documents IN SHARE MODE;
  IF NOT (public.estado_confirmacion_legal()->>'confirmed')::boolean THEN
    RAISE EXCEPTION 'Confirma los Términos y el Aviso de Privacidad para continuar.' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.exigir_confirmacion_legal() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.confirmar_documentos_cuenta(
  p_terminos_version text, p_aviso_version text, p_acepta_terminos boolean, p_acusa_aviso boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_state jsonb; v_doc jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501'; END IF;
  IF p_acepta_terminos IS DISTINCT FROM true OR p_acusa_aviso IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Marca las dos casillas para continuar.' USING ERRCODE = '22023';
  END IF;
  -- Bind evidence to the authenticated profile; no anonymous metadata or client date.
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tu perfil aún no está listo.' USING ERRCODE = 'P0002'; END IF;
  -- Share-lock the catalog so its required version cannot change halfway through acknowledgement.
  LOCK TABLE public.legal_documents IN SHARE MODE;
  v_state := public.estado_confirmacion_legal();
  FOR v_doc IN SELECT value FROM jsonb_array_elements(v_state->'documents') LOOP
    IF v_doc->>'version' IS DISTINCT FROM (CASE v_doc->>'documento'
      WHEN 'terminos' THEN p_terminos_version ELSE p_aviso_version END) THEN
      RAISE EXCEPTION 'Los documentos cambiaron. Recarga y revisa las versiones actuales.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.legal_acceptances AS a
      (user_id, documento, version, modo, confirmacion_en, confirmacion_tipo, confirmacion_origen, confirmacion_evidencia)
    VALUES (v_uid, v_doc->>'documento', v_doc->>'version', 'registro', now(),
      CASE v_doc->>'documento' WHEN 'terminos' THEN 'aceptacion_terminos' ELSE 'acuse_aviso' END,
      'confirmar_cuenta', 'ui11-cuenta-v1')
    ON CONFLICT (user_id, documento, version) DO UPDATE SET
      confirmacion_en = COALESCE(a.confirmacion_en, EXCLUDED.confirmacion_en),
      confirmacion_tipo = COALESCE(a.confirmacion_tipo, EXCLUDED.confirmacion_tipo),
      confirmacion_origen = COALESCE(a.confirmacion_origen, EXCLUDED.confirmacion_origen),
      confirmacion_evidencia = COALESCE(a.confirmacion_evidencia, EXCLUDED.confirmacion_evidencia);
  END LOOP;
  RETURN public.estado_confirmacion_legal();
END;
$$;
REVOKE ALL ON FUNCTION public.confirmar_documentos_cuenta(text,text,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_documentos_cuenta(text,text,boolean,boolean) TO authenticated;

-- The old RPC remains callable by older releases but can no longer fabricate new approvals.
CREATE OR REPLACE FUNCTION public.registrar_aceptacion_legal(
  p_modo text DEFAULT 'uso_continuado', p_user_agent text DEFAULT NULL, p_ip text DEFAULT NULL
) RETURNS TABLE (documento text, version text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501'; END IF;
  RETURN;
END;
$$;
COMMENT ON FUNCTION public.registrar_aceptacion_legal(text,text,text) IS
  'Compatibility no-op: visiting the service does not create explicit confirmation. Historical rows are preserved.';

CREATE FUNCTION public.bump_onboarding_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- No client UPDATE grant exists for this column. v3 normalizes its internal
  -- multi-write operation to expected+1 under the same FOR UPDATE row lock.
  IF NEW.onboarding_revision IS DISTINCT FROM OLD.onboarding_revision THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.username,NEW.nombre,NEW.bio,NEW.foto,NEW.intereses,NEW.onboarding_camino,NEW.onboarding_paso,
    NEW.has_seen_onboarding,NEW.es_vendedor,NEW.seller_type,NEW.categoria_negocio,NEW.nombre_negocio,
    NEW.descripcion_negocio,NEW.metodos_pago_aceptados)
    IS DISTINCT FROM ROW(OLD.username,OLD.nombre,OLD.bio,OLD.foto,OLD.intereses,OLD.onboarding_camino,OLD.onboarding_paso,
    OLD.has_seen_onboarding,OLD.es_vendedor,OLD.seller_type,OLD.categoria_negocio,OLD.nombre_negocio,
    OLD.descripcion_negocio,OLD.metodos_pago_aceptados) THEN
    NEW.onboarding_revision := OLD.onboarding_revision + 1;
  ELSE NEW.onboarding_revision := OLD.onboarding_revision;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_onboarding_revision BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.bump_onboarding_revision();
REVOKE ALL ON FUNCTION public.bump_onboarding_revision() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.guard_seller_confirmation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.es_vendedor IS TRUE AND OLD.es_vendedor IS DISTINCT FROM true THEN
    IF auth.uid() IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
    PERFORM public.exigir_confirmacion_legal();
    IF NEW.seller_visibility_confirmed_at IS NULL OR NEW.seller_visibility_version IS DISTINCT FROM 'vendedor-v1' THEN
      RAISE EXCEPTION 'Confirma la visibilidad de tu perfil antes de comenzar a vender.' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_seller_confirmation BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_seller_confirmation();
REVOKE ALL ON FUNCTION public.guard_seller_confirmation() FROM PUBLIC, anon, authenticated;

-- Preserve each legacy signature and its validation while guarding direct RPC access.
ALTER FUNCTION public.guardar_paso_onboarding_v2(text,text,text,text,text,text[],text,text,text,text,text,text)
  RENAME TO guardar_paso_onboarding_v2_internal;
REVOKE ALL ON FUNCTION public.guardar_paso_onboarding_v2_internal(text,text,text,text,text,text[],text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.guardar_paso_onboarding_v2(
  p_camino text DEFAULT NULL,p_paso text DEFAULT NULL,p_nombre text DEFAULT NULL,p_bio text DEFAULT NULL,
  p_foto text DEFAULT NULL,p_intereses text[] DEFAULT NULL,p_username text DEFAULT NULL,
  p_categoria_negocio text DEFAULT NULL,p_seller_type text DEFAULT NULL,p_nombre_negocio text DEFAULT NULL,
  p_descripcion_negocio text DEFAULT NULL,p_metodos_pago_aceptados text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.exigir_confirmacion_legal();
  RETURN public.guardar_paso_onboarding_v2_internal(p_camino,p_paso,p_nombre,p_bio,p_foto,p_intereses,p_username,
    p_categoria_negocio,p_seller_type,p_nombre_negocio,p_descripcion_negocio,p_metodos_pago_aceptados);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_paso_onboarding_v2(text,text,text,text,text,text[],text,text,text,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_paso_onboarding_v2(text,text,text,text,text,text[],text,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guardar_paso_onboarding(
  p_camino text DEFAULT NULL,p_paso text DEFAULT NULL,p_nombre text DEFAULT NULL,p_bio text DEFAULT NULL,
  p_foto text DEFAULT NULL,p_intereses text[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN public.guardar_paso_onboarding_v2(p_camino,p_paso,p_nombre,p_bio,p_foto,p_intereses);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_paso_onboarding(text,text,text,text,text,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_paso_onboarding(text,text,text,text,text,text[]) TO authenticated;

CREATE FUNCTION public.onboarding_canonical_snapshot(p_profile public.profiles) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('id',p_profile.id,'username',p_profile.username,'nombre',p_profile.nombre,
    'bio',p_profile.bio,'foto',p_profile.foto,'intereses',p_profile.intereses,
    'onboarding_camino',p_profile.onboarding_camino,'onboarding_paso',p_profile.onboarding_paso,
    'has_seen_onboarding',p_profile.has_seen_onboarding,'es_vendedor',p_profile.es_vendedor,
    'seller_type',p_profile.seller_type,'categoria_negocio',p_profile.categoria_negocio,
    'nombre_negocio',p_profile.nombre_negocio,'descripcion_negocio',p_profile.descripcion_negocio,
    'metodos_pago_aceptados',p_profile.metodos_pago_aceptados,'onboarding_revision',p_profile.onboarding_revision)
$$;
REVOKE ALL ON FUNCTION public.onboarding_canonical_snapshot(public.profiles) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.guardar_checkpoint_onboarding_v3(
  p_operation_id uuid,p_expected_revision integer,p_from_step text,p_next_step text,p_camino text,p_fields jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_profile public.profiles%ROWTYPE; v_receipt public.onboarding_operation_receipts%ROWTYPE;
  v_payload jsonb; v_result jsonb; v_fields jsonb:=COALESCE(p_fields,'{}'::jsonb); v_key text; v_allowed_key text;
BEGIN
  PERFORM public.exigir_confirmacion_legal();
  IF p_operation_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 2147483646 OR jsonb_typeof(v_fields) <> 'object' THEN
    RAISE EXCEPTION 'Operación de onboarding inválida.' USING ERRCODE='22023';
  END IF;
  IF p_from_step IS NULL OR p_from_step NOT IN ('categoria','tipo','usuario','nombre','foto','descripcion','pagos','intereses','ubicacion','notificaciones','listo')
    OR p_next_step IS NULL OR p_next_step NOT IN ('categoria','tipo','usuario','nombre','foto','descripcion','pagos','intereses','ubicacion','notificaciones','listo')
    OR p_camino IS NULL OR p_camino NOT IN ('explorar','vender') THEN
    RAISE EXCEPTION 'Paso de onboarding inválido.' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v_fields)) > 1 THEN
    RAISE EXCEPTION 'Guarda un dato a la vez.' USING ERRCODE='22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_fields) LOOP
    IF v_key NOT IN ('username','nombre','bio','foto','intereses','categoria_negocio','seller_type','nombre_negocio','descripcion_negocio','metodos_pago_aceptados')
      OR v_fields->v_key = 'null'::jsonb
      OR (v_key <> 'intereses' AND jsonb_typeof(v_fields->v_key) <> 'string')
      OR (v_key = 'intereses' AND jsonb_typeof(v_fields->v_key) <> 'array') THEN
      RAISE EXCEPTION 'Campo de onboarding inválido.' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF v_fields ? 'intereses' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields->'intereses') i WHERE jsonb_typeof(i) <> 'string') THEN
    RAISE EXCEPTION 'Intereses inválidos.' USING ERRCODE='22023';
  END IF;
  v_payload:=jsonb_build_object('kind','checkpoint','expectedRevision',p_expected_revision,'fromStep',p_from_step,'nextStep',p_next_step,'camino',p_camino,'fields',v_fields);
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tu perfil aún no está listo.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_receipt FROM public.onboarding_operation_receipts WHERE user_id=v_uid AND operation_id=p_operation_id;
  IF FOUND THEN
    IF v_receipt.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'El identificador de operación ya corresponde a otros datos.' USING ERRCODE='22023'; END IF;
    RETURN v_receipt.response;
  END IF;
  IF v_profile.onboarding_revision <> p_expected_revision THEN
    RETURN jsonb_build_object('status','conflict','revision',v_profile.onboarding_revision,'paso',v_profile.onboarding_paso,
      'camino',v_profile.onboarding_camino,'snapshot',public.onboarding_canonical_snapshot(v_profile));
  END IF;
  IF v_profile.has_seen_onboarding IS TRUE THEN RAISE EXCEPTION 'El onboarding ya terminó.' USING ERRCODE='22023'; END IF;
  -- A queued continuation can only save the field from its own page. Branches
  -- use the persisted seller type, never an unconfirmed client draft.
  v_allowed_key:=CASE p_from_step
    WHEN 'categoria' THEN 'categoria_negocio' WHEN 'tipo' THEN 'seller_type' WHEN 'usuario' THEN 'username'
    WHEN 'nombre' THEN CASE WHEN p_camino='vender' AND v_profile.seller_type='business' THEN 'nombre_negocio' ELSE 'nombre' END
    WHEN 'foto' THEN 'foto'
    WHEN 'descripcion' THEN CASE WHEN p_camino='vender' AND v_profile.seller_type='business' THEN 'descripcion_negocio' ELSE 'bio' END
    WHEN 'pagos' THEN 'metodos_pago_aceptados' WHEN 'intereses' THEN 'intereses' ELSE NULL END;
  IF v_key IS NOT NULL AND v_key IS DISTINCT FROM v_allowed_key THEN
    RAISE EXCEPTION 'El dato no corresponde a esta pantalla.' USING ERRCODE='22023';
  END IF;
  PERFORM public.guardar_paso_onboarding_v2_internal(p_camino,p_next_step,v_fields->>'nombre',v_fields->>'bio',v_fields->>'foto',
    CASE WHEN v_fields ? 'intereses' THEN ARRAY(SELECT jsonb_array_elements_text(v_fields->'intereses')) ELSE NULL END,
    v_fields->>'username',v_fields->>'categoria_negocio',v_fields->>'seller_type',v_fields->>'nombre_negocio',
    v_fields->>'descripcion_negocio',v_fields->>'metodos_pago_aceptados');
  UPDATE public.profiles SET onboarding_revision=p_expected_revision+1 WHERE id=v_uid;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_uid;
  v_result:=jsonb_build_object('status','saved','revision',v_profile.onboarding_revision,'paso',v_profile.onboarding_paso,
    'camino',v_profile.onboarding_camino,'snapshot',public.onboarding_canonical_snapshot(v_profile));
  INSERT INTO public.onboarding_operation_receipts(user_id,operation_id,payload,response) VALUES(v_uid,p_operation_id,v_payload,v_result);
  RETURN v_result;
END;
$$;

-- Existing explorers can still explicitly activate from the seller conversion
-- flow. A new account must use the atomic final onboarding operation instead.
CREATE OR REPLACE FUNCTION public.activar_modo_vendedor(
  p_categoria_negocio text DEFAULT NULL,p_seller_type text DEFAULT 'casual',p_nombre_negocio text DEFAULT NULL,
  p_descripcion_negocio text DEFAULT NULL,p_metodos_pago_aceptados text DEFAULT NULL,p_foto text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_profile public.profiles%ROWTYPE; v_category text; v_name text;
BEGIN
  PERFORM public.exigir_confirmacion_legal();
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tu perfil aún no está listo.' USING ERRCODE='P0002'; END IF;
  IF v_profile.has_seen_onboarding IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Termina el onboarding para comenzar a vender.' USING ERRCODE='22023';
  END IF;
  IF p_seller_type IS NULL OR p_seller_type NOT IN ('casual','business') THEN
    RAISE EXCEPTION 'Tipo de vendedor inválido.' USING ERRCODE='22023';
  END IF;
  v_category:=COALESCE(p_categoria_negocio,v_profile.categoria_negocio);
  v_name:=COALESCE(p_nombre_negocio,v_profile.nombre_negocio);
  IF v_category IS NULL OR NOT EXISTS(SELECT 1 FROM public.categories WHERE slug=v_category AND activo) THEN
    RAISE EXCEPTION 'Elige una categoría válida.' USING ERRCODE='22023';
  END IF;
  IF p_seller_type='business' AND length(btrim(COALESCE(v_name,''))) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'Confirma el nombre de tu negocio.' USING ERRCODE='22023';
  END IF;
  UPDATE public.profiles SET es_vendedor=true,seller_type=p_seller_type,categoria_negocio=v_category,
    nombre_negocio=CASE WHEN p_seller_type='business' THEN v_name ELSE nombre_negocio END,
    descripcion_negocio=CASE WHEN p_seller_type='business' THEN COALESCE(p_descripcion_negocio,descripcion_negocio) ELSE descripcion_negocio END,
    metodos_pago_aceptados=CASE WHEN p_seller_type='business' THEN COALESCE(p_metodos_pago_aceptados,metodos_pago_aceptados) ELSE metodos_pago_aceptados END,
    foto=COALESCE(p_foto,foto),alta_vendedor_paso='publicacion',
    seller_visibility_confirmed_at=now(),seller_visibility_version='vendedor-v1' WHERE id=v_uid;
  RETURN jsonb_build_object('es_vendedor',true,'paso','publicacion');
END;
$$;
REVOKE ALL ON FUNCTION public.activar_modo_vendedor(text,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activar_modo_vendedor(text,text,text,text,text,text) TO authenticated;

ALTER FUNCTION public.update_profile_and_pause_products(uuid,text,text,text,text,boolean,text,text,text,text)
  RENAME TO update_profile_and_pause_products_internal;
REVOKE ALL ON FUNCTION public.update_profile_and_pause_products_internal(uuid,text,text,text,text,boolean,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.update_profile_and_pause_products(
  p_user_id uuid,p_nombre text,p_bio text DEFAULT NULL,p_foto text DEFAULT NULL,p_ubicacion text DEFAULT NULL,
  p_es_vendedor boolean DEFAULT NULL,p_seller_type text DEFAULT NULL,p_nombre_negocio text DEFAULT NULL,
  p_descripcion_negocio text DEFAULT NULL,p_metodos_pago_aceptados text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  -- Opting out remains possible even when a new document version is pending.
  IF p_es_vendedor IS TRUE THEN PERFORM public.exigir_confirmacion_legal(); END IF;
  RETURN public.update_profile_and_pause_products_internal(p_user_id,p_nombre,p_bio,p_foto,p_ubicacion,
    p_es_vendedor,p_seller_type,p_nombre_negocio,p_descripcion_negocio,p_metodos_pago_aceptados);
END;
$$;
REVOKE ALL ON FUNCTION public.update_profile_and_pause_products(uuid,text,text,text,text,boolean,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_profile_and_pause_products(uuid,text,text,text,text,boolean,text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.guardar_checkpoint_onboarding_v3(uuid,integer,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.guardar_checkpoint_onboarding_v3(uuid,integer,text,text,text,jsonb) TO authenticated;

CREATE FUNCTION public.finalizar_onboarding_v3(p_operation_id uuid,p_expected_revision integer,p_decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_profile public.profiles%ROWTYPE; v_receipt public.onboarding_operation_receipts%ROWTYPE;
  v_payload jsonb;v_result jsonb;
BEGIN
  PERFORM public.exigir_confirmacion_legal();
  IF p_operation_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 2147483646
    OR p_decision IS NULL OR p_decision NOT IN ('explorar','activar') THEN
    RAISE EXCEPTION 'Elige cómo quieres entrar a VICINO.' USING ERRCODE='22023';
  END IF;
  v_payload:=jsonb_build_object('kind','finish','expectedRevision',p_expected_revision,'decision',p_decision);
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tu perfil aún no está listo.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_receipt FROM public.onboarding_operation_receipts WHERE user_id=v_uid AND operation_id=p_operation_id;
  IF FOUND THEN
    IF v_receipt.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'El identificador de operación ya corresponde a otros datos.' USING ERRCODE='22023'; END IF;
    RETURN v_receipt.response;
  END IF;
  IF v_profile.onboarding_revision <> p_expected_revision THEN
    RETURN jsonb_build_object('status','conflict','revision',v_profile.onboarding_revision,'paso',v_profile.onboarding_paso,
      'camino',v_profile.onboarding_camino,'snapshot',public.onboarding_canonical_snapshot(v_profile));
  END IF;
  IF v_profile.has_seen_onboarding IS DISTINCT FROM true THEN
    IF p_decision='activar' THEN
      IF v_profile.onboarding_camino IS DISTINCT FROM 'vender' OR v_profile.categoria_negocio IS NULL
        OR NOT EXISTS(SELECT 1 FROM public.categories WHERE slug=v_profile.categoria_negocio AND activo) THEN
        RAISE EXCEPTION 'Elige una categoría antes de comenzar a vender.' USING ERRCODE='22023';
      END IF;
      IF v_profile.seller_type='business' AND length(btrim(COALESCE(v_profile.nombre_negocio,''))) NOT BETWEEN 2 AND 100 THEN
        RAISE EXCEPTION 'Confirma el nombre de tu negocio antes de comenzar a vender.' USING ERRCODE='22023';
      END IF;
    END IF;
    UPDATE public.profiles SET has_seen_onboarding=true,onboarding_paso=NULL,
      es_vendedor=CASE WHEN p_decision='activar' THEN true ELSE es_vendedor END,
      seller_visibility_confirmed_at=CASE WHEN p_decision='activar' THEN now() ELSE seller_visibility_confirmed_at END,
      seller_visibility_version=CASE WHEN p_decision='activar' THEN 'vendedor-v1' ELSE seller_visibility_version END
      WHERE id=v_uid;
  END IF;
  UPDATE public.profiles SET onboarding_revision=p_expected_revision+1 WHERE id=v_uid;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_uid;
  v_result:=jsonb_build_object('status','saved','revision',v_profile.onboarding_revision,'paso',v_profile.onboarding_paso,
    'camino',v_profile.onboarding_camino,'snapshot',public.onboarding_canonical_snapshot(v_profile));
  INSERT INTO public.onboarding_operation_receipts(user_id,operation_id,payload,response) VALUES(v_uid,p_operation_id,v_payload,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.finalizar_onboarding_v3(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalizar_onboarding_v3(uuid,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_user_onboarding() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.exigir_confirmacion_legal();
  UPDATE public.profiles SET has_seen_onboarding=true,onboarding_paso=NULL WHERE id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Tu perfil aún no está listo.' USING ERRCODE='P0002'; END IF;
END;
$$;
