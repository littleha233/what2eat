import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createMealRepository, type MealDatabase } from '../src/storage/mealRepository';
import { createMealService, type PhotoStore } from '../src/core/mealService';
import { draftFromMeal, MealError, type MealDraft, type Photo } from '../src/core/meals';

// The production SQL runs against an actual file-backed SQLite DB here. This is host integration evidence, not native image-picker evidence.
class HostDatabase implements MealDatabase {
  readonly connection: DatabaseSync;
  closed = false;
  constructor(path: string) { this.connection = new DatabaseSync(path); }
  async execAsync(sql: string) { this.connection.exec(sql); }
  async runAsync(sql: string, ...params: (string | number | null)[]) {
    const result = this.connection.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  }
  async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null> {
    return this.connection.prepare(sql).get(...params) as T | undefined ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]> {
    return this.connection.prepare(sql).all(...params) as T[];
  }
  async withTransactionAsync(task: () => Promise<void>) {
    this.connection.exec('BEGIN IMMEDIATE');
    try { await task(); this.connection.exec('COMMIT'); }
    catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  close() { if (!this.closed) this.connection.close(); this.closed = true; }
}

const clock = () => new Date('2026-10-07T13:00:00.000Z');
const draft = (id: string, overrides: Partial<MealDraft> = {}): MealDraft => ({
  id, eatenAt: '2026-10-07T04:00:00.000Z', description: '', restaurant: '', mealType: '', notes: '',
  existingPhoto: null, newPhotoUri: null, ...overrides,
});

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'what2eat-record-test-'));
  await mkdir(join(directory, 'photos'));
  const path = join(directory, 'meals.sqlite');
  const source = join(directory, 'picker-temporary-file');
  await writeFile(source, 'host-test-image-bytes');
  const dbs: HostDatabase[] = [];
  const connect = () => { const db = new HostDatabase(path); dbs.push(db); return db; };
  const db = connect();
  const repository = createMealRepository(db);
  await repository.initialize();
  let saved = 0;
  let persistFails = false;
  let deleteFails = false;
  const removed: string[] = [];
  const photoPath = (photo: Photo) => join(directory, 'photos', `${photo.id}.jpg`);
  const photos: PhotoStore = {
    async persist(uri) {
      if (persistFails) throw new Error('Image write failed');
      const photo = { id: `photo-${++saved}`, width: 960, height: 720 };
      await copyFile(uri, photoPath(photo));
      return photo;
    },
    async remove(photo) {
      if (deleteFails) throw new Error('Image delete failed');
      await unlink(photoPath(photo)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      removed.push(photo.id);
    },
  };
  const service = createMealService(repository, photos, clock);
  t.after(async () => { for (const connection of dbs) connection.close(); await rm(directory, { recursive: true, force: true }); });
  return { db, repository, source, service, photos, photoPath, connect, removed,
    saved: () => saved, failPersist: (value: boolean) => { persistFails = value; },
    failDelete: (value: boolean) => { deleteFails = value; } };
}

test('a photo alone saves; text-only saves; a restaurant or notes alone cannot create an empty record', async (t) => {
  const f = await setup(t);
  const photo = await f.service.save(draft('photo', { newPhotoUri: f.source }));
  assert.ok(photo.photo);
  assert.equal(photo.description, '');
  const text = await f.service.save(draft('text', { description: '  番茄面  ' }));
  assert.equal(text.description, '番茄面');
  assert.equal(text.photo, null);
  await assert.rejects(f.service.save(draft('empty', { restaurant: '餐馆', notes: '备注' })),
    (error: unknown) => error instanceof MealError && error.code === 'INVALID');
  assert.equal((await f.service.list()).length, 2);
});

