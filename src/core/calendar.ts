import { filterMeals, groupMealsByDay, localDayKey, type Meal, type Photo } from './meals';

export type CalendarDay = {
  key: string;
  day: number;
  date: Date;
  isToday: boolean;
  isFuture: boolean;
  meals: Meal[];
  photo: Photo | null;
};

export function moveCalendarMonth(month: Date, offset: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + offset, 1);
}

export function mealsOnDay(meals: readonly Meal[], dayKey: string): Meal[] {
  return filterMeals(meals, 'all').filter((meal) => localDayKey(meal.eatenAt) === dayKey);
}

export function calendarMonth(month: Date, meals: readonly Meal[], now = new Date()): {
  cells: (CalendarDay | null)[];
  recordCount: number;
  recordedDayCount: number;
} {
  const first = moveCalendarMonth(month, 0);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const groups = new Map(groupMealsByDay(meals).map((group) => [group.day, group.meals]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = localDayKey(today);
  // getDay starts on Sunday; the visible calendar starts on Monday.
  const leading = (first.getDay() + 6) % 7;
  const cells: (CalendarDay | null)[] = Array.from({ length: leading }, () => null);
  let recordCount = 0;
  let recordedDayCount = 0;

  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = new Date(first.getFullYear(), first.getMonth(), day);
    const key = localDayKey(date);
    const entries = groups.get(key) ?? [];
    recordCount += entries.length;
    if (entries.length > 0) recordedDayCount += 1;
    cells.push({
      key, day, date, isToday: key === todayKey, isFuture: date.getTime() > today.getTime(),
      meals: entries, photo: entries.find((meal) => meal.photo !== null)?.photo ?? null,
    });
  }

  while (cells.length % 7 !== 0) cells.push(null);
  return { cells, recordCount, recordedDayCount };
}
