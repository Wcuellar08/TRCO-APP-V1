// Datos de ejemplo para probar la app en modo demo.
import { DEFAULT_SETTINGS } from './db.js';
import { today, addDays } from './ui.js';

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function buildDemoData() {
  const r = rng(2026);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const weighted = (pairs) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let x = r() * total;
    for (const [v, w] of pairs) if ((x -= w) < 0) return v;
    return pairs[0][0];
  };
  let n = 0;
  const id = (p) => `${p}-${++n}`;
  const t = today();
  const now = new Date().toISOString();

  const drops = [
    { id: id('d'), name: 'Drop 01 · Origen', release_date: addDays(t, -170), notes: 'Primer lanzamiento', created_at: now },
    { id: id('d'), name: 'Drop 02 · Calle', release_date: addDays(t, -95), notes: '', created_at: now },
    { id: id('d'), name: 'Drop 03 · Noche', release_date: addDays(t, -25), notes: 'Colaboración con artista local', created_at: now },
  ];

  const defs = [
    ['Tee Logo Clásico', 'Playera', 'Negro', 0, 150, 55],
    ['Tee Logo Clásico', 'Playera', 'Blanco', 0, 150, 55],
    ['Oversize Origen', 'Playera oversize', 'Negro', 0, 195, 70],
    ['Boxy Calle 502', 'Playera boxy', 'Gris', 1, 210, 78],
    ['Oversize Grafiti', 'Playera oversize', 'Crema', 1, 200, 72],
    ['Manga Larga Sombra', 'Playera manga larga', 'Negro', 1, 235, 90],
    ['Oversize Noche', 'Playera oversize', 'Azul marino', 2, 220, 80],
    ['Boxy Luna', 'Playera boxy', 'Negro', 2, 225, 82],
  ];
  const products = defs.map(([name, type, color, d, price, cost], i) => ({
    id: id('p'),
    code: `TRCO-${String(i + 1).padStart(4, '0')}`,
    name,
    type,
    color,
    drop_id: drops[d].id,
    price,
    cost,
    stock: { S: Math.floor(r() * 8), M: Math.floor(r() * 14), L: Math.floor(r() * 12), XL: Math.floor(r() * 7) },
    min_stock: 2,
    photo: null,
    notes: '',
    active: true,
    created_at: now,
  }));
  products[0].stock.M = 1;
  products[2].stock.L = 0;
  products[6].stock.M = 2;

  const names = [
    'Andrea López', 'Diego Morales', 'Sofía Hernández', 'Luis Pérez', 'Gaby Castillo', 'Kevin Ramírez', 'Mariela Ortiz',
    'José Barrios', 'Daniela Cifuentes', 'Pablo Estrada', 'Fernanda Rivas', 'Javier Gómez', 'Valeria Méndez', 'Rodrigo Alvarado',
  ];
  const cities = ['Ciudad de Guatemala', 'Mixco', 'Antigua', 'Quetzaltenango', 'Villa Nueva', 'Escuintla'];
  const customers = names.map((name) => ({
    id: id('c'),
    name,
    instagram: name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(' ', '.'),
    phone: `5${Math.floor(1000000 + r() * 8999999)}`,
    city: pick(cities),
    notes: '',
    created_at: now,
  }));

  const sales = [];
  const sale_items = [];
  for (let back = 175; back >= 0; back--) {
    const date = addDays(t, -back);
    const dow = new Date(date + 'T12:00').getDay();
    const dropBoost = drops.some((d) => d.release_date <= date && addDays(d.release_date, 6) >= date) ? 3 : 0;
    const count = Math.floor(r() * (dow === 5 || dow === 6 ? 3.2 : 1.6)) + dropBoost;
    for (let k = 0; k < count; k++) {
      const available = products.filter((p) => drops.find((d) => d.id === p.drop_id).release_date <= date);
      if (!available.length) break;
      const lines = r() < 0.25 ? 2 : 1;
      const items = [];
      for (let j = 0; j < lines; j++) {
        const p = r() < 0.4 ? available[available.length - 1 - Math.floor(r() * Math.min(3, available.length))] : pick(available);
        items.push({
          id: id('i'),
          product_id: p.id,
          product_name: p.name,
          type: p.type,
          size: weighted([['S', 2], ['M', 5], ['L', 4], ['XL', 1.5]]),
          qty: r() < 0.15 ? 2 : 1,
          unit_price: p.price,
          unit_cost: p.cost,
          created_at: now,
        });
      }
      const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      const discount = r() < 0.12 ? 25 : 0;
      const channel = weighted([['Instagram', 6], ['WhatsApp', 3], ['En persona', 2], ['Evento / Pop-up', dropBoost ? 4 : 1], ['TikTok', 1.5]]);
      const shipping = channel === 'Instagram' || channel === 'WhatsApp' ? (r() < 0.6 ? 30 : 0) : 0;
      const total = subtotal - discount + shipping;
      const recent = back < 4;
      const status = recent ? weighted([['entregado', 3], ['por_enviar', 2], ['apartado', 1]]) : r() < 0.03 ? 'cancelado' : 'entregado';
      const sid = id('s');
      sales.push({
        id: sid,
        date,
        customer_id: r() < 0.75 ? pick(customers).id : null,
        channel,
        payment_method: weighted([['Transferencia', 5], ['Efectivo', 3], ['Tarjeta', 1.5], ['Depósito', 1]]),
        status,
        subtotal,
        discount,
        shipping,
        total,
        paid: status === 'apartado' ? Math.round(total / 2) : total,
        tracking: '',
        notes: '',
        created_by: null,
        created_at: `${date}T${String(10 + k).padStart(2, '0')}:00:00.000Z`,
      });
      items.forEach((i) => sale_items.push({ ...i, sale_id: sid }));
    }
  }

  const expenses = [];
  for (let m = 0; m < 6; m++) {
    const base = addDays(t, -m * 30);
    expenses.push(
      { id: id('e'), date: addDays(base, -3), category: 'Publicidad', description: 'Anuncios Instagram', amount: 300 + Math.round(r() * 300), created_at: now },
      { id: id('e'), date: addDays(base, -8), category: 'Empaque', description: 'Bolsas y stickers', amount: 120 + Math.round(r() * 80), created_at: now },
      { id: id('e'), date: addDays(base, -12), category: 'Envíos', description: 'Guías de envío', amount: 150 + Math.round(r() * 150), created_at: now }
    );
  }
  // Eventos de ejemplo: dos bazares cerrados (con sus ventas) y uno próximo.
  const events = [];
  const mkClosed = (name, location, from, days, stand, extra) => {
    const evId = id('ev');
    const to = addDays(from, days - 1);
    const packed = {};
    const returned = {};
    const evSales = sales.filter((sl) => sl.date >= from && sl.date <= to && sl.channel === 'Evento / Pop-up' && sl.status !== 'cancelado');
    for (const sl of evSales) {
      sl.event_id = evId;
      for (const it of sale_items.filter((x) => x.sale_id === sl.id)) {
        it.from_event = true;
        (packed[it.product_id] ??= {})[it.size] = (packed[it.product_id][it.size] || 0) + it.qty;
      }
    }
    for (const [pid, sizes] of Object.entries(packed))
      for (const sz of Object.keys(sizes)) {
        packed[pid][sz] += extra;
        (returned[pid] ??= {})[sz] = extra;
      }
    events.push({ id: evId, name, location, start_date: from, end_date: to, status: 'cerrado', goal: 2500, staff: [], notes: '', items: {}, packed, returned, missing: {}, closed_at: now, created_at: now });
    expenses.push({ id: id('e'), date: from, category: 'Eventos', description: `Stand · ${name}`, amount: stand, event_id: evId, kind: 'stand', created_at: now });
    expenses.push({ id: id('e'), date: from, category: 'Transporte', description: 'Gasolina y parqueo', amount: 120, event_id: evId, created_at: now });
  };
  mkClosed('Pop-up Drop 03', 'Zona 4, Ciudad de Guatemala', drops[2].release_date, 3, 450, 2);
  mkClosed('Bazar Cayalá', 'Paseo Cayalá', drops[1].release_date, 3, 350, 3);
  events.push({ id: id('ev'), name: 'Bazar Antigua Guate', location: 'Antigua Guatemala', start_date: addDays(t, 5), end_date: addDays(t, 6), status: 'abierto', goal: 3000, staff: [], notes: 'Montaje 8:00 am. Llevar mesa y espejo.', items: {}, packed: {}, created_at: now });

  // Promociones de ejemplo
  const promos = [
    { id: id('pr'), name: '2 playeras por Q350', type: 'bundle', bundle_qty: 2, bundle_price: 350, product_ids: [], drop_ids: [], channels: [], active: true, start_date: addDays(t, -60), created_at: now },
    { id: id('pr'), name: 'Liquidación Drop 01', type: 'special', value: 120, product_ids: [], drop_ids: [drops[0].id], channels: [], active: true, start_date: addDays(t, -20), end_date: addDays(t, 20), created_at: now },
    { id: id('pr'), name: 'Código Andrea', type: 'percent', value: 10, code: 'ANDRE10', influencer: 'Andrea Fit', commission_pct: 5, product_ids: [], drop_ids: [], channels: ['Instagram', 'WhatsApp'], active: true, start_date: addDays(t, -90), created_at: now },
    { id: id('pr'), name: 'Black Friday 15%', type: 'percent', value: 15, product_ids: [], drop_ids: [], channels: [], active: true, start_date: addDays(t, 4), end_date: addDays(t, 7), max_uses: 50, created_at: now },
  ];
  // Algunas ventas usaron el código de la influencer
  const andre = promos[2];
  sales
    .filter((sl) => sl.channel === 'Instagram' && sl.status === 'entregado' && !sl.discount)
    .filter((_, i) => i % 6 === 0)
    .slice(0, 9)
    .forEach((sl) => {
      const disc = Math.round(sl.subtotal * 0.1 * 100) / 100;
      Object.assign(sl, { discount: disc, total: sl.subtotal - disc + sl.shipping, paid: sl.subtotal - disc + sl.shipping, promo_id: andre.id, promo_name: andre.name, promo_code: andre.code });
    });
  expenses.push({ id: id('e'), date: addDays(t, -30), category: 'Publicidad', description: 'Comisión Andrea Fit (ANDRE10)', amount: 60, promo_id: andre.id, kind: 'comision', created_at: now });

  // Producto en preventa con pedidos
  const pre = {
    id: id('p'), code: 'TRCO-0009', name: 'Boxy Invierno', type: 'Playera boxy', color: 'Gris jaspe', drop_id: null,
    price: 240, cost: 85, stock: {}, min_stock: 2, photo: null, notes: 'Próximo drop', active: true, created_at: now,
    preorder: { active: true, price: 199, end_date: addDays(t, 10), started_at: addDays(t, -6), quotas: { S: 10, M: 20, L: 20, XL: null } },
  };
  products.push(pre);
  const preSizes = ['M', 'L', 'M', 'S', 'L', 'XL', 'M', 'L', 'M', 'S', 'L'];
  preSizes.forEach((size, k) => {
    const sid = id('s');
    const date = addDays(t, -6 + Math.floor(k / 2));
    sales.push({
      id: sid, date, customer_id: customers[k % customers.length].id, channel: k % 3 ? 'Instagram' : 'WhatsApp', payment_method: 'Transferencia',
      status: 'preventa', preorder: true, subtotal: 199, discount: 0, shipping: 0, total: 199, paid: 199, tracking: '', notes: '', created_by: null,
      created_at: `${date}T${String(9 + k).padStart(2, '0')}:00:00.000Z`,
    });
    sale_items.push({ id: id('i'), sale_id: sid, product_id: pre.id, product_name: pre.name, type: pre.type, size, qty: 1, unit_price: 199, unit_cost: pre.cost, preorder: true, created_at: now });
  });

  const production = [
    { id: id('b'), product_id: products[7].id, supplier: 'Serigrafía Zona 1', quantities: { S: 10, M: 20, L: 20, XL: 10 }, total_cost: 4920, ordered_date: addDays(t, -30), expected_date: addDays(t, -26), received_date: addDays(t, -26), status: 'recibido', notes: '', created_at: now },
    { id: id('b'), product_id: products[2].id, supplier: 'Taller Mixco', quantities: { M: 15, L: 15, XL: 5 }, total_cost: 2450, ordered_date: addDays(t, -6), expected_date: addDays(t, 5), received_date: null, status: 'en_produccion', notes: 'Reposición talla L', created_at: now },
  ];

  return {
    settings: [{ id: 1, data: { ...DEFAULT_SETTINGS } }],
    drops,
    products,
    customers,
    sales,
    sale_items,
    production,
    expenses,
    events,
    promos,
  };
}
