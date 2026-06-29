# Tasks: Pantalla de Bienvenida (Onboarding) para Nuevos Vendedores

- [ ] Crear el archivo de migración `supabase/migrations/20260629000001_add_onboarding_column.sql`.
- [ ] Aplicar la migración a la base de datos local (vía psql o Supabase Studio) usando `ALTER TABLE public.profiles ADD COLUMN has_seen_onboarding BOOLEAN NOT NULL DEFAULT FALSE;`.
- [ ] Añadir la función `completeOnboarding()` en `apps/web/app/(marketplace)/perfil/actions.ts` validando al usuario con la sesión y ejecutando el update.
- [ ] Crear el componente cliente `apps/web/components/shared/onboarding-modal.tsx` con UI minimalista e integración de las Server Actions (usando `useTransition` para loading state si es necesario).
- [ ] Modificar `apps/web/app/(marketplace)/layout.tsx` para solicitar la columna y condicionar la renderización del `<OnboardingModal />`.
- [ ] Ejecutar `pnpm type-check` y resolver cualquier discrepancia de tipos (por ejemplo, asegurar que el select devuelve el nuevo boolean y el tipo lo reconoce).
- [ ] Iniciar el servidor de desarrollo y probar ambos flujos completos.
- [ ] Ejecutar el CODEX Review loop final para certificar los cambios.
