import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { filterMeals, type HistoryRange, type Meal } from './src/core/meals';
import type { MealService } from './src/core/mealService';
import { createId, getMealService } from './src/storage/runtime';
import { Button, colors, Loading, ui } from './src/ui/components';
import { Timeline } from './src/ui/Timeline';
import { MealEditor, type PageHandle } from './src/ui/MealEditor';
import { MealDetail } from './src/ui/MealDetail';

type Screen = { kind: 'home' } | { kind: 'detail'; id: string } | { kind: 'editor'; id: string; meal?: Meal };

function DiaryApp() {
  const [service, setService] = useState<MealService | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [range, setRange] = useState<HistoryRange>(7);
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(new Date());
  const [storageOpen, setStorageOpen] = useState(false);
  const generation = useRef(0);
  const pageHandle = useRef<PageHandle>(null);
  const reload = useCallback(async () => {
    const version = ++generation.current;
    try {
      const nextService = await getMealService();
      const records = await nextService.list();
      if (version !== generation.current) return;
      setService(nextService); setMeals(records); setError(''); setLoading(false);
    } catch {
      if (version !== generation.current) return;
      setError('暂时无法打开本机记录。没有删除或重置任何数据，请检查设备空间后重试。'); setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); return () => { generation.current += 1; }; }, [reload]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') { setNow(new Date()); void reload(); } });
    let timer: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      const current = new Date();
      const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timer = setTimeout(() => { setNow(new Date()); scheduleMidnight(); }, next.getTime() - current.getTime() + 10);
    };
    scheduleMidnight();
    return () => { listener.remove(); clearTimeout(timer); };
  }, [reload]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  const saved = (meal: Meal) => {
    ++generation.current; setMeals((current) => [meal, ...current.filter((item) => item.id !== meal.id)]); setNow(new Date()); setError('');
    const hidden = !filterMeals([meal], range).length;
    if (hidden) setRange('all');
    setNotice(hidden ? '已保存这一餐 · 已切换到全部记录' : '已保存这一餐'); setScreen({ kind: 'home' });
  };
  const deleted = (id: string) => { ++generation.current; setMeals((current) => current.filter((meal) => meal.id !== id)); setScreen((current) => current.kind === 'detail' && current.id === id ? { kind: 'home' } : current); setNotice('已删除记录'); };
  const currentMeal = screen.kind === 'detail' ? meals.find((meal) => meal.id === screen.id) : undefined;
  return <SafeAreaView style={ui.page}>
    <StatusBar style="dark" />
    {loading ? <Loading /> : !service ? <View style={{ flex: 1, justifyContent: 'center', gap: 20, padding: 28 }}><Text style={ui.title}>你的记录仍在本机</Text><Text style={ui.error}>{error}</Text><Button title="重新打开" onPress={() => { setLoading(true); void reload(); }} /></View>
      : <Timeline meals={meals} range={range} onRange={setRange} now={now} onAdd={() => setScreen({ kind: 'editor', id: createId() })} onOpen={(meal) => setScreen({ kind: 'detail', id: meal.id })} onStorage={() => setStorageOpen(true)} notice={notice} error={error} onRetry={() => void reload()} />}
    <Modal visible={screen.kind !== 'home'} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => pageHandle.current?.requestClose()}>
      <SafeAreaProvider>
      <SafeAreaView style={ui.page}>
        {service && screen.kind === 'editor' && <MealEditor ref={pageHandle} key={screen.id} id={screen.id} meal={screen.meal} service={service} onSaved={saved} onClose={() => setScreen(screen.meal ? { kind: 'detail', id: screen.meal.id } : { kind: 'home' })} />}
        {service && screen.kind === 'detail' && (currentMeal ? <MealDetail ref={pageHandle} meal={currentMeal} service={service} onClose={() => setScreen({ kind: 'home' })} onEdit={() => setScreen({ kind: 'editor', id: currentMeal.id, meal: currentMeal })} onDeleted={() => deleted(currentMeal.id)} /> : <View style={{ padding: 24, gap: 20 }}><Text style={ui.body}>这条记录已不存在。</Text><Button title="返回记录" onPress={() => setScreen({ kind: 'home' })} /></View>)}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
    <Modal visible={storageOpen} animationType="slide" transparent onRequestClose={() => setStorageOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000050' }}><SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.paper, padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 18 }}>
        <Text style={ui.title}>只属于你的饮食记忆</Text><Text style={ui.body}>{Platform.OS === 'web' ? '此浏览器预览的数据仅保存在当前浏览器，与手机记录独立。' : '照片与文字保存在当前设备的 APP 内，无需账号或网络，不会自动上传。'}</Text>
        <Text style={ui.body}>当前没有云端备份。卸载 APP、清除应用数据或更换设备，可能导致记录丢失。</Text><Button title="知道了" onPress={() => setStorageOpen(false)} />
      </SafeAreaView></View>
    </Modal>
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><DiaryApp /></SafeAreaProvider>; }
