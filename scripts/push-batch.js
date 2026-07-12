const https = require('https');
const fs = require('fs');
const path = require('path');

const token = process.env.NOTION_TOKEN;

function notionRequest(apiPath, method, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path: apiPath,
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
          try { reject(new Error(`Notion API Error (${res.statusCode}): ${JSON.parse(data).message}`)); }
          catch (e) { reject(new Error(`Notion API HTTP ${res.statusCode}: ${data}`)); }
        }
      });
    });

    req.on('error', (e) => { reject(e); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function chunkString(str, length) {
  const result = [];
  for (let i = 0; i < str.length; i += length) {
    result.push(str.substring(i, i + length));
  }
  return result;
}

function mdToBlocks(text) {
  // Notion API limit: rich_text length is 2000 chars max.
  const chunks = chunkString(text, 1900);
  return chunks.map(chunk => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: chunk } }]
    }
  }));
}

async function uploadFileToNotion(parentId, title, filePath) {
  console.log(`Uploading ${title}...`);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Archiving existing page if it exists
  const searchRes = await notionRequest('/v1/search', 'POST', { query: title, filter: { property: 'object', value: 'page' } });
  if (searchRes.results) {
    for (const page of searchRes.results) {
      if ((page.parent?.page_id === parentId || page.parent?.id === parentId)) {
        console.log(`Archiving old page ${page.id}...`);
        await notionRequest(`/v1/pages/${page.id}`, 'PATCH', { archived: true });
      }
    }
  }

  const blocks = mdToBlocks(content);
  
  // Create new page
  const body = {
    parent: { page_id: parentId },
    properties: {
      title: { title: [{ text: { content: title } }] }
    },
    children: blocks
  };

  try {
    const newPage = await notionRequest('/v1/pages', 'POST', body);
    console.log(`Successfully synced to Notion! Page ID: ${newPage.id}`);
  } catch (err) {
    console.error(`Error uploading ${title}: ${err.message}`);
  }
}

async function main() {
  // Find 01_DevLogs
  let devLogsId = null;
  let aiAgentsId = null;
  
  const searchRes1 = await notionRequest('/v1/search', 'POST', { query: '01_DevLogs', filter: { property: 'object', value: 'page' } });
  if (searchRes1.results && searchRes1.results.length > 0) devLogsId = searchRes1.results[0].id;
  
  const searchRes2 = await notionRequest('/v1/search', 'POST', { query: '05_AI_Agents', filter: { property: 'object', value: 'page' } });
  if (searchRes2.results && searchRes2.results.length > 0) aiAgentsId = searchRes2.results[0].id;

  if (!devLogsId || !aiAgentsId) {
    console.error(`Could not find parent categories. devLogsId: ${devLogsId}, aiAgentsId: ${aiAgentsId}`);
    return;
  }
  
  console.log(`devLogsId: ${devLogsId}`);
  console.log(`aiAgentsId: ${aiAgentsId}`);

  const rootObsidian = path.join(__dirname, '../../VICINO OBSIDIAN/VICINO');

  // Push DevLogs
  await uploadFileToNotion(devLogsId, "2026-05-26-Ranking-Builder", path.join(rootObsidian, '01_DevLogs/2026-05-26-Ranking-Builder.md'));
  await uploadFileToNotion(devLogsId, "2026-05-02-Cierre-Fase-8-MP04", path.join(rootObsidian, '01_DevLogs/2026-05-02-Cierre-Fase-8-MP04.md'));

  // Push AI Agents
  await uploadFileToNotion(aiAgentsId, "05_AI_Agents — Inteligencia Artificial y Herramientas", path.join(rootObsidian, '05_AI_Agents/_index.md'));
  await uploadFileToNotion(aiAgentsId, "Registro de Skills de Video", path.join(rootObsidian, '05_AI_Agents/registro_skills_video.md'));
  await uploadFileToNotion(aiAgentsId, "Arquitectura de Agentes", path.join(rootObsidian, '05_AI_Agents/av_agents_architecture.md'));
  await uploadFileToNotion(aiAgentsId, "Ruflo", path.join(rootObsidian, '05_AI_Agents/ruflo_reflexive_agents.md'));
  await uploadFileToNotion(aiAgentsId, "AI Skill: Creacion de Anuncios", path.join(rootObsidian, '05_AI_Agents/skill_anuncios_marketing.md'));
  await uploadFileToNotion(aiAgentsId, "Inventario Skills", path.join(rootObsidian, '05_AI_Agents/skills_catalog.md'));
}

main().catch(console.error);
