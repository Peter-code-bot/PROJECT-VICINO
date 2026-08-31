# Reglas del Agente (VICINO)

## Seguridad y Manejo de Secretos
- **NUNCA uses APIs, contraseñas, secretos, tokens (como JWT o de Supabase) ni ningún valor sensible escrito directamente (hardcoded) en el código**, incluso si son solo para pruebas o scripts temporales.
- **Siempre utiliza variables de entorno** (`process.env.NOMBRE_DE_VARIABLE` u otras configuraciones globales de `.env`) para manejar información confidencial.
- Revisa exhaustivamente los archivos y los cambios antes de realizar un commit para asegurar que no se filtren scripts temporales o contraseñas al repositorio.

## R8 — Evidencia literal, no resumen

Cuando una instrucción pida la salida de un comando, esa salida se pega **textual,
dentro de un bloque de código**, sin resumir, sin parafrasear y sin sustituirla por
una conclusión. El resumen puede ir además, nunca en lugar de la salida.

### Qué cuenta como reporte válido

- **Comandos:** el comando ejecutado y su salida completa. Si la salida es muy larga,
  las primeras y últimas ~15 líneas, diciendo explícitamente que se truncó y por dónde.
- **Builds:** las últimas líneas más el **exit code** (`echo $LASTEXITCODE` en
  PowerShell, `echo $?` en bash). Un build sin exit code no está reportado.
  La frase "build exitoso" sin ese número no cuenta como reporte.
- **Comandos que no imprimen nada:** decirlo explícitamente — "sin salida" — no
  omitirlos del reporte.
- **Comandos que fallan:** se reporta el fallo con su mensaje íntegro. Un comando que
  truena y no aparece en el reporte es una omisión, no un detalle.

### Confirmado vs. hipótesis

Ningún hallazgo se declara **confirmado** sin nombrar la evidencia exacta que lo
sostiene: el archivo y la línea, la query y su resultado, o la salida del comando.
Si la evidencia es indirecta, se etiqueta como **hipótesis** y se entrega junto a ella
la verificación concreta que la cerraría.

Está prohibido presentar como hecho una inferencia sobre cómo funciona algo, por
razonable que sea, si no se leyó el archivo o no se corrió la comprobación.

### Verde local ≠ verde remoto

Un `pnpm build` exitoso en la máquina local **no dice nada** sobre el build de Vercel
cuando hay archivos untracked. Antes de reportar un build como verde de cara a un push,
se corre `git status --short` y se comprueba que ningún archivo trackeado importe un
archivo untracked.

Origen de esta regla: el 18-ago-2026 se reportó un build local verde en 44 s; el build
remoto llevaba días roto porque `packages/shared/src/constants/privacy.ts` estaba
untracked y `index.ts` lo exportaba. Producción quedó servida desde un deploy viejo.

### Desviarse del plan

Si durante la ejecución hace falta un cambio que la instrucción no contemplaba —una
aserción de tipos, un import extra, un ajuste para que compile— se **para y se pregunta**
antes de aplicarlo. Si ya se aplicó, se reporta explícitamente como desviación, con el
diff exacto, en vez de enterrarlo en la narración de lo que se hizo.

### Puertas de parada

Cuando la instrucción diga "para y espera", el turno termina ahí. No se encadena la
siguiente fase, no se commitea, no se pushea. Reportar y detenerse es cumplir la
instrucción, no dejarla a medias.
