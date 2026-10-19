import type { MealRepository } from './mealRepository';

export const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Entry = { name: string; kind: 'file' | 'directory' | 'other' };

export interface PhotoRecoveryFiles {
  list(): Promise<readonly Entry[]>;
  listContents(id: string): Promise<readonly Entry[]>;
  removeDirectory(id: string): Promise<void>;
}

export type PhotoRecoveryResult = {
  removed: number;
  failed: number;
  status: 'complete' | 'database-unavailable' | 'storage-unavailable' | 'preview-skipped';
};

// Run once before exposing the meal service. A reference snapshot is unsafe while a new save can copy files.
export async function recoverUnreferencedPhotos(
  repository: Pick<MealRepository, 'list'>,
  files: PhotoRecoveryFiles,
): Promise<PhotoRecoveryResult> {
  let referenced: Set<string>;
  try {
    const meals = await repository.list();
    referenced = new Set(meals.flatMap((meal) => meal.photo ? [meal.photo.id.toLowerCase()] : []));
  } catch {
    // An unreadable database must never be mistaken for an empty collection.
    return { removed: 0, failed: 0, status: 'database-unavailable' };
  }

  let entries: readonly Entry[];
  try {
    entries = await files.list();
  } catch {
    return { removed: 0, failed: 0, status: 'storage-unavailable' };
  }

  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.kind !== 'directory' || !PHOTO_ID.test(entry.name) || referenced.has(entry.name.toLowerCase())) continue;
    try {
      const contents = await files.listContents(entry.name);
      // Empty/partially copied photo directories are recoverable too. Preserve anything outside our exact layout.
      if (contents.some((file) => file.kind !== 'file' || !['main.jpg', 'thumbnail.jpg'].includes(file.name))) continue;
      await files.removeDirectory(entry.name);
      removed += 1;
    } catch {
      // A failed deletion can retry at the next launch; it must not block the diary.
      failed += 1;
    }
  }
  return { removed, failed, status: 'complete' };
}
