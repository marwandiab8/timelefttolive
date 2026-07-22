#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const STAGING_PROJECT_ID = 'timelefttolive-stg-go';
const PRODUCTION_PROJECT_ID = 'timelefttolive';
const OUTPUT_DIR = 'dist';

function collectFiles(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function fail(message, details) {
  console.error(JSON.stringify({ status: 'error', message, ...(details ? { details } : {}) }));
  process.exit(1);
}

if (!existsSync(OUTPUT_DIR)) {
  fail('Build output directory not found. Run build first.', { outputDir: OUTPUT_DIR });
}

const files = collectFiles(OUTPUT_DIR);
const targets = ['.js', '.mjs', '.cjs', '.html', '.json', '.css'];
const readable = files.filter((filePath) => {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return targets.includes(ext);
});

let content = '';
for (const filePath of readable) {
  content += readFileSync(filePath, 'utf8');
}

if (!content.includes(STAGING_PROJECT_ID)) {
  fail('Staging build output does not include approved staging project id.', {
    expected: STAGING_PROJECT_ID
  });
}

if (content.includes(`\"${PRODUCTION_PROJECT_ID}\"`) || content.includes(`'${PRODUCTION_PROJECT_ID}'`)) {
  fail('Production project id is present in staging build output.', {
    productionProjectId: PRODUCTION_PROJECT_ID
  });
}

const sourceMapPath = join(dirname(OUTPUT_DIR), '.');
void sourceMapPath;

console.log(JSON.stringify({
  status: 'ok',
  outputDir: OUTPUT_DIR,
  scannedFiles: readable.length,
  stagingProjectId: STAGING_PROJECT_ID,
  productionProjectIdBlocked: true
}));
