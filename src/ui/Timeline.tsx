import React from 'react';
import { Platform, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { filterMeals, groupMealsByDay, localDayKey, type HistoryRange, type Meal } from '../core/meals';
import { photoUri } from '../storage/photos';
import { Button, colors, fullDate, PhotoView, timeLabel, ui } from './components';

const ranges: { value: HistoryRange; title: string }[] = [{ value: 3, title: '近三天' }, { value: 7, title: '近一周' }, { value: 30, title: '近一个月' }, { value: 'all', title: '全部' }];

export function Timeline({ meals, range, onRange, onAdd, onOpen, onStorage, notice, error, onRetry, now }: {
  meals: Meal[]; range: HistoryRange; onRange: (range: HistoryRange) => void; onAdd: () => void; onOpen: (meal: Meal) => void;
  onStorage: () => void; notice: string; error: string; onRetry: () => void; now: Date;
}) {
  const filtered = filterMeals(meals, range, now);
  const sections = groupMealsByDay(filtered).map((group) => ({ ...group, data: group.meals }));
  return <View style={ui.page}>
    <View style={styles.heading}>
      <View><Text style={ui.title}>吃什么</Text><Text style={[ui.muted, { marginTop: 5 }]}>把每一餐，留在日子里。</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="本地存储说明" onPress={onStorage} style={styles.storage}><View style={styles.dot} /><Text style={{ color: colors.green, fontSize: 12 }}>仅存本机</Text></Pressable>
    </View>
    {Platform.OS === 'web' && <Text style={[ui.muted, { paddingHorizontal: 20 }]}>浏览器开发预览 · 与手机数据独立，不代表移动端验收</Text>}
    <View style={styles.filters}>{ranges.map((item) => <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected: range === item.value }} onPress={() => onRange(item.value)}
      style={[styles.filter, range === item.value && styles.activeFilter]}><Text style={{ fontSize: 14, fontWeight: range === item.value ? '600' : '400', color: range === item.value ? colors.white : colors.muted }}>{item.title}</Text></Pressable>)}</View>
    <View style={styles.summary}><Text style={ui.muted}>{range === 'all' ? '所有留下的餐食' : `含今天的最近 ${range} 个自然日`}</Text><Text style={ui.muted}>{filtered.length} 条记录</Text></View>
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
    {!!error && <View style={{ padding: 20, gap: 8 }}><Text accessibilityRole="alert" style={ui.error}>{error}</Text><Button title="重新读取" variant="quiet" onPress={onRetry} /></View>}
    <SectionList sections={sections} keyExtractor={(item) => item.id} stickySectionHeadersEnabled={false} showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, flexGrow: 1 }} initialNumToRender={5} maxToRenderPerBatch={6} windowSize={5}
      renderSectionHeader={({ section }) => <View style={styles.day}><Text style={styles.dayText}>{section.day === localDayKey(now) ? '今天' : fullDate(`${section.day}T12:00:00`)}</Text><Text style={ui.muted}>{section.data.length} 餐记忆</Text></View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`查看${item.description || item.mealType || '这一餐'}，${fullDate(item.eatenAt)} ${timeLabel(item.eatenAt)}`} onPress={() => onOpen(item)} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}>
        {item.photo && <PhotoView key={item.photo.id} uri={photoUri(item.photo, true)} label={item.description || '餐食照片'} />}
        <View style={{ padding: 14, gap: 6 }}>
          <View style={[ui.row, { justifyContent: 'space-between', gap: 12 }]}><Text style={[styles.cardTitle, { flex: 1 }]} numberOfLines={2}>{item.description || item.mealType || '这一餐'}</Text><Text style={ui.muted}>{timeLabel(item.eatenAt)}</Text></View>
          {!!(item.restaurant || item.mealType) && <Text style={ui.muted} numberOfLines={1}>{[item.mealType, item.restaurant].filter(Boolean).join(' · ')}</Text>}
        </View>
      </Pressable>}
      ListEmptyComponent={<View style={styles.empty}><View style={styles.emptyMark}><Text style={{ color: colors.accent, fontSize: 35 }}>＋</Text></View>
        <Text style={{ fontSize: 20, fontWeight: '600', color: colors.ink }}>{meals.length ? '这段时间还没有记录' : '还没有记录，记下这一餐吧'}</Text>
        <Text style={[ui.muted, { textAlign: 'center', marginTop: 10 }]}>{meals.length ? '可以补记一餐，也可以翻看更早的照片。' : '一张照片，或一句简单的话。\n以后想吃什么，回来翻一翻。'}</Text>
        {meals.length > 0 && <Button title="查看全部记录" variant="quiet" style={{ marginTop: 20 }} onPress={() => onRange('all')} />}
      </View>} />
    <View style={styles.addBar}><Button title="＋  记一餐" label="记一餐" onPress={onAdd} style={{ borderRadius: 28, paddingHorizontal: 38, minHeight: 56 }} /></View>
  </View>;
}

const styles = StyleSheet.create({
  heading: { padding: 20, paddingTop: 17, paddingBottom: 21, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  storage: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EDF1E9', paddingHorizontal: 11, minHeight: 44, borderRadius: 24 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.green },
  filters: { marginHorizontal: 20, padding: 4, backgroundColor: '#EEEEE6', borderRadius: 16, flexDirection: 'row' },
  filter: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 12 }, activeFilter: { backgroundColor: colors.ink },
  summary: { marginHorizontal: 22, marginTop: 14, marginBottom: 2, flexDirection: 'row', justifyContent: 'space-between' },
  notice: { marginTop: 12, marginHorizontal: 20, color: colors.green, backgroundColor: '#EDF1E9', borderRadius: 10, padding: 12, fontSize: 14 },
  day: { paddingTop: 22, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayText: { color: colors.ink, fontSize: 18, fontWeight: '600' },
  card: { backgroundColor: colors.white, borderRadius: 18, borderColor: colors.line, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12, overflow: 'hidden' },
  cardTitle: { fontSize: 17, fontWeight: '600', lineHeight: 24, color: colors.ink },
  empty: { flex: 1, paddingVertical: 60, alignItems: 'center', justifyContent: 'center' },
  emptyMark: { backgroundColor: colors.soft, width: 76, height: 76, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  addBar: { position: 'absolute', bottom: 18, left: 20, right: 20, alignItems: 'center' },
});
