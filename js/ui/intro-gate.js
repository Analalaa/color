const LEAVE_DURATION = 720;

export function initIntroGate() {
  const gate = document.getElementById('intro-gate');
  const app = document.getElementById('app');
  const enterButton = document.getElementById('intro-enter-btn');
  const skipButton = document.getElementById('intro-skip-btn');
  const reopenButton = document.getElementById('reopen-intro-btn');

  if (!gate || !app) return;

  let leaveTimer = null;
  let pointerFrame = null;

  const setApplicationAccessible = accessible => {
    if (accessible) {
      app.removeAttribute('inert');
      app.removeAttribute('aria-hidden');
      return;
    }
    app.setAttribute('inert', '');
    app.setAttribute('aria-hidden', 'true');
  };

  const show = () => {
    if (leaveTimer) window.clearTimeout(leaveTimer);
    gate.hidden = false;
    gate.classList.remove('is-leaving');
    document.body.classList.add('intro-active');
    setApplicationAccessible(false);
    window.requestAnimationFrame(() => {
      gate.classList.add('is-ready');
      enterButton?.focus({ preventScroll: true });
    });
  };

  const close = () => {
    if (gate.hidden || gate.classList.contains('is-leaving')) return;
    gate.classList.add('is-leaving');
    gate.classList.remove('is-ready');
    document.body.classList.remove('intro-active');
    setApplicationAccessible(true);
    leaveTimer = window.setTimeout(() => {
      gate.hidden = true;
      document.getElementById('upload-btn')?.focus({ preventScroll: true });
    }, LEAVE_DURATION);
  };

  const updatePointer = event => {
    if (pointerFrame || gate.hidden) return;
    pointerFrame = window.requestAnimationFrame(() => {
      const x = (event.clientX / window.innerWidth - 0.5) * 2;
      const y = (event.clientY / window.innerHeight - 0.5) * 2;
      gate.style.setProperty('--intro-x', x.toFixed(3));
      gate.style.setProperty('--intro-y', y.toFixed(3));
      pointerFrame = null;
    });
  };

  enterButton?.addEventListener('click', close);
  skipButton?.addEventListener('click', close);
  reopenButton?.addEventListener('click', show);
  gate.addEventListener('pointermove', updatePointer, { passive: true });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !gate.hidden) close();
  });

  show();
}
