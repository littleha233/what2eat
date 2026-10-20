import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { calendarMonth, mealsOnDay, moveCalendarMonth, type CalendarDay } from '../core/calendar';
import { localDayKey, type Meal, type Photo } from '../core/meals';
import { photoUri } from '../storage/photos';
import { Button, colors, fullDate, PhotoView, timeLabel, ui } from './components';

type Props = {
  meals: Meal[];
  now: Date;
  selectedDay: string;
  onSelectDay: (day: string) => void;
  onAdd: (day?: string) => void;
  onOpen: (meal: Meal) => void;
  onStorage: () => void;
  onList: () => void;
  notice: string;
  error: string;
  onRetry: () => void;
};

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;
const dayDate = (day: string) => new Date(`${day}T12:00:00`);

export function MealCalendar({ meals, now, selectedDay, onSelectDay, onAdd, onOpen, onStorage, onList, notice, error, onRetry }: Props) {
  const [month, setMonth] = useState(() => moveCalendarMonth(dayDate(selectedDay), 0));
  const todayKey = localDayKey(now);
  const selectedIsToday = selectedDay === todayKey;
  const selectedIsPast = selectedDay < todayKey;
  const selectedDate = dayDate(selectedDay);
  const nextMonthDisabled = month.getTime() >= moveCalendarMonth(now, 0).getTime();
  const { cells, recordCount, recordedDayCount } = useMemo(() => calendarMonth(month, meals, now), [month, meals, now]);
  const selectedMeals = useMemo(() => mealsOnDay(meals, selectedDay), [meals, selectedDay]);
  const rows: (CalendarDay | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));

  useEffect(() => {
    const target = moveCalendarMonth(dayDate(selectedDay), 0);
    setMonth((current) => monthKey(current) === monthKey(target) ? current : target);
  }, [selectedDay]);

  function showMonth(offset: number) {
    const target = moveCalendarMonth(month, offset);
    if (target.getTime() > moveCalendarMonth(now, 0).getTime()) return;
    setMonth(target);
    onSelectDay(monthKey(target) === monthKey(now) ? todayKey : localDayKey(target));
  }

  function showToday() {
    setMonth(moveCalendarMonth(now, 0));
    onSelectDay(todayKey);
  }

  return <View style={ui.page}>
    <FlatList style={{ flex: 1 }} data={selectedMeals} keyExtractor={(meal) => meal.id} showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content} initialNumToRender={4} maxToRenderPerBatch={5} windowSize={5}
      ListHeaderComponent={<>
        <View style={styles.heading}>
          <View style={{ flex: 1, paddingRight: 8 }}><Text style={ui.title}>吃什么</Text><Text style={[ui.muted, { marginTop: 5 }]}>记下每一餐，回看每一天。</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="本地存储说明" onPress={onStorage} style={styles.storage}><View style={styles.storageDot} /><Text style={styles.storageText}>仅存本机</Text></Pressable>
        </View>
        {Platform.OS === 'web' && <Text style={[ui.muted, { marginBottom: 12 }]}>浏览器开发预览 · 与手机数据独立，不代表移动端验收</Text>}
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>饮食日历</Text>
          <Pressable accessibilityRole="button" onPress={onList} style={styles.listLink}><Text style={styles.linkText}>按列表查看 ›</Text></Pressable>
        </View>
        <View style={styles.calendar}>
          <View style={styles.monthHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel="查看上个月" onPress={() => showMonth(-1)} style={styles.monthArrow}><Text style={styles.arrowText}>‹</Text></Pressable>
            <Text accessibilityRole="header" style={styles.monthTitle}>{month.getFullYear()} 年 {month.getMonth() + 1} 月</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="查看下个月" accessibilityState={{ disabled: nextMonthDisabled }}
              disabled={nextMonthDisabled} onPress={() => showMonth(1)} style={[styles.monthArrow, nextMonthDisabled && styles.disabled]}><Text style={styles.arrowText}>›</Text></Pressable>
          </View>
          <View style={styles.monthSummary}><Text style={ui.muted}>{recordCount} 餐记录 · {recordedDayCount} 天有记录</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="回到今天" onPress={showToday} style={styles.todayButton}><Text style={styles.todayButtonText}>回今天</Text></Pressable>
          </View>
          <View style={styles.weekRow}>{weekdays.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
          {rows.map((row, index) => <View key={index} style={styles.weekRow}>{row.map((day, column) => day
            ? <CalendarCell key={day.key} day={day} selected={day.key === selectedDay} onPress={() => onSelectDay(day.key)} />
            : <View key={`empty-${column}`} style={styles.daySlot} />)}</View>)}
          <Text style={styles.calendarHint}>点一个日子，翻看那天吃过的。</Text>
        </View>
        {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
        {!!error && <View style={styles.errorBox}><Text accessibilityRole="alert" style={ui.error}>{error}</Text><Button title="重新读取" variant="quiet" onPress={onRetry} /></View>}
        <View style={styles.selectedHeading}>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={styles.selectedTitle}>{selectedIsToday ? '今天' : `${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日`}</Text>
            <Text style={[ui.muted, { marginTop: 4 }]}>{selectedDate.getFullYear()} 年 · 周{weekdays[(selectedDate.getDay() + 6) % 7]}{selectedMeals.length > 0 ? ` · ${selectedMeals.length} 餐记录` : ''}</Text>
          </View>
          {selectedIsPast && selectedMeals.length > 0 && <Button title="补记这一天" variant="quiet" onPress={() => onAdd(selectedDay)} style={styles.backfillButton} />}
        </View>
      </>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`查看${item.description || item.mealType || '这一餐'}，${fullDate(item.eatenAt)} ${timeLabel(item.eatenAt)}`}
        onPress={() => onOpen(item)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
        {item.photo && <PhotoView key={item.photo.id} uri={photoUri(item.photo, true)} label={item.description || '餐食照片'} />}
        <View style={styles.cardContent}>
          <View style={[ui.row, { justifyContent: 'space-between', gap: 12 }]}><Text style={styles.cardTitle} numberOfLines={2}>{item.description || item.mealType || '这一餐'}</Text><Text style={ui.muted}>{timeLabel(item.eatenAt)}</Text></View>
          {!!(item.restaurant || item.mealType) && <Text style={ui.muted} numberOfLines={1}>{[item.mealType, item.restaurant].filter(Boolean).join(' · ')}</Text>}
        </View>
      </Pressable>}
      ListEmptyComponent={<View style={styles.empty}>
        <Text style={styles.emptyTitle}>{selectedIsToday ? '今天还没有记录' : '这一天还没有记录'}</Text>
        <Text style={[ui.muted, { textAlign: 'center', marginTop: 7 }]}>{selectedIsToday ? '一张照片，或一句简单的话，记下这一餐。' : '想起了这一天吃过什么，可以补记下来。'}</Text>
        {selectedIsPast && <Button title="补记这一天" variant="quiet" onPress={() => onAdd(selectedDay)} style={{ marginTop: 18 }} />}
      </View>} />
    <View style={styles.addBar}><Button title="＋  记一餐" label="记一餐" onPress={() => onAdd()} style={styles.addButton} /></View>
  </View>;
}

function CalendarCell({ day, selected, onPress }: { day: CalendarDay; selected: boolean; onPress: () => void }) {
  const count = day.meals.length;
  return <View style={styles.daySlot}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${fullDate(day.date.toISOString())}${day.isToday ? '，今天' : ''}，${count} 条记录`}
      accessibilityState={{ selected, disabled: day.isFuture }} disabled={day.isFuture} onPress={onPress}
      style={({ pressed }) => [styles.dayCell, count > 0 && styles.recordedDay, day.isToday && styles.todayCell, selected && styles.selectedCell, day.isFuture && styles.disabled, pressed && { opacity: 0.7 }]}>
      {day.photo && <CalendarThumbnail key={day.photo.id} photo={day.photo} />}
      <View style={[styles.dayNumberWrap, day.photo && styles.photoNumberWrap]}><Text style={[styles.dayNumber, day.isToday && styles.todayNumber, day.photo && styles.photoNumber]}>{day.day}</Text></View>
      {count > 0 && <View style={[styles.recordBadge, day.photo && styles.photoBadge]}><Text style={[styles.recordBadgeText, day.photo && { color: colors.white }]}>{count}</Text></View>}
      {day.isToday && <View style={styles.todayDot} />}
    </Pressable>
  </View>;
}

function CalendarThumbnail({ photo }: { photo: Photo }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <Image source={{ uri: photoUri(photo, true) }} accessible={false} contentFit="cover" cachePolicy="none"
    style={StyleSheet.absoluteFill} onError={() => setFailed(true)} />;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 },
  heading: { paddingTop: 17, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  storage: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EDF1E9', paddingHorizontal: 11, minHeight: 44, borderRadius: 24 },
  storageDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.green }, storageText: { color: colors.green, fontSize: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.ink }, listLink: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  linkText: { color: colors.green, fontSize: 13 }, calendar: { backgroundColor: '#F0F0E8', borderRadius: 22, padding: 10, paddingBottom: 14 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, arrowText: { fontSize: 30, lineHeight: 34, color: colors.ink },
  monthTitle: { fontSize: 20, fontWeight: '600', color: colors.ink },
  monthSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8, paddingRight: 4, marginBottom: 7 },
  todayButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 9 }, todayButtonText: { fontSize: 13, fontWeight: '600', color: colors.green },
  weekRow: { flexDirection: 'row' }, weekday: { flex: 1, textAlign: 'center', color: colors.muted, fontSize: 12, paddingBottom: 7, paddingTop: 3 },
  daySlot: { flex: 1, padding: 2 }, dayCell: { minHeight: 48, aspectRatio: 0.88, borderRadius: 11, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden', alignItems: 'center', paddingTop: 4 },
  recordedDay: { backgroundColor: '#E1E6DA' }, todayCell: { backgroundColor: '#E4EADF' }, selectedCell: { backgroundColor: colors.soft, borderColor: colors.accent },
  disabled: { opacity: 0.28 }, dayNumberWrap: { minWidth: 23, minHeight: 23, borderRadius: 8, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontSize: 14, color: colors.ink, fontWeight: '500' }, todayNumber: { fontWeight: '700', color: colors.green },
  photoNumberWrap: { backgroundColor: '#282E2999' }, photoNumber: { color: colors.white },
  recordBadge: { minWidth: 16, height: 14, borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginTop: 1, paddingHorizontal: 3 },
  recordBadgeText: { fontSize: 10, lineHeight: 13, color: colors.green, fontWeight: '700' }, photoBadge: { backgroundColor: '#282E2999' },
  todayDot: { position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green, borderColor: colors.paper, borderWidth: 1 },
  calendarHint: { textAlign: 'center', fontSize: 12, color: colors.muted, marginTop: 11 },
  notice: { marginTop: 14, color: colors.green, backgroundColor: '#EDF1E9', borderRadius: 10, padding: 12, fontSize: 14 },
  errorBox: { marginTop: 14, gap: 8 }, selectedHeading: { marginTop: 24, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedTitle: { fontSize: 21, fontWeight: '600', color: colors.ink }, backfillButton: { paddingHorizontal: 12, minHeight: 44 },
  card: { backgroundColor: colors.white, borderRadius: 18, borderColor: colors.line, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12, overflow: 'hidden' },
  cardContent: { padding: 14, gap: 6 }, cardTitle: { fontSize: 17, fontWeight: '600', lineHeight: 24, color: colors.ink, flex: 1 },
  empty: { paddingHorizontal: 8, paddingTop: 14, paddingBottom: 24, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.ink }, addBar: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18, backgroundColor: colors.paper, alignItems: 'center' },
  addButton: { borderRadius: 28, paddingHorizontal: 38, minHeight: 56, shadowColor: colors.ink, shadowOpacity: 0.12, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 3 },
});
