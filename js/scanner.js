// Escáner de QR con la cámara. Modo ráfaga con confirmación:
// la cámara sigue abierta; cada código detectado muestra una tarjeta abajo
// con el botón de acción (ej. "Agregar"). Al confirmar, sigue escaneando.
import { loadScript, parseCode } from './codes.js';
import { $, esc } from './ui.js';

let audioCtx;
function beep() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0.18, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.13);
  } catch {}
  navigator.vibrate?.(40);
}

/**
 * openScanner({
 *   title: 'Escanear prendas',
 *   onMatch: ({product, size, code}) => ({ html, actionLabel, onAction }),
 *   counterLabel: (n) => `Listo (${n})`,
 *   onClose: () => {}
 * })
 */
export function openScanner({ title, onMatch, counterLabel, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'scan-wrap';
  wrap.innerHTML = `
    <header class="scan-head">
      <button type="button" class="btn-text" id="scan-close">Cerrar</button>
      <b>${esc(title)}</b>
      <span class="scan-count" id="scan-count"></span>
    </header>
    <div class="scan-view">
      <video id="scan-video" playsinline muted autoplay></video>
      <div class="scan-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="scan-msg" id="scan-msg">Abriendo la cámara…</div>
    </div>
    <div class="scan-bottom">
      <div class="scan-card hidden" id="scan-card" role="status" aria-live="polite"></div>
      <form class="scan-manual" id="scan-manual" autocomplete="off">
        <input id="scan-code" placeholder="o escribe el código" autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text">
        <button class="btn sm" type="submit">Buscar</button>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');

  const video = $('#scan-video', wrap);
  const msg = $('#scan-msg', wrap);
  const card = $('#scan-card', wrap);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let running = true;
  let paused = false; // mientras se muestra una tarjeta
  let count = 0;
  let lastCode = '';
  let lastAt = 0;
  let timer = null;

  const setCount = () => {
    $('#scan-count', wrap).textContent = count ? (counterLabel ? counterLabel(count) : String(count)) : '';
    $('#scan-close', wrap).textContent = count ? 'Listo' : 'Cerrar';
  };

  const hideCard = () => {
    card.classList.add('hidden');
    card.innerHTML = '';
    paused = false;
  };

  const showResult = (text) => {
    const parsed = parseCode(text);
    paused = true;
    beep();
    if (parsed.error) {
      card.innerHTML = `<div class="scan-error">${esc(parsed.error)}</div>
        <button class="btn block" type="button" data-skip>Seguir escaneando</button>`;
    } else {
      const res = onMatch(parsed);
      card.innerHTML = `${res.html}
        <div class="scan-actions">
          <button class="btn" type="button" data-skip>Omitir</button>
          <button class="btn primary" type="button" data-act>${esc(res.actionLabel)}</button>
        </div>`;
      card.querySelector('[data-act]').onclick = async () => {
        const keepOpen = await res.onAction();
        count++;
        setCount();
        lastCode = parsed.code;
        lastAt = Date.now();
        if (keepOpen === false) return close();
        hideCard();
      };
    }
    card.querySelector('[data-skip]').onclick = () => {
      lastCode = String(text).trim().toUpperCase();
      lastAt = Date.now();
      hideCard();
    };
    card.classList.remove('hidden');
  };

  const tick = () => {
    if (!running) return;
    if (!paused && video.readyState >= 2 && window.jsQR) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.min(1, 720 / Math.max(vw, vh));
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (found?.data) {
        const code = found.data.trim().toUpperCase();
        // Evita leer la misma etiqueta dos veces seguidas sin querer.
        if (!(code === lastCode && Date.now() - lastAt < 1800)) showResult(code);
      }
    }
    timer = setTimeout(tick, 130);
  };

  const start = async () => {
    try {
      await loadScript('js/vendor/jsQR.js');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!running) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});
      msg.textContent = 'Apunta al QR de la etiqueta';
      tick();
    } catch (e) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      msg.innerHTML = denied
        ? 'No hay permiso para usar la cámara.<br><small>En el iPhone: Ajustes → Safari → Cámara → Permitir. Mientras, escribe el código abajo.</small>'
        : 'No se pudo abrir la cámara en este dispositivo.<br><small>Escribe el código de la etiqueta abajo.</small>';
      msg.classList.add('err');
    }
  };

  const close = () => {
    running = false;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    wrap.parentNode?.removeChild(wrap);
    if (!document.querySelector('.sheet-wrap')) document.body.classList.remove('no-scroll');
    onClose?.(count);
  };

  $('#scan-close', wrap).onclick = close;
  $('#scan-manual', wrap).onsubmit = (e) => {
    e.preventDefault();
    const input = $('#scan-code', wrap);
    if (!input.value.trim()) return;
    showResult(input.value);
    input.value = '';
    input.blur();
  };
  setCount();
  start();
  return { close };
}
