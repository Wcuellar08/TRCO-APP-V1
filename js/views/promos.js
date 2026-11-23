// Promociones: crear y administrar (solo el Dueño), ver usos y comisiones de influencers.
import { state, saveRow, deleteRow } from '../db.js';
import { $, $$, esc, Q, int, num, today, fmtDate, sheet, toast, options, emptyState, confirmAction, sumBy } from '../ui.js';
import { bus } from '../bus.js';
import { PROMO_TYPES, promoSummary, promoStatus, promoSales, influencerStats } from '../promos.js';

const ORDER = { activa: 0, programada: 1, agotada: 2, pausada: 3, vencida: 4 };

export function render(page) {
  const rows = (state.promos || [])
    .map((p) => ({ p, st: promoStatus(p), sales: promoSales(p) }))
    .sort((a, b) => ORDER[a.st.key] - ORDER[b.st.key] || String(a.p.name).localeCompare(String(b.p.name), 'es'));
  const influencers = rows.filter((r) => r.p.code && Number(r.p.commission_pct) > 0).map((r) => ({ ...r, inf: influencerStats(r.p) }));
  const owedTotal = sumBy(influencers, (r) => r.inf.owed);

  page.innerHTML = `
    <p class="muted small" style="margin-top:0">Al vender, la app sugiere la promoción que aplica y tú decides si la usas. Los códigos se escriben en la venta. Una promoción por venta.</p>
    <div class="btn-row" style="margin-top:0"><button class="btn primary" id="new-promo">+ Nueva promoción</button></div>
    ${
      rows.length
        ? `<div class="section"><h2>Promociones</h2></div><div class="list">${rows
            .map(({ p, st, sales }) => {
              const given = sumBy(sales, (s) => s.discount);
              return `<button class="row" data-id="${p.id}">
                <div class="row-main"><div class="row-title">${esc(p.name)}${p.code ? ` <span class="code-pill">${esc(p.code)}</span>` : ''}</div>
                  <div class="row-sub">${esc(promoSummary(p))}${p.end_date ? ` · hasta ${fmtDate(p.end_date)}` : ''}</div>
                  <div class="row-sub">${int(sales.length)} uso${sales.length === 1 ? '' : 's'}${p.max_uses ? ` de ${int(p.max_uses)}` : ''} · ${Q(given)} descontados</div></div>
                <div class="row-end"><span class="badge ${st.cls}">${esc(st.label)}</span></div>
              </button>`;
            })
            .join('')}</div>`
        : emptyState('Aún no tienes promociones.')
    }
    ${
      influencers.length
        ? `<div class="section"><h2>Comisiones de influencers</h2>${owedTotal ? `<span class="muted small">Debes ${Q(owedTotal)}</span>` : ''}</div>
          <div class="list">${influencers
            .map(
              ({ p, inf }) => `<div class="row inf-row">
                <div class="row-main"><div class="row-title">${esc(p.influencer || 'Influencer')} <span class="code-pill">${esc(p.code)}</span></div>
                  <div class="row-sub">${int(inf.sales.length)} ventas · ${Q(inf.revenue)} vendidos · ${Number(p.commission_pct)}% = ${Q(inf.earned)}</div>
                  <div class="row-sub">Pagado ${Q(inf.paid)}${inf.owed ? ` · <b style="color:var(--warn)">Debes ${Q(inf.owed)}</b>` : ' · Al día ✓'}</div></div>
                ${inf.owed ? `<button class="btn sm" data-pay="${p.id}">Registrar pago</button>` : ''}
              </div>`
            )
            .join('')}</div>`
        : ''
    }`;

  $('#new-promo', page).onclick = () => openPromo();
  $$('.row[data-id]', page).forEach((b) => (b.onclick = () => openPromo(b.dataset.id)));
  $$('[data-pay]', page).forEach((b) => (b.onclick = () => payCommission(state.promos.find((x) => x.id === b.dataset.pay))));
}

