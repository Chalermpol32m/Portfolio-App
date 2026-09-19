/* Service worker — เก็บหน้าแอปไว้เปิดได้ตอนออฟไลน์
   ข้อมูลพอร์ตไม่ผ่านที่นี่ (ต้องสดเสมอ) แต่ app.js เก็บสำเนาล่าสุดไว้ใน localStorage */

const CACHE = 'portfolio-shell-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // ทุกคำสั่ง API เป็น POST — ปล่อยผ่าน
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // ฟอนต์และ API ให้เบราว์เซอร์จัดการเอง

  // หน้าเว็บ: เอาของใหม่ก่อน ถ้าออฟไลน์ค่อยใช้ของในแคช
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => hit))
  );
});
