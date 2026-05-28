#!/usr/bin/env node
// Guard pre-build: bloquea el shipping de stubs JSX visibles tipo
// <div>TODO Foo</div>. Leccion MP#06: ProductDetailDesktop se shippeo
// como <div>TODO ProductDetailDesktop</div> al flippear RENDER_V2 y
// usuarios desktop vieron literalmente "TODO ProductDetailDesktop"
// en pantalla. Este guard atrapa ese patron antes de Vercel.
//
// El regex matchea solo JSX con tag abriendo + "TODO" visible + tag
// cerrando. Comentarios "// TODO" y "/* TODO */" NO se detectan
// porque no estan dentro de un par <tag>...</tag>.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["components", "app"];
const EXT = /\.(tsx|jsx)$/;
const STUB_PATTERN = /<([a-zA-Z][a-zA-Z0-9]*)[^>]*>\s*TODO[\s\w:.,-]*<\/\1\s*>/;

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full);
    } else if (entry.isFile() && EXT.test(entry.name)) {
      const content = readFileSync(full, "utf-8");
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (STUB_PATTERN.test(line)) {
          violations.push(`${relative(process.cwd(), full)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
}

for (const root of ROOTS) {
  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {
    // ROOT no existe en este paquete; saltar silenciosamente.
  }
}

if (violations.length > 0) {
  process.stderr.write("ERROR: TODO stubs detected in components (forbidden in prod):\n");
  for (const v of violations) process.stderr.write(`  ${v}\n`);
  process.exit(1);
}

process.stdout.write("OK: No TODO stubs detected.\n");
