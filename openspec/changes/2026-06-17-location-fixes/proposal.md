# Proposal: Correcciones de Hiperlocalidad

## Problema
1. Los rankings aparecen en Villahermosa a pesar de no haber productos, mostrando vendedores de Puebla.
2. Al cerrar el modal de cambio de ubicación, la página no se recarga, requiriendo intervención manual.
3. El buscador (`buscar/page.tsx`) ignora la ubicación del usuario y muestra productos a nivel nacional.

## Solución Propuesta
1. **Rankings**: Actualizar el Server Component para leer `vicino_location` y pasar las coordenadas correctas al query de rankings.
2. **Modal**: Añadir `router.refresh()` en `onClose`.
3. **Buscador**: Crear un RPC `get_nearby_product_ids` que evalúe `ST_DWithin` y utilizar `.in('id', array)` en el query de Supabase.

## Impacto
Estos ajustes garantizan una experiencia 100% hiperlocal, donde el usuario solo ve lo que tiene en su radio seleccionado y los estados se actualizan fluidamente.