test('SQLite reopen preserves text, IDs, timestamps and file references after picker temporary file removal', async (t) => {
  const f = await setup(t);
  const saved = await f.service.save(draft('persisted', { newPhotoUri: f.source, description: '面', restaurant: '小店', mealType: '午餐' }));
  await unlink(f.source);
  f.db.close();
  const reopened = createMealRepository(f.connect());
  await reopened.initialize();
  const recovered = await reopened.get('persisted');
  assert.deepEqual(recovered, saved);
  assert.equal(await readFile(f.photoPath(recovered!.photo!), 'utf8'), 'host-test-image-bytes');
});

test('repeated clicks share one save and retries of a completed create remain idempotent', async (t) => {
  const f = await setup(t);
  const input = draft('stable-id', { newPhotoUri: f.source });
  const first = f.service.save(input);
  const second = f.service.save(input);
  assert.equal(first, second);
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  const retry = await f.service.save(input);
  assert.deepEqual(retry, a);
  assert.equal(f.saved(), 1);
  assert.equal((await f.service.list()).length, 1);
});

test('different IDs allow multiple independent records in the same meal slot', async (t) => {
  const f = await setup(t);
  await f.service.save(draft('a', { description: '面', mealType: '午餐' }));
  await f.service.save(draft('b', { description: '水果', mealType: '午餐' }));
  assert.equal((await f.service.list()).length, 2);
});

test('photo persistence failure leaves no row and the unchanged draft can retry successfully', async (t) => {
  const f = await setup(t);
  const input = draft('retry', { newPhotoUri: f.source, notes: '保留输入' });
  f.failPersist(true);
  await assert.rejects(f.service.save(input), /Image write failed/);
  assert.equal((await f.service.list()).length, 0);
  assert.equal(input.notes, '保留输入');
  assert.equal(input.newPhotoUri, f.source);
  f.failPersist(false);
  assert.equal((await f.service.save(input)).notes, '保留输入');
  assert.equal((await f.service.list()).length, 1);
});

test('SQL insertion failure rolls back the row, reclaims the new photo and allows retry with the same ID', async (t) => {
  const f = await setup(t);
  await f.db.execAsync("CREATE TRIGGER reject_insert BEFORE INSERT ON meals BEGIN SELECT RAISE(ABORT, 'Disk unavailable'); END");
  const input = draft('retry-sql', { newPhotoUri: f.source });
  await assert.rejects(f.service.save(input), /Disk unavailable/);
  assert.equal((await f.service.list()).length, 0);
  assert.deepEqual(f.removed, ['photo-1']);
  await f.db.execAsync('DROP TRIGGER reject_insert');
  assert.equal((await f.service.save(input)).id, 'retry-sql');
  assert.equal((await f.service.list()).length, 1);
});

test('editing date, fields and replacing/removing a photo updates the same record and cleans old files', async (t) => {
  const f = await setup(t);
  const original = await f.service.save(draft('edit', { newPhotoUri: f.source }));
  const edited = await f.service.save({ ...draftFromMeal(original), eatenAt: '2026-09-01T04:00:00.000Z',
    description: '炒饭', restaurant: '小店', notes: '补记', mealType: '午餐', newPhotoUri: f.source }, original.revision);
  assert.equal(edited.id, original.id);
  assert.equal(edited.createdAt, original.createdAt);
  assert.equal(edited.revision, 2);
  assert.equal(edited.eatenAt, '2026-09-01T04:00:00.000Z');
  assert.equal((await f.service.list())[0]?.notes, '补记');
  assert.deepEqual(f.removed, ['photo-1']);
  assert.equal(await readFile(f.photoPath(edited.photo!), 'utf8'), 'host-test-image-bytes');
  const textOnly = await f.service.save({ ...draftFromMeal(edited), removePhoto: true }, edited.revision);
  assert.equal(textOnly.photo, null);
  assert.deepEqual(f.removed, ['photo-1', 'photo-2']);
  assert.equal((await f.service.list()).length, 1);
});

