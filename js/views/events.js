// Eventos (bazares / pop-ups): crear, armar la maleta, vender en modo evento,
// registrar gastos y cerrar con conteo de lo que regresa.
import {
  state, can, isOwner, saveRow, deleteRow, refresh, soldLines, productById, sizesOf, stockTotal,
  packToEvent, closeEvent, eventQty, eventPacked, eventUnits,
} from '../db.js';
import { $, $$, esc, Q, Qs, int, num, pct, today, addDays, fmtDate, sheet, toast, options, emptyState, confirmAction, sumBy, groupSum, barList } from '../ui.js';
import { bus } from '../bus.js';
import { icons } from '../icons.js';
import { thumb, openProduct } from './inventory.js';
import { saleRow, bindSaleRows } from './sales.js';
import { openScanner } from '../scanner.js';
import { activeEventId, setEventMode } from '../eventmode.js';

// ── Cálculos ──
export function eventStats(ev) {
  const { lines } = soldLines();
  const mine = lines.filter((l) => l.sale.event_id === ev.id);
  const sales = state.sales.filter((s) => s.event_id === ev.id && s.status !== 'cancelado');
  const expenses = state.expenses.filter((e) => e.event_id === ev.id);
  const revenue = sumBy(mine, (l) => l.revenue);
  const cost = sumBy(mine, (l) => l.cost);
  const exp = sumBy(expenses, (e) => e.amount);
  return {
    lines: mine,
    sales,
    expenses,
    revenue,
    units: sumBy(mine, (l) => l.qty),
    gross: revenue - cost,
    net: revenue - cost - exp,
    exp,
    packed: eventUnits(ev, 'packed'),
    left: eventUnits(ev, 'items'),
    returned: eventUnits(ev, 'returned'),
    missing: eventUnits(ev, 'missing'),
  };
}

export function eventStatus(ev) {
  if (ev.status === 'cerrado') return { label: 'Cerrado', cls: 'muted' };
  const t = today();
  if (ev.start_date && t < ev.start_date) return { label: 'Próximo', cls: 'info' };
  if (ev.end_date && t > ev.end_date) return { label: 'Por cerrar', cls: 'warn' };
  return { label: 'En curso', cls: 'ok' };
}

const dates = (ev) =>
  !ev.start_date ? '' : ev.end_date && ev.end_date !== ev.start_date ? `${fmtDate(ev.start_date)} – ${fmtDate(ev.end_date)}` : fmtDate(ev.start_date);

const goalBar = (ev, st) => {
  if (!ev.goal) return '';
  const r = Math.min(1, st.revenue / ev.goal);
  return `<div class="goal"><div class="goal-top"><b>${Q(st.revenue)}</b><span class="muted">de ${Q(ev.goal)} · ${pct(st.revenue / ev.goal)}</span></div>
    <div class="goal-track"><div class="goal-bar" style="width:${Math.max(1.5, r * 100)}%"></div></div></div>`;
};

