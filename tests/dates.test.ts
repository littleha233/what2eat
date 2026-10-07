import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { filterMeals, groupMealsByDay, historyBounds, localDayKey, type Meal } from '../src/core/meals';

function record(id: string, date: Date): Meal {
  return { id, eatenAt: date.toISOString(), description: id, restaurant: '', mealType: '', notes: '',
    photo: null, createdAt: date.toISOString(), updatedAt: date.toISOString(), revision: 1 };
}

function inTimezone(zone: string, run: () => void) {
  const old = process.env.TZ;
  process.env.TZ = zone;
  try { run(); } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
}

test('3, 7 and 30 local days include their first midnight and exclude older records and tomorrow', () => {
  inTimezone('Asia/Shanghai', () => {
    const now = new Date(2026, 9, 7, 12);
    for (const range of [3, 7, 30] as const) {
      const start = new Date(2026, 9, 8 - range);
      const meals = [record('older', new Date(start.getTime() - 1)), record('boundary', start),
        record('today', now), record('tomorrow', new Date(2026, 9, 8))];
      assert.deepEqual(filterMeals(meals, range, now).map((meal) => meal.id), ['today', 'boundary']);
      assert.equal(filterMeals(meals, 'all', now).length, 4);
    }
  });
});

test('default range is seven days; all records sort by meal time and keep duplicate meal slots', () => {
  inTimezone('Asia/Shanghai', () => {
    const now = new Date(2026, 9, 7, 12);
    const meals = [record('old', new Date(2025, 0, 1)), record('new', now),
      record('same-slot', now), record('week-first', new Date(2026, 9, 1)),
      record('eight-days', new Date(2026, 8, 30, 23, 59, 59, 999))];
    assert.deepEqual(filterMeals(meals, undefined, now).map((meal) => meal.id), ['new', 'same-slot', 'week-first']);
    assert.equal(filterMeals(meals, 'all').at(-1)?.id, 'old');
  });
});

test('calendar arithmetic handles month, year and leap-day boundaries', () => {
  inTimezone('Asia/Shanghai', () => {
    assert.equal(localDayKey(historyBounds(3, new Date(2026, 0, 1)).start), '2025-12-30');
    assert.equal(localDayKey(historyBounds(7, new Date(2026, 2, 2)).start), '2026-02-24');
    assert.equal(localDayKey(historyBounds(30, new Date(2024, 2, 1)).start), '2024-02-01');
    assert.equal(localDayKey(historyBounds(3, new Date(2024, 2, 1)).start), '2024-02-28');
  });
});

test('DST spring and autumn ranges retain local midnight instead of assuming 24-hour days', () => {
  inTimezone('America/New_York', () => {
    const spring = historyBounds(3, new Date(2026, 2, 9, 12));
    const autumn = historyBounds(3, new Date(2026, 10, 2, 12));
    assert.equal(spring.start.getHours(), 0);
    assert.equal(spring.end.getHours(), 0);
    assert.equal((spring.end.getTime() - spring.start.getTime()) / 3_600_000, 71);
    assert.equal((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000, 73);
    assert.deepEqual(filterMeals([record('start', spring.start), record('before', new Date(spring.start.getTime() - 1))],
      3, new Date(2026, 2, 9, 12)).map((meal) => meal.id), ['start']);
  });
});

test('backdated and edited dates regroup correctly, without interpreting missing days as skipped meals', () => {
  inTimezone('Asia/Shanghai', () => {
    const older = record('breakfast', new Date(2026, 8, 15, 9));
    const dinner = record('dinner', new Date(2026, 9, 7, 19));
    const lunch = record('lunch', new Date(2026, 9, 7, 12));
    assert.deepEqual(groupMealsByDay([older, lunch, dinner]).map((group) => [group.day, group.meals.map((meal) => meal.id)]),
      [['2026-10-07', ['dinner', 'lunch']], ['2026-09-15', ['breakfast']]]);
    lunch.eatenAt = new Date(2026, 8, 15, 12).toISOString();
    assert.deepEqual(groupMealsByDay([older, lunch, dinner])[1]?.meals.map((meal) => meal.id), ['lunch', 'breakfast']);
    assert.deepEqual(filterMeals([older, lunch, dinner], 7, new Date(2026, 9, 7)).map((meal) => meal.id), ['dinner']);
  });
});
