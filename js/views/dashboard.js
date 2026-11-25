// Inicio estilo widgets de iPhone:
//   Portada rotativa con los más vendidos · Meta del mes (verde) · Stock bajo
//   Pendientes (ancho) · Próximo evento (ancho)
// Los widgets siempre se ven; si no hay nada, muestran un mensaje.
import { state, can, isOwner, soldLines, lowStock, saveSettings, productById, eventUnits } from '../db.js';
import { $, $$, esc, Q, Qs, int, pct, num, today, addDays, startOfMonth, parseYmd, WEEKDAYS, MONTHS_LONG, sumBy, groupSum, sheet, toast } from '../ui.js';
import { bus } from '../bus.js';
import { setFilter } from './sales.js';
import { openProduct } from './inventory.js';
import { icons } from '../icons.js';

let rotateTimer = null;

const monthKey = (d = today()) => d.slice(0, 7);
const monthName = (key) => MONTHS_LONG[Number(key.slice(5, 7)) - 1];
const goalFor = (key) => Number(state.settings.goals?.[key]) || 0;

// ── Portada: los más vendidos de los últimos 30 días ──
function coverSlides() {
  const { lines } = soldLines(addDays(today(), -29), today());
  const byProduct = groupSum(lines, (l) => l.product_id, (l) => l.qty);
  return [...byProduct.entries()]
    .map(([pid, n]) => ({ p: productById(pid), n }))
    .filter((x) => x.p && x.p.active !== false)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
}

