import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageManipulatorContext, type ImageRef } from 'expo-image-manipulator';
import type { PhotoStore } from '../core/mealService';
import type { Photo } from '../core/meals';
import type { MealRepository } from './mealRepository';
import { PHOTO_ID, recoverUnreferencedPhotos, type PhotoRecoveryResult } from './photoRecovery';

function directoryFor(id: string) {
  if (!PHOTO_ID.test(id)) throw new Error('照片标识无效，无法读取或删除。');
  return new Directory(Paths.document, 'meal-photos', id);
}

export function photoUri(photo: Photo, thumbnail = false): string {
  return new File(directoryFor(photo.id), thumbnail ? 'thumbnail.jpg' : 'main.jpg').uri;
}

export async function recoverPhotos(repository: Pick<MealRepository, 'list'>): Promise<PhotoRecoveryResult> {
  try {
    const root = new Directory(Paths.document, 'meal-photos');
    const entries = (directory: Directory) => directory.list().map((entry) => ({
      name: entry.name,
      kind: entry instanceof Directory ? 'directory' as const : 'file' as const,
    }));
    return await recoverUnreferencedPhotos(repository, {
      async list() { return root.exists ? entries(root) : []; },
      async listContents(id) { return entries(directoryFor(id)); },
      async removeDirectory(id) {
        const directory = directoryFor(id);
        if (directory.exists) directory.delete();
      },
    });
  } catch {
    // Even an unavailable private directory must leave text records usable.
    return { removed: 0, failed: 0, status: 'storage-unavailable' };
  }
}

function fit(context: ImageManipulatorContext, width: number, height: number, longest: number) {
  if (Math.max(width, height) > longest) {
    context.resize(width >= height ? { width: longest } : { height: longest });
  }
  return context;
}

export const photos: PhotoStore = {
  async persist(uri) {
    if (!/^(file:\/\/|content:\/\/|ph:\/\/|assets-library:\/\/|data:image\/)/i.test(uri)) {
      throw new Error('请重新选择设备上的照片。');
    }
    const id = randomUUID();
    const directory = directoryFor(id);
    const resources: (ImageManipulatorContext | ImageRef)[] = [];
    const generatedFiles: string[] = [];
    let created = false;
    try {
      const sourceContext = ImageManipulator.manipulate(uri);
      resources.push(sourceContext);
      const source = await sourceContext.renderAsync();
      resources.push(source);
      if (!(source.width > 0 && source.height > 0)) throw new Error('无法读取这张照片，请重新选择。');

      const mainContext = fit(ImageManipulator.manipulate(source), source.width, source.height, 1600);
      resources.push(mainContext);
      const mainImage = await mainContext.renderAsync();
      resources.push(mainImage);
      const main = await mainImage.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
      generatedFiles.push(main.uri);

      const thumbnailContext = fit(ImageManipulator.manipulate(mainImage), mainImage.width, mainImage.height, 400);
      resources.push(thumbnailContext);
      const thumbnailImage = await thumbnailContext.renderAsync();
      resources.push(thumbnailImage);
      const thumbnail = await thumbnailImage.saveAsync({ format: SaveFormat.JPEG, compress: 0.72 });
      generatedFiles.push(thumbnail.uri);

      new Directory(Paths.document, 'meal-photos').create({ intermediates: true, idempotent: true });
      directory.create();
      created = true;
      const mainFile = new File(directory, 'main.jpg');
      const thumbnailFile = new File(directory, 'thumbnail.jpg');
      await new File(main.uri).copy(mainFile);
      await new File(thumbnail.uri).copy(thumbnailFile);
      if (!mainFile.exists || mainFile.size <= 0 || !thumbnailFile.exists || thumbnailFile.size <= 0) {
        throw new Error('照片未完整保存，请检查设备空间后重试。');
      }
      return { id, width: main.width, height: main.height };
    } catch (error) {
      // Only this attempt's new directory is eligible for rollback; never touch the picker source.
      if (created) {
        try { if (directory.exists) directory.delete(); } catch { /* Preserve the save error and editable input. */ }
      }
      throw error;
    } finally {
      for (const generated of generatedFiles) {
        if (generated === uri) continue;
        try { const file = new File(generated); if (file.exists) file.delete(); } catch { /* Cache can be reclaimed by the OS. */ }
      }
      for (const resource of resources.reverse()) {
        try { resource.release(); } catch { /* A failed release must not invalidate a saved photo. */ }
      }
    }
  },
  async remove(photo) {
    const directory = directoryFor(photo.id);
    if (directory.exists) directory.delete();
  },
};