test('failed replacement leaves the previous row and photo intact and cleans the uncommitted new image', async (t) => {
  const f = await setup(t);
  const original = await f.service.save(draft('replace-fail', { newPhotoUri: f.source }));
  await f.db.execAsync("CREATE TRIGGER reject_update BEFORE UPDATE ON meals BEGIN SELECT RAISE(ABORT, 'Update failed'); END");
  await assert.rejects(f.service.save({ ...draftFromMeal(original), newPhotoUri: f.source }, original.revision), /Update failed/);
  assert.deepEqual(await f.repository.get(original.id), original);
  assert.equal(await readFile(f.photoPath(original.photo!), 'utf8'), 'host-test-image-bytes');
  assert.deepEqual(f.removed, ['photo-2']);
});

test('stale edits cannot overwrite changes; stale deletes cannot remove a newer revision', async (t) => {
  const f = await setup(t);
  const original = await f.service.save(draft('versions', { description: '旧内容' }));
  const changed = await f.service.save({ ...draftFromMeal(original), description: '新内容' }, 1);
  await assert.rejects(f.service.save({ ...draftFromMeal(original), description: '迟到旧编辑' }, 1),
    (error: unknown) => error instanceof MealError && error.code === 'CONFLICT');
  await assert.rejects(f.service.remove(original.id, 1),
    (error: unknown) => error instanceof MealError && error.code === 'CONFLICT');
  assert.deepEqual(await f.repository.get(original.id), changed);
});