function payCommission(p) {
  const inf = influencerStats(p);
  const cat = state.settings.expense_categories.find((c) => /comisi|publicidad/i.test(c)) || state.settings.expense_categories[0];
  sheet({
    title: 'Pago de comisión',
    body: `
      <form class="form" id="payf">
        <p class="muted small" style="margin:0">${esc(p.influencer || 'Influencer')} · código ${esc(p.code)}. Se registra como gasto (${esc(cat)}).</p>
        <label class="field"><span>Monto (Q)</span><input name="amount" id="pay-amount" inputmode="decimal" value="${inf.owed.toFixed(2)}"></label>
        <label class="field"><span>Fecha</span><input type="date" name="date" value="${today()}"></label>
        <button class="btn primary block" type="submit">Registrar pago</button>
      </form>`,
    onMount(root, close) {
      $('#payf', root).onsubmit = async (e) => {
        e.preventDefault();
        const amount = num(e.target.amount.value);
        if (amount <= 0) return toast('Escribe el monto', 'error');
        try {
          await saveRow('expenses', { amount, date: e.target.date.value || today(), category: cat, description: `Comisión ${p.influencer || ''} (${p.code})`.trim(), promo_id: p.id, kind: 'comision' });
          toast('Pago registrado');
          close();
          bus.rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    },
  });
}

function openPromo(id) {
  const p = (state.promos || []).find((x) => x.id === id) || { type: 'percent', active: true, start_date: today(), product_ids: [], drop_ids: [], channels: [] };
  const scope = p.product_ids?.length ? 'products' : p.drop_ids?.length ? 'drops' : 'all';
  const sales = id ? promoSales(p) : [];
  const check = (name, value, checked, label) =>
    `<label class="chip-check"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;

  sheet({
    title: id ? p.name : 'Nueva promoción',
    body: `
      ${id ? `<div class="kpis" style="margin-bottom:12px">
        <div class="kpi"><div class="k">Usos</div><div class="v">${int(sales.length)}</div>${p.max_uses ? `<div class="s">de ${int(p.max_uses)}</div>` : ''}</div>
        <div class="kpi"><div class="k">Descontado</div><div class="v">${Q(sumBy(sales, (s) => s.discount))}</div><div class="s">${Q(sumBy(sales, (s) => s.total))} vendido</div></div>
      </div>` : ''}
      <form class="form" id="prf" autocomplete="off">
        <label class="field"><span>Nombre</span><input name="name" id="pr-name" required value="${esc(p.name)}" placeholder="Ej. 2 playeras por Q350"></label>
        <label class="field"><span>Tipo</span><select name="type" id="pr-type">${options(Object.entries(PROMO_TYPES).map(([value, label]) => ({ value, label })), p.type)}</select></label>
        <div class="grid2" id="pr-values"></div>

        <div class="field"><span>Aplica a</span>
          <div class="seg" id="pr-scope">
            ${[['all', 'Todo'], ['products', 'Productos'], ['drops', 'Drops']].map(([k, l]) => `<button type="button" data-scope="${k}" class="${scope === k ? 'active' : ''}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="chip-checks ${scope === 'products' ? '' : 'hidden'}" id="pr-products">${state.products
          .filter((x) => x.active !== false)
          .map((x) => check('product_ids', x.id, p.product_ids?.includes(x.id), x.name))
          .join('')}</div>
        <div class="chip-checks ${scope === 'drops' ? '' : 'hidden'}" id="pr-drops">${state.drops.map((d) => check('drop_ids', d.id, p.drop_ids?.includes(d.id), d.name)).join('') || '<span class="muted small">No hay drops.</span>'}</div>

        <div class="section" style="margin-top:6px"><h2>Código e influencer</h2></div>
        <label class="field"><span>Código (opcional)</span><input name="code" id="pr-code" value="${esc(p.code)}" placeholder="Ej. ANDRE10" autocapitalize="characters" autocorrect="off" spellcheck="false">
          <span class="hint">Con código, la promo solo se aplica cuando el cliente lo dice. Sin código, la app la sugiere sola.</span></label>
        <div class="grid2">
          <label class="field"><span>Influencer</span><input name="influencer" id="pr-inf" value="${esc(p.influencer)}" placeholder="Opcional"></label>
          <label class="field"><span>Comisión (%)</span><input name="commission_pct" id="pr-comm" inputmode="decimal" value="${esc(p.commission_pct ?? '')}" placeholder="0"></label>
        </div>

        <div class="section" style="margin-top:6px"><h2>Reglas</h2></div>
        <div class="grid2">
          <label class="field"><span>Desde</span><input type="date" name="start_date" value="${esc(p.start_date || '')}"></label>
          <label class="field"><span>Hasta</span><input type="date" name="end_date" value="${esc(p.end_date || '')}"></label>
        </div>
        <div class="field"><span>Solo en estos canales</span>
          <div class="chip-checks">${state.settings.channels.map((c) => check('channels', c, p.channels?.includes(c), c)).join('')}</div>
          <span class="hint">Sin marcar ninguno = todos los canales.</span></div>
        <label class="field"><span>Solo en un evento</span><select name="event_id">${options(
          state.events.filter((e) => e.status !== 'cerrado' || e.id === p.event_id).map((e) => ({ value: e.id, label: e.name })),
          p.event_id || '',
          { empty: 'Cualquiera' }
        )}</select></label>
        <div class="grid2">
          <label class="field"><span>Límite de usos</span><input name="max_uses" inputmode="numeric" value="${esc(p.max_uses ?? '')}" placeholder="Sin límite"></label>
          <label class="field"><span>Compra mínima (Q)</span><input name="min_total" inputmode="decimal" value="${esc(p.min_total ?? '')}" placeholder="Sin mínimo"></label>
        </div>
        <label class="check"><input type="checkbox" name="once_per_customer" ${p.once_per_customer ? 'checked' : ''}> 1 vez por cliente</label>
        <label class="check"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Activa</label>
        <button class="btn primary block" type="submit">${id ? 'Guardar cambios' : 'Crear promoción'}</button>
        ${id && !sales.length ? '<button class="btn danger block" type="button" id="pr-del">Eliminar promoción</button>' : ''}
      </form>`,
    onMount(root, close) {
      const f = $('#prf', root);
      let sc = scope;
      const drawValues = () => {
        const t = f.type.value;
        $('#pr-values', root).innerHTML =
          t === 'bundle'
            ? `<label class="field"><span>Cantidad de prendas</span><input name="bundle_qty" inputmode="numeric" value="${esc(p.bundle_qty ?? 2)}"></label>
               <label class="field"><span>Por (Q)</span><input name="bundle_price" inputmode="decimal" value="${esc(p.bundle_price ?? '')}" placeholder="350"></label>`
            : `<label class="field" style="grid-column:1/-1"><span>${t === 'percent' ? 'Porcentaje (%)' : t === 'amount' ? 'Descuento (Q)' : 'Precio especial c/u (Q)'}</span>
               <input name="value" inputmode="decimal" value="${esc(p.type === t ? p.value ?? '' : '')}" placeholder="${t === 'percent' ? '10' : t === 'amount' ? '25' : '120'}"></label>`;
      };
      f.type.onchange = drawValues;
      drawValues();
      $$('[data-scope]', root).forEach(
        (b) =>
          (b.onclick = () => {
            sc = b.dataset.scope;
            $$('[data-scope]', root).forEach((x) => x.classList.toggle('active', x === b));
            $('#pr-products', root).classList.toggle('hidden', sc !== 'products');
            $('#pr-drops', root).classList.toggle('hidden', sc !== 'drops');
          })
      );
      f.onsubmit = async (e) => {
        e.preventDefault();
        const vals = (n) => $$(`input[name="${n}"]:checked`, f).map((c) => c.value);
        const code = f.code.value.trim().toUpperCase().replace(/\s+/g, '');
        const row = {
          name: f.name.value.trim(),
          type: f.type.value,
          value: f.value ? num(f.value.value) : null,
          bundle_qty: f.bundle_qty ? Math.max(2, Math.round(num(f.bundle_qty.value))) : null,
          bundle_price: f.bundle_price ? num(f.bundle_price.value) : null,
          product_ids: sc === 'products' ? vals('product_ids') : [],
          drop_ids: sc === 'drops' ? vals('drop_ids') : [],
          code: code || null,
          influencer: f.influencer.value.trim() || null,
          commission_pct: num(f.commission_pct.value) || null,
          start_date: f.start_date.value || null,
          end_date: f.end_date.value || null,
          channels: vals('channels'),
          event_id: f.event_id.value || null,
          max_uses: Math.round(num(f.max_uses.value)) || null,
          min_total: num(f.min_total.value) || null,
          once_per_customer: f.once_per_customer.checked,
          active: f.active.checked,
        };
        if (row.type === 'bundle' ? !row.bundle_price : !row.value) return toast('Escribe el valor de la promoción', 'error');
        if (row.type === 'percent' && row.value > 100) return toast('El porcentaje no puede pasar de 100', 'error');
        if (sc !== 'all' && !row.product_ids.length && !row.drop_ids.length) return toast(`Elige al menos un ${sc === 'products' ? 'producto' : 'drop'}`, 'error');
        if (code && (state.promos || []).some((x) => x.id !== id && x.code === code)) return toast(`El código ${code} ya existe`, 'error');
        if (row.start_date && row.end_date && row.end_date < row.start_date) return toast('La fecha "Hasta" es antes de "Desde"', 'error');
        try {
          await saveRow('promos', id ? { id, ...row } : row);
          toast(id ? 'Promoción actualizada' : 'Promoción creada');
          close();
          bus.rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      const del = $('#pr-del', root);
      if (del)
        del.onclick = async () => {
          if (!(await confirmAction(`¿Eliminar "${p.name}"?`, { ok: 'Eliminar', danger: true }))) return;
          await deleteRow('promos', id);
          toast('Promoción eliminada');
          close();
          bus.rerender();
        };
    },
  });
}
