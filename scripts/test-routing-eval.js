#!/usr/bin/env node

const dotenv = require('dotenv');
const path = require('node:path');
const {
  DEFAULT_EXAMPLES_PATH,
  DEFAULT_INDEX_PATH,
  decideRouteMatch,
  embedTexts,
  loadEmbeddingIndex,
  scoreEmbeddingIndex,
  validateRouteExamples
} = require('../src/services/routeEmbeddings');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

async function main() {
  const examplesPath = path.resolve(process.argv[2] || DEFAULT_EXAMPLES_PATH);
  const indexPath = path.resolve(process.argv[3] || DEFAULT_INDEX_PATH);
  const examples = validateRouteExamples(examplesPath);
  const index = loadEmbeddingIndex(indexPath);

  if (!index) {
    throw new Error(`Missing embedding index at ${indexPath}. Run: npm run routing:embed`);
  }

  const failures = [];
  const embeddings = await embedTexts(examples.map((example) => example.text), {
    model: index.model,
    dimensions: index.dimensions
  });

  for (let indexNumber = 0; indexNumber < examples.length; indexNumber += 1) {
    const example = examples[indexNumber];
    const embedding = embeddings[indexNumber];
    const matches = scoreEmbeddingIndex(embedding, index, { topK: 8 });
    const decision = decideRouteMatch(matches);
    const top = matches[0];
    if (top?.routeId !== example.routeId || top?.expectedFamily !== example.expectedFamily) {
      failures.push({
        id: example.id,
        expectedRouteId: example.routeId,
        actualRouteId: top?.routeId || null,
        expectedFamily: example.expectedFamily,
        actualFamily: top?.expectedFamily || null,
        score: top?.score || 0,
        decision: decision.reason
      });
    }
  }

  if (failures.length > 0) {
    process.stderr.write(JSON.stringify(failures.slice(0, 20), null, 2));
    process.stderr.write(`\nfailed routing eval: ${failures.length}/${examples.length} rows failed\n`);
    process.exit(1);
  }

  process.stdout.write(`ok routing eval ${examples.length} rows\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