test('concurrent editors preserve the winning revision and clean only the losing new photo', async (t) => {
  const f = await setup(t);
  const original = await f.service.save(draft('race', { description: '原始' }));
  const otherService = createMealService(f.repository, f.photos, clock);
  const results = await Promise.allSettled([
    f.service.save({ ...draftFromMeal(original), description: '编辑一', newPhotoUri: f.source }, 1),
    otherService.save({ ...draftFromMeal(original), description: '编辑二', newPhotoUri: f.source }, 1),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const kept = await f.repository.get(original.id);
  assert.equal(kept?.revision, 2);
  assert.equal(f.removed.length, 1);
  assert.notEqual(f.removed[0], kept?.photo?.id);
  assert.equal(await readFile(f.photoPath(kept!.photo!), 'utf8'), 'host-test-image-bytes');
});

test('deletion removes the row, is repeatable and cannot be undone by late create/edit retries even after reopening', async (t) => {
  const f = await setup(t);
  const original = await f.service.save(draft('deleted', { newPhotoUri: f.source }));
  await f.service.remove(original.id, original.revision);
  await f.service.remove(original.id, original.revision);
  assert.equal((await f.service.list()).length, 0);
  assert.deepEqual(f.removed, ['photo-1']);
  f.db.close();
  const reopened = createMealRepository(f.connect());
  await reopened.initialize();
  const service = createMealService(reopened, f.photos, clock);
  await assert.rejects(service.save(draft('deleted', { description: '迟到创建' })),
    (error: unknown) => error instanceof MealError && error.code === 'DELETED');
  await assert.rejects(service.save(draftFromMeal(original), 1),
    (error: unknown) => error instanceof MealError && error.code === 'DELETED');
  assert.deepEqual(await service.list(), []);
});

test('a database failure partway through deletion rolls back the row and keeps its photo available', async (t) => {
  const f = await setup(t);
  const original = await f.service.save(draft('delete-failure', { newPhotoUri: f.source }));
  await f.db.execAsync("CREATE TRIGGER reject_tombstone BEFORE INSERT ON deleted_meals BEGIN SELECT RAISE(ABORT, 'Delete failed'); END");
  await assert.rejects(f.service.remove(original.id, original.revision), /Delete failed/);
  assert.deepEqual(await f.repository.get(original.id), original);
  assert.equal(await f.repository.isDeleted(original.id), false);
  assert.equal(await readFile(f.photoPath(original.photo!), 'utf8'), 'host-test-image-bytes');
  assert.deepEqual(f.removed, []);
  await f.db.execAsync('DROP TRIGGER reject_tombstone');
  await f.service.remove(original.id, original.revision);
  assert.equal(await f.repository.get(original.id), null);
});

for (const rollback of [false, true]) {
  test(`concurrent get/list/isDeleted reads wait for a write transaction to ${rollback ? 'roll back' : 'commit'}`, async (t) => {
    const f = await setup(t);
    const original = await f.service.save(draft('read-isolation', { description: '保留到事务完成' }));
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const execute = f.db.runAsync.bind(f.db);
    f.db.runAsync = async (sql, ...params) => {
      const result = await execute(sql, ...params);
      if (sql.startsWith('INSERT OR IGNORE INTO deleted_meals')) {
        enter();
        await gate;
        if (rollback) throw new Error('Transaction interrupted');
      }
      return result;
    };
    const deletion = f.service.remove(original.id, original.revision)
      .then(() => null, (error: unknown) => error);
    await entered;
    // The row is deleted and its tombstone exists on the shared SQLite connection, but neither change has committed.
    let settled = 0;
    const track = <T>(promise: Promise<T>) => promise.then((result) => { settled += 1; return result; });
    const single = track(f.repository.get(original.id));
    const list = track(f.service.list());
    const isDeleted = track(f.repository.isDeleted(original.id));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, 0);
    release();
    const error = await deletion;
    if (rollback) assert.match(String(error), /Transaction interrupted/);
    else assert.equal(error, null);
    assert.deepEqual(await single, rollback ? original : null);
    assert.deepEqual(await list, rollback ? [original] : []);
    assert.equal(await isDeleted, !rollback);
    assert.equal(settled, 3);
  });
}

test('photo cleanup failure does not undo a successful delete; its persistent queue retries after DB reopening', async (t) => {
  const f = await setup(t);
  const original = await f.service.save(draft('cleanup', { newPhotoUri: f.source }));
  f.failDelete(true);
  await f.service.remove(original.id, original.revision);
  assert.deepEqual(await f.service.list(), []);
  assert.equal(await f.service.retryPhotoCleanup(), 1);
  f.db.close();
  const reopened = createMealRepository(f.connect());
  await reopened.initialize();
  const service = createMealService(reopened, f.photos, clock);
  f.failDelete(false);
  assert.equal(await service.retryPhotoCleanup(), 0);
  assert.deepEqual(f.removed, ['photo-1']);
});

test('a photo referenced by another record remains until its last reference is deleted', async (t) => {
  const f = await setup(t);
  const first = await f.service.save(draft('first', { newPhotoUri: f.source }));
  const second = await f.service.save(draft('second', { existingPhoto: first.photo }));
  await f.service.remove(first.id, first.revision);
  assert.deepEqual(f.removed, []);
  assert.equal(await readFile(f.photoPath(second.photo!), 'utf8'), 'host-test-image-bytes');
  await f.service.remove(second.id, second.revision);
  assert.deepEqual(f.removed, ['photo-1']);
});

test('deleting a photo-only record in the editor requires adding a description before saving', async (t) => {
  const f = await setup(t);
  const original = await f.service.save(draft('photo-only', { newPhotoUri: f.source }));
  await assert.rejects(f.service.save({ ...draftFromMeal(original), removePhoto: true }, original.revision),
    (error: unknown) => error instanceof MealError && error.code === 'INVALID');
  assert.deepEqual(await f.repository.get(original.id), original);
  assert.deepEqual(f.removed, []);
});

test('invalid/future times are rejected and a draft mutation during save cannot alter the save snapshot', async (t) => {
  const f = await setup(t);
  await assert.rejects(f.service.save(draft('invalid', { description: '面', eatenAt: 'not a date' })), MealError);
  await assert.rejects(f.service.save(draft('future', { description: '面', eatenAt: '2026-10-08T04:00:00Z' })), MealError);
  const input = draft('snapshot', { description: '原内容' });
  const pending = f.service.save(input);
  input.description = '修改后的输入';
  assert.equal((await pending).description, '原内容');
  assert.equal(input.description, '修改后的输入');
});
