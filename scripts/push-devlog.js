const https = require('https');
const fs = require('fs');

const token = process.env.NOTION_TOKEN;

function notionRequest(path, method, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          try {
            const err = JSON.parse(data);
            reject(new Error(`Notion API Error (${res.statusCode}): ${err.message}`));
          } catch (e) {
            reject(new Error(`Notion API HTTP ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', (e) => { reject(e); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function heading(text, level = 1) {
  const type = `heading_${level}`;
  return { object: 'block', type: type, [type]: { rich_text: [{ type: 'text', text: { content: text } }] } };
}

function paragraph(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } };
}

function bullet(text) {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } };
}

async function main() {
  console.log("Searching for 01_DevLogs page in Notion...");
  const searchRes = await notionRequest('/v1/search', 'POST', { query: '01_DevLogs', filter: { property: 'object', value: 'page' } });
  
  if (!searchRes.results || searchRes.results.length === 0) {
    console.error("Could not find 01_DevLogs page in Notion.");
    return;
  }
  
  const devLogsParentId = searchRes.results[0].id;
  console.log(`Found 01_DevLogs page: ${devLogsParentId}`);

  const pageTitle = "2026-07-09-Onboarding-Logos";
  
  // Archivo a sincronizar
  const blocks = [
    heading("Refactorización Visual de Onboarding", 1),
    heading("Contexto", 2),
    paragraph("Durante la revisión del frontend para la nueva pantalla de bienvenida (/bienvenida), identificamos que se estaba renderizando un logo genérico (vicino-logo-transparent.png) en lugar de adaptarse al esquema 'Quiet Luxury' y a los temas claro/oscuro del sistema operativo, lógica que sí estaba implementada en la pantalla de inicio de sesión (/login)."),
    heading("Progreso / Cambios", 2),
    bullet("Se analizaron los recursos y detectamos que los íconos de 1024x1024 (icon-1024 - oscuro.png y claro) ya existían dentro de apps/web/public/ (vicino-logo-light-v2.png y vicino-logo-dark.png), evitando duplicidad de archivos en el repositorio."),
    bullet("Se refactorizó apps/web/app/(onboarding)/bienvenida/page.tsx para inyectar componentes condicionales usando clases de Tailwind CSS (show-in-light y show-in-dark)."),
    bullet("Se ajustó el tamaño del componente Image a 120x120 para asegurar máxima legibilidad de los íconos cuadrados y una excelente primera impresión."),
    bullet("El entorno local (Node.js y pnpm) fue reinstalado y el proyecto fue compilado (pnpm run build) generando 0 errores."),
    bullet("Los cambios fueron empaquetados y subidos exitosamente a la rama master."),
    heading("Siguientes Pasos", 2),
    bullet("Proceder con el resto de la deuda técnica (Bug Onboarding Modal de Apple, Rankings Sync Bug a 10km, Universal Links).")
  ];

  const body = {
    parent: { page_id: devLogsParentId },
    properties: {
      title: {
        title: [{ text: { content: pageTitle } }]
      }
    },
    children: blocks
  };

  console.log("Creating page...");
  const newPage = await notionRequest('/v1/pages', 'POST', body);
  console.log(`Successfully synced to Notion! Page ID: ${newPage.id}`);
}

main().catch(console.error);
