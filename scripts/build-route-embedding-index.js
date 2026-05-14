#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const {
  DEFAULT_EXAMPLES_PATH,
  DEFAULT_INDEX_PATH,
  buildEmbeddingIndex,
  getEmbeddingDimensions,
  getEmbeddingModelName,
  validateRouteExamples
} = require('../src/services/routeEmbeddings');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

async function main() {
  const examplesPath = path.resolve(process.argv[2] || DEFAULT_EXAMPLES_PATH);
  const indexPath = path.resolve(process.argv[3] || DEFAULT_INDEX_PATH);
  const examples = validateRouteExamples(examplesPath);

  if (examples.length === 0) {
    throw new Error(`No route examples found at ${examplesPath}`);
  }

  const index = await buildEmbeddingIndex({
    examplesPath,
    model: getEmbeddingModelName(),
    dimensions: getEmbeddingDimensions()
  });

  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(`ok wrote ${index.examples.length} route embeddings to ${indexPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
