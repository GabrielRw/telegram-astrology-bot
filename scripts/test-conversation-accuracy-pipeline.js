const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const testScripts = [
  'scripts/test-direct-planet-placement.js',
  'scripts/test-artifact-followups.js',
  'scripts/test-canonical-renderers.js',
  'scripts/test-electional-routing-guards.js',
  'scripts/test-electional-followup-render.js',
  'scripts/test-simulator-batch.js'
];

const failures = [];

for (const script of testScripts) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, script)], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    failures.push({
      script,
      stdout: result.stdout,
      stderr: result.stderr
    });
    continue;
  }

  process.stdout.write(`ok ${script}\n`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`\nfailed ${failure.script}\n`);
    if (failure.stdout) {
      process.stderr.write(failure.stdout);
    }
    if (failure.stderr) {
      process.stderr.write(failure.stderr);
    }
  }
  process.exit(1);
}

process.stdout.write('ok conversation accuracy pipeline\n');
