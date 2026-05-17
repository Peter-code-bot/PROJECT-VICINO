import { RegisterForm } from "./register-form";
import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Crear cuenta — VICINO",
  description: "Crea tu cuenta en VICINO y empieza a comprar y vender",
};

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-brand/5 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-gold/5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Card */}
        <div className="p-8 rounded-3xl bg-card border border-border/40 shadow-xl shadow-charcoal/5 dark:shadow-none animate-scale-in">
          
          <div className="text-center space-y-3 mb-8">
            <Link href="/" className="inline-flex items-center justify-center mb-2">
              <div className="w-12 h-12 rounded-xl bg-brand flex items-center justify-center shadow-md">
                <MapPin className="w-6 h-6 text-white" />
              </div>
            </Link>
            <h1 className="text-2xl font-heading font-bold">Únete a VICINO</h1>
            <p className="text-sm text-muted-foreground">Crea tu cuenta para empezar</p>
          </div>
          
          <RegisterForm />
        </div>
        
        {/* Trust badge below card */}
        <p className="text-center text-xs text-muted-foreground mt-8 flex items-center justify-center gap-1.5 opacity-80">
          <span>🔒</span> Tus datos están seguros
        </p>
      </div>
    </div>
  );
}
