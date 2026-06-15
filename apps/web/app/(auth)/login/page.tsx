import { LoginForm } from "./login-form";
import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Iniciar sesión — VICINO",
  description: "Inicia sesión en VICINO para comprar y vender con confianza",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-emerald-trust/5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Card */}
        <div className="p-8 rounded-3xl bg-card border border-border/40 shadow-xl shadow-charcoal/5 dark:shadow-none animate-scale-in">
          
          <div className="text-center space-y-3 mb-8">
            <Link href="/" className="inline-flex items-center justify-center mb-2">
              <Image src="/vicino-logo-light.png" alt="VICINO" width={48} height={48} className="shrink-0 dark:hidden" priority />
              <Image src="/vicino-logo-dark.png" alt="VICINO" width={48} height={48} className="shrink-0 hidden dark:block" priority />
            </Link>
            <h1 className="text-2xl font-heading font-bold">¡Hola de nuevo!</h1>
            <p className="text-sm text-muted-foreground">Tu mercado de confianza</p>
          </div>
          
          <LoginForm />
        </div>
        
        {/* Trust badge below card */}
        <p className="text-center text-xs text-muted-foreground mt-8 flex items-center justify-center gap-1.5 opacity-80">
          <span>🔒</span> Tus datos están seguros
        </p>
      </div>
    </div>
  );
}
