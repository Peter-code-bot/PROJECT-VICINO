# Reglas del Agente (VICINO)

## Seguridad y Manejo de Secretos
- **NUNCA uses APIs, contraseñas, secretos, tokens (como JWT o de Supabase) ni ningún valor sensible escrito directamente (hardcoded) en el código**, incluso si son solo para pruebas o scripts temporales.
- **Siempre utiliza variables de entorno** (`process.env.NOMBRE_DE_VARIABLE` u otras configuraciones globales de `.env`) para manejar información confidencial.
- Revisa exhaustivamente los archivos y los cambios antes de realizar un commit para asegurar que no se filtren scripts temporales o contraseñas al repositorio.
