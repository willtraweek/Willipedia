import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("src");
const componentRoot = path.join(root, "components");

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(absolute);
      }

      return [absolute];
    })
  );

  return files.flat();
}

function fail(message: string): never {
  throw new Error(message);
}

const sourceFiles = (await walk(root)).filter((file) => /\.(astro|css|ts)$/.test(file));
const componentFiles = (await walk(componentRoot)).filter((file) => /\.(astro|ts)$/.test(file));

for (const file of sourceFiles) {
  const content = await fs.readFile(file, "utf8");

  if (content.includes("font-variant-caps")) {
    fail(`Forbidden faux small caps in ${file}`);
  }

  if (/(#000\b|#111\b|#222\b)/i.test(content)) {
    fail(`Pure black token found in ${file}`);
  }

  for (const match of content.matchAll(/border-radius\s*:\s*([0-9.]+)px/gi)) {
    const value = Number(match[1]);
    if (value > 4) {
      fail(`Oversized border-radius (${value}px) found in ${file}`);
    }
  }
}

for (const file of componentFiles) {
  const content = await fs.readFile(file, "utf8");
  if (/(?<!withBase\()["'`]\/(page|api|assets)\//.test(content)) {
    fail(`Raw app path found in component source: ${file}`);
  }
}

console.log("design-rules:ok");
