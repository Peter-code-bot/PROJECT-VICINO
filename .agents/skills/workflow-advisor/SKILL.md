---
name: workflow-advisor
description: Planifica implementaciones, revisiones y equipos de VICINO; elige trabajo directo o delegación y modelo/esfuerzo por dificultad, consumo esperado y riesgo. Usar al organizar trabajo o elegir auxiliares; no crea equipos para tareas pequeñas.
---

# Workflow Advisor para VICINO

Aplicar la regla permanente de delegación y elección de modelos de `AGENTS.md`.
Es la adaptación autocontenida del asesor del hub `herramientas_trabajo_ia` para
este repositorio; no depende de que ese hub exista en otra máquina.

1. Identificar resultado solicitado, restricciones, fuentes y verificación.
   Un encargo de planificación no autoriza implementar ni publicar.
2. Resolver directamente trabajo pequeño o secuencial. Delegar sólo subtareas
   independientes con beneficio de calidad o tiempo que compense su consumo.
3. Antes del primer despacho, leer
   [la política de selección](references/codex-model-routing.md), contrastar
   fuentes oficiales y catálogo de la herramienta. Reutilizar esa evidencia
   mientras siga vigente.
4. Elegir el modelo disponible de menor consumo esperado suficientemente capaz,
   incluyendo latencia y coste de corregir errores. Registrar por subtarea:
   resultado, modelo exacto, esfuerzo, motivo, comprobación y escalado. Enviar
   los parámetros explícitos cuando la herramienta lo permita.
5. Entregar contexto mínimo, archivos permitidos y criterios de aceptación.
   No compartir secretos ni toda la conversación si basta un resumen.
6. Usar por defecto un coordinador y hasta dos auxiliares simultáneos; sin
   subdelegación salvo justificación y límite definidos. Tras dos intentos
   fallidos comparables, aislar el problema antes de repetir o escalar.
7. Revisar e integrar el resultado con pruebas proporcionales; distinguir
   propuesta, cambio local, resultado probado, publicación y aceptación real.
   No inventar tarifas, disponibilidad ni porcentajes de ahorro.

La regla no cambia el modelo del agente principal, permisos, configuración
global, autorización de gastos o mensajes a terceros. No crea otro chat ni
un objetivo automático. Notion continúa como fuente operativa de VICINO y
Obsidian como archivo de sólo lectura.
