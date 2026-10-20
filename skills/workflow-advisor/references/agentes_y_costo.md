# Agentes y costo

Preferencia del usuario del 20 de octubre de 2026, generalizada del flujo utilizado para planificar Reparto y hogar. Aplicable a los proyectos de Proyectos PERSONAL; no constituye una modificación de las instrucciones globales de ChatGPT.

## Decidir si delegar

Resolver directamente una edición pequeña, una consulta breve o una acción determinista. Delegar cuando haya una subtarea independiente que aporte capacidad, una revisión útil o ahorro de tiempo suficiente para compensar la coordinación. No crear un equipo solo para aparentar cumplimiento.

Para trabajo de varias fases: dividir por entregables, dependencias y criterios de aceptación; separar producción y revisión cuando el riesgo lo justifique. No imponer ese proceso completo a una tarea de pocos minutos.

La regla del espacio autoriza delegación pertinente dentro del encargo. No amplía el objetivo ni permite ejecutar un plan que el usuario solo pidió redactar.

## Selección de modelo y razonamiento

Elegir por dificultad, contexto, herramientas necesarias y consecuencia de un error. Optimizar el costo total esperado de obtener un resultado correcto, incluyendo revisión y reintentos; el modelo de menor precio por token puede no ser el más económico para una tarea difícil.

| Trabajo | Elección inicial orientativa |
|---|---|
| Inventario acotado, extracción, clasificación, resumen de material dado | Luna, Terra o equivalente disponible; razonamiento bajo |
| Investigación delimitada, comparación, documentación, pruebas de reglas o código pequeño con contrato claro | Modelo económico suficientemente capaz; razonamiento medio |
| Integración de varios módulos, arquitectura con alternativas o fallo difícil de reproducir | Modelo de capacidad intermedia/alta, por ejemplo Sol disponible; razonamiento medio o alto según dificultad |
| Persistencia, migraciones, concurrencia, autorización o decisiones de alto impacto | Modelo capaz de razonar sobre esos riesgos; razonamiento alto y revisión pertinente |
| Formato, compilación, cálculo o validación reproducible | Herramienta determinista; modelo solo para interpretar o resolver problemas |

Los nombres son candidatos, no una lista fija de precios ni una promesa de disponibilidad. Consultar los modelos y niveles aceptados por la herramienta que realmente creará el subagente. Terra puede aparecer en una interfaz y no en otra. Nunca inventar un identificador.

Si la herramienta no admite cambiar modelo, no simular que se seleccionó uno barato. Valorar ejecutar directamente o usar el modelo disponible cuando la delegación siga aportando valor; informar una limitación material. No crear otro chat ni contratar otro proveedor para sortearla.

En herramientas que exigen contexto nuevo para sobrescribir modelo, usar ese modo y transmitir un resumen suficiente. En la herramienta de colaboración actual, los overrides se envían con `fork_turns="none"`; comprobar su contrato vigente antes de usarla.

No investigar tarifas en cada tarea. Si el encargo exige un presupuesto monetario o comparar precios, consultar tarifas oficiales actuales y distinguir modalidad de suscripción/API. No afirmar que un ahorro se midió si no hay datos.

## Contrato de una subtarea

Antes del envío, dejar claros:

1. Objetivo único y entregable.
2. Contexto mínimo: decisiones vigentes, fuentes y archivos concretos; incluir las restricciones que no heredará.
3. Archivos que puede modificar o condición de solo lectura.
4. Herramientas pertinentes y criterio comprobable de aceptación.
5. Límites proporcionales de investigación, intentos y longitud de respuesta.
6. Cuándo devolver un bloqueo al coordinador.

El agente devuelve resultado, evidencia, archivos cambiados y límites. El coordinador integra y valida; una declaración de éxito del auxiliar no sustituye la comprobación.

Evitar que dos agentes escriban el mismo archivo simultáneamente. Un solo responsable integra el trabajo. Las tareas dependientes se ejecutan en orden; solo las independientes se paralelizan.

## Límites de consumo

- Por defecto, un coordinador y hasta dos auxiliares simultáneos, respetando los cupos reales. Un equipo mayor exige justificar independencia y beneficio; no necesita nueva aprobación si ya está dentro del alcance autorizado.
- Subdelegación desactivada por defecto; habilitarla solo para una tarea definida y con límite común de equipo.
- No enviar toda la conversación cuando basta un resumen. No duplicar búsquedas ni releer informes sin necesidad.
- Reutilizar artefactos y resultados de pruebas mientras sigan vigentes.
- Respetar el presupuesto explícito del usuario. Si no lo hay, no inventar un presupuesto en dinero ni crear una meta automática de tokens.
- Registrar consumo/costo solo cuando esté expuesto por las herramientas. Una nota breve de modelos usados y motivo de escalado basta; no crear reportes extensos en tareas pequeñas.

## Escalar sin bucles

Si falla una aceptación, aclarar el fallo y hacer una corrección acotada. Después de dos ciclos fallidos, detener la repetición idéntica, aislar un caso mínimo y decidir si falta información, una herramienta, un contrato mejor o mayor capacidad.

Escalar solo la subtarea que lo necesita. Elegir razonamiento alto desde el comienzo cuando el riesgo lo justifique; no exigir fallos previos para trabajo crítico. Una cuota agotada o una herramienta ausente no se resuelve gastando más razonamiento.

Dos intentos no convierten el resultado en aprobado ni obligan a abandonar lo que aún puede resolverse. Continuar con un enfoque distinto cuando exista evidencia para hacerlo y el presupuesto lo permita.

## Alcance y permisos

Usar los subagentes de la conversación para subtareas. Crear un chat nuevo solo si el usuario lo pide. No enviar mensajes externos, publicar, comprar recursos, exponer secretos ni ampliar acceso por el hecho de delegar.

Los modelos locales requieren verificar instalación, modelo, hardware y desempeño en una tarea representativa; no asumir que Ollama está listo o que su costo operativo es nulo.

## Ejemplos de aplicación

- Corregir un enlace Markdown: hacerlo directamente y comprobar el enlace; cero auxiliares.
- Plan de un juego con economía y QA: coordinador más dos auxiliares económicos, contexto reducido, propuestas y una revisión acotada; sin construir el juego si el encargo es solo planificar.
- Migración de datos con riesgo de pérdida: asignar diseño/revisión a un modelo capaz y razonamiento alto; un económico puede inventariar archivos, sin decidir por sí solo la migración.
- Terra no disponible para subagentes: elegir otro candidato disponible, como Luna si es suficiente; no inventar una llamada ni abrir otro chat.
