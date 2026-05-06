import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Eliminar cuenta | Delete account — VICINO",
  description:
    "Cómo eliminar tu cuenta y datos asociados de VICINO. How to delete your VICINO account and associated data.",
  robots: { index: true, follow: true },
};

export default function EliminarCuentaPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Eliminar tu cuenta de VICINO
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Delete your VICINO account
        </p>
      </header>

      <section
        aria-labelledby="es-heading"
        className="rounded-lg border border-gray-200 bg-white p-6 md:p-8"
      >
        <h2 id="es-heading" className="text-2xl font-semibold">
          Español
        </h2>

        <p className="mt-4 text-gray-700">
          En VICINO respetamos tu derecho a eliminar tu cuenta y los datos
          asociados en cualquier momento. Tienes dos formas de hacerlo:
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          Opción 1 — Desde la app (recomendado)
        </h3>
        <ol className="mt-2 list-decimal space-y-1 pl-6 text-gray-700">
          <li>Abre la app VICINO e inicia sesión.</li>
          <li>
            Ve a la pestaña <strong>Configuración</strong>.
          </li>
          <li>
            Baja hasta la sección <strong>Eliminar cuenta</strong> y toca el
            botón rojo.
          </li>
          <li>
            Confirma escribiendo la palabra <code>ELIMINAR</code>.
          </li>
          <li>Tu cuenta y datos serán eliminados de inmediato.</li>
        </ol>

        <h3 className="mt-6 text-lg font-semibold">
          Opción 2 — Por correo electrónico
        </h3>
        <p className="mt-2 text-gray-700">
          Envía un correo a{" "}
          <a
            href="mailto:admin@vicinomarket.com?subject=Eliminar%20cuenta"
            className="font-medium text-blue-600 underline"
          >
            admin@vicinomarket.com
          </a>{" "}
          desde la dirección de email asociada a tu cuenta de VICINO con el
          asunto <strong>&quot;Eliminar cuenta&quot;</strong>. Procesaremos tu
          solicitud en un máximo de <strong>30 días</strong>.
        </p>

        <h3 className="mt-6 text-lg font-semibold">Datos que se eliminan</h3>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-gray-700">
          <li>Perfil público (nombre, foto, biografía, ubicación)</li>
          <li>Email y credenciales de autenticación</li>
          <li>Productos y servicios publicados</li>
          <li>Reviews emitidas por tu cuenta</li>
          <li>Historial de chats y mensajes enviados</li>
          <li>Favoritos guardados</li>
          <li>Documentos de verificación (teléfono, INE)</li>
          <li>Cupones, notificaciones y configuraciones personales</li>
          <li>Trust level y puntos acumulados</li>
        </ul>

        <h3 className="mt-6 text-lg font-semibold">
          Datos que se conservan (anonimizados)
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-gray-700">
          <li>
            Reviews <em>recibidas</em> de otros usuarios (sin tu nombre ni
            datos identificables) — para preservar la integridad del sistema
            de reputación de la comunidad.
          </li>
          <li>
            Registros de transacciones confirmadas (por requerimientos legales
            de México, hasta 5 años).
          </li>
          <li>
            Logs de auditoría del sistema (90 días, requeridos por seguridad).
          </li>
        </ul>

        <h3 className="mt-6 text-lg font-semibold">¿Es reversible?</h3>
        <p className="mt-2 text-gray-700">
          <strong>No.</strong> La eliminación es permanente. Si en el futuro
          quieres volver a usar VICINO tendrás que crear una cuenta nueva
          desde cero.
        </p>

        <h3 className="mt-6 text-lg font-semibold">¿Tienes dudas?</h3>
        <p className="mt-2 text-gray-700">
          Escríbenos a{" "}
          <a
            href="mailto:admin@vicinomarket.com"
            className="font-medium text-blue-600 underline"
          >
            admin@vicinomarket.com
          </a>{" "}
          y te ayudamos.
        </p>
      </section>

      <section
        aria-labelledby="en-heading"
        className="mt-8 rounded-lg border border-gray-200 bg-white p-6 md:p-8"
      >
        <h2 id="en-heading" className="text-2xl font-semibold">
          English
        </h2>

        <p className="mt-4 text-gray-700">
          At VICINO we respect your right to delete your account and
          associated data at any time. You have two ways to do it:
        </p>

        <h3 className="mt-6 text-lg font-semibold">
          Option 1 — From the app (recommended)
        </h3>
        <ol className="mt-2 list-decimal space-y-1 pl-6 text-gray-700">
          <li>Open the VICINO app and sign in.</li>
          <li>
            Go to the <strong>Settings</strong> tab (Configuración).
          </li>
          <li>
            Scroll to the <strong>Delete account</strong> section and tap the
            red button.
          </li>
          <li>
            Confirm by typing the word <code>ELIMINAR</code>.
          </li>
          <li>Your account and data will be deleted immediately.</li>
        </ol>

        <h3 className="mt-6 text-lg font-semibold">Option 2 — By email</h3>
        <p className="mt-2 text-gray-700">
          Send an email to{" "}
          <a
            href="mailto:admin@vicinomarket.com?subject=Delete%20account"
            className="font-medium text-blue-600 underline"
          >
            admin@vicinomarket.com
          </a>{" "}
          from the email address associated with your VICINO account, with
          the subject <strong>&quot;Delete account&quot;</strong>. We will
          process your request within <strong>30 days</strong>.
        </p>

        <h3 className="mt-6 text-lg font-semibold">Data that is deleted</h3>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-gray-700">
          <li>Public profile (name, photo, bio, location)</li>
          <li>Email and authentication credentials</li>
          <li>Published products and services</li>
          <li>Reviews issued by your account</li>
          <li>Chat history and sent messages</li>
          <li>Saved favorites</li>
          <li>Verification documents (phone, ID)</li>
          <li>Coupons, notifications and personal settings</li>
          <li>Trust level and accumulated points</li>
        </ul>

        <h3 className="mt-6 text-lg font-semibold">
          Data we retain (anonymized)
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-gray-700">
          <li>
            Reviews <em>received</em> from other users (without your name or
            identifiable data) — to preserve community reputation integrity.
          </li>
          <li>
            Confirmed transaction records (Mexican legal requirements, up to
            5 years).
          </li>
          <li>System audit logs (90 days, required for security).</li>
        </ul>

        <h3 className="mt-6 text-lg font-semibold">Is it reversible?</h3>
        <p className="mt-2 text-gray-700">
          <strong>No.</strong> Deletion is permanent. If you want to use
          VICINO again in the future, you&apos;ll need to create a new
          account from scratch.
        </p>

        <h3 className="mt-6 text-lg font-semibold">Questions?</h3>
        <p className="mt-2 text-gray-700">
          Email us at{" "}
          <a
            href="mailto:admin@vicinomarket.com"
            className="font-medium text-blue-600 underline"
          >
            admin@vicinomarket.com
          </a>{" "}
          and we&apos;ll help you out.
        </p>
      </section>

      <footer className="mt-10 text-center text-sm text-gray-500">
        <Link href="/" className="underline">
          Volver a VICINO / Back to VICINO
        </Link>
      </footer>
    </main>
  );
}
