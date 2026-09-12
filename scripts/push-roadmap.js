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
  let i = 0;
  while (i < str.length) {
    let end = i + length;
    // Try not to split in the middle of a word if possible
    if (end < str.length) {
      let lastNewline = str.lastIndexOf('\n', end);
      if (lastNewline > i) {
        end = lastNewline + 1;
      }
    }
    result.push(str.substring(i, end));
    i = end;
  }
  return result;
}

function mdToBlocks(text) {
  const chunks = chunkString(text, 1900);
  return chunks.map(chunk => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: chunk } }]
    }
  })).slice(0, 99); // Max 100 blocks
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
      const pageTitle = page.properties?.title?.title?.[0]?.plain_text || page.properties?.Name?.title?.[0]?.plain_text || '';
      if (pageTitle === title && (page.parent?.page_id === parentId || page.parent?.id === parentId)) {
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
  // Find 00_Core
  let coreId = null;
  const searchRes1 = await notionRequest('/v1/search', 'POST', { query: '00_Core', filter: { property: 'object', value: 'page' } });
  if (searchRes1.results && searchRes1.results.length > 0) {
    coreId = searchRes1.results[0].id;
  }

  if (!coreId) {
    console.error(`Could not find parent category 00_Core`);
    return;
  }
  
  console.log(`00_Core ID: ${coreId}`);

  const workspaceRoot = path.join(__dirname, '../../');
  const obsidianCore = path.join(workspaceRoot, 'VICINO OBSIDIAN/VICINO/00_Core');

  // Push Roadmap
  await uploadFileToNotion(coreId, "roadmap.md", path.join(obsidianCore, 'roadmap.md'));
  // Push PROGRESS
  await uploadFileToNotion(coreId, "PROGRESS.md", path.join(workspaceRoot, 'PROGRESS.md'));
  
  console.log('Done!');
}

main().catch(console.error);
