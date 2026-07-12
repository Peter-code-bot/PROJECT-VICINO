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
          try { reject(new Error(`API Error (${res.statusCode}): ${JSON.parse(data).message}`)); }
          catch (e) { reject(new Error(`API Error HTTP ${res.statusCode}: ${data}`)); }
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
  const chunks = chunkString(text, 1900);
  return chunks.map(chunk => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] }
  }));
}

async function uploadFileToNotion(parentId, title, filePath) {
  console.log(`Uploading ${title}...`);
  const content = fs.readFileSync(filePath, 'utf8');
  
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
  const body = {
    parent: { page_id: parentId },
    properties: { title: { title: [{ text: { content: title } }] } },
    children: blocks
  };

  try {
    const newPage = await notionRequest('/v1/pages', 'POST', body);
    console.log(`Synced! Page ID: ${newPage.id}`);
  } catch (err) {
    console.error(`Error uploading ${title}: ${err.message}`);
  }
}

async function main() {
  const searchRes = await notionRequest('/v1/search', 'POST', { query: '00_Core', filter: { property: 'object', value: 'page' } });
  let coreId = null;
  if (searchRes.results && searchRes.results.length > 0) coreId = searchRes.results[0].id;
  if (!coreId) return console.error("Could not find 00_Core");

  const rootObsidian = path.join(__dirname, '../../VICINO OBSIDIAN/VICINO');
  await uploadFileToNotion(coreId, "💡 Ideas — VICINO", path.join(rootObsidian, '00_Core/ideas_backlog.md'));
}

main().catch(console.error);
