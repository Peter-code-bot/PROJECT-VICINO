-- Bloque C: Marcar como leídas las notificaciones legacy de tipo 'message'.
-- Solo afecta filas que aún están sin leer (AND leida = false) para evitar
-- write amplification en el histórico. No es un DELETE — las filas permanecen.
-- Ejecutar después de 20260511000001 (drop del trigger generador).

UPDATE notifications
SET leida = true
WHERE tipo = 'message'
  AND leida = false;
