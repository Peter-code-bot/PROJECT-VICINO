# Proposal: Pantalla de Bienvenida (Onboarding) para Nuevos Vendedores

## 1. Problema
Los usuarios al iniciar sesión o registrarse no saben cómo activar el "Modo Vendedor" porque está escondido en "Editar Perfil". Existe fricción para que los compradores descubran que también pueden publicar y ofrecer productos y servicios.

## 2. Solución Propuesta (OpenSpec)
Implementar un modal global de bienvenida (Onboarding) que intercepte a los usuarios recién registrados una única vez.

- Si eligen **"Quiero Vender"**, se les redirige al formulario de perfil para activar el switch de vendedor.
- Si eligen **"Solo quiero comprar"**, se cierra el modal.
- Ambos flujos registran permanentemente en la base de datos que el usuario ya pasó por el onboarding, impidiendo que vuelva a salir en el futuro.

## 3. Scope
- Migración a tabla `profiles` para añadir `has_seen_onboarding BOOLEAN DEFAULT FALSE`.
- UI Modal minimalista global en el layout principal.
- Server Action para actualizar el flag `has_seen_onboarding`.

## 4. Opciones Descartadas
- Empty states y banners: Aunque son efectivos, un modal bloqueante de primer uso (solo una vez) garantiza el 100% de visibilidad del feature clave de la plataforma sin requerir un rediseño del Home (que ya tiene carruseles densos).
