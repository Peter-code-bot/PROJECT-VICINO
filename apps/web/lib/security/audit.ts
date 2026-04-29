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

  // Structured warn so log aggregators (Vercel, future Sentry/Logtail) can parse.
  // Never include PII in plaintext — masked above where applicable.
  console.warn(
    "[security]",
    JSON.stringify({
      ...safeEvent,
      timestamp: new Date().toISOString(),
    })
  );
}
