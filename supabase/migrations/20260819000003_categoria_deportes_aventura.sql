-- La categoria 'deportes' (Deportes y Fitness) es type:'producto' en el array
-- TS: sirve para VENDER equipo. Un servicio de hiking o una clase de yoga no
-- tenian donde caer y terminaban en 'educacion' u 'otros'.
-- El rename evita dos categorias que empiezan igual conviviendo en los chips.
-- orden=32: la secuencia real en produccion llega a 31 (joyeria), no a 25.
-- Las seis categorias de 364c605 entraron fuera de banda y no estan en
-- ninguna migracion de master. orden es INTEGER DEFAULT 0 sin UNIQUE: un
-- valor repetido no falla, deja el orden entre empatadas al planner.

INSERT INTO categories (nombre, slug, icono, orden, activo)
VALUES ('Deportes y Aventura', 'deportes-aventura', 'Mountain', 32, true)
ON CONFLICT (slug) DO NOTHING;

UPDATE categories SET nombre = 'Artículos Deportivos' WHERE slug = 'deportes';
