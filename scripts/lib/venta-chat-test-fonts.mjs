import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const REQUIRED_FAMILIES = ["Inter", "Outfit"];
const LATIN_UNICODE_RANGE = /u\+00\?\?|u\+0100-02ba/i;

/**
 * Load the actual Inter and Outfit font faces emitted by this app's Next build.
 * The returned CSS is self-contained, so isolated browser pages never need to
 * reach the network to load fonts.
 *
 * @param {string} webDir Absolute path to apps/web.
 * @returns {Promise<{ css: string, families: string[], sourceFiles: string[] }>}
 */
export async function loadChatTestFonts(webDir) {
  const cssDir = path.join(webDir, ".next", "static", "css");
  const mediaDir = path.join(webDir, ".next", "static", "media");

  let cssNames;
  try {
    cssNames = (await readdir(cssDir)).filter((name) => name.endsWith(".css"));
  } catch (error) {
    throw new Error(`Next build CSS is unavailable at ${cssDir}: ${error.message}`);
  }
  if (cssNames.length === 0) {
    throw new Error(`Next build CSS is unavailable: no .css files in ${cssDir}`);
  }

  const buildCss = await Promise.all(
    cssNames.map(async (name) => ({ name, text: await readFile(path.join(cssDir, name), "utf8") })),
  );
  const faces = [];
  for (const { name, text } of buildCss) {
    for (const match of text.matchAll(/@font-face\s*\{([^{}]*)\}/gi)) {
      const body = match[1];
      const family = body.match(/font-family\s*:\s*(['"]?)([^;'"}]+)\1\s*;/i)?.[2]?.trim();
      if (!REQUIRED_FAMILIES.includes(family)) continue;

      const unicodeRange = body.match(/unicode-range\s*:\s*([^;}]+)\s*;?/i)?.[1]?.trim();
      // These builds emit latin and latin-ext faces. Exclude Cyrillic, Greek,
      // Vietnamese and emoji subsets, while keeping the original range intact.
      if (!unicodeRange || !LATIN_UNICODE_RANGE.test(unicodeRange)) continue;

      const source = body.match(/src\s*:\s*url\(\s*(['"]?)([^)'"\s]+)\1\s*\)\s*format\(\s*(['"]?)woff2\3\s*\)\s*;/i)?.[2];
      if (!source) {
        throw new Error(`Could not parse a local woff2 source for ${family} in ${name}`);
      }
      const mediaName = source.match(/(?:^|\/)\_next\/static\/media\/([^/?#]+)$/)?.[1];
      if (!mediaName) {
        throw new Error(`Unexpected ${family} font URL in ${name}: ${source}`);
      }
      const mediaPath = path.join(mediaDir, mediaName);
      let bytes;
      try {
        bytes = await readFile(mediaPath);
      } catch (error) {
        throw new Error(`Build font file for ${family} is missing (${mediaPath}): ${error.message}`);
      }

      const inlineBody = body.replace(source, `data:font/woff2;base64,${bytes.toString("base64")}`);
      faces.push({ family, css: `@font-face{${inlineBody}}`, mediaPath });
    }
  }

  const absent = REQUIRED_FAMILIES.filter((family) => !faces.some((face) => face.family === family));
  if (absent.length > 0) {
    throw new Error(
      `Could not find latin woff2 @font-face definitions for ${absent.join(", ")} in ${cssDir}`,
    );
  }

  const variables = ":root{--font-inter:\"Inter\",\"Inter Fallback\";--font-outfit:\"Outfit\",\"Outfit Fallback\"}";
  const sourceFiles = [...new Set(faces.map((face) => face.mediaPath))];
  return {
    css: `${faces.map((face) => face.css).join("\n")}\n${variables}`,
    families: [...REQUIRED_FAMILIES],
    sourceFiles,
  };
}
