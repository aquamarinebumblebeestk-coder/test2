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

function hideAllViews() {
  ['classView', 'registerView', 'displayView', 'backupView'].forEach((id) => $(id).classList.add('hidden'));
}

async function showClassList() {
  revokeUrls();
  state.classId = null;
  hideAllViews();
  $('backBtn').classList.add('hidden');
  if (state.mode === 'backup') {
    $('title').textContent = 'バックアップ';
    $('backupView').classList.remove('hidden');
    return;
  }
  $('title').textContent = state.mode === 'register' ? '登録' : '表示';
  $('modeHint').textContent = state.mode === 'register'
    ? 'クラスを選んで画像を登録・削除します'
    : 'クラスを選んで画像を表示します';
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
  hideMini();
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
  preparePip(viewer.images[viewer.index].blob);
}
function moveViewer(d) {
  const next = viewer.index + d;
  if (next < 0 || next >= viewer.images.length) return;
  viewer.index = next;
  updateViewer();
}
function closeViewer() {
  $('viewer').classList.add('hidden');
  hideMini();
  $('viewerImg').removeAttribute('src');
  if (viewer.url) URL.revokeObjectURL(viewer.url);
  viewer.url = null;
  if (!isInPip()) stopPip();
}

// ---------- ピクチャ・イン・ピクチャ(他のアプリの上に小窓表示) ----------
// iPhoneでアプリの外に小窓を出せるのは動画だけなので、画像を数秒の静止動画に変換して
// その動画をピクチャ・イン・ピクチャで再生する。変換は拡大表示を開いた時点で済ませておく
// (小窓ボタンを押した瞬間に再生を始めないとiPhoneが許可しないため)。
const PIP_MAX_EDGE = 1280;
const PIP_SECONDS = 2;
const pipVideo = $('pipVideo');
pipVideo.muted = true;
const pipSupported = typeof MediaRecorder !== 'undefined'
  && typeof HTMLCanvasElement.prototype.captureStream === 'function'
  && (document.pictureInPictureEnabled || typeof pipVideo.webkitSetPresentationMode === 'function');
const pip = { token: 0, url: null, ready: false };

function isInPip() {
  return document.pictureInPictureElement === pipVideo
    || pipVideo.webkitPresentationMode === 'picture-in-picture';
}

function setPipReady(ready) {
  pip.ready = ready;
  $('viewerMini').textContent = ready || !pipSupported ? '⧉ 小窓' : '⧉ 準備中…';
}

async function imageToVideo(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, PIP_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  // 動画のサイズは偶数にする
  canvas.width = Math.max(2, Math.round(bitmap.width * scale / 2) * 2);
  canvas.height = Math.max(2, Math.round(bitmap.height * scale / 2) * 2);
  const ctx = canvas.getContext('2d');
  let frame = 0;
  const draw = () => {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // 画面が変化しないとフレームが記録されないため、目に見えない1pxだけ毎回変える
    ctx.fillStyle = `rgba(0,0,0,${(frame++ % 2) * 0.02})`;
    ctx.fillRect(0, 0, 1, 1);
  };
  draw();

  const stream = canvas.captureStream(30);
  const mimeType = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start();
  const timer = setInterval(draw, 1000 / 30);
  await new Promise((resolve) => setTimeout(resolve, PIP_SECONDS * 1000));
  clearInterval(timer);
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  bitmap.close();
  if (chunks.length === 0) throw new Error('動画を作成できませんでした');
  return new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' });
}

async function preparePip(blob) {
  const token = ++pip.token;
  setPipReady(false);
  if (!pipSupported) return;
  try {
    const video = await imageToVideo(blob);
    if (token !== pip.token) return; // 変換中に別の画像に切り替わった
    const oldUrl = pip.url;
    pip.url = URL.createObjectURL(video);
    pipVideo.src = pip.url;
    await new Promise((resolve, reject) => {
      pipVideo.onloadeddata = resolve;
      pipVideo.onerror = () => reject(new Error('動画を再生できませんでした'));
    });
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    await pipVideo.play();
    if (token === pip.token) setPipReady(true);
  } catch (err) {
    console.warn('PiP準備失敗', err);
    if (token === pip.token) setPipReady(true); // アプリ内の小窓で代用できるようにする
  }
}

function stopPip() {
  pip.token++;
  pipVideo.pause();
  pipVideo.removeAttribute('src');
  pipVideo.load();
  if (pip.url) URL.revokeObjectURL(pip.url);
  pip.url = null;
  setPipReady(false);
}

