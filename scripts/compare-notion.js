const https = require('https');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
let parentId = null;
let token = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--parent-id' && args[i + 1]) {
    parentId = args[i + 1];
    i++;
  } else if (args[i] === '--token' && args[i + 1]) {
    token = args[i + 1];
    i++;
  }
}

// 1. Get token
if (!token) {
  token = process.env.NOTION_API_TOKEN || process.env.NOTION_TOKEN;
}
if (!token) {
  try {
    const mcpPath = path.resolve(__dirname, '../../.mcp.json');
    if (fs.existsSync(mcpPath)) {
      const mcpContent = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      token = mcpContent.mcpServers?.notion?.env?.NOTION_API_TOKEN || '';
    }
  } catch (e) {
    // Ignore, fallback to empty
  }
}

if (!token) {
  console.error("Error: Notion API Token not found. Please provide it via --token, NOTION_API_TOKEN environment variable, or in .mcp.json.");
  process.exit(1);
}

// 2. Get parent category page ID
if (!parentId) {
  parentId = '38d98e8a-0cfa-8157-a73b-ca1bb8f9b88e'; // Default for 05_AI_Agents
}

// Helper to make HTTPS requests to Notion API
let lastRequestTime = 0;

function notionRequest(apiPath, method, body = null) {
  const execute = () => {
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
  };

  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (lastRequestTime > 0 && timeSinceLast < 350) {
    const waitTime = 350 - timeSinceLast;
    return new Promise(resolve => setTimeout(resolve, waitTime))
      .then(() => {
        lastRequestTime = Date.now();
        return execute();
      });
  } else {
    lastRequestTime = now;
    return execute();
  }
}

// Resolve/verify parent category page ID or fallback to search
async function resolveParentId(defaultId) {
  try {
    await notionRequest(`/v1/blocks/${defaultId}/children?page_size=1`, 'GET');
    return defaultId;
  } catch (e) {
    // Attempt to search for 05_AI_Agents page
    try {
      const searchRes = await notionRequest('/v1/search', 'POST', {
        query: '05_AI_Agents',
        filter: { property: 'object', value: 'page' }
      });
      const results = searchRes.results || [];
      if (results.length > 0) {
        return results[0].id;
      }
    } catch (err) {
      // Ignore search error, fallback to defaultId
    }
    return defaultId;
  }
}

// Helper to convert rich text array to Markdown
function richTextToMarkdown(richTextArray) {
  if (!richTextArray || !richTextArray.length) return '';
  return richTextArray.map(rt => {
    let text = rt.plain_text || '';
    if (!text) return '';
    const ann = rt.annotations || {};
    if (ann.code) text = `\`${text}\``;
    if (ann.bold) text = `**${text}**`;
    if (ann.italic) text = `*${text}*`;
    if (ann.strikethrough) text = `~~${text}~~`;
    if (rt.href) text = `[${text}](${rt.href})`;
    return text;
  }).join('');
}

// Recursive function to fetch all blocks of a page
async function fetchBlockChildrenRecursive(blockId) {
  let results = [];
  let hasMore = true;
  let startCursor = undefined;
  while (hasMore) {
    let url = `/v1/blocks/${blockId}/children`;
    if (startCursor) {
      url += `?start_cursor=${startCursor}`;
    }
    const res = await notionRequest(url, 'GET');
    if (res.results) {
      results = results.concat(res.results);
    }
    hasMore = res.has_more;
    startCursor = res.next_cursor;
  }

  for (let block of results) {
    if (block.has_children) {
      block.children = await fetchBlockChildrenRecursive(block.id);
    }
  }
  return results;
}

