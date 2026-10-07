import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { draftFromMeal, MEAL_TYPES, MealError, type Meal, type MealDraft } from '../core/meals';
import type { MealService } from '../core/mealService';
import { photoUri } from '../storage/photos';
import { Button, colors, fullDate, PhotoView, timeLabel, ui } from './components';

export type PageHandle = { requestClose: () => void };
export const MealEditor = forwardRef<PageHandle, { id: string; meal?: Meal; service: MealService; onSaved: (meal: Meal) => void; onClose: () => void }>(function MealEditor({ id, meal, service, onSaved, onClose }, ref) {
  const [draft, setDraft] = useState<MealDraft>(() => meal ? draftFromMeal(meal) : { id, eatenAt: new Date().toISOString(), description: '', restaurant: '', mealType: '', notes: '', existingPhoto: null, newPhotoUri: null });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(!!meal);
  const busy = useRef(false);
  const patch = (change: Partial<MealDraft>) => { setDraft((value) => ({ ...value, ...change })); setDirty(true); setError(''); };
  const preview = draft.newPhotoUri || (!draft.removePhoto && draft.existingPhoto ? photoUri(draft.existingPhoto) : null);
  const valid = !!preview || !!draft.description.trim();

  function close() {
    if (busy.current) return;
    if (!dirty) return onClose();
    if (Platform.OS === 'web') { if (globalThis.confirm('放弃这次尚未保存的修改？')) onClose(); return; }
    Alert.alert('还没有保存', '放弃这次修改吗？', [{ text: '继续记录', style: 'cancel' }, { text: '放弃修改', style: 'destructive', onPress: onClose }]);
  }
  useImperativeHandle(ref, () => ({ requestClose: close }));

  async function pick(camera: boolean) {
    if (busy.current) return;
    busy.current = true; setPicking(true); setError('');
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('未获得相机权限。可以从相册选图，或直接写下吃了什么。');
          if (!permission.canAskAgain) Alert.alert('相机权限未开启', '你仍可以选图或文字记录，也可以前往系统设置开启相机。', [{ text: '继续文字记录', style: 'cancel' }, { text: '打开设置', onPress: () => { void Linking.openSettings().catch(() => undefined); } }]);
          return;
        }
      }
      // The system photo picker only grants access to the selected image; no broad album access is needed.
      const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false, exif: false });
      if (!result.canceled && result.assets[0]) patch({ newPhotoUri: result.assets[0].uri, removePhoto: false });
    } catch {
      setError('暂时无法获取照片。请检查权限，或确认照片已下载到设备后重试。也可以先用文字记录。');
    } finally { busy.current = false; setPicking(false); }
  }

  function changeDate() {
    if (Platform.OS !== 'android') { setDateOpen(!dateOpen); return; }
    DateTimePickerAndroid.open({ value: new Date(draft.eatenAt), mode: 'date', maximumDate: new Date(), onChange: (event, date) => {
      if (event.type !== 'set' || !date) return;
      const value = new Date(draft.eatenAt); value.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      patch({ eatenAt: value.toISOString() });
      DateTimePickerAndroid.open({ value, mode: 'time', is24Hour: true, onChange: (timeEvent, time) => {
        if (timeEvent.type === 'set' && time) { value.setHours(time.getHours(), time.getMinutes(), 0, 0); patch({ eatenAt: value.toISOString() }); }
      } });
    } });
  }

  async function save() {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError('');
    try { const result = await service.save(draft, meal?.revision); onSaved(result); }
    catch (failure) { setError(failure instanceof MealError ? failure.message : '保存没有完成，照片和填写内容仍保留在本页。请检查设备空间后重试。'); }
    finally { busy.current = false; setSaving(false); }
  }

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ui.page}>
    <View style={ui.header}><Button title="取消" variant="quiet" disabled={saving || picking} onPress={close} /><Text style={{ fontSize: 19, fontWeight: '600', color: colors.ink }}>{meal ? '编辑这一餐' : '记一餐'}</Text><View style={{ width: 68 }} /></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 32 }}>
      {preview ? <View style={{ gap: 10 }}><PhotoView key={preview} uri={preview} ratio={1.25} contain /><View style={ui.row}><Text style={[ui.muted, { flex: 1 }]}>这张照片，就是这一餐的记忆。</Text><Button title="移除照片" variant="quiet" disabled={saving || picking} onPress={() => patch({ newPhotoUri: null, removePhoto: true })} /></View></View>
        : <View style={styles.photoPlaceholder}><Text style={{ fontSize: 30 }}>＋</Text><Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>留下一张餐食照片</Text><Text style={ui.muted}>也可以不选图，用一句话补记</Text></View>}
      <View style={[ui.row, { gap: 12 }]}><Button title={picking ? '正在获取…' : '拍照'} onPress={() => void pick(true)} disabled={saving || picking} variant="quiet" style={{ flex: 1 }} /><Button title="从相册选图" onPress={() => void pick(false)} disabled={saving || picking} variant="quiet" style={{ flex: 1 }} /></View>
      {picking && <ActivityIndicator color={colors.accent} />}
      <View style={styles.dateRow}><View style={{ flex: 1 }}><Text style={styles.label}>就餐时间</Text><Text style={ui.body}>{fullDate(draft.eatenAt)} {timeLabel(draft.eatenAt)}</Text></View><Button title="修改时间" variant="quiet" onPress={changeDate} disabled={saving || picking} /></View>
      {dateOpen && Platform.OS === 'ios' && <DateTimePicker disabled={saving || picking} value={new Date(draft.eatenAt)} mode="datetime" display="spinner" locale="zh-CN" maximumDate={new Date()} themeVariant="light" onChange={(_event, date) => { if (!busy.current && date) patch({ eatenAt: date.toISOString() }); }} />}
      {dateOpen && Platform.OS === 'web' && <TextInput editable={!saving && !picking} accessibilityLabel="就餐时间，格式年-月-日 时:分" placeholder="2026-10-07 12:00" style={styles.input} onEndEditing={(event) => { if (busy.current) return; const date = new Date(event.nativeEvent.text.replace(' ', 'T')); if (Number.isFinite(date.getTime())) patch({ eatenAt: date.toISOString() }); else setError('时间格式不正确，请输入 年-月-日 时:分。'); }} />}
      <View style={{ gap: 8 }}><Text style={styles.label}>吃了什么 <Text style={ui.muted}>选填，有照片就能保存</Text></Text><TextInput accessibilityLabel="吃了什么" placeholder="比如：一碗热腾腾的牛肉面" placeholderTextColor={colors.muted} value={draft.description} onChangeText={(description) => patch({ description })} editable={!saving && !picking} maxLength={300} style={styles.input} /></View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(!detailsOpen)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.green, fontSize: 15 }}>{detailsOpen ? '收起' : '再记一点'} · 餐次、餐馆、备注（选填）</Text></Pressable>
      {detailsOpen && <View style={{ gap: 18 }}>
        <View style={{ gap: 8 }}><Text style={styles.label}>餐次</Text><View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>{MEAL_TYPES.map((type) => <Pressable accessibilityRole="button" accessibilityState={{ selected: draft.mealType === type }} key={type} disabled={saving || picking} onPress={() => patch({ mealType: type })} style={[styles.typeChip, draft.mealType === type && { backgroundColor: colors.soft, borderColor: colors.accent }]}><Text style={{ color: draft.mealType === type ? colors.accent : colors.muted }}>{type || '不填写'}</Text></Pressable>)}</View></View>
        <View style={{ gap: 8 }}><Text style={styles.label}>餐馆名称</Text><TextInput accessibilityLabel="餐馆名称" placeholder="哪家店，或是在家吃的" placeholderTextColor={colors.muted} value={draft.restaurant} onChangeText={(restaurant) => patch({ restaurant })} editable={!saving && !picking} maxLength={100} style={styles.input} /></View>
        <View style={{ gap: 8 }}><Text style={styles.label}>备注</Text><TextInput accessibilityLabel="备注" placeholder="味道如何，下次还想吃吗？" placeholderTextColor={colors.muted} value={draft.notes} onChangeText={(notes) => patch({ notes })} editable={!saving && !picking} multiline maxLength={1500} textAlignVertical="top" style={[styles.input, { minHeight: 100 }]} /></View>
      </View>}
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={ui.error}>{error}</Text>}
      {!valid && <Text style={ui.muted}>添加一张照片，或在“吃了什么”写几个字，就可以保存。</Text>}
      <Text style={ui.muted}>仅保存在当前设备，不会自动上传。</Text>
    </ScrollView>
    <View style={styles.saveBar}><Button title={saving ? '正在保存…' : '保存这一餐'} label="保存这一餐" onPress={() => void save()} disabled={saving || picking || !valid} /></View>
  </KeyboardAvoidingView>;
});

const styles = StyleSheet.create({
  photoPlaceholder: { padding: 26, minHeight: 175, backgroundColor: '#F0EDE4', borderWidth: 1, borderStyle: 'dashed', borderColor: '#D7D7C9', borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 10 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink, lineHeight: 22 },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: 13, padding: 14, minHeight: 52, color: colors.ink, fontSize: 16 },
  typeChip: { paddingHorizontal: 13, minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  saveBar: { padding: 16, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, backgroundColor: colors.paper },
});
