# Design: Pantalla de Bienvenida (Onboarding) para Nuevos Vendedores

## 1. Modelo de Datos (DB)
- **Migración nueva**: `supabase/migrations/20260629000001_add_onboarding_column.sql`.
- **Query**:
  ```sql
  ALTER TABLE public.profiles 
  ADD COLUMN has_seen_onboarding BOOLEAN NOT NULL DEFAULT FALSE;
  ```
- No afecta las políticas RLS actuales (el usuario autenticado podrá hacer UPDATE de sí mismo mediante RPC o permitiendo el acceso en RLS a esa columna de forma explícita). En VICINO usamos actions del servidor que validan con `.auth.getUser()`, así que crearemos una acción limpia.

## 2. API / Acciones del Servidor (Server Actions)
- En `apps/web/app/(marketplace)/perfil/actions.ts`:
  Crearemos la función asíncrona `completeOnboarding()`.
  Utilizará `supabase.from("profiles").update({ has_seen_onboarding: true }).eq("id", user.id)`. Requerirá `revalidatePath("/")` para actualizar la UI sin recargar manualmente.

## 3. UI / Componentes
- **Modal Component**: `apps/web/components/shared/onboarding-modal.tsx`.
  - Usará `<Dialog>` y `<DialogContent>` de shadcn/ui.
  - Diseño: Minimalista, centrado, tipografía Inter/Outfit (colores VICINO: charcoal de fondo, botones crema/verde).
  - Título: "¡Bienvenido a VICINO!"
  - Descripción: "¿Quieres empezar a vender y ganar dinero ofreciendo tus servicios a la vuelta de la esquina, o prefieres solo comprar por ahora?"
  - Botón Primario: "Quiero Vender" -> redirect a `/perfil/editar?prompt=seller-mode`.
  - Botón Secundario (outline): "Solo quiero comprar".

## 4. Integración Global
- **Layout principal**: `apps/web/app/(marketplace)/layout.tsx`
  - Actualmente hace un select: `.select("nombre, foto, es_vendedor")`.
  - Lo cambiaremos a: `.select("nombre, foto, es_vendedor, has_seen_onboarding")`.
  - Dentro de la vista agregamos el componente:
    `{profile && !profile.has_seen_onboarding && <OnboardingModal />}`
