// Utilidades de interfaz: formato, fechas, hojas (modales), gráficas.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const moneyFmt = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ', minimumFractionDigits: 2 });
const moneyShortFmt = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ', maximumFractionDigits: 0 });
export const Q = (n) => moneyFmt.format(Number(n) || 0);
export const Qs = (n) => moneyShortFmt.format(Number(n) || 0);
export const int = (n) => new Intl.NumberFormat('es-GT').format(Math.round(Number(n) || 0));
export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

// ── Fechas (siempre como texto 'YYYY-MM-DD' en hora local) ──
export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => ymd(new Date());
export const parseYmd = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const startOfMonth = (s = today()) => s.slice(0, 8) + '01';
export const endOfMonth = (s = today()) => {
  const d = parseYmd(startOfMonth(s));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return ymd(d);
};
export const startOfWeek = (s = today()) => {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - dow);
  return ymd(d);
};
export const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const fmtDate = (s) => {
  if (!s) return '';
  const d = parseYmd(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
};
export const fmtDateLong = (s) => {
  if (!s) return '';
  if (s === today()) return 'Hoy';
  if (s === addDays(today(), -1)) return 'Ayer';
  const d = parseYmd(s);
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}${
    d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear()
  }`;
};

// ── Toast ──
let toastTimer;
export function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2600);
}

// ── Hoja inferior (modal estilo iOS) ──
export function sheet({ title, body, onMount, wide = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-head">
        <button class="btn-text" data-close>Cerrar</button>
        <h2>${esc(title)}</h2>
        <span class="sheet-spacer"></span>
      </header>
      <div class="sheet-body">${body}</div>
    </section>`;
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => {
    wrap.classList.remove('open');
    setTimeout(() => {
      wrap.remove();
      if (!$('.sheet-wrap')) document.body.classList.remove('no-scroll');
    }, 220);
  };
  wrap.querySelector('.sheet-backdrop').addEventListener('click', close);
  wrap.querySelector('[data-close]').addEventListener('click', close);
  const root = wrap.querySelector('.sheet-body');
  onMount?.(root, close);
  return close;
}

export const confirmAction = (msg) => Promise.resolve(window.confirm(msg));

// ── Formularios ──
export const options = (list, selected, { empty } = {}) =>
  (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list
    .map((o) => {
      const v = typeof o === 'object' ? o.value : o;
      const l = typeof o === 'object' ? o.label : o;
      return `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
    })
    .join('');

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export const emptyState = (text, action = '') =>
  `<div class="empty"><p>${esc(text)}</p>${action}</div>`;

// ── Gráficas (una sola serie, color de acento) ──

// Lista de barras horizontales para rankings: [{label, value, sub}]
export function barList(rows, { fmt = int, max = 8, note } = {}) {
  const list = rows.filter((r) => r.value > 0).slice(0, max);
  if (!list.length) return `<p class="muted small">Sin datos en este periodo.</p>`;
  const top = Math.max(...list.map((r) => r.value));
  return `<ol class="barlist">${list
    .map(
      (r) => `<li title="${esc(r.label)}: ${esc(fmt(r.value))}${r.sub ? ' · ' + esc(r.sub) : ''}">
        <div class="barlist-row"><span class="barlist-label">${esc(r.label)}</span><span class="barlist-value">${esc(fmt(r.value))}</span></div>
        <div class="barlist-track"><div class="barlist-bar" style="width:${Math.max(2, (r.value / top) * 100)}%"></div></div>
        ${r.sub ? `<div class="barlist-sub">${esc(r.sub)}</div>` : ''}
      </li>`
    )
    .join('')}</ol>${note ? `<p class="muted small">${esc(note)}</p>` : ''}`;
}

// Columnas verticales para series de tiempo: [{label, value, tip}]
export function columnChart(rows, { fmt = Qs, height = 160 } = {}) {
  if (!rows.length || rows.every((r) => !r.value)) return `<p class="muted small">Sin ventas en este periodo.</p>`;
  const max = Math.max(...rows.map((r) => r.value)) || 1;
  const n = rows.length;
  const labelEvery = Math.ceil(n / 7);
  return `<div class="colchart" style="--h:${height}px">
    <div class="colchart-max">${esc(fmt(max))}</div>
    <div class="colchart-plot">${rows
      .map(
        (r, i) => `<button type="button" class="col" data-tip="${esc(r.tip || r.label)}: ${esc(fmt(r.value))}" aria-label="${esc(r.tip || r.label)}: ${esc(fmt(r.value))}">
          <span class="col-bar" style="height:${r.value ? Math.max(2, (r.value / max) * 100) : 0}%"></span>
          <span class="col-label">${i % labelEvery === 0 ? esc(r.label) : ''}</span>
        </button>`
      )
      .join('')}</div>
    <div class="colchart-tip" aria-live="polite">Toca una barra para ver el detalle</div>
  </div>`;
}

export function bindColumnTips(root) {
  root.querySelectorAll('.colchart').forEach((chart) => {
    const tip = chart.querySelector('.colchart-tip');
    chart.querySelectorAll('.col').forEach((col) => {
      const show = () => {
        chart.querySelectorAll('.col.active').forEach((c) => c.classList.remove('active'));
        col.classList.add('active');
        tip.textContent = col.dataset.tip;
      };
      col.addEventListener('click', show);
      col.addEventListener('mouseenter', show);
    });
  });
}

// ── Archivos ──
export async function resizeImage(file, max = 480) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.78);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadFile(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function toCSV(rows, cols) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.map((c) => cell(c.label)).join(','), ...rows.map((r) => cols.map((c) => cell(c.get(r))).join(','))].join('\n');
}

export const sumBy = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export function groupSum(arr, keyFn, valFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    m.set(k, (m.get(k) || 0) + (Number(valFn(x)) || 0));
  }
  return m;
}
