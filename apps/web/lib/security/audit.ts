import * as Sentry from "@sentry/nextjs";
import { maskEmail } from "@/lib/privacy/mask";

export type SecurityEvent =
  | { type: "rate_limit_exceeded"; path: string; ip: string }
  | { type: "failed_login"; email: string }
  | { type: "suspicious_verification"; userId: string }
  | { type: "open_redirect_blocked"; attempted: string };

export function logSecurityEvent(event: SecurityEvent): void {
  const safeEvent = event.type === "failed_login"
    ? { ...event, email: maskEmail(event.email) }
    : event;

  // Structured warn so log aggregators (Vercel, Sentry/Logtail) can parse.
  // Never include PII in plaintext — masked above where applicable.
  console.warn(
    "[security]",
    JSON.stringify({
      ...safeEvent,
      timestamp: new Date().toISOString(),
    })
  );

  // Forward to Sentry so security events are searchable in the dashboard.
  // safeEvent has already been PII-masked above (e.g., failed_login emails).
  Sentry.captureMessage(`[security] ${event.type}`, {
    level: "warning",
    tags: { source: "security", event_type: event.type },
    contexts: { security: safeEvent },
  });
}
