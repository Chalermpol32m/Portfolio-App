/* Service worker — กลยุทธ์ "เอาของสดก่อน ถ้าออฟไลน์ค่อยใช้ของเก่า"
   ทำให้อัปเดตโค้ดแล้วเห็นผลทันทีโดยไม่ต้องไล่ขยับเลขเวอร์ชันทุกครั้ง
   แลกกับการโหลดช้ากว่าเสี้ยววินาทีตอนเน็ตปกติ ซึ่งคุ้มกว่ามาก */

const CACHE = 'portfolio-shell-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
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
  if (req.method !== 'GET') return;                    // คำสั่ง API เป็น POST ปล่อยผ่าน
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // ฟอนต์และเซิร์ฟเวอร์ ให้เบราว์เซอร์จัดการเอง

  e.respondWith(
    fetch(req)
      .then((res) => {
        // ได้ของสดมาแล้ว เก็บสำเนาไว้เผื่อคราวหน้าออฟไลน์
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('./index.html'))
      )
  );
});
