const CACHE = 'dino-link-v2'
const scope = self.location.pathname.replace(/link-sw\.js$/, '')
const SHELL = [`${scope}link.html`, `${scope}dino.svg`, `${scope}link-manifest.webmanifest`]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api') || url.port === '42617') return

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && url.origin === self.location.origin) {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put(request, copy))
      }
      return response
    })),
  )
})
