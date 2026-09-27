#!/usr/bin/env node
/**
 * S08 H2: prueba de 20260927140000 (categoria_id derivado del slug) en STAGING,
 * dentro de BEGIN ... ROLLBACK: el staging no cambia. Termina a proposito con
 * RAISE TODAS_OK para que el rollback sea seguro aunque todo pase.
 *
 *   node scripts/staging/probar-categoria-id.mjs
 */
import fs from 'node:fs';
import { readConfig, sql } from './lib.mjs';
const cfg = readConfig();
const mig = fs.readFileSync('supabase/migrations/20260927140000_categoria_id_desde_el_slug.sql', 'utf8');
const pruebas = `
DO $t$
DECLARE v_id uuid; v_cat uuid; v_cat2 uuid; v_final uuid;
BEGIN
  SELECT id INTO v_cat FROM categories WHERE slug='libros';
  SELECT id INTO v_cat2 FROM categories WHERE slug='ropa';
  INSERT INTO products_services (creador_id, titulo, descripcion, categoria, precio, estatus)
  VALUES ((SELECT id FROM profiles LIMIT 1), '[FIXTURE] prueba categoria_id', 'x', 'libros', 10, 'disponible')
  RETURNING id, categoria_id INTO v_id, v_final;
  IF v_final IS DISTINCT FROM v_cat THEN RAISE EXCEPTION 'INSERT: categoria_id=% esperado %', v_final, v_cat; END IF;
  UPDATE products_services SET categoria='ropa' WHERE id=v_id RETURNING categoria_id INTO v_final;
  IF v_final IS DISTINCT FROM v_cat2 THEN RAISE EXCEPTION 'UPDATE categoria: % esperado %', v_final, v_cat2; END IF;
  UPDATE products_services SET categoria='slug-que-no-existe' WHERE id=v_id RETURNING categoria_id INTO v_final;
  IF v_final IS DISTINCT FROM v_cat2 THEN RAISE EXCEPTION 'slug desconocido borro el id: %', v_final; END IF;
  UPDATE products_services SET titulo='otro titulo' WHERE id=v_id RETURNING categoria_id INTO v_final;
  IF v_final IS DISTINCT FROM v_cat2 THEN RAISE EXCEPTION 'UPDATE ajeno cambio el id: %', v_final; END IF;
  RAISE EXCEPTION 'TODAS_OK';
END $t$;`;
try {
  await sql(cfg.ref, `begin;\n${mig}\n${pruebas}\nrollback;`);
  console.log('sin excepcion final (inesperado)');
} catch (e) {
  console.log(/TODAS_OK/.test(e.message) ? 'PRUEBAS: TODAS_OK (4/4)' : `FALLO: ${e.message.slice(0, 400)}`);
}
const r = await sql(cfg.ref, "select exists(select 1 from pg_trigger where tgname='derivar_categoria_id_del_slug_trg') trigger_queda, (select count(*) from products_services where titulo like '[FIXTURE] prueba categoria_id') filas_quedan");
console.log('staging tras rollback:', JSON.stringify(r));
