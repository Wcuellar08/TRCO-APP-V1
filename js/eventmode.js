// "Modo evento" de este teléfono: mientras está activo, las ventas van al evento.
import { state } from './db.js';

const KEY = 'trco-event-mode';

export function activeEventId() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function setEventMode(id) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
}

// El evento activo en este teléfono (si sigue abierto).
export function activeEvent() {
  const id = activeEventId();
  if (!id) return null;
  const ev = state.events.find((e) => e.id === id);
  if (!ev || ev.status === 'cerrado') {
    setEventMode('');
    return null;
  }
  return ev;
}

export const EVENT_CHANNEL = 'Evento / Pop-up';
export const eventChannel = () => state.settings.channels.find((c) => c === EVENT_CHANNEL) || state.settings.channels.find((c) => /evento|pop/i.test(c)) || state.settings.channels[0];
