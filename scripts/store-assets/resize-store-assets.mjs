#!/usr/bin/env node
/**
 * resize-store-assets.mjs — Normaliza gráficos promocionales a las specs de Google Play.
 *
 * Convierte cualquier PNG/JPEG exportado (p. ej. desde Stitch) a 9:16 exacto, PNG < 8 MB.
 * El tamaño por defecto (1080x1920) cumple las 3 ranuras de Play (teléfono, tablet 7" y 10").
 *
 * Uso:
 *   node scripts/store-assets/resize-store-assets.mjs <inputDirOrFile> [outputDir] [--size 1080x1920]
 *
 * Ejemplos:
 *   node scripts/store-assets/resize-store-assets.mjs "../VICINO archivos/MKT/_raw" "../VICINO archivos/MKT"
 *   node scripts/store-assets/resize-store-assets.mjs anuncio.png ./out --size 1440x2560
 *
 * Comportamiento:
 *   - Si el aspecto ya es ~9:16 → resize exacto al target.
 *   - Si no coincide → fit: contain con padding terracota (#C45B3F), sin deformar la imagen.
 *   - Recomprime PNG y avisa si algún archivo supera 8 MB.
 */

import { readdir, mkdir, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resuelve `sharp` aunque pnpm no lo enlace en node_modules de la raíz
 * (next lo trae como dependencia transitoria bajo node_modules/.pnpm).
 */
function loadSharp() {
  const require = createRequire(import.meta.url);
  try {
    return require("sharp");
  } catch {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pnpmDir = path.resolve(here, "..", "..", "node_modules", ".pnpm");
    if (existsSync(pnpmDir)) {
      const match = readdirSync(pnpmDir).find((d) => d.startsWith("sharp@"));
      if (match) {
        return require(path.join(pnpmDir, match, "node_modules", "sharp"));
      }
    }
    throw new Error(
      "No se pudo cargar 'sharp'. Instálalo con `pnpm add -D sharp -w` o corre el script desde un workspace que lo tenga."
    );
  }
}

const sharp = loadSharp();

const TERRACOTTA = { r: 0xc4, g: 0x5b, b: 0x3f, alpha: 1 };
const MAX_BYTES = 8 * 1024 * 1024;
const VALID_EXT = new Set([".png", ".jpg", ".jpeg"]);

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  let size = "1080x1920";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--size") {
      size = args[++i];
    } else {
      positional.push(args[i]);
    }
  }
  const [w, h] = size.split("x").map((n) => parseInt(n, 10));
  if (!w || !h) throw new Error(`--size inválido: "${size}". Usa WxH, p. ej. 1080x1920.`);
  return { input: positional[0], outputDir: positional[1], width: w, height: h };
}

async function listInputs(input) {
  const s = await stat(input);
  if (s.isFile()) return [input];
  const entries = await readdir(input);
  return entries
    .filter((f) => VALID_EXT.has(path.extname(f).toLowerCase()) && !f.startsWith("_"))
    .map((f) => path.join(input, f));
}

async function processOne(file, outputDir, width, height) {
  const targetRatio = width / height;
  const meta = await sharp(file).metadata();
  const srcRatio = meta.width / meta.height;
  const ratioMatches = Math.abs(srcRatio - targetRatio) < 0.01;

  const base = path.parse(file).name + ".png";
  const outPath = path.join(outputDir, base);

  const pipeline = sharp(file).resize(width, height, {
    fit: ratioMatches ? "fill" : "contain",
    background: TERRACOTTA,
  });

  await pipeline.png({ compressionLevel: 9, quality: 90 }).toFile(outPath);

  const { size } = await stat(outPath);
  const flag = size > MAX_BYTES ? " ⚠️ >8MB" : "";
  const mode = ratioMatches ? "exacto" : "padding terracota";
  console.log(
    `✓ ${path.basename(file)} → ${base}  [${width}x${height}, ${mode}, ${(size / 1024).toFixed(0)} KB]${flag}`
  );
  return size <= MAX_BYTES;
}

async function main() {
  const { input, outputDir, width, height } = parseArgs(process.argv);
  if (!input) {
    console.error("Falta el input. Uso: node resize-store-assets.mjs <inputDirOrFile> [outputDir] [--size WxH]");
    process.exit(1);
  }
  if (!existsSync(input)) {
    console.error(`No existe el input: ${input}`);
    process.exit(1);
  }
  const inputIsFile = (await stat(input)).isFile();
  const finalOut = outputDir || (inputIsFile ? path.dirname(input) : input);
  await mkdir(finalOut, { recursive: true });

  const files = await listInputs(input);
  if (files.length === 0) {
    console.error("No se encontraron PNG/JPEG para procesar.");
    process.exit(1);
  }

  console.log(`Procesando ${files.length} archivo(s) → ${finalOut} (${width}x${height})\n`);
  let allOk = true;
  for (const f of files) {
    const ok = await processOne(f, finalOut, width, height);
    allOk = allOk && ok;
  }
  console.log(allOk ? "\n✅ Todos cumplen specs de Play." : "\n⚠️ Algún archivo supera 8 MB — recomprimir.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
