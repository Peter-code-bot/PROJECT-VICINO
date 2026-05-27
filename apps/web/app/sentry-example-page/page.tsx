"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

// Removable verification page. After confirming ingest works end-to-end
// (web Vercel deploy + Android APK), delete this directory.
export default function SentryExamplePage() {
  const [sent, setSent] = useState(false);

  function triggerClientError() {
    throw new Error(`Sentry test error — client ${new Date().toISOString()}`);
  }

  async function triggerServerCapture() {
    try {
      throw new Error(
        `Sentry test error — explicit capture ${new Date().toISOString()}`,
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { source: "sentry-example-page" } });
      setSent(true);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 space-y-6">
      <h1 className="text-2xl font-bold">Sentry verification page</h1>
      <p className="text-sm text-muted-foreground">
        Use these buttons to confirm Sentry ingest is working. Each click
        produces one event in the linked Sentry project (vicino-web on
        browser, vicino-android inside the Capacitor WebView).
      </p>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={triggerClientError}
          className="rounded-lg bg-red-600 px-4 py-2 text-white font-medium hover:bg-red-700"
        >
          Throw uncaught client error
        </button>
        <button
          type="button"
          onClick={triggerServerCapture}
          className="rounded-lg bg-amber-600 px-4 py-2 text-white font-medium hover:bg-amber-700"
        >
          Explicit Sentry.captureException
        </button>
        {sent && (
          <p className="text-sm text-emerald-600">
            captureException dispatched — check the Sentry dashboard.
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        This page is removable. Delete <code>app/sentry-example-page/</code>{" "}
        once verification is complete.
      </p>
    </div>
  );
}
