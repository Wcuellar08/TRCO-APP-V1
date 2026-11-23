# TRCO App · Control del negocio

App web instalable (PWA) para iPhone y iPad que controla el negocio de **TRCO**: inventario, ventas, pedidos, clientes, producción, gastos, drops y reportes. Usa quetzales (Q).

## Qué hace

| Sección | Para qué sirve |
|---|---|
| **Inicio** | Ventas de hoy, la semana y el mes (con comparación contra el mes pasado), ganancia neta, saldos por cobrar, pendientes, stock bajo y producción en camino |
| **Inventario** | Productos con foto, tipo, color, drop, precio, costo y stock **por talla**. Alertas de stock bajo |
| **＋ Vender** | Registro rápido: producto → talla → cantidad. Descuenta el inventario solo. Admite descuentos, envío, anticipos/apartados y clientes nuevos |
| **Ventas / Pedidos** | Historial por día y filtros: pendientes, por enviar, apartados, por cobrar. Registrar pagos, número de guía, cancelar (regresa el stock) |
| **Reportes** | Por periodo: ventas en el tiempo, productos más vendidos, tipo de prenda, talla, color, día de la semana, canal, drop, método de pago, mejores clientes, ganancia por producto y gastos. Exporta a Excel (CSV) |
| **Clientes** | Contacto, Instagram y WhatsApp en un toque, historial y total gastado |
| **Producción** | Lotes mandados a hacer con el proveedor. Al marcarlos como recibidos se suman al inventario y se actualiza el costo por prenda |
| **Gastos** *(solo dueño)* | Publicidad, envíos, empaque, eventos… para calcular la ganancia neta |
| **Drops** | Colecciones: cuánto vendió cada una y qué % ya se vendió |
| **Ajustes** | Equipo y roles, catálogos (tipos, tallas, canales, pagos), respaldos |

**Roles:** el **dueño** ve todo. El **equipo** registra ventas, inventario, clientes y producción, pero no ve costos, ganancias ni gastos.

---

## 1. Probarla ya (modo demo)

Sin configurar nada, la app funciona en **modo demo**: los datos se guardan solo en ese navegador. En *Más → Ajustes → Cargar datos de ejemplo* puedes verla con ventas de prueba.

Para abrirla en tu computadora:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## 2. Conectar la nube (Supabase, gratis)

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo (región: *East US* o la más cercana).
2. Ve a **SQL Editor → New query**, pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y dale a **Run**.
3. Ve a **Project Settings → API** y copia **Project URL** y la **anon public key**.
4. Pégalas en [`js/config.js`](js/config.js).
5. Abre la app y toca **Crear cuenta**. **La primera cuenta que se registre será la del dueño** (tú). Hazlo antes que nadie.
6. Tu equipo crea su cuenta desde la app. Entra como *Sin acceso* hasta que tú le asignes un rol en **Más → Ajustes → Equipo**.

> Opcional: en Supabase → *Authentication → Providers → Email* puedes desactivar "Confirm email" para no tener que confirmar el correo al registrarse.

## 3. Publicarla en internet

Es un sitio estático (no necesita servidor). Opciones gratis:

- **Netlify / Cloudflare Pages / Vercel:** conecta este repositorio de GitHub. No hace falta configurar nada de compilación (*build command* vacío, *publish directory* `/`).
- **GitHub Pages:** *Settings → Pages → Deploy from branch*. En repositorios privados requiere un plan de pago de GitHub.

## 4. Instalar en iPhone / iPad

1. Abre la URL de la app en **Safari**.
2. Toca **Compartir** (cuadro con flecha ↑).
3. **Agregar a pantalla de inicio** → **Agregar**.

Se abre en pantalla completa con el ícono de TRCO y carga aunque no haya internet (en modo nube, para guardar datos sí necesitas conexión).

---

## Personalizar

- **Color de acento:** `--accent` en [`css/app.css`](css/app.css).
- **Tipos de prenda, tallas, canales, métodos de pago y categorías de gastos:** desde la app, en *Ajustes → Catálogos*.
- **Ícono:** reemplaza los PNG de [`icons/`](icons/) por tu logo (180×180, 192×192 y 512×512).
- Cuando publiques cambios, sube el número de `VERSION` en [`sw.js`](sw.js) para que los iPhones descarguen la versión nueva.

## Estructura

```
index.html            Página principal
manifest.webmanifest  Configuración de app instalable
sw.js                 Funcionamiento sin conexión
css/app.css           Estilos
js/config.js          Claves de Supabase
js/db.js              Datos (Supabase o modo demo) y lógica de inventario/ventas
js/ui.js              Formatos, fechas, gráficas, ventanas
js/views/*.js         Cada pantalla
js/demo.js            Datos de ejemplo
supabase/schema.sql   Tablas y reglas de seguridad
```

### Notas de seguridad

- La *anon key* de Supabase es pública por diseño. Lo que protege los datos son las reglas (Row Level Security) de `schema.sql`: solo los usuarios aprobados ven o cambian información.
- Los **gastos** están protegidos en la base de datos: solo el dueño puede leerlos. El **costo** de los productos se oculta al equipo en la app, pero técnicamente un usuario del equipo con conocimientos podría leerlo desde la base de datos.
