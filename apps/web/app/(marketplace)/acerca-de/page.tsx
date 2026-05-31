import Link from "next/link";

export const metadata = { title: "Acerca de VICINO" };

export default function AcercaDePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
      <h1 className="text-3xl font-heading font-bold mb-2">Acerca de VICINO</h1>
      <p className="text-sm text-muted-foreground mb-8">Conectando vecinos, fortaleciendo comunidades</p>

      <div className="prose prose-neutral dark:prose-invert prose-sm max-w-none space-y-6">
        <section>
          <h2 className="text-lg font-heading font-bold">Nuestra Misión</h2>
          <p>En VICINO, creemos en el poder de la comunidad local. Nuestra misión es crear una plataforma segura y confiable que conecte a vecinos, facilitando la compra y venta de productos y servicios dentro de tu propia zona. Fomentamos la economía circular y ayudamos a construir lazos más fuertes entre las personas que comparten un mismo entorno.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">¿Qué nos hace diferentes?</h2>
          <p>A diferencia de otras plataformas globales, VICINO se enfoca en la hiperlocalidad. Diseñamos nuestras herramientas pensando en la confianza que se genera al interactuar con las personas que viven cerca de ti.</p>
          <ul className="list-disc list-inside ml-2 space-y-1 mt-2">
            <li><strong>Conexión local:</strong> Encuentra productos y servicios a pocos pasos de tu hogar.</li>
            <li><strong>Confianza mutua:</strong> Sistemas de validación y reseñas para mantener un entorno seguro.</li>
            <li><strong>Apoyo a emprendedores:</strong> Ayudamos a los negocios locales y vendedores independientes a llegar a su comunidad directa.</li>
            <li><strong>Sin comisiones por venta:</strong> Somos un facilitador tecnológico, permitiendo que acuerdes las condiciones directamente con la otra parte.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">Nuestro Compromiso</h2>
          <p>Nos comprometemos a mantener una plataforma tecnológica estable, rápida y segura, innovando constantemente para ofrecerte la mejor experiencia posible al interactuar con tu comunidad.</p>
        </section>
      </div>
    </div>
  );
}
