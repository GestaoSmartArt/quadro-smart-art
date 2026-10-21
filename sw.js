'use strict';
// Guarda a "casca" do app para abrir sem internet (as tarefas em si vêm do cache do próprio app, em localStorage). A ponte do Google nunca passa por aqui.
const VERSAO = 'qc-1';
const CASCA = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icone-192.png', 'icone-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCA)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;       // só arquivos do próprio app
  e.respondWith(caches.open(VERSAO).then(async c => {
    const guardado = await c.match(e.request);
    const rede = fetch(e.request).then(r => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => guardado);
    return guardado || rede;                                                          // abre na hora com o guardado e atualiza por baixo
  }));
});