function coverHTML(slides) {
  if (!slides.length)
    return `<section class="cover cover-empty"><div class="cover-slide"><div class="cover-art"><span>TRCO.</span></div>
      <div class="cover-text"><small>Bienvenido</small><b>Aquí aparecerán tus más vendidos</b></div></div></section>`;
  return `<section class="cover" aria-label="Más vendidos de los últimos 30 días">
    <div class="cover-track" id="cover-track">${slides
      .map(
        ({ p, n }, i) => `<button type="button" class="cover-slide" data-prod="${p.id}" aria-label="${esc(p.name)}, ${n} vendidas">
          ${p.photo ? `<div class="cover-img" style="background-image:url('${p.photo}')"></div>` : `<div class="cover-art"><span>TRCO.</span></div>`}
          <div class="cover-text"><small>🔥 #${i + 1} más vendido · 30 días</small><b>${esc(p.name)}</b><span>${int(n)} vendida${n === 1 ? '' : 's'}</span></div>
        </button>`
      )
      .join('')}</div>
    ${slides.length > 1 ? `<div class="cover-dots">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
  </section>`;
}

function bindCover(page) {
  clearInterval(rotateTimer);
  const track = $('#cover-track', page);
  if (!track) return;
  const dots = $$('.cover-dots i', page);
  const count = track.children.length;
  const current = () => Math.round(track.scrollLeft / track.clientWidth);
  track.addEventListener('scroll', () => dots.forEach((d, i) => d.classList.toggle('on', i === current())), { passive: true });
  let pausedUntil = 0;
  ['touchstart', 'pointerdown', 'wheel'].forEach((ev) => track.addEventListener(ev, () => (pausedUntil = Date.now() + 8000), { passive: true }));
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (count > 1 && !reduce)
    rotateTimer = setInterval(() => {
      if (!track.isConnected) return clearInterval(rotateTimer);
      if (Date.now() < pausedUntil || document.hidden || document.querySelector('.sheet-wrap')) return;
      track.scrollTo({ left: ((current() + 1) % count) * track.clientWidth, behavior: 'smooth' });
    }, 4500);
  $$('[data-prod]', track).forEach((b) => (b.onclick = () => openProduct(b.dataset.prod)));
}

// ── Widgets ──
function metaWidget() {
  const key = monthKey();
  const goal = goalFor(key);
  const { lines } = soldLines(startOfMonth(), today());
  const sold = sumBy(lines, (l) => l.revenue);
  if (!goal)
    return `<button type="button" class="widget w-meta" id="w-meta">
      <div class="w-title">${icons.chart}Meta · ${monthName(key).slice(0, 3)}</div>
      <div class="w-empty">${isOwner() ? 'Toca para poner tu meta del mes' : 'Aún no hay meta este mes'}</div>
      <div class="w-foot">Vas en ${Qs(sold)}</div>
    </button>`;
  const r = sold / goal;
  const R = 34;
  const C = 2 * Math.PI * R;
  // Ritmo: cuánto falta vender por día para llegar.
  const d = parseYmd(today());
  const daysLeft = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
  const perDay = Math.max(0, goal - sold) / daysLeft;
  return `<button type="button" class="widget w-meta" id="w-meta" aria-label="Meta del mes: ${pct(r)}">
    <div class="w-title">${icons.chart}Meta · ${monthName(key).slice(0, 3)}</div>
    <div class="ring"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${R}" class="ring-bg"/><circle cx="40" cy="40" r="${R}" class="ring-fg"
      stroke-dasharray="${Math.min(1, r) * C} ${C}"/></svg><b>${pct(r)}</b></div>
    <div class="w-foot">${Qs(sold)} de ${Qs(goal)}<br><span>${r >= 1 ? '¡Meta cumplida! 🎉' : `${Qs(perDay)} por día para llegar`}</span></div>
  </button>`;
}

function stockWidget() {
  const low = lowStock();
  const out = low.filter((l) => l.qty <= 0);
  const almost = low.filter((l) => l.qty > 0);
  return `<button type="button" class="widget w-stock" id="w-stock">
    <div class="w-title">${icons.shirt}Stock bajo</div>
    ${
      low.length
        ? `<div class="w-stack"><div><b class="c-danger">${int(out.length)}</b><span>agotada${out.length === 1 ? '' : 's'}</span></div><div><b class="c-warn">${int(almost.length)}</b><span>por agotarse</span></div></div>
           <div class="w-foot">${esc(low[0].product.name)} ${esc(low[0].size)}${low.length > 1 ? ` y ${int(low.length - 1)} más` : ''}</div>`
        : '<div class="w-empty ok">✓ Todo con stock</div>'
    }
  </button>`;
}

function pendingWidget() {
  const active = state.sales.filter((s) => s.status !== 'cancelado');
  const items = [
    { key: 'por_enviar', n: active.filter((s) => s.status === 'por_enviar').length, label: 'por enviar', cls: 'c-warn' },
    { key: 'apartado', n: active.filter((s) => s.status === 'apartado').length, label: 'apartados', cls: 'c-info' },
    { key: 'preventa', n: active.filter((s) => s.status === 'preventa').length, label: 'preventas', cls: 'c-info' },
  ];
  const total = sumBy(items, (i) => i.n);
  return `<section class="widget wide w-pend">
    <div class="w-title">${icons.receipt}Pendientes</div>
    ${
      total
        ? `<div class="w-nums three">${items
            .map((i) => `<button type="button" data-pend="${i.key}" ${i.n ? '' : 'class="zero"'}><b class="${i.n ? i.cls : ''}">${int(i.n)}</b><span>${i.label}</span></button>`)
            .join('')}</div>`
        : '<div class="w-empty ok">✓ Nada pendiente. ¡Todo entregado!</div>'
    }
  </section>`;
}

function eventWidget() {
  const t = today();
  const open = state.events.filter((e) => e.status !== 'cerrado' && (e.end_date || e.start_date) >= t);
  const ev = open.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))[0];
  if (!ev)
    return `<button type="button" class="widget wide w-event" id="w-event">
      <div class="w-title">${icons.event}Próximo evento</div>
      <div class="w-empty">Sin eventos próximos${isOwner() ? ' · <u>Crear uno</u>' : ''}</div>
    </button>`;
  const days = Math.round((parseYmd(ev.start_date) - parseYmd(t)) / 864e5);
  const when = days > 1 ? `en ${days} días` : days === 1 ? 'mañana' : 'hoy';
  const bag = eventUnits(ev, 'items');
  return `<button type="button" class="widget wide w-event" id="w-event" data-ev="${ev.id}">
    <div class="w-title">${icons.event}Próximo evento</div>
    <div class="w-event-row">
      <div class="w-date"><b>${parseYmd(ev.start_date).getDate()}</b><span>${esc(MONTHS_LONG[parseYmd(ev.start_date).getMonth()].slice(0, 3))}</span></div>
      <div class="w-event-main"><b>${esc(ev.name)}</b><span>${esc([when, ev.location].filter(Boolean).join(' · '))}</span>
        <span>${bag ? `Maleta: ${int(bag)} prendas` : 'Maleta vacía · ármala'}</span></div>
      <span class="chev">›</span>
    </div>
  </button>`;
}

// ── Meta: se pregunta al empezar cada mes ──
function askGoal(auto = false) {
  const key = monthKey();
  const prevEnd = addDays(startOfMonth(), -1);
  const prevKey = monthKey(prevEnd);
  const prevGoal = goalFor(prevKey);
  const { lines } = soldLines(startOfMonth(prevEnd), prevEnd);
  const prevSold = sumBy(lines, (l) => l.revenue);
  const suggestion = prevSold ? Math.round((prevSold * 1.1) / 100) * 100 : 10000;
  sheet({
    title: `Meta de ${monthName(key)}`,
    body: `
      <form class="form" id="goalf">
        <p class="muted small" style="margin:0">${auto ? `¡Empezó ${monthName(key)}! ` : ''}¿Cuánto quieres vender este mes?${prevSold ? ` En ${monthName(prevKey)} vendiste ${Q(prevSold)}${prevGoal ? ` (meta ${Q(prevGoal)})` : ''}.` : ''}</p>
        <label class="field"><span>Meta (Q)</span><input name="goal" id="goal-in" inputmode="decimal" value="${goalFor(key) || ''}" placeholder="${suggestion}"></label>
        <button class="btn primary block" type="submit">Guardar meta</button>
      </form>`,
    onMount(root, close) {
      $('#goalf', root).onsubmit = async (e) => {
        e.preventDefault();
        const g = num(e.target.goal.value) || suggestion;
        try {
          await saveSettings({ ...state.settings, goals: { ...(state.settings.goals || {}), [key]: g } });
          toast(`Meta de ${monthName(key)}: ${Q(g)}`);
          close();
          bus.rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    },
  });
}

function maybeAskGoal() {
  if (!isOwner() || goalFor(monthKey())) return;
  const k = `trco-goal-asked-${monthKey()}`;
  try {
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, '1');
  } catch {
    return;
  }
  setTimeout(() => {
    const onHome = ['', '#inicio'].includes(location.hash);
    if (onHome && !document.querySelector('.sheet-wrap')) askGoal(true);
  }, 700);
}

export function render(page) {
  const d = parseYmd(today());
  const dateText = `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}`;
  const name = state.profile?.name ? esc(state.profile.name.split(' ')[0]) : '';
  const money = can('reportes');

  page.innerHTML = `
    <div class="home2">
      <header class="home2-hello"><b>Hola${name ? `, ${name}` : ''}</b><span>${esc(dateText)}</span></header>
      ${coverHTML(coverSlides())}
      <div class="widgets">
        ${money ? metaWidget() : ''}
        ${stockWidget()}
        ${pendingWidget()}
        ${eventWidget()}
      </div>
    </div>`;

  bindCover(page);
  const on = (sel, fn) => {
    const el = $(sel, page);
    if (el) el.onclick = fn;
  };
  on('#w-meta', () => (isOwner() ? askGoal() : bus.go('reportes')));
  on('#w-stock', () => bus.go('inventario'));
  on('#w-event', () => {
    const id = $('#w-event', page).dataset.ev;
    if (id) bus.go(`eventos/${id}`);
    else if (isOwner()) bus.go('eventos');
  });
  $$('[data-pend]', page).forEach(
    (b) =>
      (b.onclick = () => {
        if (b.dataset.pend === 'preventa') return bus.go('preventas');
        setFilter(b.dataset.pend);
        bus.go('ventas');
      })
  );
  if (money) maybeAskGoal();
}