// ── Lista de eventos ──
export function render(page, params = []) {
  if (params[0]) return renderEvent(page, params[0]);
  const owner = isOwner();
  const rows = state.events.map((ev) => ({ ev, st: eventStats(ev) }));
  const closed = rows.filter((r) => r.ev.status === 'cerrado');
  page.innerHTML = `
    <p class="muted small" style="margin-top:0">Bazares y pop-ups: lo que llevas, lo que vendes y cuánto ganaste en cada uno.</p>
    ${owner ? '<div class="btn-row" style="margin-top:0"><button class="btn primary" id="new-ev">+ Nuevo evento</button></div>' : ''}
    ${
      rows.length
        ? `<div class="section"><h2>Eventos</h2></div><div class="list">${rows
            .map(({ ev, st }) => {
              const s = eventStatus(ev);
              const live = activeEventId() === ev.id;
              return `<a class="row" href="#eventos/${ev.id}">
                <div class="row-main"><div class="row-title">${live ? '<span class="live-dot"></span>' : ''}${esc(ev.name)}</div>
                  <div class="row-sub">${esc([dates(ev), ev.location].filter(Boolean).join(' · '))}</div>
                  <div class="row-sub">${int(st.units)} vendidas${st.packed ? ` de ${int(st.packed)} llevadas` : ''}</div></div>
                <div class="row-end">${can('reportes') ? `<div><b>${Q(st.revenue)}</b></div>` : ''}<div style="margin-top:3px"><span class="badge ${s.cls}">${s.label}</span></div></div>
              </a>`;
            })
            .join('')}</div>`
        : emptyState('Aún no tienes eventos. Crea uno para tu próximo bazar.')
    }
    ${
      can('reportes') && closed.length > 1
        ? `<div class="section"><h2>Comparar eventos cerrados</h2></div>
          <div class="card">${barList(
            closed.map((r) => ({
              label: r.ev.name,
              value: r.st.revenue,
              sub: `${int(r.st.units)} prendas · ${r.st.packed ? pct(r.st.units / r.st.packed) + ' de lo llevado' : ''}${can('costos') ? ` · ganancia ${Q(r.st.net)}` : ''}`,
            })),
            { fmt: Qs, max: 12 }
          )}</div>`
        : ''
    }`;
  const nb = $('#new-ev', page);
  if (nb) nb.onclick = () => openEventForm();
}