// Reconstruct markdown from blocks
function blocksToMarkdown(blocks, depth = 0) {
  let md = '';
  let prevType = null;
  let listCounter = 1;
  const indent = '  '.repeat(depth);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const type = block.type;
    let blockText = '';

    if (type === 'numbered_list_item') {
      if (prevType !== 'numbered_list_item') {
        listCounter = 1;
      }
    }

    switch (type) {
      case 'heading_1':
        blockText = `${indent}# ${richTextToMarkdown(block.heading_1.rich_text)}`;
        break;
      case 'heading_2':
        blockText = `${indent}## ${richTextToMarkdown(block.heading_2.rich_text)}`;
        break;
      case 'heading_3':
        blockText = `${indent}### ${richTextToMarkdown(block.heading_3.rich_text)}`;
        break;
      case 'paragraph':
        blockText = `${indent}${richTextToMarkdown(block.paragraph.rich_text)}`;
        break;
      case 'bulleted_list_item':
        blockText = `${indent}- ${richTextToMarkdown(block.bulleted_list_item.rich_text)}`;
        break;
      case 'numbered_list_item':
        blockText = `${indent}${listCounter}. ${richTextToMarkdown(block.numbered_list_item.rich_text)}`;
        listCounter++;
        break;
      case 'callout':
        const emoji = block.callout.icon?.emoji;
        const text = richTextToMarkdown(block.callout.rich_text);
        blockText = `${indent}> ${emoji ? emoji + ' ' : ''}${text}`;
        break;
      case 'quote':
        blockText = `${indent}> ${richTextToMarkdown(block.quote.rich_text)}`;
        break;
      case 'divider':
        blockText = `${indent}---`;
        break;
      case 'code':
        const codeText = richTextToMarkdown(block.code.rich_text);
        const lang = block.code.language || '';
        blockText = `${indent}\`\`\`${lang}\n${codeText}\n${indent}\`\`\``;
        break;
      default:
        break;
    }

    if (blockText) {
      if (md === '') {
        md += blockText;
      } else {
        const isPrevList = prevType === 'bulleted_list_item' || prevType === 'numbered_list_item';
        const isCurrList = type === 'bulleted_list_item' || type === 'numbered_list_item';
        
        if (isPrevList && isCurrList && prevType === type) {
          md += '\n' + blockText;
        } else {
          md += '\n\n' + blockText;
        }
      }

      if (block.children && block.children.length > 0) {
        const childMd = blocksToMarkdown(block.children, depth + 1);
        if (childMd) {
          md += '\n' + childMd;
        }
      }
      prevType = type;
    } else {
      if (block.children && block.children.length > 0) {
        const childMd = blocksToMarkdown(block.children, depth);
        if (childMd) {
          if (md === '') {
            md += childMd;
          } else {
            md += '\n\n' + childMd;
          }
          
          let lastChild = block.children[block.children.length - 1];
          while (lastChild && lastChild.children && lastChild.children.length > 0 && !['heading_1', 'heading_2', 'heading_3', 'paragraph', 'bulleted_list_item', 'numbered_list_item', 'callout', 'quote', 'divider', 'code'].includes(lastChild.type)) {
            lastChild = lastChild.children[lastChild.children.length - 1];
          }
          if (lastChild) {
            prevType = lastChild.type;
          }
        }
      }
    }
  }
  return md;
}

// Normalize Title to assist matching (stripping emojis, extra space, lowercasing)
function normalizeTitle(t) {
  return t
    .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Normalize markdown for comparison
function normalizeMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      const trimmedTrailing = line.replace(/\s+$/, '');
      const match = trimmedTrailing.match(/^(\s*)(.*)$/);
      const indent = match ? match[1] : '';
      let content = match ? match[2] : trimmedTrailing;
      
      if (content.startsWith('>')) {
        let blockquoteText = content.substring(1).trim();
        blockquoteText = blockquoteText.replace(/^\[![a-zA-Z_-]+\]\s*/i, '');
        const emojiRegex = /^([\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]|\u2700-\u27BF)\s*/;
        blockquoteText = blockquoteText.replace(emojiRegex, '');
        
        if (blockquoteText.length === 0) {
          return null;
        }
        content = '> ' + blockquoteText;
      }
      
      if (content.startsWith('* ') || content.startsWith('+ ') || content.startsWith('- ')) {
        content = '- ' + content.substring(2);
      }
      
      content = content.replace(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g, '[**$1**]($2)');
      content = content.replace(/\*\[([^\]]+)\]\(([^)]+)\)\*/g, '[*$1*]($2)');
      content = content.replace(/_\[([^\]]+)\]\(([^)]+)\)_/g, '[_$1_]($2)');
      
      return indent + content;
    })
    .filter(line => line !== null)
    .join('\n');
}