// ボタンやスワイプの操作中に同期的に呼ぶこと
function enterPip() {
  if (!pipSupported || !pip.ready || !pipVideo.src) return false;
  try {
    pipVideo.play();
    if (document.pictureInPictureEnabled && pipVideo.requestPictureInPicture) {
      pipVideo.requestPictureInPicture().catch((err) => {
        console.warn('PiP開始失敗', err);
        minimizeViewer();
      });
    } else {
      pipVideo.webkitSetPresentationMode('picture-in-picture');
    }
    return true;
  } catch (err) {
    console.warn('PiP開始失敗', err);
    return false;
  }
}

function openMini() {
  if (!enterPip()) minimizeViewer();
}

// 小窓(PiP)の「戻る」ボタンでアプリに戻ったときは拡大表示を開いておく
pipVideo.addEventListener('leavepictureinpicture', () => {
  if (!viewer.url) stopPip();
});
pipVideo.addEventListener('webkitpresentationmodechanged', () => {
  if (pipVideo.webkitPresentationMode === 'inline' && !viewer.url) stopPip();
});

// ---------- 小窓 ----------
const MINI_MIN_W = 100;
const MINI_MARGIN = 8;
const mini = $('mini');
const miniPos = loadMiniPos();

function loadMiniPos() {
  try {
    const saved = JSON.parse(localStorage.getItem('svsup-mini'));
    if (saved && saved.w) return saved;
  } catch {}
  return { x: null, y: null, w: 160 };
}
function saveMiniPos() {
  try { localStorage.setItem('svsup-mini', JSON.stringify(miniPos)); } catch {}
}

// 画面外にはみ出さないよう位置とサイズを調整して反映
function placeMini() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  miniPos.w = Math.max(MINI_MIN_W, Math.min(miniPos.w, vw - MINI_MARGIN * 2));
  mini.style.width = miniPos.w + 'px';
  const h = mini.offsetHeight;
  if (miniPos.x === null) {
    miniPos.x = vw - miniPos.w - 12;
    miniPos.y = vh - h - 90;
  }
  miniPos.x = Math.max(MINI_MARGIN, Math.min(miniPos.x, vw - miniPos.w - MINI_MARGIN));
  // ノッチ(セーフエリア)の下に収める
  const top = parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingTop) + MINI_MARGIN;
  miniPos.y = Math.max(top, Math.min(miniPos.y, vh - h - MINI_MARGIN));
  mini.style.left = miniPos.x + 'px';
  mini.style.top = miniPos.y + 'px';
}

function minimizeViewer() {
  if (!viewer.url) return;
  $('viewer').classList.add('hidden');
  $('miniImg').src = viewer.url;
  mini.classList.remove('hidden');
  if ($('miniImg').complete) placeMini();
  else $('miniImg').onload = placeMini;
  placeMini();
}
function expandMini() {
  mini.classList.add('hidden');
  $('viewer').classList.remove('hidden');
}
function hideMini() {
  mini.classList.add('hidden');
  $('miniImg').removeAttribute('src');
}

// ドラッグで移動、動かさずに離したらタップ扱いで拡大表示に戻す
let drag = null;
mini.addEventListener('pointerdown', (e) => {
  if (e.target === $('miniClose')) return;
  drag = {
    resize: e.target === $('miniResize'),
    sx: e.clientX, sy: e.clientY,
    x: miniPos.x, y: miniPos.y, w: miniPos.w,
    moved: false,
  };
  mini.setPointerCapture(e.pointerId);
});
mini.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
  if (drag.resize) {
    // 左下の角をつかんで左に引くと大きくなる(右端は固定)
    const w = Math.max(MINI_MIN_W, Math.min(drag.w - dx, drag.x + drag.w - MINI_MARGIN));
    miniPos.x = drag.x + drag.w - w;
    miniPos.w = w;
  } else {
    miniPos.x = drag.x + dx;
    miniPos.y = drag.y + dy;
  }
  placeMini();
});
function endDrag() {
  if (!drag) return;
  const tapped = !drag.moved && !drag.resize;
  drag = null;
  saveMiniPos();
  if (tapped) expandMini();
}
mini.addEventListener('pointerup', endDrag);
mini.addEventListener('pointercancel', () => { drag = null; saveMiniPos(); });
$('miniClose').onclick = closeViewer;
window.addEventListener('resize', () => {
  if (!mini.classList.contains('hidden')) placeMini();
});

