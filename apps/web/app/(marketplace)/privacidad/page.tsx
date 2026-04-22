export const metadata = { title: "Aviso de Privacidad" };

export default function PrivacidadPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
      <h1 className="text-3xl font-heading font-bold mb-2">Aviso de Privacidad</h1>
      <p className="text-sm text-muted-foreground mb-8">Última actualización: Abril 2026</p>

      <div className="prose prose-neutral dark:prose-invert prose-sm max-w-none space-y-6">
        <section>
          <h2 className="text-lg font-heading font-bold">1. Identidad del Responsable</h2>
          <p>VICINO, con domicilio en Puebla, Puebla, México, es responsable del tratamiento de tus datos personales conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su Reglamento.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">2. Datos Personales que Recopilamos</h2>
          <p>Para el funcionamiento de la Plataforma, recopilamos los siguientes datos personales:</p>
          <p><strong>Datos de identificación:</strong> nombre completo, correo electrónico, fotografía de perfil, número de teléfono (opcional), ubicación aproximada (ciudad/zona).</p>
          <p><strong>Datos de verificación (voluntarios):</strong> identificación oficial (INE) frente y reverso, fotografía selfie para verificación facial. Estos datos se solicitan únicamente cuando el usuario decide verificar su identidad para acceder a niveles superiores de confianza.</p>
          <p><strong>Datos de actividad:</strong> historial de publicaciones, transacciones confirmadas, reseñas, mensajes de chat, productos favoritos, y métricas de uso de la Plataforma.</p>
          <p><strong>Datos técnicos:</strong> dirección IP, tipo de dispositivo, navegador, sistema operativo, y cookies de sesión.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">3. Finalidades del Tratamiento</h2>
          <p><strong>Finalidades primarias (necesarias):</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Crear y gestionar tu cuenta de usuario</li>
            <li>Facilitar la comunicación entre compradores y vendedores</li>
            <li>Operar el sistema de confirmación mutua de ventas</li>
            <li>Calcular y mantener los niveles de confianza y reputación</li>
            <li>Procesar verificaciones de identidad</li>
            <li>Moderar contenido y resolver disputas</li>
            <li>Enviar notificaciones sobre actividad en tu cuenta</li>
          </ul>
          <p><strong>Finalidades secundarias (opcionales):</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Enviar comunicaciones promocionales sobre la Plataforma</li>
            <li>Realizar análisis estadísticos de uso (de forma anonimizada)</li>
            <li>Mejorar la experiencia del usuario y las funciones de la Plataforma</li>
          </ul>
          <p>Si no deseas que tus datos sean tratados para las finalidades secundarias, puedes manifestarlo enviando un correo a privacidad@vicino.mx.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">4. Transferencia de Datos</h2>
          <p>Tus datos personales pueden ser compartidos con:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Supabase Inc.</strong> — proveedor de infraestructura de base de datos y autenticación (servidores en Estados Unidos)</li>
            <li><strong>Vercel Inc.</strong> — proveedor de hospedaje web (servidores en Estados Unidos)</li>
            <li><strong>Google LLC</strong> — cuando utilizas autenticación vía Google OAuth</li>
          </ul>
          <p>Estos proveedores cuentan con políticas de privacidad y medidas de seguridad adecuadas conforme a estándares internacionales.</p>
          <p>VICINO no vende, renta ni comparte tus datos personales con terceros para fines de marketing.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">5. Derechos ARCO</h2>
          <p>Conforme a la LFPDPPP, tienes derecho a:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Acceso:</strong> conocer qué datos personales tenemos sobre ti</li>
            <li><strong>Rectificación:</strong> corregir datos inexactos o incompletos</li>
            <li><strong>Cancelación:</strong> solicitar la eliminación de tus datos</li>
            <li><strong>Oposición:</strong> oponerte al tratamiento de tus datos para ciertas finalidades</li>
          </ul>
          <p>Para ejercer tus derechos ARCO, envía un correo a privacidad@vicino.mx con tu nombre, correo electrónico registrado, y una descripción de lo que solicitas. Responderemos en un plazo máximo de 20 días hábiles.</p>
          <p>También puedes eliminar tu cuenta y datos directamente desde la sección de configuración de tu perfil.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">6. Cookies y Tecnologías Similares</h2>
          <p>VICINO utiliza cookies estrictamente necesarias para:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Mantener tu sesión activa</li>
            <li>Recordar tus preferencias de tema (claro/oscuro)</li>
            <li>Garantizar la seguridad de la autenticación</li>
          </ul>
          <p>No utilizamos cookies de seguimiento ni de publicidad de terceros.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">7. Medidas de Seguridad</h2>
          <p>Implementamos medidas de seguridad técnicas y organizativas para proteger tus datos personales, incluyendo: cifrado en tránsito (HTTPS/TLS), cifrado en reposo para contraseñas (bcrypt), Row Level Security (RLS) en la base de datos que impide acceso no autorizado, almacenamiento seguro de documentos de verificación con acceso restringido, y autenticación basada en tokens JWT con expiración.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">8. Conservación de Datos</h2>
          <p>Tus datos personales se conservan mientras mantengas una cuenta activa en la Plataforma. Al solicitar la eliminación de tu cuenta, tus datos serán eliminados en un plazo de 30 días, excepto aquellos que debamos conservar por obligaciones legales o fiscales (hasta por 5 años).</p>
          <p>Los documentos de verificación (INE, selfie) se eliminan automáticamente 90 días después de ser procesados.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">9. Modificaciones al Aviso de Privacidad</h2>
          <p>VICINO se reserva el derecho de modificar este Aviso de Privacidad en cualquier momento. Las modificaciones se publicarán en esta página y, en caso de cambios significativos, se notificará a los usuarios registrados por correo electrónico o mediante notificación en la Plataforma.</p>
        </section>

        <section>
          <h2 className="text-lg font-heading font-bold">10. Contacto</h2>
          <p>Para cualquier duda, comentario o solicitud relacionada con este Aviso de Privacidad o el tratamiento de tus datos personales:</p>
          <p><strong>Correo:</strong> privacidad@vicino.mx<br /><strong>Ubicación:</strong> Puebla, Puebla, México</p>
        </section>
      </div>
    </div>
  );
}
