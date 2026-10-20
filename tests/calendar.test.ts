import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calendarMonth, mealsOnDay, moveCalendarMonth } from '../src/core/calendar';
import { localDayKey, type Meal } from '../src/core/meals';

function record(id: string, date: Date, photoId?: string): Meal {
  return {
    id, eatenAt: date.toISOString(), description: photoId ? '' : id,
    restaurant: '', mealType: '', notes: '',
    photo: photoId ? { id: photoId, width: 1600, height: 1200 } : null,
    createdAt: date.toISOString(), updatedAt: date.toISOString(), revision: 1,
  };
}

function inTimezone(zone: string, run: () => void) {
  const old = process.env.TZ;
  process.env.TZ = zone;
  try { run(); } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
}

test('month cells align to Monday and pad complete weeks including four, five and six rows', () => {
  inTimezone('Asia/Shanghai', () => {
    const monday = calendarMonth(new Date(2021, 1, 28, 23), []);
    assert.equal(monday.cells.length, 28);
    assert.equal(monday.cells[0]?.day, 1);
    assert.equal(monday.cells.at(-1)?.day, 28);

    const thursday = calendarMonth(new Date(2026, 9, 21), []);
    assert.equal(thursday.cells.length, 35);
    assert.deepEqual(thursday.cells.slice(0, 3), [null, null, null]);
    assert.equal(thursday.cells[3]?.day, 1);
    assert.equal(thursday.cells[33]?.day, 31);
    assert.equal(thursday.cells[34], null);

    const sunday = calendarMonth(new Date(2026, 2, 1), []);
    assert.equal(sunday.cells.length, 42);
    assert.deepEqual(sunday.cells.slice(0, 6), Array(6).fill(null));
    assert.equal(sunday.cells[6]?.day, 1);
    assert.equal(sunday.cells[36]?.day, 31);
    assert.deepEqual(sunday.cells.slice(37), Array(5).fill(null));
  });
});

test('month navigation resets to first local day and handles leap years and year changes', () => {
  inTimezone('Asia/Shanghai', () => {
    const original = new Date(2024, 0, 31, 22, 30);
    const february = moveCalendarMonth(original, 1);
    assert.equal(localDayKey(february), '2024-02-01');
    assert.equal(february.getHours(), 0);
    assert.equal(localDayKey(original), '2024-01-31');
    assert.equal(calendarMonth(february, []).cells.filter(Boolean).length, 29);
    assert.equal(calendarMonth(new Date(2025, 1, 1), []).cells.filter(Boolean).length, 28);
    assert.equal(localDayKey(moveCalendarMonth(new Date(2026, 0, 31), -1)), '2025-12-01');
    assert.equal(localDayKey(moveCalendarMonth(new Date(2026, 11, 31), 1)), '2027-01-01');
    assert.equal(localDayKey(moveCalendarMonth(new Date(2026, 9, 31), -12)), '2025-10-01');
  });
});

test('local calendar groups UTC-boundary photos with their actual local date', () => {
  inTimezone('Asia/Shanghai', () => {
    const meals = [record('local-november', new Date('2026-10-31T16:00:00.000Z'), 'november'),
      record('local-october', new Date('2026-10-31T15:59:59.999Z'), 'october')];
    const october = calendarMonth(new Date(2026, 9, 1), meals, new Date(2026, 10, 1));
    const november = calendarMonth(new Date(2026, 10, 1), meals, new Date(2026, 10, 1));
    assert.equal(october.recordCount, 1);
    assert.equal(october.cells.find((day) => day?.day === 31)?.photo?.id, 'october');
    assert.equal(november.recordCount, 1);
    assert.equal(november.cells.find((day) => day?.day === 1)?.photo?.id, 'november');
    assert.deepEqual(mealsOnDay(meals, '2026-11-01').map((meal) => meal.id), ['local-november']);
  });
});

