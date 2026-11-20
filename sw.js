// Service worker แบบเน้นเครือข่ายก่อน: ออนไลน์ได้ข้อมูลใหม่เสมอ ออฟไลน์ยังเปิดหน้าแอปได้
const CACHE = 'massage-share-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request)),
  );
});
