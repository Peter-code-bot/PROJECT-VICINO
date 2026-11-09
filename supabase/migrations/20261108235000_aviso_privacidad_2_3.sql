-- Aviso de Privacidad 2.3: enlaces de contacto y redes sociales del negocio.
--
-- Publica la version 2.3 en legal_documents. El texto vive en
-- apps/web/components/legal/aviso-privacidad-cuerpo.tsx y la version en
-- packages/shared/src/constants/privacy.ts (AVISO_PRIVACIDAD_VERSION). La
-- version vigente de esta tabla y la del codigo TIENEN que coincidir: la
-- pantalla /confirmar-cuenta compara las dos, y si no coinciden nadie puede
-- confirmar.
--
-- Al entrar en vigor, todas las cuentas con sesion vuelven a ver una vez la
-- pantalla «Antes de empezar» para confirmar los documentos (el middleware
-- pide confirmar la version vigente).
--
-- DECISION DE PEDRO: si el cambio es SUSTANCIAL (Aviso, seccion 18).
--
--   Este archivo lo trae como NO sustancial (sustancial = false), con entrada
--   en vigor al aplicarlo: describe una funcion opcional en la que el propio
--   Vendedor escribe el dato para publicarlo, y un conteo que no identifica a
--   nadie. Orden si se queda asi:
--     1. Merge del PR (el codigo ya dice 2.3).
--     2. En cuanto termine el deploy de Vercel, Pedro aplica esta migracion.
--   En esos minutos, quien ya confirmo 2.2 navega normal; quien tiene que
--   confirmar ve «No pudimos comprobar los documentos» hasta que se aplica.
--   (Al reves seria peor: con la base en 2.3 y el codigo en 2.2, nadie podria
--   confirmar hasta el deploy.)
--
--   Si Pedro lo califica como SUSTANCIAL, cambiar la fila a
--     sustancial = true, vigente_desde = now() + interval '30 days'
--   (el CHECK legal_documents_preaviso_30_dias lo exige), aplicar la migracion
--   YA (el banner de cambios legales lo anuncia 30 dias) y mergear el codigo el
--   dia de la entrada en vigor.

INSERT INTO public.legal_documents (documento, version, publicado_en, vigente_desde, sustancial, resumen)
VALUES (
  'aviso', '2.3', now(), now(), false,
  'Agrega la seccion 4.6: los enlaces de contacto y redes sociales que el Vendedor decide publicar en su perfil '
  '(son publicos, VICINO no se conecta a esas redes ni comprueba la cuenta, y se quitan al desactivar el Modo '
  'Vendedor); el registro sin identidad de cuantas veces se abren (4.3 y 15, 90 dias); dos finalidades primarias '
  '(5.1) y la salida a servicios de terceros al abrir esos enlaces (8).'
);

-- VERIFY (solo lectura):
--   SELECT documento, version, vigente_desde, sustancial FROM public.legal_documents ORDER BY vigente_desde;
--   -- esperado: aviso 2.3 al final, vigente
--   SELECT * FROM public.estado_confirmacion_legal();   -- con una sesion: confirmed = false hasta confirmar
