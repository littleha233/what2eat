import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Uses existing simulator-native libraries. It never touches the production app container.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const device = process.env.STORAGE_SMOKE_DEVICE;
const baseApp = process.env.STORAGE_SMOKE_BASE_APP;
if (!device || !baseApp) throw new Error('Set STORAGE_SMOKE_DEVICE to a dedicated simulator UUID and STORAGE_SMOKE_BASE_APP to an existing Release simulator .app');
const bundleId = 'com.littleha233.what2eat.storagecheck';
const output = join(root, 'local-data', `native-storage-smoke-${Date.now()}`);
mkdirSync(output, { recursive: true });
writeFileSync(join(root, 'local-data', 'native-storage-fixture.json'), JSON.stringify({ base64: readFileSync(join(root, 'scripts', 'fixtures', 'storage-photo.jpg')).toString('base64') }));
const app = join(output, 'StorageCheck.app');
cpSync(baseApp, app, { recursive: true });
const cli = (command, args, options = {}) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...options }).trim();
const manifest = JSON.parse(cli('xcrun', ['simctl', 'list', 'devices', '--json']));
const target = Object.values(manifest.devices).flat().find((entry) => entry.udid === device);
if (!target?.name.includes('Storage Check')) throw new Error('Refusing to run on a simulator not named Storage Check');
try { cli('xcrun', ['simctl', 'boot', device]); } catch (error) { if (target.state !== 'Booted') throw error; }
cli('xcrun', ['simctl', 'bootstatus', device, '-b']);
console.log(`Building isolated storage entry in ${output}`);
const exportLog = cli(join(root, 'node_modules', '.bin', 'expo'), ['export:embed', '--entry-file', 'scripts/native-storage-smoke-entry.tsx', '--platform', 'ios', '--dev', 'false', '--minify', 'false', '--bundle-output', join(app, 'main.jsbundle'), '--assets-dest', app]);
writeFileSync(join(output, 'bundle.log'), exportLog);
cli('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${bundleId}`, join(app, 'Info.plist')]);
cli('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleDisplayName Storage Check', join(app, 'Info.plist')]);
cli('codesign', ['--force', '--sign', '-', app]);
// Reset only this script's own test bundle, after validating the dedicated simulator name above.
try { cli('xcrun', ['simctl', 'uninstall', device, bundleId]); } catch { /* First run has no prior test app. */ }
cli('xcrun', ['simctl', 'install', device, app]);
const container = cli('xcrun', ['simctl', 'get_app_container', device, bundleId, 'data']);
const phase1 = join(container, 'Documents', 'storage-smoke-phase1.json');
const final = join(container, 'Documents', 'storage-smoke-result.json');
if (existsSync(phase1) || existsSync(final)) throw new Error('This dedicated test container already has results; use a fresh Storage Check simulator');
const waitFor = async (path) => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (existsSync(final)) {
      const result = JSON.parse(readFileSync(final, 'utf8'));
      if (result.status === 'failed') throw new Error(`Native storage check failed: ${result.error}`);
    }
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Timed out waiting for ${path}`);
};
console.log(cli('xcrun', ['simctl', 'launch', '--stdout=' + join(output, 'stdout.log'), '--stderr=' + join(output, 'stderr.log'), device, bundleId]));
const initial = await waitFor(phase1);
writeFileSync(join(output, 'phase1.json'), JSON.stringify(initial, null, 2));
console.log('Phase 1 saved native photo files and removed the temporary source; terminating the process.');
cli('xcrun', ['simctl', 'terminate', device, bundleId]);
console.log(cli('xcrun', ['simctl', 'launch', '--stdout=' + join(output, 'restart-stdout.log'), '--stderr=' + join(output, 'restart-stderr.log'), device, bundleId]));
const completed = await waitFor(final);
const sources = ['src/storage/photos.ts', 'src/storage/photoRecovery.ts', 'src/storage/runtime.ts', 'src/storage/mealRepository.ts', 'src/core/mealService.ts'];
const sourceHashes = Object.fromEntries(sources.map((path) => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
writeFileSync(join(output, 'result.json'), JSON.stringify({ ...completed, simulator: { id: device, name: target.name }, bundleId, sourceHashes, evidence: output }, null, 2));
cli('xcrun', ['simctl', 'terminate', device, bundleId]);
console.log(JSON.stringify({ status: completed.status, checks: completed.checks, evidence: join(output, 'result.json') }, null, 2));