// ── Detalle del evento ──
function renderEvent(page, id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) {
    page.innerHTML = emptyState('Ese evento ya no existe.', '<a class="btn" href="#eventos">Ver eventos</a>');
    return;
  }
  const owner = isOwner();
  const open = ev.status !== 'cerrado';
  const st = eventStats(ev);
  const s = eventStatus(ev);
  const live = activeEventId() === ev.id;
  const staff = (ev.staff || []).map((uid) => state.profiles.find((p) => p.id === uid)?.name).filter(Boolean);
  const pids = Object.keys({ ...(ev.packed || {}) });
  const soldBy = groupSum(st.lines, (l) => `${l.product_id}|${l.size}`, (l) => l.qty);

  page.innerHTML = `
    <a class="btn-text" href="#eventos">‹ Eventos</a>
    <div class="ev-head">
      <h2>${esc(ev.name)}</h2>
      <span class="badge ${s.cls}">${s.label}</span>
    </div>
    <p class="muted small" style="margin:4px 0 0">${esc([dates(ev), ev.location].filter(Boolean).join(' · '))}${staff.length ? `<br>Equipo: ${esc(staff.join(', '))}` : ''}</p>
    ${ev.notes ? `<p class="small" style="white-space:pre-wrap">${esc(ev.notes)}</p>` : ''}

    ${
      open && can('vender')
        ? `<div class="btn-row"><button class="btn ${live ? 'danger' : 'primary'} block" id="mode">${live ? 'Salir de modo evento' : '● Entrar a modo evento'}</button></div>
           <p class="muted small" style="margin:6px 0 0">${live ? 'Este teléfono está vendiendo en el evento.' : 'Las ventas desde este teléfono se registrarán en el evento.'}</p>`
        : ''
    }

    ${goalBar(ev, st)}

    ${can('reportes') ? `
    <div class="kpis4" style="margin-top:14px">
      <div class="kpi"><div class="k">Ventas</div><div class="v">${Q(st.revenue)}</div><div class="s">${int(st.sales.length)} ventas</div></div>
      <div class="kpi"><div class="k">Prendas vendidas</div><div class="v">${int(st.units)}</div><div class="s">${st.packed ? `${pct(st.units / st.packed)} de lo llevado` : 'Maleta vacía'}</div></div>
      ${can('costos') ? `<div class="kpi"><div class="k">Ganancia del evento</div><div class="v ${st.net < 0 ? 'neg' : ''}">${Q(st.net)}</div><div class="s">menos costo y ${Q(st.exp)} de gastos</div></div>` : ''}
      <div class="kpi"><div class="k">${open ? 'En la maleta' : 'Regresaron'}</div><div class="v">${int(open ? st.left : st.returned)}</div>
        <div class="s">${!open && st.missing ? `<span style="color:var(--danger)">${int(st.missing)} faltantes</span>` : `de ${int(st.packed)} llevadas`}</div></div>
    </div>` : ''}

    <div class="section"><h2>Maleta</h2>${open && owner ? '<button class="btn-text" id="suggest">Sugerencias</button>' : ''}</div>
    ${open && owner ? `<div class="grid2" style="margin-bottom:10px">
      <button class="btn" id="pack-list">+ Con lista</button>
      <button class="btn" id="pack-scan">${icons.scan} Escanear</button>
    </div>` : ''}
    ${
      pids.length
        ? `<div class="list">${pids
            .map((pid) => {
              const p = productById(pid);
              const sizes = Object.keys(ev.packed?.[pid] || {});
              return `<div class="row ev-item">
                ${thumb(p)}
                <div class="row-main"><div class="row-title">${esc(p?.name || 'Producto eliminado')}</div>
                  <div class="sizes">${sizes
                    .map((sz) => {
                      const took = eventPacked(ev, pid, sz);
                      const sold = soldBy.get(`${pid}|${sz}`) || 0;
                      if (open) {
                        const left = eventQty(ev, pid, sz);
                        return `<span class="size ${left <= 0 ? 'out' : ''}" title="Quedan ${left} de ${took}">${esc(sz)} ${left}/${took}</span>`;
                      }
                      const miss = Number(ev.missing?.[pid]?.[sz]) || 0;
                      return `<span class="size ${miss ? 'low' : ''}" title="Vendidas ${sold}, regresaron ${Number(ev.returned?.[pid]?.[sz]) || 0}">${esc(sz)} ${sold}/${took}${miss ? ` · −${miss}` : ''}</span>`;
                    })
                    .join('')}</div>
                </div>
              </div>`;
            })
            .join('')}</div>
          <p class="muted small">${open ? 'Talla quedan/llevadas.' : 'Talla vendidas/llevadas · −faltantes.'}</p>`
        : `<div class="card muted small">La maleta está vacía.${open && owner ? ' Agrega las prendas que vas a llevar.' : ''}</div>`
    }

    ${can('gastos') ? `
    <div class="section"><h2>Gastos del evento</h2>${owner ? '<button class="btn-text" id="add-exp">+ Gasto</button>' : ''}</div>
    ${
      st.expenses.length
        ? `<div class="list">${st.expenses
            .map((e) => `<div class="row"><div class="row-main"><div class="row-title">${esc(e.description || e.category)}</div><div class="row-sub">${esc(e.category || '')} · ${fmtDate(e.date)}</div></div><div class="row-end"><b>${Q(e.amount)}</b></div></div>`)
            .join('')}</div>`
        : '<div class="card muted small">Sin gastos registrados. El costo del stand se agrega solo desde el evento.</div>'
    }` : ''}

    <div class="section"><h2>Ventas del evento</h2></div>
    ${st.sales.length ? `<div class="list">${st.sales.map(saleRow).join('')}</div>` : '<div class="card muted small">Aún no hay ventas en este evento.</div>'}

    ${owner ? `<div class="form" style="margin-top:20px">
      ${open ? '<button class="btn primary block" id="close-ev">Cerrar evento y contar lo que regresa</button>' : ''}
      <button class="btn block" id="edit-ev">Editar evento</button>
      ${!st.sales.length ? '<button class="btn danger block" id="del-ev">Eliminar evento</button>' : ''}
    </div>` : ''}`;

  bindSaleRows(page);
  const on = (sel, fn) => {
    const el = $(sel, page);
    if (el) el.onclick = fn;
  };
  on('#mode', () => {
    setEventMode(live ? '' : ev.id);
    toast(live ? 'Saliste del modo evento' : `Modo evento: ${ev.name}`);
    bus.rerender();
  });
  on('#edit-ev', () => openEventForm(ev));
  on('#pack-list', () => openPackList(ev));
  on('#pack-scan', () => scanToPack(ev));
  on('#suggest', () => openSuggestions(ev));
  on('#add-exp', () => openEventExpense(ev));
  on('#close-ev', () => openCloseEvent(ev));
  on('#del-ev', async () => {
    if (!(await confirmAction(`¿Eliminar "${ev.name}"? Lo que esté en la maleta regresa a la bodega.`, { ok: 'Eliminar', danger: true }))) return;
    try {
      for (const [pid, sizes] of Object.entries(ev.items || {})) for (const [sz, n] of Object.entries(sizes)) if (n) await packToEvent(ev.id, pid, sz, -n);
      for (const e of state.expenses.filter((x) => x.event_id === ev.id)) await deleteRow('expenses', e.id);
      await deleteRow('events', ev.id);
      if (activeEventId() === ev.id) setEventMode('');
      await refresh(['products']);
      toast('Evento eliminado');
      bus.go('eventos');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

// ── Crear / editar ──
const expenseCategory = () => state.settings.expense_categories.find((c) => /evento/i.test(c)) || state.settings.expense_categories[0];

function openEventForm(ev) {
  const e = ev || { start_date: addDays(today(), 7) };
  const stand = ev && state.expenses.find((x) => x.event_id === ev.id && x.kind === 'stand');
  sheet({
    title: ev ? 'Editar evento' : 'Nuevo evento',
    body: `
      <form class="form" id="evf" autocomplete="off">
        <label class="field"><span>Nombre</span><input name="name" id="ev-name" required value="${esc(e.name)}" placeholder="Ej. Bazar Antigua Guate"></label>
        <div class="grid2">
          <label class="field"><span>Desde</span><input type="date" name="start_date" id="ev-start" value="${esc(e.start_date || '')}" required></label>
          <label class="field"><span>Hasta</span><input type="date" name="end_date" id="ev-end" value="${esc(e.end_date || e.start_date || '')}"></label>
        </div>
        <label class="field"><span>Lugar</span><input name="location" id="ev-loc" value="${esc(e.location)}" placeholder="Ej. Antigua Guatemala"></label>
        <div class="grid2">
          <label class="field"><span>Costo del stand (Q)</span><input name="stand" id="ev-stand" inputmode="decimal" value="${esc(stand?.amount ?? '')}" placeholder="0"></label>
          <label class="field"><span>Meta de ventas (Q)</span><input name="goal" id="ev-goal" inputmode="decimal" value="${esc(e.goal ?? '')}" placeholder="Opcional"></label>
        </div>
        <div class="field"><span>Quién va</span>
          <div class="perms">${state.profiles
            .filter((p) => p.active !== false)
            .map((p) => `<label class="perm"><input type="checkbox" data-staff="${esc(p.id)}" ${(e.staff || []).includes(p.id) ? 'checked' : ''}><span><b>${esc(p.name)}</b><small>@${esc(p.username || '')}</small></span></label>`)
            .join('')}</div>
        </div>
        <label class="field"><span>Notas</span><textarea name="notes" id="ev-notes" placeholder="Contacto del organizador, horario de montaje…">${esc(e.notes)}</textarea></label>
        <button class="btn primary block" type="submit">${ev ? 'Guardar cambios' : 'Crear evento'}</button>
      </form>`,
    onMount(root, close) {
      $('#evf', root).onsubmit = async (evt) => {
        evt.preventDefault();
        const f = evt.target;
        const row = {
          name: f.name.value.trim(),
          start_date: f.start_date.value,
          end_date: f.end_date.value && f.end_date.value >= f.start_date.value ? f.end_date.value : f.start_date.value,
          location: f.location.value.trim(),
          goal: num(f.goal.value) || null,
          notes: f.notes.value.trim(),
          staff: $$('[data-staff]', root).filter((c) => c.checked).map((c) => c.dataset.staff),
        };
        if (!ev) Object.assign(row, { status: 'abierto', items: {}, packed: {} });
        try {
          const saved = await saveRow('events', ev ? { id: ev.id, ...row } : row);
          // El costo del stand se guarda como gasto del evento.
          const amount = num(f.stand.value);
          if (amount > 0)
            await saveRow('expenses', {
              ...(stand ? { id: stand.id } : {}),
              date: row.start_date,
              category: stand?.category || expenseCategory(),
              description: `Stand · ${row.name}`,
              amount,
              event_id: saved.id,
              kind: 'stand',
            });
          else if (stand) await deleteRow('expenses', stand.id);
          toast(ev ? 'Evento actualizado' : 'Evento creado');
          close();
          if (ev) bus.rerender();
          else bus.go(`eventos/${saved.id}`);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    },
  });
}

function openEventExpense(ev) {
  sheet({
    title: 'Gasto del evento',
    body: `
      <form class="form" id="exf">
        <label class="field"><span>Monto (Q)</span><input name="amount" id="ex-amount" inputmode="decimal" required placeholder="0"></label>
        <label class="field"><span>Descripción</span><input name="description" id="ex-desc" placeholder="Ej. Gasolina, comida, bolsas"></label>
        <label class="field"><span>Categoría</span><select name="category">${options(state.settings.expense_categories, expenseCategory())}</select></label>
        <label class="field"><span>Fecha</span><input type="date" name="date" value="${esc(today() >= ev.start_date && today() <= (ev.end_date || ev.start_date) ? today() : ev.start_date)}"></label>
        <button class="btn primary block" type="submit">Guardar gasto</button>
      </form>`,
    onMount(root, close) {
      $('#exf', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        if (num(f.amount.value) <= 0) return toast('Escribe el monto', 'error');
        try {
          await saveRow('expenses', {
            amount: num(f.amount.value),
            description: f.description.value.trim() || ev.name,
            category: f.category.value,
            date: f.date.value || today(),
            event_id: ev.id,
          });
          toast('Gasto guardado');
          close();
          bus.rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    },
  });
}

// ── Maleta: lista con +/− ──
function openPackList(ev) {
  const products = state.products.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const delta = {}; // { pid: { size: n } }
  sheet({
    title: 'Agregar a la maleta',
    body: `
      <input class="search" type="search" id="pk-q" placeholder="Buscar prenda o código…">
      <div class="list" id="pk-list">${products
        .map((p) => {
          const sizes = sizesOf(p).filter((sz) => sz in (p.stock || {}) || eventQty(ev, p.id, sz));
          if (!sizes.length) return '';
          return `<div class="pk-prod" data-name="${esc((p.name + ' ' + (p.code || '') + ' ' + (p.type || '')).toLowerCase())}">
            <div class="pk-title">${thumb(p)}<div><b>${esc(p.name)}</b><div class="muted small">${esc(p.type || '')} · ${int(stockTotal(p))} en bodega</div></div></div>
            <div class="pk-sizes">${sizes
              .map(
                (sz) => `<div class="pk-size">
                  <b>${esc(sz)}</b>
                  <small>Bodega ${int(p.stock?.[sz] || 0)}${eventQty(ev, p.id, sz) ? ` · Maleta ${eventQty(ev, p.id, sz)}` : ''}</small>
                  <div class="stepper sm"><button type="button" data-pk="${p.id}" data-sz="${esc(sz)}" data-d="-1" aria-label="Menos">−</button><span data-val="${p.id}|${esc(sz)}">0</span><button type="button" data-pk="${p.id}" data-sz="${esc(sz)}" data-d="1" aria-label="Más">+</button></div>
                </div>`
              )
              .join('')}</div>
          </div>`;
        })
        .join('')}</div>
      <div class="pk-footer"><span id="pk-total" class="muted small">Elige cuántas llevas de cada talla.</span>
        <button class="btn primary" type="button" id="pk-apply" disabled>Agregar</button></div>
      <p class="muted small">¿Llevas algo que no está en el sistema? <button class="btn-text" type="button" id="pk-new">Crear producto</button></p>`,
    onMount(root, close) {
      const total = () => Object.values(delta).reduce((s, x) => s + Object.values(x).reduce((a, n) => a + n, 0), 0);
      const update = () => {
        const n = total();
        $('#pk-total', root).textContent = n ? `${n > 0 ? '+' : ''}${int(n)} prendas` : 'Elige cuántas llevas de cada talla.';
        $('#pk-apply', root).disabled = !n;
        $('#pk-apply', root).textContent = n >= 0 ? `Agregar ${n ? int(n) : ''}` : `Regresar ${int(-n)} a bodega`;
      };
      $$('[data-pk]', root).forEach(
        (b) =>
          (b.onclick = () => {
            const p = productById(b.dataset.pk);
            const sz = b.dataset.sz;
            const cur = delta[p.id]?.[sz] || 0;
            const next = cur + Number(b.dataset.d);
            if (next > (Number(p.stock?.[sz]) || 0)) return toast(`Solo hay ${int(p.stock?.[sz] || 0)} ${sz} en bodega`, 'error');
            if (next < -eventQty(ev, p.id, sz)) return;
            (delta[p.id] ??= {})[sz] = next;
            $(`[data-val="${p.id}|${CSS.escape(sz)}"]`, root).textContent = next;
            update();
          })
      );
      $('#pk-q', root).oninput = (e) => {
        const q = e.target.value.trim().toLowerCase();
        $$('.pk-prod', root).forEach((el) => el.classList.toggle('hidden', q && !el.dataset.name.includes(q)));
      };
      $('#pk-new', root).onclick = () => (close(), openProduct());
      $('#pk-apply', root).onclick = async (e) => {
        e.target.disabled = true;
        try {
          for (const [pid, sizes] of Object.entries(delta)) for (const [sz, n] of Object.entries(sizes)) if (n) await packToEvent(ev.id, pid, sz, n);
          await refresh(['events', 'products']);
          toast('Maleta actualizada');
          close();
          bus.rerender();
        } catch (err) {
          e.target.disabled = false;
          toast(err.message, 'error');
        }
      };
      update();
    },
  });
}

// ── Maleta: escaneando ──
function scanToPack(ev) {
  openScanner({
    title: 'Armar maleta',
    counterLabel: (n) => `${n} a la maleta`,
    onMatch: ({ product: p, size }) => {
      const cur = state.events.find((e) => e.id === ev.id) || ev;
      const inStock = Number(p.stock?.[size]) || 0;
      return {
        html: `<div class="scan-item">${thumb(p)}<div class="row-main"><b>${esc(p.name)}</b>
          <div class="scan-meta"><span class="scan-size">${esc(size)}</span>
          <span class="muted small">Bodega ${int(inStock)} · Maleta ${int(eventQty(cur, p.id, size))}</span>
          ${inStock <= 0 ? '<span class="badge danger">Sin stock en bodega</span>' : ''}</div></div></div>`,
        actionLabel: 'Meter a la maleta',
        onAction: async () => {
          if (inStock <= 0 && !(await confirmAction(`No hay ${size} en bodega según la app. ¿Meterla de todos modos?`, { ok: 'Sí, meter' }))) return;
          await packToEvent(ev.id, p.id, size, 1);
          await refresh(['events', 'products']);
        },
      };
    },
    onClose: (n) => n && bus.rerender(),
  });
}

// ── Sugerencias ──
function openSuggestions(ev) {
  const closed = state.events.filter((e) => e.status === 'cerrado' && e.id !== ev.id);
  const { lines } = soldLines();
  let basis;
  let rows;
  if (closed.length) {
    const ids = new Set(closed.map((e) => e.id));
    const m = groupSum(lines.filter((l) => ids.has(l.sale.event_id)), (l) => `${l.product_id}|${l.size}`, (l) => l.qty);
    basis = `según lo que vendiste en ${closed.length} evento${closed.length === 1 ? '' : 's'} anterior${closed.length === 1 ? '' : 'es'}`;
    rows = [...m.entries()].map(([k, n]) => ({ k, sold: n, suggest: Math.ceil((n / closed.length) * 1.25) }));
  } else {
    const from = addDays(today(), -90);
    const m = groupSum(lines.filter((l) => l.sale.date >= from), (l) => `${l.product_id}|${l.size}`, (l) => l.qty);
    basis = 'según tus ventas de los últimos 90 días (aún no hay eventos cerrados)';
    rows = [...m.entries()].map(([k, n]) => ({ k, sold: n, suggest: Math.max(1, Math.ceil(n / 4)) }));
  }
  rows = rows
    .map((r) => {
      const [pid, size] = r.k.split('|');
      const p = productById(pid);
      if (!p || p.active === false) return null;
      const bodega = Math.max(0, Number(p.stock?.[size]) || 0);
      const already = eventQty(ev, pid, size);
      return { ...r, p, size, bodega, add: Math.max(0, Math.min(bodega, r.suggest - already)) };
    })
    .filter((r) => r && r.add > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 15);
  sheet({
    title: 'Sugerencias',
    body: `
      <p class="muted small" style="margin-top:0">Qué llevar ${esc(basis)}. Ajusta las cantidades y agrega.</p>
      ${
        rows.length
          ? `<div class="list">${rows
              .map(
                (r, i) => `<div class="row sg-row">
                  <input type="checkbox" data-sg="${i}" checked aria-label="Llevar">
                  <div class="row-main"><div class="row-title">${esc(r.p.name)} · ${esc(r.size)}</div><div class="row-sub">Vendidas ${int(r.sold)} · bodega ${int(r.bodega)}</div></div>
                  <div class="stepper sm"><button type="button" data-sgq="${i}" data-d="-1">−</button><span id="sgv-${i}">${r.add}</span><button type="button" data-sgq="${i}" data-d="1">+</button></div>
                </div>`
              )
              .join('')}</div>
            <button class="btn primary block" type="button" id="sg-apply" style="margin-top:12px">Agregar a la maleta</button>`
          : '<div class="card muted small">No hay sugerencias: o ya llevas lo que más se vende, o todavía no hay suficientes ventas.</div>'
      }`,
    onMount(root, close) {
      $$('[data-sgq]', root).forEach(
        (b) =>
          (b.onclick = () => {
            const r = rows[Number(b.dataset.sgq)];
            r.add = Math.max(0, Math.min(r.bodega, r.add + Number(b.dataset.d)));
            $(`#sgv-${b.dataset.sgq}`, root).textContent = r.add;
          })
      );
      const apply = $('#sg-apply', root);
      if (apply)
        apply.onclick = async () => {
          apply.disabled = true;
          try {
            let n = 0;
            for (const [i, r] of rows.entries()) {
              if (!$(`[data-sg="${i}"]`, root).checked || !r.add) continue;
              await packToEvent(ev.id, r.p.id, r.size, r.add);
              n += r.add;
            }
            await refresh(['events', 'products']);
            toast(`${int(n)} prendas agregadas a la maleta`);
            close();
            bus.rerender();
          } catch (e) {
            apply.disabled = false;
            toast(e.message, 'error');
          }
        };
    },
  });
}

// ── Cierre con conteo ──
function openCloseEvent(ev) {
  const entries = [];
  for (const [pid, sizes] of Object.entries(ev.items || {})) for (const [sz, n] of Object.entries(sizes || {})) if (Number(n) > 0) entries.push({ pid, sz, expected: Number(n), count: Number(n) });
  const p = (pid) => productById(pid);
  sheet({
    title: 'Cerrar evento',
    body: `
      <p class="muted small" style="margin-top:0">Cuenta lo que regresa. Lo contado vuelve a la bodega; si falta algo, quedará registrado como faltante.</p>
      ${
        entries.length
          ? `<button class="btn block" type="button" id="cl-scan">${icons.scan} Contar escaneando (empieza en 0)</button>
            <div class="list" style="margin-top:10px">${entries
              .map(
                (e, i) => `<div class="row">
                  <div class="row-main"><div class="row-title">${esc(p(e.pid)?.name || 'Producto')} · ${esc(e.sz)}</div><div class="row-sub">Deberían regresar ${int(e.expected)}</div></div>
                  <div class="stepper sm"><button type="button" data-cl="${i}" data-d="-1">−</button><span id="clv-${i}">${e.count}</span><button type="button" data-cl="${i}" data-d="1">+</button></div>
                </div>`
              )
              .join('')}</div>`
          : '<div class="card muted small">La maleta quedó vacía: se vendió todo. 🎉</div>'
      }
      <div class="card totals" id="cl-sum" style="margin-top:12px"></div>
      <button class="btn primary block" type="button" id="cl-ok" style="margin-top:12px">Cerrar evento</button>`,
    onMount(root, close) {
      const draw = () => {
        entries.forEach((e, i) => ($(`#clv-${i}`, root) ? ($(`#clv-${i}`, root).textContent = e.count) : null));
        const exp = sumBy(entries, (e) => e.expected);
        const cnt = sumBy(entries, (e) => e.count);
        const miss = sumBy(entries, (e) => Math.max(0, e.expected - e.count));
        $('#cl-sum', root).innerHTML = `<div><span class="muted">Deberían regresar</span><span>${int(exp)}</span></div>
          <div><span class="muted">Contadas</span><span>${int(cnt)}</span></div>
          ${miss ? `<div style="color:var(--danger)"><span>Faltantes</span><b>${int(miss)}</b></div>` : '<div style="color:var(--ok)"><span>Todo cuadra</span><b>✓</b></div>'}`;
      };
      $$('[data-cl]', root).forEach(
        (b) =>
          (b.onclick = () => {
            const e = entries[Number(b.dataset.cl)];
            e.count = Math.max(0, e.count + Number(b.dataset.d));
            draw();
          })
      );
      const scan = $('#cl-scan', root);
      if (scan)
        scan.onclick = () => {
          entries.forEach((e) => (e.count = 0));
          draw();
          openScanner({
            title: 'Contar lo que regresa',
            counterLabel: (n) => `${n} contadas`,
            onMatch: ({ product, size }) => {
              const e = entries.find((x) => x.pid === product.id && x.sz === size);
              return {
                html: `<div class="scan-item">${thumb(product)}<div class="row-main"><b>${esc(product.name)}</b>
                  <div class="scan-meta"><span class="scan-size">${esc(size)}</span>
                  ${e ? `<span class="muted small">Contadas ${e.count} de ${e.expected}</span>` : '<span class="badge danger">No estaba en la maleta</span>'}</div></div></div>`,
                actionLabel: e ? 'Contar' : 'Ignorar',
                onAction: () => {
                  if (e) e.count++;
                  draw();
                },
              };
            },
          });
        };
      $('#cl-ok', root).onclick = async (evt) => {
        const miss = sumBy(entries, (e) => Math.max(0, e.expected - e.count));
        if (miss && !(await confirmAction(`Faltan ${miss} prendas. ¿Cerrar el evento de todos modos? Quedarán como faltantes.`, { ok: 'Cerrar evento', danger: true }))) return;
        evt.target.disabled = true;
        const counted = {};
        entries.forEach((e) => ((counted[e.pid] ??= {})[e.sz] = e.count));
        try {
          await closeEvent(ev.id, counted);
          if (activeEventId() === ev.id) setEventMode('');
          toast('Evento cerrado');
          close();
          bus.rerender();
        } catch (err) {
          evt.target.disabled = false;
          toast(err.message, 'error');
        }
      };
      draw();
    },
  });
}
