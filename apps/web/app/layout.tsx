import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { CapacitorInit } from "@/components/capacitor-init";
import { OfflineDetector } from "@/components/offline-detector";
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
  openGraph: {
    title: "VICINO — Compra y vende con confianza",
    description:
      "Marketplace para PyMEs, emprendedores y profesionales en México.",
    siteName: "VICINO",
    locale: "es_MX",
    type: "website",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF8F0" },
    { media: "(prefers-color-scheme: dark)", color: "#0D0D1A" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
      <body className="min-h-full flex flex-col font-sans antialiased bg-cream text-charcoal">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <CapacitorInit />
          <OfflineDetector />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
