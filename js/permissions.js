// Permisos que el Dueño puede activar a cada Colaborador.
// (La misma lista está en functions/permissions.js y en firebase/firestore.rules.)
export const PERMISSIONS = [
  { key: 'vender', label: 'Registrar ventas', hint: 'Usar el botón + para vender', default: true },
  { key: 'editar_ventas', label: 'Actualizar pedidos', hint: 'Cambiar estado, registrar pagos y guías', default: true },
  { key: 'descuentos', label: 'Descuentos a mano', hint: 'Escribir un descuento sin usar una promoción', default: false },
  { key: 'borrar_ventas', label: 'Cancelar o eliminar ventas', hint: 'Regresa prendas al inventario', default: false },
  { key: 'inventario', label: 'Editar inventario', hint: 'Crear y editar productos, stock y drops', default: false },
  { key: 'produccion', label: 'Producción', hint: 'Registrar lotes y marcarlos como recibidos', default: false },
  { key: 'clientes', label: 'Clientes', hint: 'Ver la lista, editar y borrar clientes', default: true },
  { key: 'reportes', label: 'Ver reportes', hint: 'Qué se vende, cuándo, tallas, canales', default: false },
  { key: 'costos', label: 'Ver costos y ganancias', hint: 'Costo por prenda, márgenes y ganancia', default: false },
  { key: 'gastos', label: 'Gastos', hint: 'Ver y registrar gastos del negocio', default: false },
  { key: 'exportar', label: 'Descargar a Excel', hint: 'Bajar ventas, inventario y clientes en CSV', default: false },
];

export const defaultPermissions = () => Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.default]));

export const ROLE_LABEL = { owner: 'Dueño', colaborador: 'Colaborador' };
