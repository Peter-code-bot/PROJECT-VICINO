# Security Audit Index — VICINO

Histórico de auditorías de seguridad del monorepo. Ordenado por fecha descendente.

## Auditorías realizadas

| Fecha | Scope | Severidad máx | Hallazgos | Reporte |
|---|---|---|---:|---|
| 2026-05-12 | `apps/web` (Next.js 16, Supabase, geo, PWA) en branch `design` | 🔴 CRITICA (10) | 31 | [SECURITY_AUDIT_VICINO_20260512.md](./SECURITY_AUDIT_VICINO_20260512.md) |

## Convenciones

**Nombres de archivo:** `SECURITY_AUDIT_<scope>_<YYYYMMDD>.md`
- `<scope>` — typically `VICINO` para audit holístico, o `STRIPE_CONNECT`, `CAPACITOR_ANDROID`, etc. para audits específicos.
- `<YYYYMMDD>` — fecha de inicio del audit.

**Severidad:**
- 🔴 **CRITICA** — privilege escalation, data leak grave, RCE, auth bypass explotable
- 🟠 **ALTA** — injection, open redirect, leak parcial, dep con CVE HIGH activo
- 🟡 **MEDIA** — falta de defensa en profundidad (rate limit, headers, validación parcial), dep con CVE moderada
- 🔵 **BAJA** — validación de UUID/enums faltante sin impacto inmediato, hardening menor

**Esfuerzo de fix:**
- **S** — <2h, cambio aislado
- **M** — 2h–1d, varios archivos o requires test
- **L** — >1d, refactor o migración

## Próximas auditorías sugeridas

| Cuándo | Scope | Razón |
|---|---|---|
| Post-merge `design` → `master` | Re-audit `apps/web` completo | Confirmar que `lib/supabase/admin.ts` callers (en master) tienen `requireAdmin()` |
| Cuando se integre Stripe Connect | `apps/web/app/api/stripe/**` + webhooks | Validar firma webhook, idempotencia, manejo de errores |
| Cuando KYC Didit esté en producción | `apps/web/app/api/didit/**` | Validar firma webhook, manejo de PII |
| Cuando Capacitor/Android salga a Play Store | `apps/web/android/**`, plugins nativos | Capsec (skill `capacitor-security`), permisos peligrosos, deep links |
| Auditoría SQL/RLS dedicada | `supabase/migrations/**` | Confirmar que cada tabla tiene RLS sensata; revisar políticas de `user_roles`, `seller_verification`, `disputes` |

## Cómo correr un audit nuevo

1. Megaprompt template: ver Megaprompt #1 de Javier en chat history o `docs/security/templates/` (TODO).
2. Plan en Claude Code: `~/.claude/plans/megaprompt-auditor-*.md`.
3. Codex CLI:
   ```bash
   codex exec -C <repo-root> -s read-only --dangerously-bypass-approvals-and-sandbox \
     - < prompt.txt > codex-audit-output.md
   ```
4. Reporte final: `docs/security/SECURITY_AUDIT_<scope>_<date>.md`.
5. Actualizar la tabla de este README con la nueva entrada.
