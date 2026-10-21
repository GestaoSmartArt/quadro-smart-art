'use strict';
// Quadro Smart Art — app do celular. Lê a foto do quadro publicada pelo Jarvis e manda ações (a ponte é um script do Google do próprio Alequis).
// Nada de dados fica neste código: o endereço da ponte e a senha chegam pelo QR (no "#" do link), ficam só neste celular e a página nunca os envia a mais ninguém.
// A lógica (sem tela) está em Logica e é testada no Node; a parte da tela vem depois, só no navegador.

const COLUNAS = ['caixa', 'prioridade', 'hoje', 'fazendo', 'feito'];
const ROTULO = { caixa: 'Caixa de entrada', prioridade: 'Prioridades', hoje: 'Hoje', fazendo: 'Fazendo', feito: 'Feito' };
const ABA = { caixa: 'Caixa', prioridade: 'Prioridades', hoje: 'Hoje', fazendo: 'Fazendo', feito: 'Feito' };
const LIMITE = { hoje: 3, fazendo: 1 };

const Logica = {
  COLUNAS, ROTULO, ABA, LIMITE,
  clonar: x => JSON.parse(JSON.stringify(x)),
  novoId: () => Array.from(crypto.getRandomValues(new Uint8Array(9)), b => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4),
  vazia: () => ({ caixa: [], prioridade: [], hoje: [], fazendo: [], feito: [] }),
  achar(cols, id) {
    for (const c of COLUNAS) { const i = (cols[c] || []).findIndex(x => x.id === id); if (i >= 0) return { col: c, i, cartao: cols[c][i] }; }
    return null;
  },
  // motivo de não poder mover (as mesmas regras do quadro do PC), ou ''
  recusa(cols, id, para) {
    if (para === 'hoje' && (cols.hoje || []).filter(x => x.id !== id).length >= LIMITE.hoje) return 'Hoje já tem três itens. Termine ou tire um.';
    if (para === 'fazendo' && (cols.fazendo || []).filter(x => x.id !== id).length >= LIMITE.fazendo) return 'Já há um item em Fazendo. Termine-o antes de começar outro.';
    return '';
  },
  // aplica uma ação na visão local (otimista). Devolve true se mudou.
  aplicar(cols, acao, opId) {
    const a = acao || {}, f = a.id ? Logica.achar(cols, a.id) : null;
    if (a.tipo === 'adicionar') { cols.caixa.push({ id: 'tmp-' + opId, texto: String(a.texto || '').slice(0, 140), motivo: '', pendente: true }); return true; }
    if (!f) return false;
    if (a.tipo === 'editar') { f.cartao.texto = String(a.texto || '').slice(0, 140); f.cartao.pendente = true; return true; }
    if (a.tipo === 'remover') { cols[f.col].splice(f.i, 1); return true; }
    if (a.tipo === 'concluir' || (a.tipo === 'mover' && a.para === 'feito')) { if (f.col === 'feito') return false; const [c] = cols[f.col].splice(f.i, 1); c.pendente = true; cols.feito.unshift(c); return true; }
    if (a.tipo === 'mover') {
      if (!COLUNAS.includes(a.para) || Logica.recusa(cols, a.id, a.para)) return false;
      const [c] = cols[f.col].splice(f.i, 1); c.pendente = true; cols[a.para].push(c); return true;
    }
    if (a.tipo === 'ordenar') {
      if (!COLUNAS.includes(a.para) || a.para === 'feito') return false;
      if (a.para !== f.col && Logica.recusa(cols, a.id, a.para)) return false;
      const [c] = cols[f.col].splice(f.i, 1); c.pendente = true;
      const alvo = cols[a.para]; let pos = a.antes ? alvo.findIndex(x => x.id === a.antes) : -1; if (pos < 0) pos = alvo.length;
      alvo.splice(pos, 0, c); return true;
    }
    return false;
  },
  // foto do PC + ações ainda não confirmadas pelo PC = o que o celular mostra
  visao(snap, pend, aplicadas) {
    const cols = snap && snap.colunas ? Logica.clonar(snap.colunas) : Logica.vazia();
    for (const c of COLUNAS) if (!Array.isArray(cols[c])) cols[c] = [];
    const ja = new Set(aplicadas || []);
    for (const p of pend || []) if (!ja.has(p.id)) Logica.aplicar(cols, p.acao, p.id);
    return cols;
  },
  // tira de pend o que o PC já confirmou
  podar(pend, aplicadas) { const ja = new Set(aplicadas || []); return (pend || []).filter(p => !ja.has(p.id)); },
  // como o PC está: 'on' (falou há menos de 5 min), 'espera' (mais que isso), 'off' (nunca) — usa o relógio do servidor para não depender da hora do celular
  situacao(pcEm, agoraServidor) {
    if (!pcEm) return { nivel: 'off', texto: 'PC ainda não publicou o quadro' };
    const min = Math.max(0, Math.round(((agoraServidor || Date.now()) - pcEm) / 60000));
    if (min < 5) return { nivel: 'on', texto: 'PC conectado' };
    const tempo = min < 60 ? min + ' min' : min < 1440 ? Math.round(min / 60) + ' h' : Math.round(min / 1440) + ' d';
    return { nivel: 'espera', texto: 'PC sem responder há ' + tempo };
  },
  lerHash(hash) {                                                  // "#u=<endereço>&t=<senha>" -> { u, t } ou null
    const p = new URLSearchParams(String(hash || '').replace(/^#/, '')), u = p.get('u'), t = p.get('t');
    return u && t && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u) && /^[A-Fa-f0-9]{32,80}$/.test(t) ? { u, t } : null;
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = Logica;

// ============================ tela (só no navegador) ============================
if (typeof document !== 'undefined') (function () {
  const $ = id => document.getElementById(id);
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* modo privado: funciona sem lembrar */ } };
  const ler = (k, p) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : p; } catch (e) { return p; } };
  const E = { cfg: ler('qc.cfg', null), snap: ler('qc.snap', null), pend: ler('qc.pend', []), aplicadas: ler('qc.aplicadas', []), pcEm: ler('qc.pcEm', 0), aba: ler('qc.aba', 'hoje'), offset: 0, ocupado: false, instalar: null, ultimoOk: 0, falhou: false };

  // pareamento pelo QR: guarda e limpa o endereço do histórico
  const par = Logica.lerHash(location.hash);
  if (par) { E.cfg = par; guardar('qc.cfg', par); history.replaceState(null, '', location.pathname + location.search); }

  function aviso(txt) { const a = $('aviso'); a.textContent = txt; a.classList.add('ver'); clearTimeout(aviso.t); aviso.t = setTimeout(() => a.classList.remove('ver'), 3500); }
  const vib = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* sem vibração */ } };

  // ---------- rede ----------
  async function pedir(opcoes) {
    if (!E.cfg) return null;
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
      const r = opcoes
        ? await fetch(E.cfg.u, { method: 'POST', body: JSON.stringify({ t: E.cfg.t, ...opcoes }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctl.signal, cache: 'no-store' })
        : await fetch(E.cfg.u + '?t=' + encodeURIComponent(E.cfg.t) + '&de=cel&_=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      const j = await r.json();
      if (j && j.erro === 'nao_autorizado') { E.cfg = null; localStorage.removeItem('qc.cfg'); aviso('A senha do quadro mudou. Gere o código de novo no Jarvis.'); desenhar(); return null; }
      return j && j.ok ? j : null;
    } catch (e) { return null; }
  }
  function receber(j) {
    E.offset = (j.agora || Date.now()) - Date.now();
    if (j.snap) { E.snap = j.snap; guardar('qc.snap', j.snap); }
    E.aplicadas = (j.aplicadas || []).slice(-300); guardar('qc.aplicadas', E.aplicadas);
    E.pend = Logica.podar(E.pend, E.aplicadas); guardar('qc.pend', E.pend);
    E.pcEm = j.pcEm || E.pcEm; guardar('qc.pcEm', E.pcEm);
    E.ultimoOk = Date.now(); E.falhou = false;
  }
  async function sincronizar() {
    if (E.ocupado || !E.cfg) return; E.ocupado = true;
    try {
      const enviar = E.pend.filter(p => !E.aplicadas.includes(p.id));
      const j = enviar.length ? await pedir({ a: 'ops', ops: enviar.map(p => ({ id: p.id, acao: p.acao })) }) : await pedir(null);
      if (j) receber(j); else E.falhou = true;
    } finally { E.ocupado = false; desenhar(); }
  }
  function acao(a) {
    const id = Logica.novoId();
    const cols = Logica.visao(E.snap, E.pend, E.aplicadas);
    if (a.tipo === 'mover' || a.tipo === 'ordenar') { const r = Logica.recusa(cols, a.id, a.para); if (r) { aviso(r); return false; } }
    E.pend.push({ id, acao: a, ts: Date.now() }); guardar('qc.pend', E.pend); vib(); desenhar(); sincronizar(); return true;
  }

  // ---------- tela ----------
  function desenhar() {
    $('inicio').hidden = !!E.cfg; $('mais').hidden = !E.cfg; $('abas').hidden = !E.cfg; $('lista').hidden = !E.cfg;
    const est = $('estado');
    if (!E.cfg) { est.className = 'estado off'; est.innerHTML = ''; return; }
    const s = Logica.situacao(E.pcEm, Date.now() + E.offset), n = E.pend.length;
    const semNet = E.falhou && Date.now() - E.ultimoOk > 45000;
    est.className = 'estado ' + (semNet ? 'off' : s.nivel);
    est.textContent = ''; const b = document.createElement('b'); est.append(b, (semNet ? 'Sem internet' : s.texto) + (n ? ' · ' + n + ' na fila' : ''));
    const cols = Logica.visao(E.snap, E.pend, E.aplicadas);
    const abas = $('abas'); abas.textContent = '';
    for (const c of Logica.COLUNAS) {
      const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'aba'; bt.setAttribute('role', 'tab'); bt.setAttribute('aria-selected', String(c === E.aba));
      bt.append(Logica.ABA[c]); const sp = document.createElement('span'); sp.className = 'n'; sp.textContent = cols[c].length; bt.append(sp);
      bt.onclick = () => { E.aba = c; guardar('qc.aba', c); desenhar(); }; abas.append(bt);
    }
    const lista = $('lista'); lista.textContent = '';
    const itens = cols[E.aba];
    if (LIMITE[E.aba]) { const p = document.createElement('p'); p.className = 'limite'; p.textContent = itens.length + ' de ' + LIMITE[E.aba] + ' (limite do método)'; lista.append(p); }
    if (!itens.length) { const v = document.createElement('div'); v.className = 'vazio'; v.textContent = E.snap ? 'Nada em ' + Logica.ROTULO[E.aba] + '.' : 'Esperando o Jarvis publicar o quadro…'; lista.append(v); }
    for (const c of itens) {
      const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'cartao' + (c.pendente ? ' pend' : '') + (E.aba === 'feito' ? ' feito' : '');
      const t = document.createElement('div'); t.className = 't'; t.textContent = c.texto; bt.append(t);
      if (c.motivo || c.pendente) { const m = document.createElement('div'); m.className = 'm'; m.textContent = c.motivo || ''; bt.append(m); }
      bt.onclick = () => abrirCartao(c.id); lista.append(bt);
    }
  }

  // ---------- folha (menu de baixo) ----------
  function folha(titulo, montar) {
    $('folha-titulo').textContent = titulo; const corpo = $('folha-corpo'); corpo.textContent = ''; montar(corpo);
    $('folha').hidden = false; $('fundo').hidden = false; $('fundo').onclick = fechar;
    const f = corpo.querySelector('textarea, button'); if (f) setTimeout(() => f.focus(), 50);
  }
  function fechar() { $('folha').hidden = true; $('fundo').hidden = true; }
  function grupo(corpo, nome) { const g = document.createElement('div'); g.className = 'grupo'; g.textContent = nome; corpo.append(g); const l = document.createElement('div'); l.className = 'linha'; corpo.append(l); return l; }
  function botao(l, texto, fn, cls = '', off = false) { const b = document.createElement('button'); b.type = 'button'; b.className = 'acao ' + cls; b.textContent = texto; b.disabled = off; b.onclick = () => { fechar(); fn(); }; l.append(b); return b; }

  function abrirCartao(id) {
    const cols = Logica.visao(E.snap, E.pend, E.aplicadas), f = Logica.achar(cols, id); if (!f) return;
    folha(f.cartao.texto, corpo => {
      const col = f.col, ids = cols[col].map(x => x.id), i = ids.indexOf(id);
      if (col !== 'feito') botao(grupo(corpo, 'Terminou?'), '✓ Concluir', () => acao({ tipo: 'concluir', id }), 'forte');
      const destinos = Logica.COLUNAS.filter(c => c !== 'feito' && c !== col);
      const lm = grupo(corpo, col === 'feito' ? 'Reabrir em' : 'Mover para');
      for (const d of destinos) botao(lm, Logica.ROTULO[d], () => acao({ tipo: 'mover', id, para: d }));
      if (col !== 'feito' && ids.length > 1) {
        const lo = grupo(corpo, 'Ordem na coluna (o de cima é o mais importante)');
        botao(lo, '↑ Subir', () => acao({ tipo: 'ordenar', id, para: col, antes: ids[i - 1] }), '', i === 0);
        botao(lo, '↓ Descer', () => acao({ tipo: 'ordenar', id, para: col, antes: i + 2 < ids.length ? ids[i + 2] : '' }), '', i === ids.length - 1);
      }
      const lx = grupo(corpo, 'Outros');
      botao(lx, '✎ Editar', () => editar(id, f.cartao.texto));
      botao(lx, '🗑 Remover', () => { if (confirm('Remover este cartão do quadro?')) acao({ tipo: 'remover', id }); }, 'perigo');
    });
  }
  function editar(id, texto) {
    folha('Editar cartão', corpo => {
      const ta = document.createElement('textarea'); ta.maxLength = 140; ta.value = texto; corpo.append(ta);
      const l = grupo(corpo, ''); botao(l, 'Salvar', () => { const v = ta.value.trim(); if (v.length >= 2 && v !== texto) acao({ tipo: 'editar', id, texto: v }); }, 'principal'); botao(l, 'Cancelar', () => { });
    });
  }
  function novo() {
    folha('Anotar na Caixa de entrada', corpo => {
      const ta = document.createElement('textarea'); ta.maxLength = 140; ta.placeholder = 'O que precisa ser feito?'; corpo.append(ta);
      const l = grupo(corpo, ''); botao(l, 'Anotar', () => { const v = ta.value.trim(); if (v.length >= 2) { acao({ tipo: 'adicionar', texto: v }); E.aba = 'caixa'; guardar('qc.aba', 'caixa'); desenhar(); } }, 'principal'); botao(l, 'Cancelar', () => { });
    });
  }
  function menu() {
    folha('Quadro Smart Art', corpo => {
      const l = grupo(corpo, 'App');
      if (E.instalar) botao(l, '⬇ Instalar no celular', async () => { E.instalar.prompt(); try { await E.instalar.userChoice; } catch (e) { /* */ } E.instalar = null; });
      botao(l, '⟳ Atualizar agora', sincronizar);
      botao(l, 'Desconectar este celular', () => { if (confirm('Desconectar? Para voltar, é preciso gerar o código no Jarvis de novo.')) { ['qc.cfg', 'qc.snap', 'qc.pend', 'qc.aplicadas', 'qc.pcEm'].forEach(k => localStorage.removeItem(k)); E.cfg = null; E.snap = null; E.pend = []; desenhar(); } }, 'perigo');
      const p = document.createElement('p'); p.className = 'suave'; p.textContent = 'Os dados ficam no seu computador e na sua conta do Google. Este app só guarda uma cópia para consulta.'; corpo.append(p);
    });
  }

  $('mais').onclick = novo; $('menu').onclick = menu; $('atualizar').onclick = () => { aviso('Atualizando…'); sincronizar(); };
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); E.instalar = e; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
  window.addEventListener('online', sincronizar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });
  setInterval(() => { if (!document.hidden) sincronizar(); }, 30000);
  setInterval(desenhar, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* sem service worker: funciona, só não abre sem internet */ });
  desenhar(); sincronizar();
})();
