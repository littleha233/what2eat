import { randomUUID } from 'expo-crypto';
import type { PhotoStore } from '../core/mealService';
import type { Photo } from '../core/meals';

// Browser-only development preview. Native builds use photos.ts and the app's private files.
const prefix = 'what2eat.preview.photo.';
const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function keyFor(id: string, thumbnail = false) {
  if (!PHOTO_ID.test(id)) throw new Error('照片标识无效。');
  return `${prefix}${id}.${thumbnail ? 'thumbnail' : 'main'}`;
}

export function photoUri(photo: Photo, thumbnail = false): string {
  return localStorage.getItem(keyFor(photo.id, thumbnail)) ?? '';
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取这张照片，请重新选择。'));
    image.src = uri;
  });
}

function compress(image: HTMLImageElement, longest: number, quality: number) {
  const scale = Math.min(1, longest / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法处理照片。');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/jpeg', quality), width: canvas.width, height: canvas.height };
}

export const photos: PhotoStore = {
  async persist(uri) {
    if (!/^(blob:|data:image\/)/i.test(uri)) throw new Error('请从当前设备重新选择照片。');
    const image = await loadImage(uri);
    if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error('这张照片没有有效内容。');
    const main = compress(image, 1600, 0.82);
    const thumbnail = compress(image, 400, 0.72);
    const id = randomUUID();
    try {
      localStorage.setItem(keyFor(id), main.data);
      localStorage.setItem(keyFor(id, true), thumbnail.data);
      if (localStorage.getItem(keyFor(id)) !== main.data || localStorage.getItem(keyFor(id, true)) !== thumbnail.data) {
        throw new Error('照片未完整保存。');
      }
    } catch {
      try {
        localStorage.removeItem(keyFor(id));
        localStorage.removeItem(keyFor(id, true));
      } catch { /* Preserve the actionable save error if browser storage is entirely disabled. */ }
      throw new Error('浏览器预览的照片空间不足或存储不可用，请减少照片后重试。');
    }
    return { id, width: main.width, height: main.height };
  },
  async remove(photo) {
    localStorage.removeItem(keyFor(photo.id));
    localStorage.removeItem(keyFor(photo.id, true));
  },
};
