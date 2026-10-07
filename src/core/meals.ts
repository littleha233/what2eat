export const MEAL_TYPES = ['', '早餐', '午餐', '晚餐', '加餐', '其他'] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export type HistoryRange = 3 | 7 | 30 | 'all';

export type Photo = { id: string; width: number; height: number };

export type Meal = {
  id: string;
  eatenAt: string;
  description: string;
  restaurant: string;
  mealType: MealType;
  notes: string;
  photo: Photo | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type MealDraft = Pick<Meal, 'id' | 'eatenAt' | 'description' | 'restaurant' | 'mealType' | 'notes'> & {
  existingPhoto: Photo | null;
  newPhotoUri: string | null;
  removePhoto?: boolean;
};

export class MealError extends Error {
  constructor(public readonly code: 'INVALID' | 'CONFLICT' | 'NOT_FOUND' | 'DELETED', message: string) {
    super(message);
    this.name = 'MealError';
  }
}

export function draftFromMeal(meal: Meal): MealDraft {
  return {
    id: meal.id, eatenAt: meal.eatenAt, description: meal.description,
    restaurant: meal.restaurant, mealType: meal.mealType, notes: meal.notes,
    existingPhoto: meal.photo, newPhotoUri: null,
  };
}

export function localDayKey(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function historyBounds(range: Exclude<HistoryRange, 'all'>, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Calendar arithmetic keeps the local-day boundary correct across DST changes.
  start.setDate(start.getDate() - range + 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start, end };
}

export function filterMeals(meals: readonly Meal[], range: HistoryRange = 7, now = new Date()): Meal[] {
  const bounds = range === 'all' ? null : historyBounds(range, now);
  return meals.filter((meal) => {
    const timestamp = new Date(meal.eatenAt).getTime();
    return Number.isFinite(timestamp) && (!bounds || (timestamp >= bounds.start.getTime() && timestamp < bounds.end.getTime()));
  }).sort((a, b) => new Date(b.eatenAt).getTime() - new Date(a.eatenAt).getTime()
    || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function groupMealsByDay(meals: readonly Meal[]): { day: string; meals: Meal[] }[] {
  const groups = new Map<string, Meal[]>();
  for (const meal of filterMeals(meals, 'all')) {
    const key = localDayKey(meal.eatenAt);
    const group = groups.get(key) ?? [];
    group.push(meal);
    groups.set(key, group);
  }
  return Array.from(groups, ([day, entries]) => ({ day, meals: entries }));
}
