// Etiquetas con QR para imprimir (Niimbot, Phomemo, Brother, etc.).
// Cada etiqueta = producto + talla. Se generan como imagen del tamaño exacto.
import { state, sizesOf, dropById } from './db.js';
import { ensureProductCode, variantCode, loadScript } from './codes.js';
import { $, $$, esc, Q, int, num, sheet, toast } from './ui.js';

const PX_PER_MM = 12; // ~300 dpi: nítido en impresoras de 203 y 300 dpi
const FONT = 'Helvetica, Arial, sans-serif';

export const labelSize = () => ({
  w: Number(state.settings.label_w) || 40,
  h: Number(state.settings.label_h) || 30,
});

async function qrModules(text) {
  await loadScript('js/vendor/qrcode.js');
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return { n, dark: (r, c) => qr.isDark(r, c) };
}

function fitText(ctx, text, maxW, size, weight = 700, min = 14) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) return s;
    s -= 1;
  } while (s > min);
  return s;
}

function ellipsis(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function wrapLines(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW || !line) line = test;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsis(ctx, lines.slice(maxLines - 1).join(' '), maxW);
    return kept;
  }
  return lines.map((l) => ellipsis(ctx, l, maxW));
}

// Dibuja una etiqueta y regresa el canvas.
export async function renderLabel(p, size) {
  const { w, h } = labelSize();
  const mm = PX_PER_MM;
  const W = Math.round(w * mm);
  const H = Math.round(h * mm);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  // Lo más visible: TALLA y PRECIO (arriba a la derecha). Abajo, nombre, tipo y drop.
  const m = Math.round(1.4 * mm);
  const code = variantCode(p, size);
  const bottomH = Math.round(Math.max(7, h * 0.27) * mm); // franja de nombre + tipo/drop
  const topH = H - 2 * m - bottomH; // zona de QR, talla y precio
  const codeH = Math.round(2.2 * mm);

  // QR (módulos en píxeles enteros para que la impresora térmica lo deje nítido)
  const qr = await qrModules(code);
  const quiet = 1;
  const maxQr = Math.min(topH - codeH, Math.round(W * 0.4));
  const mod = Math.max(1, Math.floor(maxQr / (qr.n + quiet * 2)));
  const qrPx = mod * (qr.n + quiet * 2);
  const qx = m - mod * quiet;
  const qy = m - mod * quiet;
  for (let r = 0; r < qr.n; r++)
    for (let col = 0; col < qr.n; col++) if (qr.dark(r, col)) ctx.fillRect(qx + (col + quiet) * mod, qy + (r + quiet) * mod, mod, mod);
  const codeSize = fitText(ctx, code, qrPx - 2 * mod, Math.round(1.9 * mm), 700, 9);
  ctx.font = `700 ${codeSize}px ${FONT}`;
  ctx.fillText(code, qx + mod, qy + qrPx + codeSize * 0.95);

  // Columna derecha: talla (caja negra) y precio
  const rx = qx + qrPx + Math.round(1.2 * mm);
  const rw = W - m - rx;
  const priceH = Math.round(topH * 0.36);
  const boxH = topH - priceH - Math.round(0.8 * mm);
  ctx.fillRect(rx, m, rw, boxH);
  const sizeText = String(size).toUpperCase();
  const sizeFont = fitText(ctx, sizeText, rw - Math.round(2 * mm), Math.round(boxH * 0.86), 900, 20);
  ctx.font = `900 ${sizeFont}px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sizeText, rx + rw / 2, m + boxH / 2 + sizeFont * 0.04);
  ctx.fillStyle = '#000';
  // Precio sin centavos cuando es cerrado (Q 220) para que se vea más grande
  const price = Number(p.price) || 0;
  const priceText = Number.isInteger(price) ? `Q ${int(price)}` : Q(price);
  const priceFont = fitText(ctx, priceText, rw, Math.round(priceH * 0.86), 900, 14);
  ctx.font = `900 ${priceFont}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(priceText, rx + rw / 2, m + topH - Math.round(0.9 * mm));
  ctx.textAlign = 'left';

  // Franja inferior: línea divisoria, nombre (negrita) y tipo · drop
  const by = H - m - bottomH;
  ctx.fillRect(m, by + Math.round(0.3 * mm), W - 2 * m, Math.max(2, Math.round(0.25 * mm)));
  const tw = W - 2 * m;
  const nameFont = Math.round(Math.min(3.2, bottomH / mm * 0.42) * mm);
  ctx.font = `800 ${nameFont}px ${FONT}`;
  ctx.fillText(ellipsis(ctx, p.name, tw), m, by + Math.round(0.9 * mm) + nameFont);
  const sub = [p.type, dropById(p.drop_id)?.name].filter(Boolean).join(' · ');
  // Se achica un poco si no cabe, antes de cortar con "…"
  const subFont = fitText(ctx, sub, tw, Math.round(nameFont * 0.78), 500, Math.round(nameFont * 0.58));
  ctx.font = `500 ${subFont}px ${FONT}`;
  ctx.fillText(ellipsis(ctx, sub, tw), m, H - m - Math.round(0.2 * mm));
  return c;
}

const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/png'));

