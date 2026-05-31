import { Mail } from "lucide-react";

export const metadata = { title: "Centro de ayuda" };

export default function CentroDeAyudaPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
      <h1 className="text-3xl font-heading font-bold mb-2">Centro de ayuda</h1>
      <p className="text-sm text-muted-foreground mb-8">Estamos aquí para ayudarte</p>

      <div className="prose prose-neutral dark:prose-invert prose-sm max-w-none space-y-6">
        <section className="bg-muted/50 p-6 rounded-xl border border-border flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
            <Mail className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-heading font-bold mt-0 mb-2">Contáctanos por correo</h2>
          <p className="mb-4">Si tienes alguna duda, problema o sugerencia, no dudes en escribirnos a nuestro correo de soporte. Te responderemos lo antes posible.</p>
          <a href="mailto:admin@vicinomarket.com" className="text-primary font-medium hover:underline text-lg">
            admin@vicinomarket.com
          </a>
        </section>
      </div>
    </div>
  );
}
