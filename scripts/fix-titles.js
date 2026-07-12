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
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function renamePage(oldTitle, newTitle) {
  const search = await notionRequest('/v1/search', 'POST', { query: oldTitle, filter: { property: 'object', value: 'page' } });
  if (search.results && search.results.length > 0) {
    for (let page of search.results) {
      if (page.parent?.page_id === '38d98e8a-0cfa-8157-a73b-ca1bb8f9b88e' || page.parent?.id === '38d98e8a-0cfa-8157-a73b-ca1bb8f9b88e') {
        console.log(`Renaming ${oldTitle} to ${newTitle}...`);
        await notionRequest(`/v1/pages/${page.id}`, 'PATCH', {
          properties: {
            title: { title: [{ text: { content: newTitle } }] }
          }
        });
      }
    }
  }
}

async function run() {
  await renamePage("Arquitectura de Agentes", "🦾 Arquitectura de Agentes y Skills para Producción Audiovisual");
  await renamePage("Ruflo", "🤖 Ruflo y Agentes Auto-Reflexivos");
  await renamePage("AI Skill: Creacion de Anuncios", "📢 AI Skill: Creación de Anuncios de Marketing");
  await renamePage("Inventario Skills", "🤖 Inventario de AI Skills & Herramientas");
  console.log("Done");
}
run();
