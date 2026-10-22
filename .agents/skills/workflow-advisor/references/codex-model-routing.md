# Selección y ejecución de modelos para agentes Codex

Referencia revisada el **2026-10-13**. Leer cuando Workflow Advisor vaya a recomendar o crear agentes Codex. Los criterios son una política de este hub; los identificadores y capacidades deben contrastarse con la sesión actual.

## Fuentes y disponibilidad

Consulta [selección de modelos de OpenAI](https://developers.openai.com/api/docs/guides/model-selection) y [subagentes de Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents) una vez al iniciar el despacho en una sesión. Abre las páginas pertinentes y usa el catálogo de la herramienta actual para confirmar las opciones ejecutables. Los límites de ChatGPT/Codex y la facturación por API son superficies diferentes: no extrapoles precios ni disponibilidad entre ellas.

Si falta conexión, usa esta referencia como orientación fechada y decláralo; la herramienta actual sigue siendo necesaria para confirmar una opción admitida. Si no hay un modelo capaz disponible, entrega la evidencia y el bloqueo concreto, sin simular un despacho.

## Criterios por subtarea

Esta matriz es un punto de partida, no una clasificación automática por palabras clave. Un trabajo largo puede ser repetitivo; una modificación de una línea puede afectar autorización o integridad de datos.

| Necesidad real | Candidato si está disponible | Esfuerzo orientativo | Evidencia que permite elegirlo |
|---|---|---|---|
| Extracción, inventario, formato o edición mecánica | `gpt-6-luna` | `low` | Resultado preciso y comprobable; poco contexto y baja incertidumbre. |
| Exploración acotada, localizar referencias o corregir un fallo ya reproducido | `gpt-6-luna` | `medium` o `high` | Alcance claro, evidencia accesible y criterio de aceptación directo. |
| Implementación con dependencias, diseño de pruebas, investigación con síntesis o revisión de lógica | `gpt-6.1-sol` | `medium` o `high` | Debe relacionar varias piezas, justificar decisiones y validar el resultado. |
| Diagnóstico muy ambiguo, arquitectura difícil, análisis adversarial con alto riesgo o evidencia contradictoria que Sol no resuelve | `gpt-6-astra` | `low` o `medium`; elevar si hace falta | El problema exige más capacidad; concreta por qué una opción inferior tendría riesgo de fallo o demasiado retrabajo. |

Las familias Luna, Sol y Astra cubren respectivamente trabajo acotado, trabajo complejo con equilibrio de consumo y análisis especialmente exigente según la documentación citada. Los rangos de esfuerzo de la tabla son decisiones de este hub: confirma los valores soportados. Reserva `xhigh`, `max` o `ultra` para una necesidad identificada; no son valores obligatorios de un rol. Considera versiones anteriores solo si están disponibles y son adecuadas; no sustituyas una elección explícita del usuario por novedad.

Para riesgo alto y resultado difícil de comprobar, empieza con una opción capaz o una revisión independiente proporcionada; evita la prueba barata seguida de costosas repeticiones. Comparar muchas variantes de modelo solo se justifica para un flujo recurrente o si el usuario pide evaluar alternativas.

## Ejecución según la herramienta

- **Herramienta `spawn_agent`:** inspecciona su esquema real. Si admite `model` y `reasoning_effort`, pásalos explícitos. En sesiones donde las elecciones propias requieren `fork_turns="none"`, usa un encargo autosuficiente con contexto seleccionado. No combines un historial completo con una elección de modelo si esa combinación está prohibida. No pongas campos no admitidos en la llamada.
- **Agentes personalizados de Codex:** cuando estén soportados, los archivos `.codex/agents/*.toml` pueden especificar `name`, `description`, `developer_instructions`, `model` y `model_reasoning_effort`. Inspecciona si sus valores sustituyen los del despacho y elige un perfil compatible. La configuración global puede imponer valores por defecto; omitirlos puede producir herencia. Usa el mecanismo de selección disponible; esta skill no ordena instalar perfiles ni cambiar configuración global para cada tarea.
- **Sin elección por agente:** informa del modelo heredado cuando sea conocido y comprueba que resulte adecuado. Si impide cumplir la tarea, indica el bloqueo y la opción concreta necesaria. No afirmes haber seleccionado otro modelo solo por escribirlo en un prompt.
- **Tareas separadas en la app:** crear un thread es distinto de crear un subagente. Usa `create_thread` solo cuando el usuario haya pedido una tarea nueva; no lo utilices como sustituto automático de `spawn_agent`.

Ejemplo conceptual para una herramienta que admita estos campos; completar el encargo y comprobar el esquema antes de ejecutarlo:

```json
{
  "task_name": "inventario_referencias",
  "fork_turns": "none",
  "model": "gpt-6-luna",
  "reasoning_effort": "low",
  "message": "Localiza las referencias al símbolo indicado en los archivos entregados. Devuelve ruta, línea y uso; no edites. Incluye el símbolo, rutas y restricciones concretos en el encargo real. Si debes delegar, lee y aplica la política de Workflow Advisor en la ruta proporcionada."
}
```

## Contexto, verificación y cambio de nivel

El encargo debe contener objetivo, alcance de archivos, restricciones, evidencia relevante, resultado esperado y criterio de aceptación. Para quien pueda delegar, proporciona también la ruta real de este documento y la obligación de aplicarlo. Evita copiar la conversación completa, manuales enteros o pedir respuestas extensas sin necesidad. Asigna responsables distintos para archivos compartidos y secuencia las escrituras dependientes. Usa solo los agentes útiles y respeta la concurrencia disponible.

Comprueba el resultado con evidencia adecuada: referencias existentes para extracción, comportamiento y pruebas pertinentes para código, fuentes primarias para investigación. Un mensaje de éxito no prueba que la tarea pasó. Usa métricas reales si están expuestas; de lo contrario comunica una estimación cualitativa de consumo y latencia.

Si el fallo se debe a instrucciones o contexto incompletos, corrige el encargo. Si demuestra dificultad de razonamiento o incumplimiento pese a contexto suficiente, eleva esfuerzo o modelo y transfiere solo lo aprendido. Evita repetir a ciegas el mismo intento; tras un segundo fallo comparable, reevalúa la descomposición o el bloqueo. No escales por una herramienta ausente o un permiso que otro modelo tampoco tendrá. Al resolver la incertidumbre, reevalúa las siguientes subtareas y usa la opción más ligera que siga cumpliendo la calidad requerida.
