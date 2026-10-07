import { MEAL_TYPES, MealError, type Meal, type MealDraft, type Photo } from './meals';
import type { MealRepository } from '../storage/mealRepository';

export interface PhotoStore {
  persist(uri: string): Promise<Photo>;
  remove(photo: Photo): Promise<void>;
}

function validateDraft(draft: MealDraft, now: Date) {
  if (!draft.id.trim()) throw new MealError('INVALID', '记录标识无效，请重新打开新增页面。');
  const date = new Date(draft.eatenAt);
  if (!Number.isFinite(date.getTime())) throw new MealError('INVALID', '请选择有效的就餐时间。');
  if (date.getTime() > now.getTime()) throw new MealError('INVALID', '就餐时间不能晚于当前时间。');
  if (!MEAL_TYPES.includes(draft.mealType)) throw new MealError('INVALID', '请选择有效的餐次。');
  if (!draft.description.trim() && !draft.newPhotoUri && (!draft.existingPhoto || draft.removePhoto)) {
    throw new MealError('INVALID', '请添加一张照片，或写下吃了什么。');
  }
}

export function createMealService(repository: MealRepository, photos: PhotoStore, now: () => Date = () => new Date()) {
  const inFlight = new Map<string, Promise<Meal>>();

  async function retryPhotoCleanup(): Promise<number> {
    try {
      return await repository.cleanupPhotos((photo) => photos.remove(photo));
    } catch {
      // A cleanup/storage read failure must not turn a successful meal commit into a failed save.
      return -1;
    }
  }

  async function cleanupUncommitted(photo: Photo) {
    try {
      await repository.queuePhotoCleanup(photo);
      await retryPhotoCleanup();
    } catch {
      // The database may be unavailable after a failed write. This newly-created file has no committed reference.
      try { await photos.remove(photo); } catch { /* Retain the original save error. */ }
    }
  }

  async function saveOnce(draft: MealDraft, expectedRevision?: number): Promise<Meal> {
    const timestamp = now();
    validateDraft(draft, timestamp);
    const existing = await repository.get(draft.id);
    if (expectedRevision === undefined && existing) return existing;
    if (await repository.isDeleted(draft.id)) throw new MealError('DELETED', '这条记录已经删除，请新建一餐。');
    if (expectedRevision !== undefined && (!existing || existing.revision !== expectedRevision)) {
      throw new MealError(existing ? 'CONFLICT' : 'NOT_FOUND', '记录已发生变化，请返回详情重新编辑。');
    }
    let newPhoto: Photo | null = null;
    try {
      if (draft.newPhotoUri) newPhoto = await photos.persist(draft.newPhotoUri);
      const meal: Meal = {
        id: draft.id, eatenAt: new Date(draft.eatenAt).toISOString(),
        description: draft.description.trim(), restaurant: draft.restaurant.trim(), mealType: draft.mealType,
        notes: draft.notes.trim(), photo: newPhoto ?? (draft.removePhoto ? null : draft.existingPhoto),
        createdAt: existing?.createdAt ?? timestamp.toISOString(), updatedAt: timestamp.toISOString(),
        revision: existing ? existing.revision + 1 : 1,
      };
      const saved = expectedRevision === undefined
        ? await repository.insert(meal) : await repository.update(meal, expectedRevision);
      if (newPhoto && saved.photo?.id !== newPhoto.id) await cleanupUncommitted(newPhoto);
      await retryPhotoCleanup();
      return saved;
    } catch (error) {
      if (newPhoto) await cleanupUncommitted(newPhoto);
      throw error;
    }
  }

  return {
    list: () => repository.list(),
    save: (draft: MealDraft, expectedRevision?: number): Promise<Meal> => {
      const key = `${draft.id}:${expectedRevision ?? 'new'}`;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const snapshot = { ...draft, existingPhoto: draft.existingPhoto ? { ...draft.existingPhoto } : null };
      const result = saveOnce(snapshot, expectedRevision).finally(() => { inFlight.delete(key); });
      inFlight.set(key, result);
      return result;
    },
    remove: async (id: string, revision: number) => {
      await repository.remove(id, revision);
      await retryPhotoCleanup();
    },
    retryPhotoCleanup,
  };
}

export type MealService = ReturnType<typeof createMealService>;
