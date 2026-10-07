import { MealError, type Meal, type MealType, type Photo } from '../core/meals';

type BindValue = string | number | null;

export interface MealDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: BindValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, ...params: BindValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: BindValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

type MealRow = {
  id: string; eaten_at: string; description: string; restaurant: string;
  meal_type: MealType; notes: string; photo_id: string | null;
  photo_width: number | null; photo_height: number | null;
  created_at: string; updated_at: string; revision: number;
};
type PhotoRow = { id: string; width: number; height: number };

function fromRow(row: MealRow): Meal {
  return {
    id: row.id, eatenAt: row.eaten_at, description: row.description,
    restaurant: row.restaurant, mealType: row.meal_type, notes: row.notes,
    photo: row.photo_id ? { id: row.photo_id, width: row.photo_width!, height: row.photo_height! } : null,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision,
  };
}

export function createMealRepository(db: MealDatabase) {
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  }
  async function transaction<T>(task: () => Promise<T>): Promise<T> {
    let result!: T;
    await db.withTransactionAsync(async () => { result = await task(); });
    return result;
  }
  async function get(id: string): Promise<Meal | null> {
    const row = await db.getFirstAsync<MealRow>('SELECT * FROM meals WHERE id = ?', id);
    return row ? fromRow(row) : null;
  }
  async function deleted(id: string) {
    return !!await db.getFirstAsync<{ id: string }>('SELECT id FROM deleted_meals WHERE id = ?', id);
  }
  async function enqueuePhoto(photo: Photo) {
    await db.runAsync('INSERT OR IGNORE INTO photo_cleanup (id, width, height) VALUES (?, ?, ?)', photo.id, photo.width, photo.height);
  }
  async function unavailable(id: string): Promise<never> {
    if (await deleted(id)) throw new MealError('DELETED', '这条记录已经删除，请返回首页。');
    throw new MealError('NOT_FOUND', '找不到这条记录，请返回首页。');
  }

  return {
    initialize: () => exclusive(async () => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS meals (
          id TEXT PRIMARY KEY NOT NULL,
          eaten_at TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          restaurant TEXT NOT NULL DEFAULT '',
          meal_type TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          photo_id TEXT,
          photo_width INTEGER,
          photo_height INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          CHECK (length(trim(description)) > 0 OR photo_id IS NOT NULL)
        );
        CREATE INDEX IF NOT EXISTS meals_eaten_at ON meals (eaten_at DESC);
        CREATE INDEX IF NOT EXISTS meals_photo_id ON meals (photo_id);
        CREATE TABLE IF NOT EXISTS deleted_meals (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE IF NOT EXISTS photo_cleanup (
          id TEXT PRIMARY KEY NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL
        );
        PRAGMA user_version = 1;
      `);
    }),
    // Expo transactions share this connection. Reads must wait too, so reloads cannot expose a write that later rolls back.
    get: (id: string): Promise<Meal | null> => exclusive(() => get(id)),
    isDeleted: (id: string): Promise<boolean> => exclusive(() => deleted(id)),
    list: (): Promise<Meal[]> => exclusive(async () => (await db.getAllAsync<MealRow>(
      'SELECT * FROM meals ORDER BY eaten_at DESC, created_at DESC, id ASC',
    )).map(fromRow)),
    insert: (meal: Meal): Promise<Meal> => exclusive(() => transaction(async () => {
      if (await deleted(meal.id)) throw new MealError('DELETED', '这条记录已经删除，请新建一餐。');
      const existing = await get(meal.id);
      if (existing) return existing;
      await db.runAsync(`INSERT INTO meals
        (id, eaten_at, description, restaurant, meal_type, notes, photo_id, photo_width, photo_height, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      meal.id, meal.eatenAt, meal.description, meal.restaurant, meal.mealType, meal.notes,
      meal.photo?.id ?? null, meal.photo?.width ?? null, meal.photo?.height ?? null,
      meal.createdAt, meal.updatedAt, meal.revision);
      return meal;
    })),
    update: (meal: Meal, expectedRevision: number): Promise<Meal> => exclusive(() => transaction(async () => {
      const old = await get(meal.id);
      if (!old) return unavailable(meal.id);
      if (old.revision !== expectedRevision) throw new MealError('CONFLICT', '记录已发生变化，请返回详情重新编辑。');
      const next = { ...meal, createdAt: old.createdAt, revision: expectedRevision + 1 };
      const result = await db.runAsync(`UPDATE meals SET eaten_at = ?, description = ?, restaurant = ?,
        meal_type = ?, notes = ?, photo_id = ?, photo_width = ?, photo_height = ?, updated_at = ?, revision = ?
        WHERE id = ? AND revision = ?`, next.eatenAt, next.description, next.restaurant,
      next.mealType, next.notes, next.photo?.id ?? null, next.photo?.width ?? null, next.photo?.height ?? null,
      next.updatedAt, next.revision, next.id, expectedRevision);
      if (result.changes !== 1) throw new MealError('CONFLICT', '记录已发生变化，请返回详情重新编辑。');
      if (old.photo && old.photo.id !== next.photo?.id) await enqueuePhoto(old.photo);
      return next;
    })),
    remove: (id: string, expectedRevision: number): Promise<void> => exclusive(() => transaction(async () => {
      const old = await get(id);
      if (!old) {
        if (await deleted(id)) return;
        return unavailable(id);
      }
      if (old.revision !== expectedRevision) throw new MealError('CONFLICT', '记录已发生变化，请重新查看后再删除。');
      const result = await db.runAsync('DELETE FROM meals WHERE id = ? AND revision = ?', id, expectedRevision);
      if (result.changes !== 1) throw new MealError('CONFLICT', '记录已发生变化，请重新查看后再删除。');
      await db.runAsync('INSERT OR IGNORE INTO deleted_meals (id) VALUES (?)', id);
      if (old.photo) await enqueuePhoto(old.photo);
    })),
    queuePhotoCleanup: (photo: Photo) => exclusive(() => enqueuePhoto(photo)),
    cleanupPhotos: (remove: (photo: Photo) => Promise<void>): Promise<number> => exclusive(async () => {
      const pending = await db.getAllAsync<PhotoRow>('SELECT id, width, height FROM photo_cleanup');
      for (const photo of pending) {
        const reference = await db.getFirstAsync<{ id: string }>('SELECT id FROM meals WHERE photo_id = ? LIMIT 1', photo.id);
        if (reference) continue;
        try {
          // Keep the durable queue entry until deletion succeeds; never sweep arbitrary files.
          await remove(photo);
          await db.runAsync('DELETE FROM photo_cleanup WHERE id = ?', photo.id);
        } catch {
          // Cleanup retries at startup and after the next mutation; committed meals remain valid.
        }
      }
      const remaining = await db.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM photo_cleanup');
      return remaining?.count ?? 0;
    }),
  };
}

export type MealRepository = ReturnType<typeof createMealRepository>;