$('viewerClose').onclick = closeViewer;
$('viewerMini').onclick = openMini;
$('prevBtn').onclick = () => moveViewer(-1);
$('nextBtn').onclick = () => moveViewer(1);

// 左右スワイプで前後の画像へ、下スワイプで小窓へ
let touchStart = null;
$('viewer').addEventListener('touchstart', (e) => {
  touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
$('viewer').addEventListener('touchend', (e) => {
  const start = touchStart;
  touchStart = null;
  if (!start || window.visualViewport && window.visualViewport.scale > 1.05) return;
  const dx = e.changedTouches[0].clientX - start.x;
  const dy = e.changedTouches[0].clientY - start.y;
  if (dy > 80 && dy > Math.abs(dx) * 1.5) openMini();
  else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) moveViewer(dx < 0 ? 1 : -1);
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

// ---------- バックアップ ----------
const BACKUP_FORMAT = 'svsup-backup';

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

function setBackupStatus(msg) {
  $('backupStatus').textContent = msg;
}

$('exportBtn').onclick = async () => {
  const all = await tx('readonly', (s) => s.getAll());
  if (all.length === 0) {
    alert('登録済みの画像がありません');
    return;
  }
  setBackupStatus('バックアップを作成中…');
  // 大きな文字列を1つ作らないよう、画像ごとに分けてBlobにする
  const parts = [`{"format":"${BACKUP_FORMAT}","version":1,"createdAt":${Date.now()},"images":[`];
  for (let i = 0; i < all.length; i++) {
    const item = all[i];
    const data = await blobToDataURL(item.blob);
    parts.push((i ? ',' : '') + JSON.stringify({ classId: item.classId, createdAt: item.createdAt, data }));
  }
  parts.push(']}');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const file = new File(parts, `svsup-backup-${stamp}.json`, { type: 'application/json' });

  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // iPhoneでは共有シートから「"ファイル"に保存」を選ぶ
      await navigator.share({ files: [file] });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    setBackupStatus(`${all.length}件の画像をバックアップしました`);
  } catch (err) {
    setBackupStatus(err.name === 'AbortError' ? 'キャンセルしました' : 'バックアップに失敗しました: ' + err.message);
  }
};

$('importInput').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    alert('バックアップファイルを読み込めませんでした');
    return;
  }
  if (!backup || backup.format !== BACKUP_FORMAT || !Array.isArray(backup.images)) {
    alert('svsupのバックアップファイルではありません');
    return;
  }
  const validIds = new Set(CLASSES.map((c) => c.id));
  const perClass = {};
  const items = [];
  for (const img of backup.images) {
    if (!validIds.has(img.classId) || typeof img.data !== 'string') continue;
    perClass[img.classId] = (perClass[img.classId] || 0) + 1;
    if (perClass[img.classId] > MAX_IMAGES) continue;
    const blob = await (await fetch(img.data)).blob();
    items.push({ classId: img.classId, blob, createdAt: img.createdAt || Date.now() });
  }
  if (items.length === 0) {
    alert('復元できる画像がありません');
    return;
  }
  if (!confirm(`${items.length}件の画像を復元します。\n現在の登録画像はすべて置き換わります。よろしいですか？`)) return;
  try {
    await tx('readwrite', (s) => {
      s.clear();
      items.forEach((item) => s.add(item));
    });
    setBackupStatus(`${items.length}件の画像を復元しました`);
  } catch (err) {
    alert('復元に失敗しました: ' + err.message);
  }
};

// ---------- 更新チェック ----------
// アプリは常に最新のファイルを読み込むが、iPhoneは開いたままの画面を再読み込みしないため、
// 新しいバージョンが公開されていたら更新ボタンを出す。登録画像は端末内に残るので更新しても消えない。
let loadedVersion = null;

async function fetchVersion() {
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    return (await res.json()).version;
  } catch {
    return null; // オフライン時など
  }
}

async function checkUpdate() {
  const v = await fetchVersion();
  if (!v) return;
  if (loadedVersion === null) {
    loadedVersion = v;
    $('versionLabel').textContent = v;
  } else if (v !== loadedVersion) {
    $('updateBar').classList.remove('hidden');
  }
}

$('updateBtn').onclick = () => location.reload();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkUpdate();
});
checkUpdate();

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    state.mode = tab.dataset.mode;
    if (!$('viewer').classList.contains('hidden')) minimizeViewer();
    showClassList();
  };
});

// 保存データが自動削除されないよう永続化を要求
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

showClassList();
