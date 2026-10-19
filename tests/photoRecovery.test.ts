import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { Meal, Photo } from '../src/core/meals';
import { createMealRepository, type MealDatabase } from '../src/storage/mealRepository';
import { recoverUnreferencedPhotos, type PhotoRecoveryFiles } from '../src/storage/photoRecovery';

class HostDatabase implements MealDatabase {
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(path: string) { this.db = new DatabaseSync(path); }
  async execAsync(sql: string) { this.db.exec(sql); }
  async runAsync(sql: string, ...params: (string | number | null)[]) {
    return { changes: Number(this.db.prepare(sql).run(...params).changes) };
  }
  async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null> {
    return this.db.prepare(sql).get(...params) as T | undefined ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async withTransactionAsync(task: () => Promise<void>) {
    this.db.exec('BEGIN IMMEDIATE');
    try { await task(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { if (!this.closed) this.db.close(); this.closed = true; }
}

const id = (last: number) => `12345678-1234-4123-8123-${String(last).padStart(12, '0')}`;
const photo = (last: number): Photo => ({ id: id(last), width: 960, height: 720 });
const meal = (value: Photo, mealId = 'committed'): Meal => ({
  id: mealId, eatenAt: '2026-10-19T04:00:00.000Z', description: '', restaurant: '', mealType: '', notes: '',
  photo: value, createdAt: '2026-10-19T04:00:00.000Z', updatedAt: '2026-10-19T04:00:00.000Z', revision: 1,
});

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'what2eat-recovery-test-'));
  const root = join(directory, 'meal-photos');
  const path = join(directory, 'meals.sqlite');
  await mkdir(root);
  const connections: HostDatabase[] = [];
  const connect = () => { const db = new HostDatabase(path); connections.push(db); return db; };
  const db = connect();
  const repository = createMealRepository(db);
  await repository.initialize();
  const listEntries = async (path: string) => (await readdir(path, { withFileTypes: true })).map((entry) => ({
    name: entry.name,
    kind: entry.isDirectory() ? 'directory' as const : entry.isFile() ? 'file' as const : 'other' as const,
  }));
  const files: PhotoRecoveryFiles = {
    list: () => listEntries(root),
    listContents: (name) => listEntries(join(root, name)),
    removeDirectory: (name) => rm(join(root, name), { recursive: true, force: true }),
  };
  const addPhoto = async (name: string, filenames = ['main.jpg', 'thumbnail.jpg']) => {
    await mkdir(join(root, name));
    for (const filename of filenames) await writeFile(join(root, name, filename), `${name}:${filename}`);
  };
  const names = () => readdir(root);
  t.after(async () => { for (const connection of connections) connection.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, root, path, db, repository, files, addPhoto, names, connect };
}

test('startup after a killed SQLite writer reclaims its copied photo but preserves committed references and bytes', async (t) => {
  const f = await setup(t);
  await f.addPhoto(id(1));
  await f.repository.insert(meal(photo(1)));
  f.db.close();
  // The child really copies files, starts an uncommitted production-table write, then receives SIGKILL.
  // This tests host file/SQLite crash recovery; it does not replace native image processing or device restart evidence.
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const [path, root, photoId] = process.argv.slice(1);
    const directory = join(root, photoId);
    mkdirSync(directory);
    writeFileSync(join(directory, 'main.jpg'), 'copied before commit');
    writeFileSync(join(directory, 'thumbnail.jpg'), 'thumbnail before commit');
    const db = new DatabaseSync(path);
    db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO meals SELECT ?, eaten_at, description, restaurant, meal_type, notes, ?, photo_width, photo_height, created_at, updated_at, revision FROM meals WHERE id = 'committed'")
      .run('uncommitted', photoId);
    process.kill(process.pid, 'SIGKILL');
  `;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, f.path, f.root, id(2)], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal === 'SIGKILL') resolve();
      else reject(new Error(`Crash fixture exited unexpectedly: ${code}/${signal}`));
    });
  });
  const reopened = createMealRepository(f.connect());
  await reopened.initialize();
  assert.equal((await reopened.list()).length, 1);
  assert.deepEqual(await recoverUnreferencedPhotos(reopened, f.files), { removed: 1, failed: 0, status: 'complete' });
  assert.deepEqual(await f.names(), [id(1)]);
  assert.equal(await readFile(join(f.root, id(1), 'main.jpg'), 'utf8'), `${id(1)}:main.jpg`);
  assert.deepEqual(await reopened.get('committed'), meal(photo(1)));
  assert.equal(await reopened.get('uncommitted'), null);
  assert.deepEqual(await recoverUnreferencedPhotos(reopened, f.files), { removed: 0, failed: 0, status: 'complete' });
});

test('only unreferenced UUIDv4 directories with the exact managed layout are reclaimed, including partial copies', async (t) => {
  const f = await setup(t);
  await f.addPhoto(id(1));
  await f.addPhoto(id(2), ['main.jpg']);
  await f.addPhoto(id(3), []);
  await f.addPhoto(id(4), ['main.jpg', 'private-note.txt']);
  await f.addPhoto('not-a-photo', ['main.jpg']);
  await f.addPhoto(id(5), []);
  await mkdir(join(f.root, id(5), 'main.jpg'));
  await writeFile(join(f.root, id(6)), 'root file, not a photo directory');
  await f.addPhoto('abcdefab-abcd-4abc-8abc-abcdefabcdef');
  await f.repository.insert(meal({ ...photo(7), id: 'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF' }));
  await writeFile(join(f.directory, 'picker-original.jpg'), 'untouched source');
  assert.deepEqual(await recoverUnreferencedPhotos(f.repository, f.files), { removed: 3, failed: 0, status: 'complete' });
  assert.deepEqual((await f.names()).sort(), [id(4), id(5), id(6), 'not-a-photo', 'abcdefab-abcd-4abc-8abc-abcdefabcdef'].sort());
  assert.equal(await readFile(join(f.directory, 'picker-original.jpg'), 'utf8'), 'untouched source');
});

test('an actual database read failure never lists or deletes any photo files', async (t) => {
  const f = await setup(t);
  await f.addPhoto(id(1));
  await f.db.execAsync('DROP TABLE meals');
  let touched = false;
  const files: PhotoRecoveryFiles = {
    ...f.files,
    async list() { touched = true; return f.files.list(); },
  };
  assert.deepEqual(await recoverUnreferencedPhotos(f.repository, files), { removed: 0, failed: 0, status: 'database-unavailable' });
  assert.equal(touched, false);
  assert.deepEqual(await f.names(), [id(1)]);
});

test('recovery waits for the complete reference snapshot before inspecting any photo directories', async (t) => {
  const f = await setup(t);
  await f.addPhoto(id(1));
  await f.repository.insert(meal(photo(1)));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let touched = false;
  const recovery = recoverUnreferencedPhotos({ async list() { await gate; return f.repository.list(); } }, {
    ...f.files,
    async list() { touched = true; return f.files.list(); },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(touched, false);
  release();
  assert.deepEqual(await recovery, { removed: 0, failed: 0, status: 'complete' });
  assert.deepEqual(await f.names(), [id(1)]);
});

test('unreadable photo roots skip recovery without rejecting initialization or changing files', async (t) => {
  const f = await setup(t);
  await f.addPhoto(id(1));
  assert.deepEqual(await recoverUnreferencedPhotos(f.repository, {
    ...f.files,
    async list() { throw new Error('Directory unavailable'); },
  }), { removed: 0, failed: 0, status: 'storage-unavailable' });
  assert.deepEqual(await f.names(), [id(1)]);
});

test('per-directory read/delete failures preserve those files, allow other cleanup, and retry on the next launch', async (t) => {
  const f = await setup(t);
  for (let n = 1; n <= 4; n += 1) await f.addPhoto(id(n));
  await f.repository.insert(meal(photo(1)));
  assert.deepEqual(await recoverUnreferencedPhotos(f.repository, {
    ...f.files,
    async listContents(name) {
      if (name === id(2)) throw new Error('Directory unreadable');
      return f.files.listContents(name);
    },
    async removeDirectory(name) {
      if (name === id(3)) throw new Error('Deletion unavailable');
      return f.files.removeDirectory(name);
    },
  }), { removed: 1, failed: 2, status: 'complete' });
  assert.deepEqual((await f.names()).sort(), [id(1), id(2), id(3)]);
  assert.deepEqual(await recoverUnreferencedPhotos(f.repository, f.files), { removed: 2, failed: 0, status: 'complete' });
  assert.deepEqual(await f.names(), [id(1)]);
  assert.deepEqual(await f.repository.get('committed'), meal(photo(1)));
});
