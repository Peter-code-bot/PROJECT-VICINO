import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Inter, Outfit } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { CapacitorInit } from "@/components/capacitor-init";
import { CapacitorSentryInit } from "@/components/capacitor-sentry-init";
import { PushNotificationInit } from "@/components/push-notification-init";
import { OAuthUrlListener } from "@/components/auth/oauth-url-listener";
import { OfflineDetector } from "@/components/offline-detector";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "VICINO — Tu mercado de confianza",
    template: "%s — VICINO",
  },
  description:
    "VICINO — Compra y vende con confianza. Marketplace para PyMEs, emprendedores y profesionales en México.",
  icons: {
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-96.png", sizes: "96x96", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "VICINO — Compra y vende con confianza",
    description:
      "Marketplace para PyMEs, emprendedores y profesionales en México.",
    siteName: "VICINO",
    locale: "es_MX",
    type: "website",
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "VICINO" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.jpg"],
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF8F0" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0F0E" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${outfit.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* A3 sub-fase 3.5: preconnect a Supabase para que el handshake TLS
            empiece antes de que el cliente supabase-js dispare su primera
            request (auth getUser, storage signed URL, REST). crossOrigin
            anonymous es OBLIGATORIO: el TLS connection pool segmenta por el
            atributo crossorigin, y supabase-js manda requests CORS desde el
            browser, asi que sin crossOrigin la conexion preconectada NO se
            reusa. Project ref hardcoded (preconnect no soporta wildcards). */}
        <link
          rel="preconnect"
          href="https://oxxdkwywprkfghhbnoto.supabase.co"
          crossOrigin="anonymous"
        />
        <Script src="/theme-init.js" strategy="beforeInteractive" />
      </head>
      <body className="min-h-full flex flex-col font-sans antialiased bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={true}
          storageKey="vicino-theme"
          disableTransitionOnChange
        >
          <CapacitorInit />
          <CapacitorSentryInit />
          <PushNotificationInit />
          <OAuthUrlListener />
          <OfflineDetector />
          {children}
          <Toaster richColors position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