function printLabels(items) {
  const { w, h } = labelSize();
  const area = document.createElement('div');
  area.id = 'print-area';
  area.innerHTML = items.flatMap(({ url, qty }) => Array.from({ length: qty }, () => `<div class="print-label"><img src="${url}" alt=""></div>`)).join('');
  const style = document.createElement('style');
  style.id = 'print-style';
  style.textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }
    @media print {
      body > *:not(#print-area) { display: none !important; }
      #print-area { display: block !important; }
      .print-label { width: ${w}mm; height: ${h}mm; page-break-after: always; break-after: page; overflow: hidden; }
      .print-label img { width: ${w}mm; height: ${h}mm; display: block; }
    }
    #print-area { display: none; }`;
  document.head.appendChild(style);
  document.body.appendChild(area);
  const cleanup = () => {
    area.parentNode?.removeChild(area);
    style.parentNode?.removeChild(style);
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 150);
  setTimeout(cleanup, 60000);
}

// Hoja para elegir cuántas etiquetas de cada talla y mandarlas a imprimir.
// `preset` = { M: 10, L: 5 } sugiere cantidades (ej. lo que llegó de producción).
export async function openLabels(p, preset) {
  try {
    await ensureProductCode(p);
  } catch (e) {
    return toast('No se pudo asignar el código: ' + e.message, 'error');
  }
  const { w, h } = labelSize();
  const sizes = sizesOf(p).filter((s) => s in (p.stock || {}) || (preset && preset[s]));
  const qtyOf = (s) => (preset ? Number(preset[s]) || 0 : Math.max(0, Number(p.stock?.[s]) || 0));

  sheet({
    title: 'Etiquetas',
    body: `
      <p class="muted small" style="margin-top:0">${esc(p.name)} · código <b>${esc(p.code)}</b> · etiqueta de ${w} × ${h} mm</p>
      <div class="label-preview"><img id="lbl-prev" alt="Vista previa de la etiqueta"></div>
      <div class="section"><h2>¿Cuántas de cada talla?</h2></div>
      ${
        sizes.length
          ? `<div class="list">${sizes
              .map(
                (s) => `<div class="row lbl-row" data-size="${esc(s)}">
                  <button type="button" class="size-btn" data-prev="${esc(s)}">${esc(s)}<small>${int(p.stock?.[s] || 0)} en stock</small></button>
                  <div class="row-main"></div>
                  <div class="stepper"><button type="button" data-step="-1">−</button><input inputmode="numeric" data-qty="${esc(s)}" value="${qtyOf(s)}"><button type="button" data-step="1">+</button></div>
                </div>`
              )
              .join('')}</div>`
          : '<p class="muted">Este producto no tiene tallas registradas. Agrégalas en el producto.</p>'
      }
      <p class="muted small" id="lbl-total" style="margin:10px 0"></p>
      <div class="form">
        <button class="btn primary block" type="button" id="lbl-share">Compartir para imprimir</button>
        <button class="btn block" type="button" id="lbl-print">Imprimir (AirPrint / computadora)</button>
        <p class="muted small" style="margin:0">
          <b>Niimbot / Phomemo:</b> toca "Compartir", guarda las imágenes y en la app de tu impresora elige
          <i>Imagen</i>, el tamaño ${w} × ${h} mm y el número de copias. Cada imagen trae en el nombre cuántas copias imprimir.
        </p>
      </div>`,
    async onMount(root) {
      const qty = () => Object.fromEntries($$('[data-qty]', root).map((i) => [i.dataset.qty, Math.max(0, Math.round(num(i.value)))]));
      const updateTotal = () => {
        const q = qty();
        const total = Object.values(q).reduce((a, b) => a + b, 0);
        $('#lbl-total', root).textContent = total ? `Total: ${int(total)} etiquetas (${Object.entries(q).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(' · ')})` : 'Elige al menos una etiqueta.';
        return total;
      };
      const preview = async (size) => {
        if (!size) return;
        $$('[data-prev]', root).forEach((b) => b.classList.toggle('active', b.dataset.prev === size));
        try {
          $('#lbl-prev', root).src = (await renderLabel(p, size)).toDataURL('image/png');
        } catch (e) {
          toast(e.message, 'error');
        }
      };
      $$('[data-prev]', root).forEach((b) => (b.onclick = () => preview(b.dataset.prev)));
      $$('.lbl-row [data-step]', root).forEach(
        (b) =>
          (b.onclick = () => {
            const input = b.parentElement.querySelector('input');
            input.value = Math.max(0, Math.round(num(input.value)) + Number(b.dataset.step));
            updateTotal();
          })
      );
      $$('[data-qty]', root).forEach((i) => (i.oninput = updateTotal));
      updateTotal();
      preview(sizes.find((s) => qtyOf(s) > 0) || sizes[0]);

      const build = async () => {
        const q = qty();
        const out = [];
        for (const s of sizes) {
          if (!q[s]) continue;
          const canvas = await renderLabel(p, s);
          out.push({ size: s, qty: q[s], canvas, url: canvas.toDataURL('image/png') });
        }
        return out;
      };

      $('#lbl-share', root).onclick = async () => {
        if (!updateTotal()) return toast('Elige cuántas etiquetas', 'error');
        const items = await build();
        const files = await Promise.all(
          items.map(async (it) => new File([await toBlob(it.canvas)], `${variantCode(p, it.size)} x${it.qty}.png`, { type: 'image/png' }))
        );
        try {
          if (navigator.canShare?.({ files })) {
            await navigator.share({ files, title: `Etiquetas ${p.name}` });
            return;
          }
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
        // Sin "Compartir": se descargan las imágenes.
        for (const f of files) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(f);
          a.download = f.name;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => (URL.revokeObjectURL(a.href), a.parentNode?.removeChild(a)), 1000);
        }
        toast('Imágenes descargadas');
      };

      $('#lbl-print', root).onclick = async () => {
        if (!updateTotal()) return toast('Elige cuántas etiquetas', 'error');
        printLabels(await build());
      };
    },
  });
}