// Search for page by title in global workspace search
async function searchPageByTitle(title) {
  try {
    const res = await notionRequest('/v1/search', 'POST', {
      query: title,
      filter: { property: 'object', value: 'page' }
    });
    const results = res.results || [];
    const normTitle = normalizeTitle(title);
    
    // Find best match - exact first
    for (const page of results) {
      const pageTitle = page.properties?.title?.title?.[0]?.plain_text || 
                        page.properties?.Name?.title?.[0]?.plain_text || '';
      const normPageTitle = normalizeTitle(pageTitle);
      if (normPageTitle && normPageTitle === normTitle) {
        return page;
      }
    }
    // Then partial matching only on non-empty titles
    for (const page of results) {
      const pageTitle = page.properties?.title?.title?.[0]?.plain_text || 
                        page.properties?.Name?.title?.[0]?.plain_text || '';
      const normPageTitle = normalizeTitle(pageTitle);
      if (normPageTitle && normTitle && (normPageTitle.includes(normTitle) || normTitle.includes(normPageTitle))) {
        return page;
      }
    }
  } catch (e) {
    // Ignore search errors
  }
  return null;
}

// Main function
async function main() {
  const OBSIDIAN_DIR = path.resolve(__dirname, '../../VICINO OBSIDIAN/VICINO/05_AI_Agents');
  if (!fs.existsSync(OBSIDIAN_DIR)) {
    console.error(`Error: Local Obsidian directory not found at ${OBSIDIAN_DIR}`);
    process.exit(1);
  }

  // Read local files
  const files = fs.readdirSync(OBSIDIAN_DIR);
  const localDocs = [];
  files.forEach(file => {
    if (file.endsWith('.md')) {
      const fullPath = path.join(OBSIDIAN_DIR, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      let title = '';
      if (lines.length > 0 && lines[0].startsWith('# ')) {
        title = lines[0].substring(2).trim();
      }
      if (title) {
        localDocs.push({
          file: file,
          fullPath: fullPath,
          title: title,
          content: content
        });
      }
    }
  });

  // Resolve parent ID
  const resolvedParentId = await resolveParentId(parentId);
  
  // Get children of parent page
  let childPages = [];
  try {
    let hasMore = true;
    let startCursor = undefined;
    while (hasMore) {
      let url = `/v1/blocks/${resolvedParentId}/children`;
      if (startCursor) {
        url += `?start_cursor=${startCursor}`;
      }
      const res = await notionRequest(url, 'GET');
      if (res.results) {
        childPages = childPages.concat(res.results.filter(b => b.type === 'child_page'));
      }
      hasMore = res.has_more;
      startCursor = res.next_cursor;
    }
  } catch (e) {
    // If querying children fails, we will rely purely on search
  }

  // Compare each local file
  for (const doc of localDocs) {
    let notionPage = null;

    // 1. Check in childPages of parent
    const normDocTitle = normalizeTitle(doc.title);
    const childMatch = childPages.find(c => normalizeTitle(c.child_page?.title || '') === normDocTitle);
    
    if (childMatch) {
      notionPage = { id: childMatch.id, title: childMatch.child_page.title };
    } else {
      // 2. Try global search
      const searchMatch = await searchPageByTitle(doc.title);
      if (searchMatch) {
        const titleText = searchMatch.properties?.title?.title?.[0]?.plain_text || 
                          searchMatch.properties?.Name?.title?.[0]?.plain_text || doc.title;
        notionPage = { id: searchMatch.id, title: titleText };
      }
    }

    if (!notionPage) {
      console.log(`MISSING: Page '${doc.title}' is not found in Notion`);
      continue;
    }

    // Fetch children blocks of the Notion page
    try {
      const blocks = await fetchBlockChildrenRecursive(notionPage.id);
      const notionMd = blocksToMarkdown(blocks);

      const normLocal = normalizeMarkdown(doc.content);
      const normNotion = normalizeMarkdown(notionMd);

      if (normLocal === normNotion) {
        console.log(`MATCH: Page '${doc.title}' is in sync`);
      } else {
        const localLines = normLocal.split('\n');
        const notionLines = normNotion.split('\n');
        const diffs = [];
        const maxLines = Math.max(localLines.length, notionLines.length);

        for (let i = 0; i < maxLines; i++) {
          const lLine = localLines[i] !== undefined ? localLines[i] : '<EOF>';
          const nLine = notionLines[i] !== undefined ? notionLines[i] : '<EOF>';
          if (lLine !== nLine) {
            diffs.push({
              line: i + 1,
              local: lLine,
              notion: nLine
            });
          }
        }

        console.log(`DISCREPANCY: Page '${doc.title}' content differs`);
        diffs.forEach(d => {
          console.log(`  Line ${d.line}:`);
          console.log(`    Local : "${d.local}"`);
          console.log(`    Notion: "${d.notion}"`);
        });
      }
    } catch (e) {
      console.error(`Error comparing page '${doc.title}':`, e.message);
    }
  }
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
