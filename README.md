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

**Usuarios y permisos:** se entra con **usuario y contraseña**. La primera vez se crea la cuenta del **Dueño**. El Dueño da de alta a cada persona en *Más → Usuarios* con una contraseña temporal; al entrar por primera vez, cada quien crea la suya. Si alguien la olvida, el Dueño le asigna otra temporal (no hay "olvidé mi contraseña").

| Rol | Puede |
|---|---|
| **Dueño** | Todo, incluidos usuarios, permisos y catálogos |
| **Colaborador** | Ver inventario, ventas y drops, más lo que el Dueño le active: registrar ventas, actualizar pedidos, cancelar/eliminar ventas, editar inventario, producción, clientes, reportes, costos y ganancias, gastos, descargar a Excel |

Los permisos se aplican en la app **y** en la base de datos (reglas de Firestore), así que no se pueden saltar.

---

## 1. Probarla ya (modo demo)

Sin configurar nada, la app funciona en **modo demo**: los datos se guardan solo en ese navegador. En *Más → Ajustes → Cargar datos de ejemplo* puedes verla con ventas de prueba.

Para abrirla en tu computadora:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## 2. Conectar la nube (Firebase)

Los usuarios se gestionan con **Cloud Functions**, que requieren el plan **Blaze** de Firebase (pago por uso; pide tarjeta, pero con el uso de TRCO normalmente sale en US$0 porque incluye una cuota gratis grande).

1. En [console.firebase.google.com](https://console.firebase.google.com) → **Agregar proyecto** (ej. `trco-app`). Google Analytics no hace falta.
2. Abajo a la izquierda → **Actualizar** → plan **Blaze**. Recomendado: pon una alerta de presupuesto de US$1.
3. **Authentication** → *Comenzar* → *Sign-in method* → activa **Correo electrónico/contraseña** (internamente los usuarios usan un correo ficticio `usuario@usuarios.trco.app`).
4. **Firestore Database** → *Crear base de datos* → ubicación `nam5 (us-central)` → *Modo de producción*.
5. ⚙️ **Configuración del proyecto** → *General* → *Tus apps* → ícono web **`</>`** → registra la app (sin Hosting). Copia `firebaseConfig` en [`js/config.js`](js/config.js) (o pásaselo a Claude).
6. **Authentication → Settings → Dominios autorizados** → agrega `wcuellar08.github.io`.
7. **Publicar reglas y funciones.** Abre [Google Cloud Shell](https://shell.cloud.google.com) (terminal en el navegador, con tu misma cuenta de Google) y corre:
   ```bash
   git clone https://github.com/Wcuellar08/TRCO-APP-V1.git && cd TRCO-APP-V1
   (cd functions && npm ci)
   npx firebase-tools@13 login --no-localhost
   npx firebase-tools@13 deploy --only firestore:rules,functions --project TU-PROYECTO-ID
   ```
   Repite los dos últimos comandos (con `git pull` antes) cada vez que cambien `functions/` o `firebase/firestore.rules`.
8. Abre la app: te pedirá **crear la cuenta del Dueño**. Hazlo tú primero.

### Probar localmente con emuladores

```bash
(cd functions && npm install)
npx firebase-tools@13 emulators:start --only auth,firestore,functions --project demo-trco
```

## 3. Publicarla en internet (GitHub Pages)

La app se publica desde la rama `main` con GitHub Pages:

1. El repositorio debe ser **público** (Settings → General → Danger Zone → Change visibility). Tus datos de ventas NO están en el código; viven en Firebase o en el dispositivo.
2. **Settings → Pages → Build and deployment**: *Source* = **Deploy from a branch**, *Branch* = **main** y carpeta **/ (root)** → **Save**.
3. En 1-2 minutos queda en **https://wcuellar08.github.io/TRCO-APP-V1/**.

Cada cambio que se sube a `main` se publica solo en 1-2 minutos. En el iPhone, cierra y vuelve a abrir la app (a veces dos veces) para que tome la versión nueva.

## 4. Instalar en iPhone / iPad

1. Abre la URL de la app en **Safari**.
2. Toca **Compartir** (cuadro con flecha ↑).
3. **Agregar a pantalla de inicio** → **Agregar**.

Se abre en pantalla completa con el ícono de TRCO y carga aunque no haya internet (para guardar datos en la nube sí necesitas conexión).

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
js/config.js          Claves de Firebase
js/db.js              Datos (Firebase o modo demo) y lógica de inventario/ventas
js/ui.js              Formatos, fechas, gráficas, ventanas
js/views/*.js         Cada pantalla (users.js = gestión de usuarios)
js/permissions.js     Lista de permisos de colaborador
functions/            Cloud Functions: crear/editar usuarios y contraseñas (solo Dueño)
js/demo.js            Datos de ejemplo
firebase/firestore.rules  Reglas de seguridad de la base de datos
```

### Notas de seguridad

- Las claves de `js/config.js` son públicas por diseño (van dentro de cualquier app web de Firebase). Lo que protege los datos son las reglas de `firebase/firestore.rules`: solo los usuarios aprobados ven o cambian información.
- Crear usuarios, cambiar roles/permisos y asignar contraseñas solo se puede desde las Cloud Functions, que verifican que quien lo pide sea un Dueño activo.
- Las reglas de Firestore revisan los permisos de cada persona en cada lectura/escritura. Desactivar a alguien lo bloquea al instante.
- Excepción conocida: el **costo** de los productos se oculta en la app a quien no tiene el permiso "Ver costos", pero viaja junto con el producto, así que alguien con conocimientos técnicos podría leerlo desde la base de datos.
