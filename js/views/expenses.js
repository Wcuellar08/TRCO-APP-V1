import { state, saveRow, deleteRow } from '../db.js';
import { $, $$, esc, Q, num, today, fmtDate, MONTHS_LONG, parseYmd, startOfMonth, sheet, toast, options, emptyState, confirmAction, sumBy } from '../ui.js';
import { bus } from '../bus.js';

export function render(page) {
  const byMonth = new Map();
  for (const e of state.expenses) {
    const k = e.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(e);
  }
  const thisMonth = sumBy(state.expenses.filter((e) => e.date >= startOfMonth()), (e) => e.amount);
  page.innerHTML = `
    <p class="muted small" style="margin-top:0">Gastos de operación: publicidad, envíos, empaque, eventos… Lo que pagas por producir prendas va en <a href="#produccion">Producción</a> (eso es inventario).</p>
    <div class="kpis"><div class="kpi hero"><div class="k">Gastos de este mes</div><div class="v">${Q(thisMonth)}</div></div></div>
    <div class="btn-row"><button class="btn primary" id="new">+ Nuevo gasto</button></div>
    ${
      state.expenses.length
        ? [...byMonth.entries()]
            .map(([k, rows]) => {
              const d = parseYmd(k + '-01');
              return `<div class="date-head"><span>${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}</span><span class="num">${Q(sumBy(rows, (e) => e.amount))}</span></div>
              <div class="list">${rows
                .map(
                  (e) => `<button class="row" data-id="${e.id}"><div class="row-main"><div class="row-title">${esc(e.description || e.category)}</div>
                  <div class="row-sub">${esc(e.category || '')} · ${fmtDate(e.date)}</div></div><div class="row-end"><b>${Q(e.amount)}</b></div></button>`
                )
                .join('')}</div>`;
            })
            .join('')
        : emptyState('Aún no hay gastos registrados.')
    }`;
  $('#new', page).onclick = () => openExpense();
  $$('.row[data-id]', page).forEach((b) => (b.onclick = () => openExpense(b.dataset.id)));
}

function openExpense(id) {
  const e = state.expenses.find((x) => x.id === id) || { date: today(), category: state.settings.expense_categories[0] };
  sheet({
    title: id ? 'Gasto' : 'Nuevo gasto',
    body: `
      <form class="form" id="ef">
        <label class="field"><span>Monto (Q)</span><input name="amount" inputmode="decimal" required value="${esc(e.amount ?? '')}" placeholder="0"></label>
        <label class="field"><span>Categoría</span><select name="category">${options(state.settings.expense_categories, e.category)}</select></label>
        <label class="field"><span>Descripción</span><input name="description" value="${esc(e.description)}" placeholder="Ej. Anuncio IG drop verano"></label>
        <label class="field"><span>Fecha</span><input type="date" name="date" value="${esc(e.date)}"></label>
        <button class="btn primary block" type="submit">Guardar</button>
        ${id ? '<button class="btn danger block" type="button" id="del">Eliminar gasto</button>' : ''}
      </form>`,
    onMount(root, close) {
      $('#ef', root).onsubmit = async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        if (num(f.amount.value) <= 0) return toast('Escribe el monto', 'error');
        try {
          await saveRow('expenses', {
            ...(id ? { id } : {}),
            amount: num(f.amount.value),
            category: f.category.value,
            description: f.description.value.trim(),
            date: f.date.value || today(),
          });
          toast('Gasto guardado');
          close();
          bus.rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      const del = $('#del', root);
      if (del)
        del.onclick = async () => {
          if (!(await confirmAction('¿Eliminar este gasto?', { ok: 'Eliminar', danger: true }))) return;
          await deleteRow('expenses', id);
          toast('Gasto eliminado');
          close();
          bus.rerender();
        };
    },
  });
}
