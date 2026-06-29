const https = require('https');

// Default Notion configuration
const DEFAULT_TOKEN = process.env.NOTION_TOKEN || "";

// Parse command line arguments
const args = process.argv.slice(2);
let parentId = null;
let token = process.env.NOTION_TOKEN || DEFAULT_TOKEN;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--parent-id' && args[i + 1]) {
    parentId = args[i + 1];
    i++;
  } else if (args[i] === '--token' && args[i + 1]) {
    token = args[i + 1];
    i++;
  }
}

console.log("=== VICINO Notion Sync Utility ===");
console.log(`Token: ${token.substring(0, 10)}...`);

// Helper to make HTTPS requests to Notion API
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

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// 1. Search for any pages or databases
async function searchWorkspace() {
  console.log("Searching Notion workspace...");
  try {
    const res = await notionRequest('/v1/search', 'POST', {});
    return res.results || [];
  } catch (e) {
    console.error("Search failed:", e.message);
    return [];
  }
}

// Helper to construct Notion blocks from simple descriptions
function paragraph(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: text } }]
    }
  };
}

function heading(text, level = 1) {
  const type = `heading_${level}`;
  return {
    object: 'block',
    type: type,
    [type]: {
      rich_text: [{ type: 'text', text: { content: text } }]
    }
  };
}

function bullet(text) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: text } }]
    }
  };
}

function callout(text, icon = "📌") {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: text } }],
      icon: { type: 'emoji', emoji: icon }
    }
  };
}

function divider() {
  return {
    object: 'block',
    type: 'divider',
    divider: {}
  };
}

// Create page
async function createPage(parentId, title, children = []) {
  const body = {
    parent: { page_id: parentId },
    properties: {
      title: {
        title: [{ text: { content: title } }]
      }
    },
    children: children
  };
  return await notionRequest('/v1/pages', 'POST', body);
}

// Archive a page by ID
async function archivePage(pageId) {
  return await notionRequest(`/v1/pages/${pageId}`, 'PATCH', { archived: true });
}

