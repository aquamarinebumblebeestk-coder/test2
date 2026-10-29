'use strict';

const CLASSES = [
  { id: 'elf', name: 'エルフ', color: 'linear-gradient(135deg,#3fae5a,#1f6e36)' },
  { id: 'royal', name: 'ロイヤル', color: 'linear-gradient(135deg,#e0b23a,#a07415)' },
  { id: 'witch', name: 'ウィッチ', color: 'linear-gradient(135deg,#4f7de0,#2a4aa0)' },
  { id: 'dragon', name: 'ドラゴン', color: 'linear-gradient(135deg,#e07a3a,#a8441a)' },
  { id: 'nightmare', name: 'ナイトメア', color: 'linear-gradient(135deg,#b04ad0,#5e1f80)' },
  { id: 'bishop', name: 'ビショップ', color: 'linear-gradient(135deg,#c9c3a8,#8a8366)' },
  { id: 'nemesis', name: 'ネメシス', color: 'linear-gradient(135deg,#3ac6c9,#1a7a80)' },
];
const MAX_IMAGES = 5;
const MAX_EDGE = 2400; // 保存時の長辺の上限(px)

// ---------- IndexedDB ----------
const DB_NAME = 'svsup';
const STORE = 'images';
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('classId', 'classId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function getImages(classId) {
  const list = await tx('readonly', (s) => s.index('classId').getAll(classId));
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

async function countAll() {
  const all = await tx('readonly', (s) => s.getAll());
  const counts = {};
  for (const item of all) counts[item.classId] = (counts[item.classId] || 0) + 1;
  return counts;
}

const addImage = (classId, blob) =>
  tx('readwrite', (s) => s.add({ classId, blob, createdAt: Date.now() }));
const deleteImage = (id) => tx('readwrite', (s) => s.delete(id));

// ---------- 画像処理 ----------
async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // デコードできない場合はそのまま保存
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 3 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', 0.92));
}

// ---------- 画面 ----------
const $ = (id) => document.getElementById(id);
const state = { mode: 'register', classId: null, urls: [] };

function revokeUrls() {
  state.urls.forEach((u) => URL.revokeObjectURL(u));
  state.urls = [];
}
function urlFor(blob) {
  const u = URL.createObjectURL(blob);
  state.urls.push(u);
  return u;
}

async function showClassList() {
  revokeUrls();
  state.classId = null;
  $('title').textContent = state.mode === 'register' ? '登録' : '表示';
  $('modeHint').textContent = state.mode === 'register'
    ? 'クラスを選んで画像を登録・削除します'
    : 'クラスを選んで画像を表示します';
  $('backBtn').classList.add('hidden');
  $('registerView').classList.add('hidden');
  $('displayView').classList.add('hidden');
  $('classView').classList.remove('hidden');

  const counts = await countAll();
  const grid = $('classGrid');
  grid.innerHTML = '';
  for (const c of CLASSES) {
    const btn = document.createElement('button');
    btn.className = 'class-btn';
    btn.style.background = c.color;
    btn.textContent = c.name;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = `${counts[c.id] || 0}/${MAX_IMAGES}`;
    btn.appendChild(badge);
    btn.onclick = () => openClass(c.id);
    grid.appendChild(btn);
  }
}

function openClass(classId) {
  state.classId = classId;
  $('title').textContent = CLASSES.find((c) => c.id === classId).name;
  $('backBtn').classList.remove('hidden');
  $('classView').classList.add('hidden');
  window.scrollTo(0, 0);
  if (state.mode === 'register') renderRegister();
  else renderDisplay();
}

async function renderRegister() {
  revokeUrls();
  const images = await getImages(state.classId);
  $('registerView').classList.remove('hidden');
  $('regCount').textContent = images.length;
  $('regEmpty').classList.toggle('hidden', images.length > 0);
  const full = images.length >= MAX_IMAGES;
  $('addBtn').classList.toggle('hidden', full);
  $('fullMsg').classList.toggle('hidden', !full);

  const list = $('regList');
  list.innerHTML = '';
  images.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    const img = document.createElement('img');
    img.src = urlFor(item.blob);
    img.onclick = () => openViewer(images, i);
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.setAttribute('aria-label', '削除');
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('この画像を削除しますか？')) return;
      await deleteImage(item.id);
      renderRegister();
    };
    div.append(img, del);
    list.appendChild(div);
  });
}

async function renderDisplay() {
  revokeUrls();
  const images = await getImages(state.classId);
  $('displayView').classList.remove('hidden');
  $('dispEmpty').classList.toggle('hidden', images.length > 0);
  const list = $('dispList');
  list.innerHTML = '';
  images.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    const img = document.createElement('img');
    img.src = urlFor(item.blob);
    img.onclick = () => openViewer(images, i);
    div.appendChild(img);
    list.appendChild(div);
  });
}

// ---------- 拡大表示 ----------
const viewer = { images: [], index: 0, url: null };

function openViewer(images, index) {
  viewer.images = images;
  viewer.index = index;
  $('viewerNav').classList.toggle('hidden', images.length < 2);
  $('viewer').classList.remove('hidden');
  updateViewer();
}
function updateViewer() {
  if (viewer.url) URL.revokeObjectURL(viewer.url);
  viewer.url = URL.createObjectURL(viewer.images[viewer.index].blob);
  $('viewerImg').src = viewer.url;
  $('viewerPos').textContent = `${viewer.index + 1} / ${viewer.images.length}`;
  $('prevBtn').disabled = viewer.index === 0;
  $('nextBtn').disabled = viewer.index === viewer.images.length - 1;
}
function moveViewer(d) {
  const next = viewer.index + d;
  if (next < 0 || next >= viewer.images.length) return;
  viewer.index = next;
  updateViewer();
}
function closeViewer() {
  $('viewer').classList.add('hidden');
  $('viewerImg').removeAttribute('src');
  if (viewer.url) URL.revokeObjectURL(viewer.url);
  viewer.url = null;
}

$('viewerClose').onclick = closeViewer;
$('prevBtn').onclick = () => moveViewer(-1);
$('nextBtn').onclick = () => moveViewer(1);

// 左右スワイプで前後の画像へ
let touchX = null;
$('viewer').addEventListener('touchstart', (e) => {
  touchX = e.touches.length === 1 ? e.touches[0].clientX : null;
}, { passive: true });
$('viewer').addEventListener('touchend', (e) => {
  if (touchX === null || window.visualViewport && window.visualViewport.scale > 1.05) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 60) moveViewer(dx < 0 ? 1 : -1);
  touchX = null;
});

// ---------- イベント ----------
$('fileInput').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !state.classId) return;
  const current = await getImages(state.classId);
  if (current.length >= MAX_IMAGES) {
    alert('登録できるのは最大5件までです');
    return;
  }
  try {
    await addImage(state.classId, await shrinkImage(file));
  } catch (err) {
    alert('画像の保存に失敗しました: ' + err.message);
  }
  renderRegister();
};

$('backBtn').onclick = showClassList;

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    state.mode = tab.dataset.mode;
    closeViewer();
    showClassList();
  };
});

// 保存データが自動削除されないよう永続化を要求
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

showClassList();
