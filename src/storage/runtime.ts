import { randomUUID } from 'expo-crypto';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { createMealService, type MealService } from '../core/mealService';
import { createMealRepository } from './mealRepository';
import { photos } from './photos';

let initialization: Promise<MealService> | undefined;

export const createId = (): string => randomUUID();

export function getMealService(): Promise<MealService> {
  if (!initialization) {
    initialization = (async () => {
      let database: SQLiteDatabase | undefined;
      try {
        database = await openDatabaseAsync('what2eat.db');
        const repository = createMealRepository(database);
        await repository.initialize();
        const service = createMealService(repository, photos);
        await service.retryPhotoCleanup();
        return service;
      } catch (error) {
        if (database) {
          try { await database.closeAsync(); } catch { /* Keep the original initialization failure. */ }
        }
        throw error;
      }
    })().catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}
