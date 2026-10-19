import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';
import { openDatabaseAsync } from 'expo-sqlite';
import { draftFromMeal, type MealDraft, type Photo } from '../src/core/meals';
import { createMealRepository } from '../src/storage/mealRepository';
import { photos, photoUri, recoverPhotos } from '../src/storage/photos';
import { getMealService } from '../src/storage/runtime';

// Generated from the non-private local fixture by native-storage-smoke.mjs; never product data.
const fixture = require('../local-data/native-storage-fixture.json') as { base64: string };
const state = new File(Paths.document, 'storage-smoke-phase1.json');
const result = new File(Paths.document, 'storage-smoke-result.json');
const runtimeId = randomUUID();
let started = false;

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function source(name: string) {
  const file = new File(Paths.cache, name);
  file.write(fixture.base64, { encoding: 'base64' });
  return file;
}
function draft(id: string, uri: string): MealDraft {
  return { id, eatenAt: new Date().toISOString(), description: '', restaurant: '', mealType: '', notes: '', existingPhoto: null, newPhotoUri: uri };
}
async function inspect(photo: Photo) {
  const main = new File(photoUri(photo));
  const thumbnail = new File(photoUri(photo, true));
  check(main.exists && main.size > 0 && thumbnail.exists && thumbnail.size > 0, 'Both persistent photo files must exist');
  const context = ImageManipulator.manipulate(main.uri);
  const thumbnailContext = ImageManipulator.manipulate(thumbnail.uri);
  const image = await context.renderAsync();
  const small = await thumbnailContext.renderAsync();
  try {
    check(image.width === photo.width && image.height === photo.height, 'Decoded dimensions must match the record');
    check(Math.max(image.width, image.height) <= 1600 && Math.max(small.width, small.height) <= 400, 'Native resize bounds must hold');
    return { mainBytes: main.size, thumbnailBytes: thumbnail.size, mainWidth: image.width, mainHeight: image.height, thumbnailWidth: small.width, thumbnailHeight: small.height };
  } finally { image.release(); small.release(); context.release(); thumbnailContext.release(); }
}

async function run() {
  const database = await openDatabaseAsync('what2eat.db');
  const repository = createMealRepository(database);
  await repository.initialize();
  const previous = state.exists ? JSON.parse(await state.text()) as { runtimeId: string; mealId: string; photo: Photo; orphan: Photo; sourceUri: string; decoded: unknown } : null;
  const orphanPresentBeforeStartup = previous ? new File(photoUri(previous.orphan)).exists : false;
  // Exercise the actual production initialization and recovery in this isolated bundle's container.
  const service = await getMealService();
  if (!previous) {
    const pickerSource = source('storage-smoke-picker-source.jpg');
    const input = draft(randomUUID(), pickerSource.uri);
    const [meal, repeated] = await Promise.all([service.save(input), service.save(input)]);
    check(meal.photo && meal.id === repeated.id && (await service.list()).length === 1, 'Photo-only duplicate save must create exactly one meal');
    check(!meal.description && !meal.restaurant && !meal.mealType && !meal.notes, 'Photo-only save must not fabricate optional fields');
    const decoded = await inspect(meal.photo);
    const orphan = await photos.persist(pickerSource.uri);
    pickerSource.delete();
    check(!pickerSource.exists, 'Temporary picker source must be removed before restart');
    state.write(JSON.stringify({ status: 'phase1-ready', runtimeId, mealId: meal.id, photo: meal.photo, orphan, sourceUri: pickerSource.uri, decoded, createdAt: new Date().toISOString() }, null, 2));
    // Leave the connection open: the driver terminates this process before phase 2.
    return;
  }

  check(previous.runtimeId !== runtimeId, 'Phase 2 must run in a new JS runtime');
  check(!new File(previous.sourceUri).exists, 'Original picker source must remain absent');
  const restored = await repository.get(previous.mealId);
  check(restored?.photo?.id === previous.photo.id && (await service.list()).length === 1, 'Cold start must restore the SQLite meal and photo reference');
  const recoveredPhoto = await inspect(restored.photo);
  check(orphanPresentBeforeStartup, 'Phase 1 orphan must exist before production startup recovery');
  check(new File(photoUri(restored.photo)).exists && !new File(photoUri(previous.orphan)).exists, 'Recovery must preserve referenced files and remove only the orphan');
  const recovery = await recoverPhotos(repository);
  check(recovery.status === 'complete' && recovery.removed === 0, 'Recovery after production startup must be idempotent');

  const replacementSource = source('storage-smoke-replacement.jpg');
  const replacement = await service.save({ ...draftFromMeal(restored), newPhotoUri: replacementSource.uri }, restored.revision);
  check(replacement.photo && replacement.photo.id !== restored.photo.id, 'Replacement must persist a new native photo');
  const replacementPhoto = await inspect(replacement.photo);
  check(!new File(photoUri(restored.photo)).exists && !new File(photoUri(restored.photo, true)).exists, 'Replacement must reclaim the old files');

  const failedId = randomUUID();
  let failed = false;
  try { await service.save(draft(failedId, new File(Paths.cache, 'missing-storage-smoke.jpg').uri)); } catch { failed = true; }
  check(failed && !await repository.get(failedId), 'Missing native source must fail without a database row');
  const retried = await service.save(draft(failedId, replacementSource.uri));
  check(retried.photo && (await service.list()).length === 2, 'Retry must save the same stable ID successfully');
  await inspect(retried.photo);
  await service.save(draft(failedId, replacementSource.uri));
  check((await service.list()).length === 2, 'Completed-save retry must stay idempotent');
  await service.remove(replacement.id, replacement.revision);
  await service.remove(retried.id, retried.revision);
  check((await service.list()).length === 0 && !new File(photoUri(replacement.photo)).exists && !new File(photoUri(retried.photo)).exists, 'Delete must remove rows and their native files');
  replacementSource.delete();
  const photoRoot = new Directory(Paths.document, 'meal-photos');
  check(!photoRoot.exists || photoRoot.list().length === 0, 'Test image directory must be empty after deletion');
  await database.closeAsync();
  result.write(JSON.stringify({ status: 'passed', scope: 'Isolated iOS native storage integration via production getMealService initialization; no system picker UI or camera acceptance', firstRuntimeId: previous.runtimeId, secondRuntimeId: runtimeId, checks: ['photo-only save', 'duplicate save', 'native main and thumbnail decoding', 'temporary source deletion', 'process termination and SQLite/photo restoration', 'production startup recovery preserves references and reclaims orphan', 'recovery idempotence', 'photo replacement and old file cleanup', 'native source failure and same-ID retry', 'idempotent completed retry', 'delete rows and native files'], firstPhoto: previous.decoded, restoredPhoto: recoveredPhoto, replacementPhoto, startupRecovery: { orphanPresentBeforeStartup, orphanPresentAfterStartup: false, referencedPhotoPreserved: true }, recovery, completedAt: new Date().toISOString() }, null, 2));
}

function StorageSmokeApp() {
  useEffect(() => {
    if (started) return;
    started = true;
    void run().catch((error: unknown) => result.write(JSON.stringify({ status: 'failed', runtimeId, error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() }, null, 2)));
  }, []);
  return <View><Text>What2Eat isolated native storage check. Results are written to the test container.</Text></View>;
}
registerRootComponent(StorageSmokeApp);
