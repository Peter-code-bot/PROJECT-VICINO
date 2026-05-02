import Link from "next/link";

export const metadata = { title: "Términos y Condiciones" };

export default function TerminosPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
      <h1 className="text-3xl font-heading font-bold mb-2">Términos y Condiciones de Uso</h1>
      <p className="text-sm text-muted-foreground mb-8">Última actualización: 29 de abril de 2026</p>

      <div className="prose prose-neutral dark:prose-invert prose-sm max-w-none space-y-6">
        <section>
          <h2 className="text-lg font-heading font-bold">1. Aceptación de los Términos</h2>
          <p>Al acceder, registrarte o utilizar la plataforma VICINO (en adelante &quot;la Plataforma&quot;), aceptas quedar vinculado por estos Términos y Condiciones de Uso. Si no estás de acuerdo con alguno de estos términos, no utilices la Plataforma. VICINO se reserva el derecho de modificar estos términos en cualquier momento, notificando a los usuarios registrados por los medios disponibles.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">2. Descripción del Servicio</h2>
          <p>VICINO es una plataforma tecnológica que conecta a compradores y vendedores de productos y servicios en México. VICINO actúa exclusivamente como intermediario tecnológico y <strong>no participa, intermedia ni garantiza las transacciones comerciales</strong> entre los usuarios. VICINO no cobra comisiones sobre las ventas ni procesa pagos.</p>
          <p>Los acuerdos de precio, método de pago, forma de entrega y cualquier otra condición de la transacción se negocian y acuerdan directamente entre comprador y vendedor a través del sistema de chat y confirmación mutua de la Plataforma.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">3. Registro y Cuentas de Usuario</h2>
          <p>Para acceder a todas las funciones de la Plataforma, debes crear una cuenta proporcionando información veraz, completa y actualizada. Eres responsable de mantener la confidencialidad de tus credenciales de acceso y de todas las actividades realizadas bajo tu cuenta.</p>
          <p>VICINO se reserva el derecho de suspender o eliminar cuentas que: proporcionen información falsa, incumplan estos términos, realicen actividades fraudulentas, o reciban múltiples reportes negativos de otros usuarios.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">4. Publicación de Productos y Servicios</h2>
          <p>Al publicar un producto o servicio en VICINO, declaras que: eres el legítimo propietario o tienes autorización para venderlo, la descripción, fotos y precio son veraces, el producto o servicio no infringe leyes aplicables ni derechos de terceros, y cumple con las regulaciones mexicanas aplicables.</p>
          <p>Está prohibido publicar: productos ilegales, robados o falsificados; armas, drogas o sustancias controladas; contenido que promueva discriminación, violencia o actividades ilícitas; información personal de terceros sin su consentimiento; spam o publicaciones repetitivas.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">5. Sistema de Confirmación Mutua</h2>
          <p>VICINO utiliza un sistema de confirmación mutua donde tanto el comprador como el vendedor deben confirmar los términos de la transacción (precio, cantidad, método de pago y forma de entrega). Una transacción se considera completada únicamente cuando ambas partes confirman.</p>
          <p>Las confirmaciones pendientes expiran automáticamente después de 72 horas sin actividad de ambas partes.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">6. Reseñas y Calificaciones</h2>
          <p>Después de completar una transacción, ambas partes pueden dejar una reseña. Las reseñas deben ser honestas, respetuosas y basadas en la experiencia real de la transacción. VICINO se reserva el derecho de ocultar o eliminar reseñas que contengan lenguaje ofensivo, información falsa o que violen estos términos.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">7. Sistema de Confianza</h2>
          <p>VICINO implementa un sistema de niveles de confianza basado en la actividad, verificación de identidad y calificaciones de los usuarios. Los niveles y puntos de confianza se calculan automáticamente y no pueden ser manipulados. La verificación de identidad (INE, selfie) es voluntaria pero recomendada para acceder a niveles superiores.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">8. Limitación de Responsabilidad</h2>
          <p>VICINO no es responsable por: la calidad, seguridad, legalidad o existencia de los productos o servicios publicados; la veracidad de las publicaciones o la identidad de los usuarios; la capacidad de los vendedores para completar la venta o de los compradores para pagar; daños directos o indirectos derivados del uso de la Plataforma o de transacciones entre usuarios; pérdidas económicas, interrupciones del servicio o fallos técnicos.</p>
          <p>Los usuarios reconocen que VICINO es un facilitador tecnológico y que cualquier transacción se realiza bajo su propio riesgo y responsabilidad.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">9. Propiedad Intelectual</h2>
          <p>Todo el contenido de la Plataforma (diseño, código, marca, logotipos) es propiedad de VICINO o de sus licenciantes. Al publicar contenido en la Plataforma, otorgas a VICINO una licencia no exclusiva, mundial y gratuita para usar, mostrar y distribuir dicho contenido dentro de la Plataforma.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">10. Disputas entre Usuarios</h2>
          <p>En caso de conflicto entre comprador y vendedor, VICINO ofrece un sistema de disputas donde un administrador puede mediar. Sin embargo, la resolución final es una recomendación y VICINO no tiene obligación legal de compensar a ninguna de las partes.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">11. Ley Aplicable y Jurisdicción</h2>
          <p>Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para cualquier controversia derivada del uso de la Plataforma, las partes se someten a la jurisdicción de los tribunales competentes de la ciudad de Puebla, Puebla, México, renunciando a cualquier otro fuero que pudiera corresponderles.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">12. Contacto</h2>
          <p>Para preguntas, quejas o sugerencias sobre estos términos o el funcionamiento de la Plataforma, puedes contactarnos a través del sistema de chat de la Plataforma o enviando un correo a admin@vicinomarket.com.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">13. Reportes, Bloqueo y Conducta del Usuario</h2>
          <p><strong>Mayoría de edad.</strong> VICINO es una plataforma para mayores de 18 años residentes en México. Al registrarte declaras cumplir con esta condición. VICINO se reserva el derecho de suspender cuentas que violen este requisito.</p>
          <p><strong>Contenido prohibido.</strong> Está prohibido publicar, ofrecer o intercambiar en la Plataforma, sin que esta lista sea limitativa:</p>
          <ul className="list-disc list-inside ml-2 space-y-0.5">
            <li>Productos o servicios ilegales bajo las leyes mexicanas aplicables.</li>
            <li>Armas, municiones, explosivos, drogas, sustancias controladas, alcohol, tabaco o productos con regulación restringida.</li>
            <li>Contenido sexual explícito, pornografía o material para adultos.</li>
            <li>Animales vivos, partes o derivados de animales en categoría de protección.</li>
            <li>Productos falsificados o que infrinjan derechos de propiedad intelectual.</li>
            <li>Servicios que violen normas laborales, sanitarias o de protección al consumidor.</li>
            <li>Contenido que incite al odio, violencia, discriminación o acoso por raza, género, orientación sexual, religión o nacionalidad.</li>
            <li>Spam, esquemas piramidales, multinivel fraudulentos o publicaciones engañosas.</li>
            <li>Información personal de terceros sin su consentimiento.</li>
          </ul>
          <p><strong>Conducta esperada.</strong> Al usar VICINO te comprometes a tratar a otros usuarios con respeto, no acosar ni amenazar, no suplantar la identidad de otra persona, no usar la Plataforma para actividades fraudulentas y cumplir con las leyes federales y locales aplicables a tus transacciones.</p>
          <p><strong>Mecanismos de moderación.</strong> En cada producto, perfil de usuario, mensaje y reseña encontrarás un botón de &ldquo;Reportar&rdquo; que permite enviar el contenido a revisión. Adicionalmente, puedes <strong>bloquear a otro usuario</strong> desde su perfil; al hacerlo, ni tú ni esa persona verán mutuamente su contenido en la Plataforma.</p>
          <p><strong>Plazo de respuesta.</strong> VICINO se compromete a revisar los reportes en un plazo de <strong>48 horas hábiles</strong>. El contenido con tres o más reportes activos se oculta automáticamente del público mientras se completa la revisión.</p>
          <p><strong>Verificación con INE.</strong> La imagen de tu identificación oficial INE solicitada para verificación se almacena cifrada y no se comparte públicamente. Para más detalles consulta nuestro <Link href="/privacidad" className="text-primary underline">Aviso de Privacidad</Link>.</p>
          <p><strong>Sanciones.</strong> VICINO se reserva el derecho de ocultar o eliminar contenido reportado, suspender o eliminar cuentas que violen estos términos de forma reiterada, y cooperar con autoridades competentes en casos de actividad ilegal.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">14. Seguridad Infantil y Denuncias</h2>
          <p>VICINO tiene <strong>tolerancia cero</strong> a cualquier contenido o conducta que ponga en riesgo a menores de edad, incluyendo material de explotación sexual infantil (CSAM), grooming o intentos de captación.</p>
          <p>Cuando se reporte contenido bajo el motivo &ldquo;Seguridad infantil&rdquo;:</p>
          <ul className="list-disc list-inside ml-2 space-y-0.5">
            <li>El contenido se oculta de forma <strong>inmediata y automática</strong>, sin esperar revisión humana.</li>
            <li>VICINO presentará <strong>denuncia ante la Policía Cibernética y/o la Fiscalía General de la República (FGR)</strong> conforme a sus obligaciones legales.</li>
            <li>VICINO conservará evidencia del reporte y de las acciones tomadas durante al menos cinco (5) años, según las normas aplicables.</li>
          </ul>
          <p>Si crees que existe un riesgo inmediato para un menor, te pedimos que <strong>también denuncies directamente a las autoridades</strong> además de reportarlo en VICINO.</p>
        </section>
      </div>
    </div>
  );
}
