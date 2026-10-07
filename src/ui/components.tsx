import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

export const colors = { paper: '#FAF8F4', white: '#FFFFFF', ink: '#282E29', muted: '#747B73', line: '#E6E8DE', accent: '#D65435', soft: '#FCEDE5', green: '#607664' };
export const ui = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 27, fontWeight: '700', color: colors.ink },
  body: { fontSize: 16, lineHeight: 24, color: colors.ink },
  muted: { fontSize: 13, lineHeight: 20, color: colors.muted },
  header: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth },
  error: { color: '#A22C20', fontSize: 14, lineHeight: 21, padding: 14, backgroundColor: '#FFF0EB', borderRadius: 12 },
});

export function Button({ title, onPress, disabled = false, variant = 'primary', style, label }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'quiet' | 'danger'; style?: StyleProp<ViewStyle>; label?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [{ minHeight: 48, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: variant === 'primary' ? colors.accent : variant === 'danger' ? '#FCEEEA' : '#EFEEE7', opacity: disabled ? 0.45 : pressed ? 0.72 : 1 }, style]}>
    <Text style={{ color: variant === 'primary' ? colors.white : variant === 'danger' ? '#AE3A28' : colors.ink, fontSize: 16, fontWeight: '600' }}>{title}</Text>
  </Pressable>;
}

export function PhotoView({ uri, ratio = 1.5, contain = false, label = '餐食照片' }: { uri: string; ratio?: number; contain?: boolean; label?: string }) {
  const [failed, setFailed] = useState(false);
  return <View style={{ aspectRatio: ratio, backgroundColor: '#EEECE4', overflow: 'hidden', borderRadius: 16 }}>
    {failed ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 22 }}>
      <Text style={ui.muted}>照片暂时无法读取</Text><Text style={ui.muted}>可在编辑中重新选择，文字记录仍保留</Text>
    </View> : <Image key={uri} source={{ uri }} accessibilityLabel={label} accessible contentFit={contain ? 'contain' : 'cover'} style={{ flex: 1 }} cachePolicy="none" onError={() => setFailed(true)} />}
  </View>;
}

export function Loading({ text = '正在打开你的记录…' }: { text?: string }) {
  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 }}><ActivityIndicator color={colors.accent} /><Text style={ui.muted}>{text}</Text></View>;
}

export function timeLabel(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
export function fullDate(value: string) { return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }); }
