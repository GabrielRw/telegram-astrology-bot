const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const result = spawnSync(
  process.execPath,
  [path.join(repoRoot, 'scripts/simulate-chat.js'), '--chat', 'codex-batch-regression'],
  {
    cwd: repoRoot,
    input: ['/start', '13/13/1990', '1990-12-01', 'Atlantiszz', 'cancel', '/quit', ''].join('\n'),
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      STRIPE_SECRET_KEY: ''
    }
  }
);

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /Send your birth date in YYYY-MM-DD format/);
assert.match(result.stdout, /Date format should look like 1990-05-15/);
assert.match(result.stdout, /Could not find a city match for "Atlantiszz"/);
assert.match(result.stdout, /Cancelled/);
assert.doesNotMatch(result.stderr, /ERR_USE_AFTER_CLOSE/);

console.log('ok');
