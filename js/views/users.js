import { state, CLOUD, users, refresh, cleanUsername } from '../db.js';
import { PERMISSIONS, ROLE_LABEL, defaultPermissions } from '../permissions.js';
import { $, $$, esc, sheet, toast, confirmAction, emptyState } from '../ui.js';
import { bus } from '../bus.js';

// Contraseña temporal fácil de dictar: trco + 4 números.
const tempPassword = () => {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return 'trco' + String(n[0] % 10000).padStart(4, '0');
};

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado');
  } catch {
    toast('Mantén presionado el texto para copiarlo');
  }
}

let fetched = 0;

export function render(page) {
  if (CLOUD && Date.now() - fetched > 5000) {
    fetched = Date.now();
    refresh(['profiles'])
      .then(() => location.hash === '#usuarios' && render(page))
      .catch(() => {});
  }
  const list = [...state.profiles].sort(
    (a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || String(a.name).localeCompare(String(b.name), 'es')
  );

  page.innerHTML = `
    <p class="muted small" style="margin-top:0">Tú creas los usuarios con una contraseña temporal. Al entrar por primera vez, cada quien pone la suya. Si alguien la olvida, aquí le asignas una nueva.</p>
    ${!CLOUD ? `<div class="alert info" style="margin-bottom:12px">Los usuarios se activan cuando conectemos Firebase. En modo demo solo existe el Dueño, pero puedes ver cómo se configuran los permisos.</div>` : ''}
    <div class="btn-row"><button class="btn primary" id="new">+ Nuevo usuario</button></div>
    <div class="section"><h2>Usuarios (${list.length})</h2></div>
    ${
      list.length
        ? `<div class="list">${list
            .map((u) => {
              const perms = u.role === 'owner' ? 'Acceso total' : `${PERMISSIONS.filter((p) => u.permissions?.[p.key]).length} de ${PERMISSIONS.length} permisos`;
              return `<button class="row" data-id="${esc(u.id)}">
                <div class="row-main">
                  <div class="row-title">${esc(u.name)}${u.id === state.profile?.id ? ' <span class="muted small">(tú)</span>' : ''}</div>
                  <div class="row-sub">@${esc(u.username || '')} · ${esc(perms)}</div>
                </div>
                <div class="row-end">
                  <span class="badge ${u.role === 'owner' ? 'ok' : 'info'}">${ROLE_LABEL[u.role] || u.role}</span>
                  ${u.active === false ? '<div style="margin-top:4px"><span class="badge muted">Desactivado</span></div>' : ''}
                  ${u.must_change_password && u.active !== false ? '<div style="margin-top:4px"><span class="badge warn">Clave temporal</span></div>' : ''}
                </div>
              </button>`;
            })
            .join('')}</div>`
        : emptyState('Aún no hay usuarios.')
    }`;

  $('#new', page).onclick = () => openUser();
  $$('.row[data-id]', page).forEach((b) => (b.onclick = () => openUser(b.dataset.id)));
}

function permissionsHTML(perms) {
  return PERMISSIONS.map(
    (p) => `<label class="perm">
      <input type="checkbox" data-perm="${p.key}" ${perms[p.key] ? 'checked' : ''}>
      <span><b>${esc(p.label)}</b><small>${esc(p.hint)}</small></span>
    </label>`
  ).join('');
}

function credentialsCard(username, password) {
  return `<div class="card creds">
    <div class="label" style="margin-bottom:8px">Pásale estos datos</div>
    <div class="kv"><span>Usuario</span><span><b>${esc(username)}</b></span></div>
    <div class="kv"><span>Contraseña temporal</span><span><b>${esc(password)}</b></span></div>
    <button class="btn block" type="button" id="copy-creds" style="margin-top:10px">Copiar</button>
    <p class="muted small" style="margin:10px 0 0">Al entrar, la app le pedirá crear su propia contraseña.</p>
  </div>`;
}

function openUser(id) {
  const u = state.profiles.find((x) => x.id === id);
  const isNew = !u;
  const isMe = u && u.id === state.profile?.id;
  const perms = u?.permissions || defaultPermissions();
  const role = u?.role || 'colaborador';

  sheet({
    title: isNew ? 'Nuevo usuario' : u.name,
    body: `
      <form class="form" id="uf">
        <label class="field"><span>Nombre</span><input name="name" id="u-name" required value="${esc(u?.name)}" placeholder="Ej. Ana López"></label>
        ${
          isNew
            ? `<label class="field"><span>Usuario</span><input name="username" id="u-username" required autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="ej. ana">
                <span class="hint">Con lo que va a entrar. Letras, números, punto o guion; sin espacios ni acentos.</span></label>
               <label class="field"><span>Contraseña temporal</span><input name="password" id="u-password" required minlength="6" value="${tempPassword()}" autocapitalize="none" autocorrect="off">
                <span class="hint">Se la das tú; la cambiará al entrar.</span></label>`
            : `<div class="kv"><span>Usuario</span><span><b>@${esc(u.username)}</b></span></div>`
        }
        <label class="field"><span>Rol</span><select name="role" id="u-role" ${isMe ? 'disabled' : ''}>
          <option value="colaborador" ${role === 'colaborador' ? 'selected' : ''}>Colaborador (solo lo que le permitas)</option>
          <option value="owner" ${role === 'owner' ? 'selected' : ''}>Dueño (acceso total)</option>
        </select></label>
        <div id="perm-box" class="${role === 'owner' ? 'hidden' : ''}">
          <div class="label" style="margin:4px 0 8px">Permisos</div>
          <div class="perms">${permissionsHTML(perms)}</div>
          <p class="muted small">Sin permisos especiales igual puede ver el inventario, las ventas y los drops.</p>
        </div>
        ${!isNew && !isMe ? `<label class="check"><input type="checkbox" name="active" id="u-active" ${u.active !== false ? 'checked' : ''}> Usuario activo (puede entrar)</label>` : ''}
        <button class="btn primary block" type="submit">${isNew ? 'Crear usuario' : 'Guardar cambios'}</button>
        ${!isNew && !isMe ? `
          <button class="btn block" type="button" id="reset">Asignar contraseña temporal nueva</button>
          <button class="btn danger block" type="button" id="del">Eliminar usuario</button>` : ''}
        ${isMe ? '<p class="muted small">Tu propio rol no se puede cambiar desde aquí. Otro Dueño puede hacerlo.</p>' : ''}
      </form>
      <div id="result"></div>`,
    onMount(root, close) {
      const form = $('#uf', root);
      const roleSel = $('#u-role', root);
      roleSel.onchange = () => $('#perm-box', root).classList.toggle('hidden', roleSel.value === 'owner');
      const readPerms = () => Object.fromEntries($$('[data-perm]', root).map((c) => [c.dataset.perm, c.checked]));
      const guard = () => {
        if (CLOUD) return true;
        toast('Disponible cuando conectemos Firebase');
        return false;
      };
      const showCreds = (username, password) => {
        form.classList.add('hidden');
        $('#result', root).innerHTML = `${credentialsCard(username, password)}<button class="btn primary block" type="button" id="done" style="margin-top:12px">Listo</button>`;
        $('#copy-creds', root).onclick = () => copy(`Usuario: ${username}\nContraseña temporal: ${password}`);
        $('#done', root).onclick = () => {
          close();
          bus.rerender();
        };
      };

      form.onsubmit = async (e) => {
        e.preventDefault();
        if (!guard()) return;
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          if (isNew) {
            const username = cleanUsername(form.username.value);
            const password = form.password.value.trim();
            await users.create({ name: form.name.value.trim(), username, password, role: roleSel.value, permissions: readPerms() });
            await refresh(['profiles']);
            toast('Usuario creado');
            showCreds(username, password);
          } else {
            await users.update({
              uid: u.id,
              name: form.name.value.trim(),
              role: roleSel.value,
              permissions: readPerms(),
              ...(form.active ? { active: form.active.checked } : {}),
            });
            await refresh(['profiles']);
            toast('Cambios guardados');
            close();
            bus.rerender();
          }
        } catch (err) {
          btn.disabled = false;
          toast(err.message, 'error');
        }
      };

      const reset = $('#reset', root);
      if (reset)
        reset.onclick = async () => {
          if (!guard()) return;
          if (!(await confirmAction(`¿Asignar una contraseña temporal nueva a ${u.name}? Se cerrará su sesión y la que tenía dejará de funcionar.`, { ok: 'Asignar' }))) return;
          const password = tempPassword();
          try {
            await users.resetPassword(u.id, password);
            await refresh(['profiles']);
            showCreds(u.username, password);
          } catch (err) {
            toast(err.message, 'error');
          }
        };

      const del = $('#del', root);
      if (del)
        del.onclick = async () => {
          if (!guard()) return;
          if (!(await confirmAction(`¿Eliminar a ${u.name}? Ya no podrá entrar. Las ventas que registró se conservan. Si solo es temporal, mejor desmarca "Usuario activo".`, { ok: 'Eliminar', danger: true }))) return;
          try {
            await users.remove(u.id);
            await refresh(['profiles']);
            toast('Usuario eliminado');
            close();
            bus.rerender();
          } catch (err) {
            toast(err.message, 'error');
          }
        };
    },
  });
}
