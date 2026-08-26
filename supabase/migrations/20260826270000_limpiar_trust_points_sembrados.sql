-- 847 puntos de confianza que nadie pudo ganar.
--
-- El perfil de Javier Rodriguez tiene trust_points = 847 y trust_level
-- 'estrella' con CERO ventas, CERO resenas y CERO verificaciones aprobadas.
--
-- No es una sospecha, es aritmetica. Estas son TODAS las vias que suman puntos
-- en el sistema, leidas de las funciones vivas:
--
--   venta completada        vendedor +10, comprador +3   (check_sale_completion)
--   verificacion aprobada   +30                          (approve_verification_atomic)
--   resena recibida         segun la calificacion        (update_user_rating_on_review)
--   venta cancelada         -5 o -3
--
-- Con cero de las tres primeras, el maximo alcanzable es 0. Los 847 son dato
-- sembrado en pruebas.
--
-- Por que importa y no es cosmetico: el umbral de 'estrella' son 500 puntos, y
-- composite_score de los rankings usa trust_points_snapshot. Un perfil sin una
-- sola venta encabezaria el ranking de su categoria en cuanto seller_rankings
-- se empiece a poblar, y el primer ranking que vea un usuario real seria una
-- mentira.
--
-- Se pone a 0 y NO a un valor inventado: cero es lo que corresponde a cero
-- ventas y cero resenas. El trigger auto_update_trust_level recalcula el nivel
-- solo, y como es una bajada no dispara la notificacion de subida de nivel.
--
-- NO se toca el otro perfil con puntos (20, de Pedro Soriano). Ese SI tiene una
-- verificacion aprobada detras, asi que tiene origen, aunque los numeros no
-- cuadren del todo: aprobar da +30, no +20. Queda anotado como pendiente
-- menor, pero 20 puntos no mueven ningun umbral (el primero esta en 50) y
-- borrar algo que si tiene origen es peor que dejarlo.

UPDATE public.profiles
   SET trust_points = 0
 WHERE trust_points > 0
   AND total_sales = 0
   AND reviews_count = 0
   AND NOT EXISTS (
     SELECT 1 FROM public.seller_verification sv
      WHERE sv.user_id = profiles.id AND sv.status = 'approved'
   );

-- VERIFY:
--   SELECT nombre, trust_points, trust_level FROM profiles WHERE trust_points > 0;
--   -- esperado: solo Pedro Soriano con 20 y nivel 'nuevo'
--   SELECT nombre, trust_level FROM profiles WHERE trust_level <> 'nuevo';
--   -- esperado: ninguna fila