test('DST transition keeps a single cell per local date and future status ignores time of day', () => {
  inTimezone('America/New_York', () => {
    const meals = [record('early', new Date('2026-11-01T05:30:00.000Z')),
      record('late', new Date('2026-11-01T06:30:00.000Z'))];
    const month = calendarMonth(new Date(2026, 10, 21), meals, new Date(2026, 10, 1, 0, 5));
    const days = month.cells.filter((day) => day !== null);
    assert.equal(days.length, 30);
    assert.equal(new Set(days.map((day) => day.key)).size, 30);
    assert.deepEqual(days[0]?.meals.map((meal) => meal.id), ['late', 'early']);
    assert.equal(days[0]?.isToday, true);
    assert.equal(days[0]?.isFuture, false);
    assert.equal(days[1]?.isToday, false);
    assert.equal(days[1]?.isFuture, true);
    assert.equal((days[1]!.date.getTime() - days[0]!.date.getTime()) / 3_600_000, 25);

    const spring = calendarMonth(new Date(2026, 2, 1), [], new Date(2026, 2, 9, 12));
    const eighth = spring.cells.find((day) => day?.day === 8)!;
    const ninth = spring.cells.find((day) => day?.day === 9)!;
    assert.equal((ninth.date.getTime() - eighth.date.getTime()) / 3_600_000, 23);
    assert.equal(eighth.isFuture, false);
    assert.equal(ninth.isToday, true);
  });
});

test('daily records retain meal ordering and first real photo while text-only days count', () => {
  inTimezone('Asia/Shanghai', () => {
    const meals = [record('lunch', new Date(2026, 9, 21, 12), 'lunch-photo'),
      record('dinner-photo', new Date(2026, 9, 21, 19), 'dinner-photo'),
      record('dinner-text', new Date(2026, 9, 21, 20)),
      record('text-only', new Date(2026, 9, 20, 12)),
      record('outside', new Date(2026, 8, 21, 12), 'outside')];
    const originalOrder = meals.map((meal) => meal.id);
    const month = calendarMonth(new Date(2026, 9, 1), meals, new Date(2026, 9, 21, 8));
    const today = month.cells.find((day) => day?.key === '2026-10-21')!;
    const yesterday = month.cells.find((day) => day?.key === '2026-10-20')!;
    assert.equal(month.recordCount, 4);
    assert.equal(month.recordedDayCount, 2);
    assert.deepEqual(today.meals.map((meal) => meal.id), ['dinner-text', 'dinner-photo', 'lunch']);
    assert.equal(today.photo?.id, 'dinner-photo');
    assert.equal(today.isToday, true);
    assert.equal(today.isFuture, false);
    assert.equal(yesterday.meals.length, 1);
    assert.equal(yesterday.photo, null);
    assert.deepEqual(mealsOnDay(meals, today.key), today.meals);
    assert.deepEqual(meals.map((meal) => meal.id), originalOrder);
  });
});

test('edits moving a record and deletions immediately change day markers and month statistics', () => {
  inTimezone('Asia/Shanghai', () => {
    const original = [record('photo', new Date(2026, 9, 21, 12), 'photo'),
      record('text', new Date(2026, 9, 21, 13))];
    const october = new Date(2026, 9, 1);
    const moved = original.map((meal) => meal.id === 'photo'
      ? { ...meal, eatenAt: new Date(2026, 8, 30, 12).toISOString() } : meal);
    assert.equal(calendarMonth(october, original).recordCount, 2);
    const afterEdit = calendarMonth(october, moved);
    assert.equal(afterEdit.recordCount, 1);
    assert.equal(afterEdit.recordedDayCount, 1);
    assert.equal(afterEdit.cells.find((day) => day?.day === 21)?.photo, null);
    assert.deepEqual(mealsOnDay(moved, '2026-09-30').map((meal) => meal.id), ['photo']);
    assert.equal(calendarMonth(new Date(2026, 8, 1), moved).recordedDayCount, 1);

    const afterDelete = calendarMonth(october, moved.filter((meal) => meal.id !== 'text'));
    assert.equal(afterDelete.recordCount, 0);
    assert.equal(afterDelete.recordedDayCount, 0);
    assert.deepEqual(afterDelete.cells.find((day) => day?.day === 21)?.meals, []);
  });
});

test('empty month has neutral days, today and future metadata without invented records', () => {
  inTimezone('Asia/Shanghai', () => {
    const month = calendarMonth(new Date(2026, 9, 1), [], new Date(2026, 9, 21, 12));
    assert.equal(month.recordCount, 0);
    assert.equal(month.recordedDayCount, 0);
    for (const day of month.cells) {
      if (day === null) continue;
      assert.deepEqual(day.meals, []);
      assert.equal(day.photo, null);
      assert.equal(day.isToday, day.day === 21);
      assert.equal(day.isFuture, day.day > 21);
    }
    assert.deepEqual(mealsOnDay([], '2026-10-21'), []);
  });
});
