const https = require('https');
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
          try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
        } else {
          try { reject(new Error(JSON.parse(data).message)); } catch (e) { reject(new Error(data)); }
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log("Searching for 00_Core page in Notion...");
  const searchRes = await notionRequest('/v1/search', 'POST', { query: '00_Core', filter: { property: 'object', value: 'page' } });
  
  if (!searchRes.results || searchRes.results.length === 0) {
    console.error("Could not find 00_Core page in Notion.");
    return;
  }
  
  const coreParentId = searchRes.results[0].id;
  console.log(`Found 00_Core page: ${coreParentId}`);

  const pageTitle = "Bugs y Tareas Pendientes";
  
  const blocks = [
    {
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: "Bugs y Tareas Pendientes (Asignadas a Pedro)" } }] }
    },
    {
      object: 'block', type: 'to_do',
      to_do: { rich_text: [{ type: 'text', text: { content: "OnboardingModal (Apple Sign-In): Revisión de la integración con Apple." } }], checked: false }
    },
    {
      object: 'block', type: 'to_do',
      to_do: { rich_text: [{ type: 'text', text: { content: "Universal Links / App Links: Configuración de TEAMID10X para deep linking en la app." } }], checked: false }
    },
    {
      object: 'block', type: 'to_do',
      to_do: { rich_text: [{ type: 'text', text: { content: "Bug radio 10km (Rankings): Ya verificado. El límite máximo se subió a 50,000m (50km), con lo cual el radio de 10km funciona correctamente. (Verificado: Antigravity)" } }], checked: true }
    }
  ];

  const body = {
    parent: { page_id: coreParentId },
    properties: { title: { title: [{ text: { content: pageTitle } }] } },
    children: blocks
  };

  console.log("Creating/Updating page...");
  const newPage = await notionRequest('/v1/pages', 'POST', body);
  console.log(`Successfully synced tasks to Notion! Page ID: ${newPage.id}`);
}

main().catch(console.error);
