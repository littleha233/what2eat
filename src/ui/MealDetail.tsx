import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import type { Meal } from '../core/meals';
import type { MealService } from '../core/mealService';
import { photoUri } from '../storage/photos';
import { Button, fullDate, PhotoView, timeLabel, ui } from './components';
import type { PageHandle } from './MealEditor';

export const MealDetail = forwardRef<PageHandle, { meal: Meal; service: MealService; onClose: () => void; onEdit: () => void; onDeleted: () => void }>(function MealDetail({ meal, service, onClose, onEdit, onDeleted }, ref) {
  const [error, setError] = useState(''); const [deleting, setDeleting] = useState(false); const busy = useRef(false);
  useImperativeHandle(ref, () => ({ requestClose: () => { if (!busy.current) onClose(); } }));
  async function remove() {
    if (busy.current) return; busy.current = true; setDeleting(true); setError('');
    try { await service.remove(meal.id, meal.revision); onDeleted(); }
    catch { setError('删除没有完成，记录仍然保留。请重试；若记录已变化，请返回首页重新打开。'); }
    finally { busy.current = false; setDeleting(false); }
  }
  function confirmDelete() {
    if (Platform.OS === 'web') { if (globalThis.confirm('删除这一餐？这条记录和它在 APP 内的照片副本将被删除，无法撤销。')) void remove(); return; }
    Alert.alert('删除这一餐？', '记录和 APP 内的照片副本将被删除，无法撤销。系统相册原图不会删除。', [{ text: '保留', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void remove() }]);
  }
  return <View style={ui.page}>
    <View style={ui.header}><Button title="返回" onPress={onClose} variant="quiet" disabled={deleting} /><Text style={{ fontSize: 19, fontWeight: '600' }}>这一餐</Text><Button title="编辑" variant="quiet" onPress={onEdit} disabled={deleting} /></View>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }}>
      {meal.photo && <PhotoView key={meal.photo.id} uri={photoUri(meal.photo)} ratio={Math.max(0.75, Math.min(1.5, meal.photo.width / meal.photo.height))} contain label={meal.description || '这一餐的照片'} />}
      <View style={{ gap: 8 }}><Text style={ui.title}>{meal.description || meal.mealType || '这一餐'}</Text><Text style={ui.muted}>{fullDate(meal.eatenAt)} {timeLabel(meal.eatenAt)}{meal.mealType ? ` · ${meal.mealType}` : ''}</Text></View>
      {!!meal.restaurant && <View style={{ gap: 5 }}><Text style={ui.muted}>餐馆</Text><Text style={ui.body}>{meal.restaurant}</Text></View>}
      {!!meal.notes && <View style={{ gap: 5 }}><Text style={ui.muted}>那时的感受</Text><Text style={ui.body}>{meal.notes}</Text></View>}
      <Text style={ui.muted}>这段记忆保存在当前设备。</Text>
      {!!error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
      <Button title={deleting ? '正在删除…' : '删除记录'} variant="danger" onPress={confirmDelete} disabled={deleting} />
    </ScrollView>
  </View>;
});