// Main execution flow
async function main() {
  // Query Notion first
  const existingPages = await searchWorkspace();
  console.log(`Found ${existingPages.length} existing visible pages/databases in workspace.`);
  
  if (existingPages.length > 0) {
    console.log("Visible pages:");
    existingPages.forEach(p => {
      const title = p.properties?.title?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || "Untitled";
      console.log(` - [${p.object}] ID: ${p.id} | Title: ${title}`);
    });
  }

  // Determine parent page ID
  if (!parentId) {
    if (existingPages.length > 0) {
      // Find a page that looks like a root
      const rootPage = existingPages.find(p => {
        const title = p.properties?.title?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || "";
        return title.toLowerCase().includes("vicino") || title.toLowerCase().includes("root") || title.toLowerCase().includes("workspace");
      }) || existingPages[0];
      
      parentId = rootPage.id;
      const rootTitle = rootPage.properties?.title?.title?.[0]?.plain_text || rootPage.properties?.Name?.title?.[0]?.plain_text || "Untitled";
      console.log(`Automatically selected parent page: "${rootTitle}" (ID: ${parentId})`);
    }
  }

  if (!parentId) {
    console.log("\nAttempting to create root categories in the workspace root...");
    // Attempting to create the 8 root pages directly in workspace root
    const categories = [
      "00_Core", "01_DevLogs", "02_Architecture_ADR", "03_Design_UX",
      "04_Projects", "05_AI_Agents", "06_Growth_Marketing", "07_Business_Legal"
    ];

    for (const cat of categories) {
      try {
        const body = {
          parent: { type: "workspace", workspace: true },
          properties: {
            title: { title: [{ text: { content: cat } }] }
          }
        };
        const res = await notionRequest('/v1/pages', 'POST', body);
        console.log(`✅ Created root page at workspace level: ${cat} (ID: ${res.id})`);
      } catch (err) {
        console.log(`❌ Failed to create root page "${cat}" at workspace level:`);
        console.log(`   Error: ${err.message}`);
        console.log("   Workspace-level private pages cannot be created by internal integrations.");
        console.log("   Please share an existing page with this integration to use it as parent.");
        break;
      }
    }
    
    console.log("\n=== HOW TO RUN SYNCHRONIZATION ===");
    console.log("1. Create a root page in your Notion workspace named 'VICINO Root'.");
    console.log("2. Open the page settings in Notion, and in the 'Connections' section, share it with the integration.");
    console.log("3. Copy the ID from the Notion page URL (the 32-character hex code).");
    console.log("4. Run this sync script: node scripts/sync-notion.js --parent-id <your-copied-page-id>");
    return;
  }

  console.log(`\nStarting sync under parent page ID: ${parentId}`);

  // Re-fetch children of parent page to see if categories already exist
  console.log("Checking if categories already exist under parent...");
  let categoryPages = {};
  
  // We can search the visible pages to see which ones are children of parentId
  existingPages.forEach(p => {
    if (p.parent?.page_id === parentId || p.parent?.id === parentId) {
      const title = p.properties?.title?.title?.[0]?.plain_text || "";
      if (title) {
        categoryPages[title] = p.id;
      }
    }
  });

  const categories = [
    "00_Core", "01_DevLogs", "02_Architecture_ADR", "03_Design_UX",
    "04_Projects", "05_AI_Agents", "06_Growth_Marketing", "07_Business_Legal"
  ];

  for (const cat of categories) {
    if (categoryPages[cat]) {
      console.log(` - Category "${cat}" already exists (ID: ${categoryPages[cat]})`);
    } else {
      console.log(` - Creating category "${cat}"...`);
      try {
        const page = await createPage(parentId, cat, [
          heading(`VICINO Category: ${cat}`, 1),
          paragraph(`This is the numerical taxonomy root folder for ${cat} in the VICINO project.`),
          divider()
        ]);
        categoryPages[cat] = page.id;
        console.log(`   ✅ Created "${cat}" (ID: ${page.id})`);
      } catch (err) {
        console.error(`   ❌ Failed to create "${cat}":`, err.message);
      }
    }
  }

  // Now, create the specific sub-pages as requested

  // 1. Master Index Page under Parent ID (mimicking Master.md)
  console.log("\nSyncing Master Index page...");
  const masterTitle = "Master Index";
  // Check if Master Index already exists under parent
  let masterIndexId = existingPages.find(p => {
    const title = p.properties?.title?.title?.[0]?.plain_text || "";
    return title === masterTitle && (p.parent?.page_id === parentId || p.parent?.id === parentId);
  })?.id;

  if (masterIndexId) {
    console.log(` - Master Index already exists (ID: ${masterIndexId}). Archiving old page to refresh...`);
    await archivePage(masterIndexId);
  }

  const masterBlocks = [
    heading("VICINO Obsidian Vault Master Index", 1),
    paragraph("Welcome to the VICINO Notion Workspace. This workspace is restructured using a standardized numeric taxonomy to optimize context navigation for AI agents and human developers."),
    divider(),
    heading("Taxonomy Structure", 2),
    paragraph("Below is the mapping of categories to their directory locations:"),
    bullet("00_Core — High-level indexes, roadmap, and project maps of content (MOC)."),
    bullet("01_DevLogs — Daily developer logs indexed chronologically."),
    bullet("02_Architecture_ADR — Architectural Decision Records (ADRs) and specifications."),
    bullet("03_Design_UX — Styling tokens, UI tweaks, and user flows."),
    bullet("04_Projects — Distinct sub-projects (e.g. Agentic OS)."),
    bullet("05_AI_Agents — AI agent prompts, instructions, and tools."),
    bullet("06_Growth_Marketing — Growth marketing plans, contacts, and outreach copy."),
    bullet("07_Business_Legal — Notion synchronization, pitches, and compliance."),
    divider(),
    heading("Navigation Rules for AI Agents", 2),
    bullet("Look under 00_Core for project scope, roadmap, and high-level decisions."),
    bullet("Look under 01_DevLogs to trace historical changes or past issues chronologically."),
    bullet("Look under 02_Architecture_ADR to check design decisions and schemas."),
    bullet("Look under 05_AI_Agents to understand local skills and agent prompts.")
  ];

  try {
    const masterPage = await createPage(parentId, masterTitle, masterBlocks);
    console.log(` ✅ Master Index page created successfully! (ID: ${masterPage.id})`);
  } catch (err) {
    console.error(" ❌ Failed to create Master Index page:", err.message);
  }

  // 2. Estrategia de YouTube & Lanzamiento under 06_Growth_Marketing page ID
  const growthMarketingId = categoryPages["06_Growth_Marketing"];
  if (growthMarketingId) {
    console.log("\nSyncing 'Estrategia de YouTube & Lanzamiento' page...");
    const youtubeTitle = "Estrategia de YouTube & Lanzamiento";
    
    // Check if it already exists under 06_Growth_Marketing
    let ytPageId = existingPages.find(p => {
      const title = p.properties?.title?.title?.[0]?.plain_text || "";
      return title === youtubeTitle && (p.parent?.page_id === growthMarketingId || p.parent?.id === growthMarketingId);
    })?.id;

    if (ytPageId) {
      console.log(` - Page already exists (ID: ${ytPageId}). Archiving old page to refresh...`);
      await archivePage(ytPageId);
    }

    const ytBlocks = [
      heading("Estrategia de YouTube & Lanzamiento", 1),
      callout("Esta página detalla la estrategia de lanzamiento y distribución de videos demo y pitches en YouTube para VICINO.", "🎥"),
      divider(),
      heading("1. Video Demo — VICINO (El Marketplace de tu Barrio)", 2),
      paragraph("Estructura narrativa del video demo de la aplicación para atraer a los primeros vendedores y compradores."),
      bullet("Título Recomendado: VICINO — El Marketplace de tu Barrio | Demo de la App 2026"),
      bullet("Descripción optimizada:"),
      paragraph("¿Quieres comprar o vender a la vuelta de tu casa? VICINO es la aplicación móvil que conecta a vecinos en Puebla para comprar y vender productos y servicios de manera local, segura e inmediata. Descarga la app en vicinomarket.com y únete a la red de tu barrio. 📲"),
      bullet("SEO Tags: #VICINO, #MarketplaceHiperlocal, #ComercioLocal, #Puebla, #NenisMX, #StartupMexico"),
      divider(),
      heading("2. Composición y Guía de Thumbnail", 2),
      paragraph("Diseño premium siguiendo el concepto de 'Quiet Luxury' de VICINO."),
      bullet("Fondo: Charcoal oscuro (#1A1A2E) con efecto de vidrio (glassmorphism)."),
      bullet("Izquierda: Texto en Outfit negrita contrastante ('VICINO' en crema #FFF8F0 y 'Demo de la App' en verde marca #1F5A4E)."),
      bullet("Derecha: Mockup de teléfono Android (pantalla real de inicio con listados locales) con un pin 3D de ubicación flotando en oro (#D4A853)."),
      bullet("Sin sobrecargar: Elementos visuales limpios, legibilidad a tamaño pequeño en mobile.")
    ];

    try {
      const ytPage = await createPage(growthMarketingId, youtubeTitle, ytBlocks);
      console.log(` ✅ YouTube Strategy page created successfully! (ID: ${ytPage.id})`);
    } catch (err) {
      console.error(" ❌ Failed to create YouTube Strategy page:", err.message);
    }
  }

  // 3. Ficha Técnica: Pitch Final (Startup Champ) under 07_Business_Legal page ID
  const businessLegalId = categoryPages["07_Business_Legal"];
  if (businessLegalId) {
    console.log("\nSyncing 'Ficha Técnica: Pitch Final (Startup Champ)' page...");
    const pitchTitle = "Ficha Técnica: Pitch Final (Startup Champ)";
    
    // Check if it already exists under 07_Business_Legal
    let pitchPageId = existingPages.find(p => {
      const title = p.properties?.title?.title?.[0]?.plain_text || "";
      return title === pitchTitle && (p.parent?.page_id === businessLegalId || p.parent?.id === businessLegalId);
    })?.id;

    if (pitchPageId) {
      console.log(` - Page already exists (ID: ${pitchPageId}). Archiving old page to refresh...`);
      await archivePage(pitchPageId);
    }

    const pitchBlocks = [
      heading("Ficha Técnica: Pitch Final (Startup Champ)", 1),
      callout("Requisitos y estructura del Pitch Final para la Startup World Cup / Startup Champ 2026 (Chihuahua Tech Week).", "🏆"),
      divider(),
      heading("1. Estructura del Pitch (3 Minutos - Inglés)", 2),
      bullet("0:00 - 0:30 | Hook & Problema: La desconexión en el comercio informal de barrio en LATAM. Encontrar un producto localmente requiere grupos de Facebook o WhatsApp desordenados."),
      bullet("0:30 - 1:00 | Solución: VICINO, la app de geolocalización por proximidad que digitaliza la economía local en un radio de 5km sin comisiones por transacción."),
      bullet("1:00 - 2:00 | Producto & Demo: Cómo un usuario publica en 30 segundos, el chat realtime y el flujo de confirmación de venta seguro."),
      bullet("2:00 - 2:40 | Tracción & Ventaja: 30 vendedores reales validados en Puebla, reviews bidireccionales y trust points. Privacidad geoespacial server-side (fuzzing a 100m)."),
      bullet("2:40 - 3:00 | Call to Action: Expansión nacional y global. 'Changing how neighborhoods trade. We are VICINO.'"),
      divider(),
      heading("2. Lineamientos del Pitch Deck", 2),
      bullet("Slide 1: Visión global (VICINO - The Marketplace of your Neighborhood)"),
      bullet("Slide 2: Problema (economía informal y fricción de búsqueda local)"),
      bullet("Slide 3: Solución (geolocalización 5km, multi-vendor)"),
      bullet("Slide 4: Demo / Producto (pantallas premium, pull-to-refresh, drag-drop)"),
      bullet("Slide 5: Tracción (vendedores reales en Puebla, transacciones, reviews)"),
      bullet("Slide 6: Ventaja competitiva (fuzzing de privacidad, trust points, rankings locales)"),
      bullet("Slide 7: Visión global y plan de expansión"),
      divider(),
      heading("3. Información de Viaje y Logística", 2),
      bullet("Fecha límite de registro: 15 de julio de 2026"),
      bullet("Fechas del evento: Jueves 24 de septiembre de 2026 en Chihuahua"),
      bullet("Hospedaje: 2 noches cubiertas por el comité organizador (miércoles 23 y jueves 24 de septiembre de 2026)"),
      bullet("Vuelos: Vuelos nacionales incluidos (llegar a más tardar el miércoles 23 de septiembre)"),
      bullet("Visa: Requisito de visa americana vigente obligatoria en caso de ganar para la final mundial en Silicon Valley ($1,000,000 USD).")
    ];

    try {
      const pitchPage = await createPage(businessLegalId, pitchTitle, pitchBlocks);
      console.log(` ✅ Pitch Final page created successfully! (ID: ${pitchPage.id})`);
    } catch (err) {
      console.error(" ❌ Failed to create Pitch Final page:", err.message);
    }
  }

  // 4. Dirección de Arte y Storyboard under 03_Design_UX page ID
  const designUxId = categoryPages["03_Design_UX"];
  if (designUxId) {
    console.log("\nSyncing 'Dirección de Arte y Storyboard' page...");
    const artTitle = "Dirección de Arte y Storyboard";
    
    // Check if it already exists under 03_Design_UX
    let artPageId = existingPages.find(p => {
      const title = p.properties?.title?.title?.[0]?.plain_text || "";
      return title === artTitle && (p.parent?.page_id === designUxId || p.parent?.id === designUxId);
    })?.id;

    if (artPageId) {
      console.log(` - Page already exists (ID: ${artPageId}). Archiving old page to refresh...`);
      await archivePage(artPageId);
    }

    const artBlocks = [
      heading("Dirección de Arte y Storyboard", 1),
      callout("Guía de dirección de arte, branding, tipografía cinemática y estructura de guion/storyboard para los videos promocionales de VICINO.", "🎨"),
      divider(),
      heading("1. Brand Identity & Palette (Quiet Luxury)", 2),
      paragraph("La estética de VICINO sigue el concepto de 'Quiet Luxury', transmitiendo elegancia y calidez local sin saturación ni elementos artificiales (AI slop)."),
      bullet("Brand: #1F5A4E (Verde Teal)"),
      bullet("Light: #2E8773 (Verde Claro)"),
      bullet("Dark: #133731 (Verde Oscuro)"),
      bullet("Cream: #FFF8F0 (Fondo Claro)"),
      bullet("Charcoal: #1A1A2E (Fondo Oscuro)"),
      bullet("Gold: #D4A853 (Detalles/Destacados)"),
      divider(),
      heading("2. Tipografía & Estilo Visual", 2),
      bullet("Headings/Títulos: Outfit (Google Fonts) - Bold/ExtraBold"),
      bullet("Body/Subtítulos: Inter (Google Fonts) - Medium/Regular"),
      bullet("Android-First Design: Toda UI y mockup debe presentarse usando dispositivos Android (punch-hole camera). NUNCA usar mockups de iPhone, asegurando consistencia con el mercado objetivo mexicano."),
      divider(),
      heading("3. Storyboard Narrativo (5 Bloques Críticos)", 2),
      bullet("Bloque 1: HOOK (0:00–0:15) — Presenta el problema del comercio local informal en México y la desconexión entre vecinos (42 millones de personas)."),
      bullet("Bloque 2: SOLUCIÓN (0:15–0:40) — Introduce VICINO y su propuesta de valor hiperlocal (conectando compradores y vendedores a menos de 5km)."),
      bullet("Bloque 3: DEMO (0:40–3:00) — Flujo interactivo de la app en 6 mini-historias: Descubre (login/home), Detalle (reseñas), Conecta (chat/confirmación), Personaliza (siguiendo), Vende (publicar producto/servicio) y Gestiona (perfil/tienda)."),
      bullet("Bloque 4: TRACCIÓN & DIFERENCIADORES (3:00–4:00) — Muestra los números clave (vendedores activos, productos, seguridad KYC, PWA)."),
      bullet("Bloque 5: CTA & CIERRE (4:00–4:30) — Cierre de marca con el logo de VICINO, lema 'Lo mejor está cerca' y URL vicinomarket.com.")
    ];

    try {
      const artPage = await createPage(designUxId, artTitle, artBlocks);
      console.log(` ✅ Art Direction & Storyboard page created successfully! (ID: ${artPage.id})`);
    } catch (err) {
      console.error(" ❌ Failed to create Art Direction & Storyboard page:", err.message);
    }
  }

  // 5. Registro de Producción CapCut under 01_DevLogs page ID
  const devLogsId = categoryPages["01_DevLogs"];
  if (devLogsId) {
    console.log("\nSyncing 'Registro de Producción CapCut' page...");
    const capcutTitle = "Registro de Producción CapCut";
    
    // Check if it already exists under 01_DevLogs
    let capcutPageId = existingPages.find(p => {
      const title = p.properties?.title?.title?.[0]?.plain_text || "";
      return title === capcutTitle && (p.parent?.page_id === devLogsId || p.parent?.id === devLogsId);
    })?.id;

    if (capcutPageId) {
      console.log(` - Page already exists (ID: ${capcutPageId}). Archiving old page to refresh...`);
      await archivePage(capcutPageId);
    }

    const capcutBlocks = [
      heading("Registro de Producción CapCut", 1),
      callout("Bitácora de producción, edición en CapCut y guías técnicas para la captura de pantalla del video promocional de VICINO.", "🎬"),
      divider(),
      heading("1. Mega-Resumen del Chat: Producción del Video VICINO", 2),
      paragraph("Durante las sesiones de alineación de producto y marketing, Javier y Alejandro coordinaron la recopilación de clips del emulador Android para el video demo. Se acordó evitar tiempos muertos de carga, recortar transiciones innecesarias y centrarse en la fluidez de la app con haptics y transiciones directas."),
      divider(),
      heading("2. Guía de Screen Recordings (OBS & scrcpy)", 2),
      bullet("OBS Studio Setup: Capturar en resolución limpia de 1920x1080 a 30fps. Formato MKV con remux automático a MP4."),
      bullet("scrcpy Tooling: Proyectar el teléfono Android real mediante scrcpy con la bandera --disable-screensaver y ocultar la barra de notificaciones y reloj para un look de app de producción."),
      bullet("Clean UI Rule: Ninguna notificación de sistema, barra de señal o indicador de batería debe estar visible en los clips."),
      divider(),
      heading("3. Edición en CapCut (Tips Clave)", 2),
      bullet("Keyframes: Generar efectos de zoom-through del 100% al 120% y transiciones parallax sutiles controlando la escala del clip en puntos clave (Keyframe al inicio normal -> Keyframe al final zoom 120%)."),
      bullet("Transitions: Mantener consistencia usando cortes directos (hard cuts) dentro de la misma sección y transiciones suaves con flash blanco o slide-up para cambios de bloques narrativos."),
      bullet("Beat Sync: Marcar los beats del track de Epidemic Sound en la línea de tiempo usando la función de Ritmo y cortar los clips coincidiendo exactamente con los golpes de la música."),
      bullet("Export Settings: Formato H.264, resolución 1080p a 30fps con tasa de bits (bitrate) alta para máxima nitidez en proyectores.")
    ];

    try {
      const capcutPage = await createPage(devLogsId, capcutTitle, capcutBlocks);
      console.log(` ✅ CapCut Production page created successfully! (ID: ${capcutPage.id})`);
    } catch (err) {
      console.error(" ❌ Failed to create CapCut Production page:", err.message);
    }
  }

  // 6. Registro de Skills de Video under 05_AI_Agents page ID
  const aiAgentsId = categoryPages["05_AI_Agents"];
  if (aiAgentsId) {
    console.log("\nSyncing 'Registro de Skills de Video' page...");
    const skillsTitle = "Registro de Skills de Video";
    
    // Check if it already exists under 05_AI_Agents
    let skillsPageId = existingPages.find(p => {
      const title = p.properties?.title?.title?.[0]?.plain_text || "";
      return title === skillsTitle && (p.parent?.page_id === aiAgentsId || p.parent?.id === aiAgentsId);
    })?.id;

    if (skillsPageId) {
      console.log(` - Page already exists (ID: ${skillsPageId}). Archiving old page to refresh...`);
      await archivePage(skillsPageId);
    }

    const skillsBlocks = [
      heading("Registro de Skills de Video", 1),
      callout("Resumen de las habilidades locales (AI Agent Skills) para dirección y producción audiovisual en el proyecto VICINO.", "🤖"),
      divider(),
      heading("1. Skill: av-demo-director", 2),
      paragraph("Habilidad especializada que guía la dirección creativa de los videos promocionales y pitches de competencia de VICINO."),
      bullet("Ruta local: .agents/skills/av-demo-director/SKILL.md"),
      bullet("Metodología: Define el estilo visual 'Quiet Luxury' (colores, tipografías), la estructura del pitch de 3-5 minutos dividida en 5 bloques narrativos, lineamientos de color grading (sombras Charcoal, highlights Cream) y diseño de audio de 3 capas."),
      divider(),
      heading("2. Skill: av-design-toolkit", 2),
      paragraph("Catálogo y guía de herramientas para producción de contenido gráfico y audiovisual optimizado para el equipo de VICINO."),
      bullet("Ruta local: .agents/skills/av-design-toolkit/SKILL.md"),
      bullet("Metodología: Reúne mejores prácticas para edición rápida con CapCut, uso de Canva Pro para overlays, OBS Studio para grabación de pantallas móviles, DaVinci Resolve para grading profesional y acceso a recursos estudiantiles/edu de Figma.")
    ];

    try {
      const skillsPage = await createPage(aiAgentsId, skillsTitle, skillsBlocks);
      console.log(` ✅ Video Skills page created successfully! (ID: ${skillsPage.id})`);
    } catch (err) {
      console.error(" ❌ Failed to create Video Skills page:", err.message);
    }
  }

  console.log("\nNotion synchronization finished!");
}

main().catch(err => {
  console.error("Unexpected error in main:", err);
});
