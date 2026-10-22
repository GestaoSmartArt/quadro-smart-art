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
  // ---- conversa com o Jarvis ----
  CHIPS: ['O que tenho hoje?', 'Vai chover hoje?', 'Quadro de hoje', 'Contas da semana', 'Quem começa amanhã?', 'Resumo do WhatsApp'],
  pinValido: p => /^[0-9]{4,8}$/.test(String(p || '')),
  bytesDeBase64(b64) { const s = atob(String(b64 || '')), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; },
  motivoPin(r) {
    if (!r) return 'O computador não respondeu. Ele pode estar desligado ou sem internet.';
    if (r.ok) return '';
    if (r.motivo === 'errado') return 'PIN errado. Restam ' + r.restantes + ' tentativa(s).';
    if (r.motivo === 'bloqueado') return 'Muitas tentativas. Espere ' + r.minutos + ' min.';
    if (r.motivo === 'sem_pin') return 'Ainda não existe PIN. No computador, diga: "Jarvis, criar um PIN novo no celular".';
    return 'Não consegui entrar.';
  },
  // coloca as respostas do PC nas bolhas que esperavam (casa pelo id da mensagem)
  mesclar(chat, respostas) {
    const por = new Map((respostas || []).map(r => [r.id, r]));
    return chat.map(b => { const r = b.estado === 'espera' && por.get(b.id); return r && r.tipo === 'texto' ? { ...b, texto: String(r.texto || ''), estado: 'ok', sessaoInvalida: !!r.sessaoInvalida } : b; });
  },
  sessaoViva: s => !!(s && s.codigo && s.ate > Date.now()),
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
  const E = { cfg: ler('qc.cfg', null), snap: ler('qc.snap', null), pend: ler('qc.pend', []), aplicadas: ler('qc.aplicadas', []), pcEm: ler('qc.pcEm', 0), aba: ler('qc.aba', 'hoje'), offset: 0, ocupado: false, instalar: null, ultimoOk: 0, falhou: false,
    vista: ler('qc.vista', 'quadro'), chat: [], ouvindo: false, ocupadoChat: false, audios: {}, tocando: null, player: null, aberto: null };
  const lerSessao = () => { try { return JSON.parse(sessionStorage.getItem('qc.sessao') || 'null'); } catch (e) { return null; } };
  const gravarSessao = s => { try { if (s) sessionStorage.setItem('qc.sessao', JSON.stringify(s)); else sessionStorage.removeItem('qc.sessao'); } catch (e) { /* sem sessionStorage: pede o PIN a cada abertura */ } };
  E.sessao = lerSessao();                                          // o PIN nunca é guardado; só o código da sessão (30 min), que some ao fechar a aba

  // pareamento pelo QR: guarda e limpa o endereço do histórico
  const par = Logica.lerHash(location.hash);
  if (par) { E.cfg = par; guardar('qc.cfg', par); history.replaceState(null, '', location.pathname + location.search); }

  function aviso(txt) { const a = $('aviso'); a.textContent = txt; a.classList.add('ver'); clearTimeout(aviso.t); aviso.t = setTimeout(() => a.classList.remove('ver'), 3500); }
  const vib = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* sem vibração */ } };

  // ---------- rede ----------
  async function pedir(opcoes, extra) {
    if (!E.cfg) return null;
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
      const r = opcoes
        ? await fetch(E.cfg.u, { method: 'POST', body: JSON.stringify({ t: E.cfg.t, ...opcoes }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctl.signal, cache: 'no-store' })
        : await fetch(E.cfg.u + '?t=' + encodeURIComponent(E.cfg.t) + '&de=cel' + (extra || '') + '&_=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
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
    const jv = !!E.cfg && E.vista === 'jarvis';
    $('inicio').hidden = !!E.cfg; $('mais').hidden = !E.cfg || jv; $('abas').hidden = !E.cfg || jv; $('lista').hidden = !E.cfg || jv;
    $('vistas').hidden = !E.cfg; $('vista-jarvis').hidden = !jv; $('titulo').textContent = jv ? 'Jarvis' : 'Quadro';
    $('v-quadro').setAttribute('aria-selected', String(!jv)); $('v-jarvis').setAttribute('aria-selected', String(jv));
    const est = $('estado');
    if (!E.cfg) { est.className = 'estado off'; est.innerHTML = ''; return; }
    const s = Logica.situacao(E.pcEm, Date.now() + E.offset), n = E.pend.length;
    const semNet = E.falhou && Date.now() - E.ultimoOk > 45000;
    est.className = 'estado ' + (semNet ? 'off' : s.nivel);
    est.textContent = ''; const b = document.createElement('b'); est.append(b, (semNet ? 'Sem internet' : s.texto) + (n ? ' · ' + n + ' na fila' : ''));
    if (jv) { desenharJarvis(); return; }
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
      const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'cartao' + (c.pendente ? ' pend' : '') + (E.aba === 'feito' ? ' feito' : '') + (E.aberto === c.id ? ' aberto' : '');
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
  function fechar() { $('folha').hidden = true; $('fundo').hidden = true; if (E.aberto) { E.aberto = null; desenhar(); } }
  function grupo(corpo, nome) { const g = document.createElement('div'); g.className = 'grupo'; g.textContent = nome; corpo.append(g); const l = document.createElement('div'); l.className = 'linha'; corpo.append(l); return l; }
  function botao(l, texto, fn, cls = '', off = false) { const b = document.createElement('button'); b.type = 'button'; b.className = 'acao ' + cls; b.textContent = texto; b.disabled = off; b.onclick = () => { fechar(); fn(); }; l.append(b); return b; }

  function abrirCartao(id) {
    const cols = Logica.visao(E.snap, E.pend, E.aplicadas), f = Logica.achar(cols, id); if (!f) return;
    E.aberto = id; desenhar();                                       // o cartão aberto fica laranja (cor de "selecionado" no HUD)
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
      if (Logica.sessaoViva(E.sessao)) botao(l, 'Sair da conversa do Jarvis', () => { E.sessao = null; E.chat = []; gravarSessao(null); desenhar(); });
      botao(l, 'Desconectar este celular', () => { if (confirm('Desconectar? Para voltar, é preciso gerar o código no Jarvis de novo.')) { ['qc.cfg', 'qc.snap', 'qc.pend', 'qc.aplicadas', 'qc.pcEm'].forEach(k => localStorage.removeItem(k)); E.cfg = null; E.snap = null; E.pend = []; E.sessao = null; E.chat = []; gravarSessao(null); desenhar(); } }, 'perigo');
      const p = document.createElement('p'); p.className = 'suave'; p.textContent = 'Os dados ficam no seu computador e na sua conta do Google. Este app só guarda uma cópia para consulta.'; corpo.append(p);
    });
  }

  // ---------- conversa com o Jarvis ----------
  const voz = () => { try { return localStorage.getItem('qc.ler') === '1'; } catch (e) { return false; } };
  function falar(txt) {
    try { if (!voz() || !window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(String(txt).slice(0, 600)); u.lang = 'pt-BR'; speechSynthesis.speak(u); } catch (e) { /* sem voz no aparelho */ }
  }
  function desenharJarvis() {
    const vivo = Logica.sessaoViva(E.sessao);
    $('pin-tela').hidden = vivo; $('chat-tela').hidden = !vivo;
    if (!vivo) { E.sessao = null; gravarSessao(null); return; }
    const chips = $('chips'); if (!chips.childNodes.length) for (const c of Logica.CHIPS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = c; b.onclick = () => perguntar(c); chips.append(b); }
    $('ler').checked = voz(); $('mic').hidden = !(window.SpeechRecognition || window.webkitSpeechRecognition);
    const conv = $('conversa'); conv.textContent = '';
    if (!E.chat.length) { const v = document.createElement('div'); v.className = 'vazio'; v.textContent = 'Pergunte algo ou toque numa sugestão. Eu consulto e anoto; o resto fica no computador.'; conv.append(v); }
    for (const b of E.chat) {
      const d = document.createElement('div'); d.className = 'bolha ' + b.de + (b.estado === 'espera' ? ' espera' : '');
      const q = document.createElement('span'); q.className = 'quem'; q.textContent = b.de === 'eu' ? 'Você' : 'Jarvis'; d.append(q, document.createTextNode(b.texto));
      if (b.de === 'jarvis' && b.estado === 'ok' && b.audio === 'esperando') { const v = document.createElement('span'); v.className = 'voz'; v.textContent = 'gerando a voz…'; d.append(v); }
      if (b.de === 'jarvis' && b.estado === 'ok' && b.audio === 'pronto' && E.audios[b.id]) {
        const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'ouvir' + (E.tocando === b.id ? ' tocando' : ''); bt.textContent = E.tocando === b.id ? '■ Parar' : '▶ Ouvir a voz do Jarvis'; bt.onclick = () => tocar(b.id); d.append(bt);
      }
      conv.append(d);
    }
    window.scrollTo(0, document.body.scrollHeight);
  }
  async function postar(id, msg) { const j = await pedir({ a: 'msg', msgs: [{ id, ...msg }] }); return !!j; }
  async function esperar(id, limite) {                             // o PC consulta de 3 em 3 s com a conversa aberta; aqui olhamos a cada 2,5 s
    const t0 = Date.now();
    while (Date.now() - t0 < limite) {
      await new Promise(r => setTimeout(r, 2500));
      const j = await pedir(null, '&chat=1'); const r = j && (j.respostas || []).find(x => x.id === id); if (r) return r;
    }
    return null;
  }
  async function entrarPin() {
    const pin = $('pin').value.trim(), msg = $('pin-msg');
    if (!Logica.pinValido(pin)) { msg.textContent = 'O PIN tem 4 a 8 números.'; return; }
    if (E.ocupadoChat) return; E.ocupadoChat = true; msg.textContent = 'Conferindo com o computador…'; $('pin-ok').disabled = true;
    try {
      const id = Logica.novoId(); let r = null;
      if (await postar(id, { tipo: 'pin', pin })) r = await esperar(id, 45000); else msg.textContent = 'Sem internet.';
      $('pin').value = '';
      if (r && r.ok && r.codigo) { E.sessao = { codigo: r.codigo, ate: Date.now() + (r.minutos || 30) * 60000 }; gravarSessao(E.sessao); msg.textContent = ''; }
      else if (msg.textContent !== 'Sem internet.') msg.textContent = Logica.motivoPin(r);
    } finally { E.ocupadoChat = false; $('pin-ok').disabled = false; desenhar(); }
  }
  async function perguntar(texto) {
    texto = String(texto || '').trim(); if (!texto || E.ocupadoChat) return;
    if (!Logica.sessaoViva(E.sessao)) { E.sessao = null; gravarSessao(null); desenhar(); return; }
    E.ocupadoChat = true; $('texto').value = '';
    const id = Logica.novoId();
    E.chat.push({ id: 'u' + id, de: 'eu', texto }, { id, de: 'jarvis', texto: 'Consultando o computador…', estado: 'espera' }); desenhar();
    let final = '', respondeuTexto = false;
    try {
      if (!(await postar(id, { tipo: 'texto', texto: texto.slice(0, 300), sessao: E.sessao.codigo }))) final = 'Sem internet. Tente de novo.';
      else {
        const r = await esperar(id, 50000);
        if (!r) final = 'O computador não respondeu. Ele pode estar desligado; o quadro continua funcionando na outra aba.';
        else { respondeuTexto = !r.sessaoInvalida && !!r.texto; E.chat = Logica.mesclar(E.chat, [r]); final = r.texto || ''; if (r.sessaoInvalida) { E.sessao = null; gravarSessao(null); } else { E.sessao.ate = Date.now() + 30 * 60000; gravarSessao(E.sessao); } }
      }
    } finally {
      E.chat = E.chat.map(b => (b.id === id ? { ...b, texto: b.estado === 'espera' ? final : b.texto, estado: 'ok', audio: respondeuTexto ? 'esperando' : 'sem' } : b));
      E.ocupadoChat = false; desenhar();
      if (respondeuTexto) buscarVoz(id, final); else falar(final);
    }
  }
  // Voz do Jarvis: o computador gera o áudio com a voz de sempre e o manda pela ponte (alguns segundos depois do texto). Sem áudio a tempo, cai na voz do aparelho (só se "falar" estiver ligado).
  async function buscarVoz(id, texto) {
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < 45000 && E.cfg) {
      await new Promise(r => setTimeout(r, 2000));
      const j = await pedir(null, '&chat=1');
      if (j && (j.audios || []).includes(id)) {
        const a = await pedir(null, '&a=audio&id=' + encodeURIComponent(id));
        if (a && a.b64) { E.audios[id] = URL.createObjectURL(new Blob([Logica.bytesDeBase64(a.b64)], { type: a.mime || 'audio/mpeg' })); ok = true; }
        break;
      }
    }
    E.chat = E.chat.map(b => (b.id === id ? { ...b, audio: ok ? 'pronto' : 'sem' } : b));
    if (E.vista === 'jarvis') desenhar();
    if (ok && voz()) tocar(id); else if (!ok) falar(texto);
  }
  function tocar(id) {
    try {
      if (E.player) { E.player.pause(); E.player = null; }
      if (E.tocando === id) { E.tocando = null; desenhar(); return; }
      const url = E.audios[id]; if (!url) return;
      const p = new Audio(url); E.player = p; E.tocando = id; desenhar();
      p.onended = p.onerror = () => { if (E.tocando === id) { E.tocando = null; E.player = null; desenhar(); } };
      p.play().catch(() => { E.tocando = null; desenhar(); aviso('Toque em "Ouvir a voz do Jarvis" para escutar.'); });
    } catch (e) { E.tocando = null; }
  }
  $('v-quadro').onclick = () => { E.vista = 'quadro'; guardar('qc.vista', 'quadro'); desenhar(); };
  $('v-jarvis').onclick = () => { E.vista = 'jarvis'; guardar('qc.vista', 'jarvis'); desenhar(); };
  $('pin-ok').onclick = entrarPin; $('pin').addEventListener('keydown', e => { if (e.key === 'Enter') entrarPin(); });
  $('enviar').onclick = () => perguntar($('texto').value);
  $('texto').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); perguntar($('texto').value); } });
  $('ler').onchange = e => { try { localStorage.setItem('qc.ler', e.target.checked ? '1' : '0'); } catch (x) { /* sem armazenamento */ } if (!e.target.checked && window.speechSynthesis) speechSynthesis.cancel(); };
  $('mic').onclick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    if (E.ouvindo && E.rec) { E.rec.stop(); return; }
    const rec = new SR(); E.rec = rec; rec.lang = 'pt-BR'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = ev => { const t = ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript; if (t) { $('texto').value = t; perguntar(t); } };
    rec.onend = () => { E.ouvindo = false; $('mic').classList.remove('ouvindo'); }; rec.onerror = () => { E.ouvindo = false; $('mic').classList.remove('ouvindo'); aviso('Não consegui ouvir. Tente de novo ou escreva.'); };
    try { rec.start(); E.ouvindo = true; $('mic').classList.add('ouvindo'); } catch (x) { aviso('O microfone não está disponível.'); }
  };

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
