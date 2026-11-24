// Gráficas de dona (Reportes). Máximo 5 partes + "Otros", total al centro,
// leyenda con %, y detalle al tocar una parte. Colores: --chart-1…5 (app.css).
import { $, $$, esc, Q, Qs, int, pct, sumBy, groupSum } from './ui.js';

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const OTHER = 'var(--chart-other)';
const MAX_SLICES = 5;

const totalLabel = (total, metric) => (metric === 'revenue' ? Qs(total) : `${int(total)} pzs`);

export function slices(lines, keyFn, metric) {
  const rev = groupSum(lines, keyFn, (l) => l.revenue);
  const units = groupSum(lines, keyFn, (l) => l.qty);
  const val = metric === 'revenue' ? rev : units;
  const rows = [...val.entries()]
    .map(([label, value]) => ({ label: label || 'Sin dato', value, revenue: rev.get(label) || 0, units: units.get(label) || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const top = rows.slice(0, MAX_SLICES).map((r, i) => ({ ...r, color: COLORS[i] }));
  const rest = rows.slice(MAX_SLICES);
  if (rest.length)
    top.push({
      label: `Otros (${rest.length})`,
      value: sumBy(rest, (r) => r.value),
      revenue: sumBy(rest, (r) => r.revenue),
      units: sumBy(rest, (r) => r.units),
      color: OTHER,
    });
  return top;
}

export function donut(id, title, rows, metric) {
  const total = sumBy(rows, (r) => r.value);
  if (!total) return `<section class="donut-card"><h3>${esc(title)}</h3><p class="muted small" style="margin:0">Sin ventas en este periodo.</p></section>`;
  const r = 50;
  const C = 2 * Math.PI * r;
  const gap = rows.length > 1 ? 2.2 : 0; // separación entre partes, del color del fondo
  let offset = 0;
  const segs = rows
    .map((row, i) => {
      const len = (row.value / total) * C;
      const seg = `<circle class="seg" data-i="${i}" r="${r}" cx="60" cy="60" stroke="${row.color}"
        stroke-dasharray="${Math.max(0.5, len - gap)} ${C}" stroke-dashoffset="${-offset}"><title>${esc(row.label)}</title></circle>`;
      offset += len;
      return seg;
    })
    .join('');
  return `<section class="donut-card" data-donut="${id}">
    <h3>${esc(title)}</h3>
    <div class="donut-body">
      <div class="donut" role="img" aria-label="${esc(title)}: ${rows.map((x) => `${x.label} ${pct(x.value / total)}`).join(', ')}">
        <svg viewBox="0 0 120 120">${segs}</svg>
        <div class="donut-center"><div class="dv">${esc(totalLabel(total, metric))}</div><div class="dl">Total</div></div>
      </div>
      <ul class="legend">${rows
        .map(
          (x, i) => `<li><button type="button" data-i="${i}">
            <span class="sw" style="background:${x.color}"></span>
            <span class="ln">${esc(x.label)}</span>
            <span class="lp">${pct(x.value / total)}</span>
          </button></li>`
        )
        .join('')}</ul>
    </div>
    <p class="donut-detail">Toca una parte para ver el detalle.</p>
  </section>`;
}

export function bindDonuts(root, data, metric) {
  $$('[data-donut]', root).forEach((card) => {
    const rows = data[card.dataset.donut];
    if (!rows) return;
    const total = sumBy(rows, (r) => r.value);
    const box = $('.donut', card);
    const center = $('.donut-center', card);
    const detail = $('.donut-detail', card);
    let current = -1;
    const reset = () => {
      current = -1;
      box.classList.remove('has-active');
      $$('.active', card).forEach((e) => e.classList.remove('active'));
      center.innerHTML = `<div class="dv">${esc(totalLabel(total, metric))}</div><div class="dl">Total</div>`;
      detail.textContent = 'Toca una parte para ver el detalle.';
    };
    const select = (i) => {
      if (i === current) return reset();
      current = i;
      const x = rows[i];
      box.classList.add('has-active');
      $$('.active', card).forEach((e) => e.classList.remove('active'));
      $$(`[data-i="${i}"]`, card).forEach((e) => e.classList.add('active'));
      center.innerHTML = `<div class="dv">${pct(x.value / total)}</div><div class="dl">${esc(x.label)}</div>`;
      detail.innerHTML = `<b style="color:var(--text)">${esc(x.label)}</b> · ${Q(x.revenue)} · ${int(x.units)} prendas`;
    };
    $$('[data-i]', card).forEach((el) => el.addEventListener('click', () => select(Number(el.dataset.i))));
  });
}
