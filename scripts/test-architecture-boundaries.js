const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(REPO_ROOT, 'src');

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listJavaScriptFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

function relative(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

function requireTargets(source) {
  const targets = [];
  const pattern = /require\(['"]([^'"]+)['"]\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    targets.push(match[1]);
  }
  return targets;
}

function testOnlyLegacyAdapterImportsController() {
  const allowed = new Set(['src/adapters/legacyControllerHandlers.js']);
  const offenders = listJavaScriptFiles(SOURCE_ROOT)
    .filter((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return requireTargets(source).some((target) => target.includes('core/controller'));
    })
    .map(relative)
    .filter((filePath) => !allowed.has(filePath));

  assert.deepEqual(offenders, []);
}

function testCommandAdaptersReceiveRouterByInjection() {
  const commandDirectory = path.join(SOURCE_ROOT, 'commands');
  const offenders = listJavaScriptFiles(commandDirectory)
    .filter((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return requireTargets(source).some((target) => (
        target.includes('core/controller') ||
        target.includes('application/incomingEventRouter')
      ));
    })
    .map(relative);

  assert.deepEqual(offenders, []);
}

function testWhatsAppAdapterReceivesRouterByInjection() {
  const source = fs.readFileSync(path.join(SOURCE_ROOT, 'channels/whatsapp/webhook.js'), 'utf8');
  const targets = requireTargets(source);

  assert.equal(targets.some((target) => target.includes('core/controller')), false);
  assert.equal(targets.some((target) => target.includes('application/incomingEventRouter')), false);
}

testOnlyLegacyAdapterImportsController();
testCommandAdaptersReceiveRouterByInjection();
testWhatsAppAdapterReceivesRouterByInjection();

console.log('ok');
