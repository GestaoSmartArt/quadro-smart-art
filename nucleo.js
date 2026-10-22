'use strict';
// Núcleo do Jarvis para o celular: o mesmo desenho do HUD do computador (brilho, grade fina, varredura de radar, anéis tracejados, marcas, barras de áudio radiais, anéis do meio,
// marcadores triangulares, esfera de luz com hexágono e triângulo, partículas ao pensar), em versão leve: sem sombras, ~20 quadros/s em espera e ~30 em atividade, e parado quando a aba
// não está à vista (poupa a bateria). Estados: espera · pensando (consulta ao computador) · falando (voz tocando) · ouvindo (microfone).
const Nucleo = (function () {
  const TAU = Math.PI * 2, N = 48;
  const lim = a => Math.max(0, Math.min(1, a));
  const ciano = a => 'rgba(63,224,255,' + lim(a).toFixed(3) + ')', branco = a => 'rgba(215,245,255,' + lim(a).toFixed(3) + ')';
  const ALVO = { espera: [.12, .12, .03], pensando: [.45, .55, .12], falando: [.7, .22, 1], ouvindo: [.4, .3, .35] };     // energia, giro, nível das barras

  function criar(canvas, provedor) {
    const ctx = canvas.getContext && canvas.getContext('2d'); if (!ctx) return null;
    const reduzido = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, cx = 0, cy = 0, R = 0, visivelAntes = false, rodando = false, ultimo = 0, t = 0, angulo = 0, giro = .12, energia = .12, fala = .03, pens = 0;
    const esp = new Float32Array(N);
    const parts = Array.from({ length: 7 }, (_, i) => ({ a: i * TAU / 7, v: .6 + (i % 3) * .25, dir: i % 2 ? -1 : 1, r: .62 + (i % 4) * .13 }));

    function medir() {
      const b = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(120, b.width); H = Math.max(120, b.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2; R = Math.min(W, H) * .27;
    }
    const anel = (r, larg, seg, fr, rot, al) => { const passo = TAU * r / seg; ctx.setLineDash([passo * fr, passo * (1 - fr)]); ctx.lineWidth = larg; ctx.strokeStyle = ciano(al); ctx.beginPath(); ctx.arc(cx, cy, r, rot, rot + TAU); ctx.stroke(); ctx.setLineDash([]); };
    const arco = (r, larg, ini, fim, al) => { ctx.lineWidth = larg; ctx.strokeStyle = ciano(al); ctx.beginPath(); ctx.arc(cx, cy, r, ini, fim); ctx.stroke(); };
    const marcas = (r, qtd, comp, rot, al) => {
      ctx.beginPath();
      for (let i = 0; i < qtd; i++) { const a = rot + i / qtd * TAU, l = i % 10 === 0 ? comp * 2 : i % 5 === 0 ? comp * 1.4 : comp, c = Math.cos(a), s = Math.sin(a); ctx.moveTo(cx + c * r, cy + s * r); ctx.lineTo(cx + c * (r + l), cy + s * (r + l)); }
      ctx.lineWidth = 1; ctx.strokeStyle = ciano(al); ctx.stroke();
    };
    const poligono = (r, lados, rot, larg, al) => { ctx.beginPath(); for (let i = 0; i <= lados; i++) { const a = rot + i / lados * TAU; ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.lineWidth = larg; ctx.strokeStyle = ciano(al); ctx.stroke(); };

    function quadro(ts) {
      if (!rodando) return;
      requestAnimationFrame(quadro);
      const estado = (provedor && provedor()) || 'espera', alvo = ALVO[estado] || ALVO.espera;
      const passoMin = reduzido ? 400 : (estado === 'espera' ? 50 : 33);
      if (ts - ultimo < passoMin) return;
      const dt = Math.min(.1, (ts - ultimo) / 1000) || .016; ultimo = ts; t += dt;
      const vis = !!canvas.offsetParent; if (vis && !visivelAntes) medir(); visivelAntes = vis;           // acabou de aparecer: mede o tamanho de verdade
      if (!vis) return;                                                            // fora da tela: não desenha
      const k = Math.min(1, dt * 3);
      energia += (alvo[0] - energia) * k; giro += (alvo[1] * (reduzido ? .2 : 1) - giro) * k; fala += (alvo[2] - fala) * k; pens += ((estado === 'pensando' ? 1 : 0) - pens) * k;
      angulo += dt * giro;
      for (let i = 0; i < N; i++) { const env = Math.exp(-(i / N) * 1.5) * .8 + .25, alvoB = fala * (.35 + .65 * Math.abs(Math.sin(t * (3 + i * .37) + i * 1.3))) * env; esp[i] += (alvoB - esp[i]) * .35; }

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = .6 + .4 * Math.min(1, energia / .5);                       // um pouco mais nítido que no computador: tela pequena e ao sol
      let g = ctx.createRadialGradient(cx, cy, R * .2, cx, cy, R * 2);                                     // brilho de fundo
      g.addColorStop(0, ciano(.20 * energia + .05)); g.addColorStop(1, ciano(0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 2, 0, TAU); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = ciano(.07);                                                      // grade fina
      for (const m of [1.75, 2.1, 2.55]) { ctx.beginPath(); ctx.arc(cx, cy, R * m, 0, TAU); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - W / 2, cy); ctx.lineTo(cx + W / 2, cy); ctx.moveTo(cx, cy - H / 2); ctx.lineTo(cx, cy + H / 2); ctx.stroke();
      if (ctx.createConicGradient) {                                                                        // varredura de radar
        const sw = ctx.createConicGradient(angulo * 1.4, cx, cy);
        sw.addColorStop(0, ciano(0)); sw.addColorStop(.82, ciano(0)); sw.addColorStop(1, ciano(.05 + .22 * pens + .08 * energia));
        ctx.fillStyle = sw; ctx.beginPath(); ctx.arc(cx, cy, R * 1.34, 0, TAU); ctx.fill();
      }
      anel(R * 1.52, 2, 36, .62, angulo * .35, .55); anel(R * 1.44, 1, 90, .5, -angulo * .5, .35);         // anéis externos
      marcas(R * 1.30, 180, R * .035, -angulo * .22, .55); arco(R * 1.255, 1, -Math.PI / 2, -Math.PI / 2 + TAU, .35);
      ctx.beginPath();                                                                                      // barras de áudio radiais (espelhadas)
      for (let j = 0; j < N * 2; j++) { const idx = j < N ? j : N * 2 - 1 - j, a = j / (N * 2) * TAU - Math.PI / 2, c = Math.cos(a), s = Math.sin(a), ini = R * 1.04, len = 3 + esp[idx] * R * .34; ctx.moveTo(cx + c * ini, cy + s * ini); ctx.lineTo(cx + c * (ini + len), cy + s * (ini + len)); }
      ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = ciano(.9); ctx.stroke(); ctx.lineCap = 'butt';
      for (let m = 0; m < 3; m++) { const ini = angulo * .8 + m * TAU / 3; arco(R * .93, 5, ini, ini + TAU / 3 * .62, .85); }      // anéis do meio
      arco(R * .83, 1.5, -Math.PI / 2, -Math.PI / 2 + TAU, .55); anel(R * .76, 2, 48, .5, -angulo * 1.1, .8);
      for (let m = 0; m < 3; m++) {                                                                         // marcadores triangulares girando
        const a = -angulo * .6 + m * TAU / 3, rr = R * .70; ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (rr - 6), cy + Math.sin(a) * (rr - 6)); ctx.lineTo(cx + Math.cos(a + .06) * (rr + 5), cy + Math.sin(a + .06) * (rr + 5)); ctx.lineTo(cx + Math.cos(a - .06) * (rr + 5), cy + Math.sin(a - .06) * (rr + 5));
        ctx.closePath(); ctx.fillStyle = ciano(.9); ctx.fill();
      }
      const media = esp.reduce((s, v) => s + v, 0) / N, pulso = 1 + .05 * Math.sin(t * 3) + .22 * media * (estado === 'falando' ? 1.6 : 1), rN = R * .5 * pulso;      // núcleo
      const nuc = ctx.createRadialGradient(cx, cy, 0, cx, cy, rN);
      nuc.addColorStop(0, branco(.55 + .4 * energia)); nuc.addColorStop(.30, ciano(.55 + .3 * energia)); nuc.addColorStop(1, ciano(0));
      ctx.fillStyle = nuc; ctx.beginPath(); ctx.arc(cx, cy, rN, 0, TAU); ctx.fill();
      arco(R * .42 * pulso, 2, -Math.PI / 2, -Math.PI / 2 + TAU, .9); poligono(R * .30, 6, angulo * .9, 1.6, .8); poligono(R * .22, 3, -angulo * 1.3, 1.2, .7);
      if (pens > .02) for (const p of parts) {                                                              // partículas em órbita (pensando)
        p.a += dt * p.v * p.dir * (1 + giro * .4); const rr = R * p.r;
        ctx.lineWidth = 2; ctx.strokeStyle = ciano(.75 * pens); ctx.beginPath(); ctx.arc(cx, cy, rr, p.a - .30 * p.dir, p.a, p.dir < 0); ctx.stroke();
        ctx.fillStyle = branco(.95 * pens); ctx.beginPath(); ctx.arc(cx + Math.cos(p.a) * rr, cy + Math.sin(p.a) * rr, 2, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (typeof window !== 'undefined') window.addEventListener('resize', () => { if (rodando) medir(); });
    return {
      iniciar() { if (rodando) return; medir(); rodando = true; ultimo = 0; requestAnimationFrame(quadro); },
      parar() { rodando = false; },
      medir
    };
  }
  return { criar };
})();
if (typeof window !== 'undefined') window.Nucleo = Nucleo;                      // "const" de script clássico não vira propriedade de window: o app procura por window.Nucleo
if (typeof module !== 'undefined' && module.exports) module.exports = Nucleo;
