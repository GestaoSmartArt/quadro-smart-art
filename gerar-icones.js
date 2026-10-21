// Gera os ícones do app (PNG) sem nenhuma biblioteca: fundo petróleo com três colunas (o quadro) em latão, terracota e creme.
// Uso: node gerar-icones.js   -> icone-192.png, icone-512.png (cantos arredondados) e icone-maskable-512.png (quadrado cheio, para o Android recortar)
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const PETROLEO = [15, 59, 70], LATAO = [201, 168, 76], TERRACOTA = [196, 98, 45], CREME = [242, 233, 216];

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(tipo, dados) { const t = Buffer.from(tipo), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(dados.length); c.writeUInt32BE(crc32(Buffer.concat([t, dados]))); return Buffer.concat([l, t, dados, c]); }
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const bruto = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { bruto[y * (w * 4 + 1)] = 0; rgba.copy(bruto, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(bruto, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const dentro = (x, y, x0, y0, x1, y1, r) => {                       // retângulo arredondado
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x, cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
function desenhar(N, { cantos, margem }) {
  const px = Buffer.alloc(N * N * 4), S = 3, u = N / 100;           // coordenadas em "centésimos" do ícone; 3x3 amostras por pixel
  const barras = [[LATAO, 45], [TERRACOTA, 26], [CREME, 37]];   // cor, topo de cada coluna (o desenho fica centralizado: colunas de 14 com 4 de vão)
  const m = margem, esc = v => 50 + (v - 50) * (1 - m * 2 / 100);  // encolhe o desenho para a "zona segura" do ícone maskable
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const X = (x + (sx + .5) / S) / u, Y = (y + (sy + .5) / S) / u;
      if (cantos && !dentro(X, Y, 0, 0, 100, 100, 22)) continue;
      let cor = PETROLEO;
      barras.forEach((bar, i) => { const x0 = esc(25 + i * 18), x1 = esc(39 + i * 18), y0 = esc(bar[1]), y1 = esc(76); if (dentro(X, Y, x0, y0, x1, y1, 3.2)) cor = bar[0]; });
      r += cor[0]; g += cor[1]; b += cor[2]; a++;
    }
    const k = (y * N + x) * 4, n = S * S;
    px[k] = a ? Math.round(r / a) : 0; px[k + 1] = a ? Math.round(g / a) : 0; px[k + 2] = a ? Math.round(b / a) : 0; px[k + 3] = Math.round(255 * a / n);
  }
  return png(N, N, px);
}
const aqui = __dirname;
fs.writeFileSync(path.join(aqui, 'icone-192.png'), desenhar(192, { cantos: true, margem: 0 }));
fs.writeFileSync(path.join(aqui, 'icone-512.png'), desenhar(512, { cantos: true, margem: 0 }));
fs.writeFileSync(path.join(aqui, 'icone-maskable-512.png'), desenhar(512, { cantos: false, margem: 8 }));
console.log('ícones gerados em', aqui);
