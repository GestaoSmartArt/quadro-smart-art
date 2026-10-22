'use strict';
// Guarda a "casca" do app para abrir sem internet (as tarefas em si vêm do cache do próprio app, em localStorage). A ponte do Google nunca passa por aqui.
// Atualização: com internet, SEMPRE busca a versão nova dos arquivos (espera até 4 s); sem internet ou lento, abre com a guardada. Assim uma melhoria publicada aparece na próxima vez que o app abrir.
const VERSAO = 'qc-3';
const CASCA = ['./', 'index.html', 'app.css', 'app.js', 'nucleo.js', 'manifest.webmanifest', 'icone-192.png', 'icone-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCA.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;       // só arquivos do próprio app
  e.respondWith((async () => {
    const c = await caches.open(VERSAO);
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(e.request, { cache: 'no-cache', signal: ctl.signal }); clearTimeout(t);
      if (r && r.ok) c.put(e.request, r.clone());
      return r;
    } catch (x) { return (await c.match(e.request)) || Response.error(); }
  })());
});
