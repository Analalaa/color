function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || target.matches('input, textarea, select')
  );
}

function activateWorkflowStep(step) {
  document.querySelectorAll('[data-workflow-target]').forEach(button => {
    button.classList.toggle('active', button.dataset.workflowTarget === step);
  });
}

function revealWorkflowStep(step) {
  const compactLayout = window.matchMedia('(max-width: 920px)').matches;

  if (step === 'input') {
    activateWorkflowStep('input');
    const target = document.getElementById('input-panel');
    if (compactLayout) target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else document.getElementById('upload-btn')?.focus({ preventScroll: true });
    return;
  }

  if (step === 'review') {
    activateWorkflowStep('review');
    document.querySelector('[data-panel-mode="candidates"]')?.click();
    const drawer = document.querySelector('.reference-drawer');
    if (drawer instanceof HTMLDetailsElement) drawer.open = true;
    const target = document.getElementById('review-panel');
    if (compactLayout) target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else target?.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  activateWorkflowStep('recipe');
  document.querySelector('[data-panel-mode="anatomy"]')?.click();
  const target = document.getElementById('review-panel');
  if (compactLayout) target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else target?.scrollTo({ top: 0, behavior: 'smooth' });
}

export function initEditorialShell(EventBus) {
  const app = document.getElementById('app');
  const focusButton = document.getElementById('focus-mode-btn');
  const focusLabel = focusButton?.querySelector('span');
  const referenceDrawer = document.querySelector('.reference-drawer');

  if (!app) return;

  const setFocusMode = enabled => {
    app.classList.toggle('focus-mode', enabled);
    focusButton?.setAttribute('aria-pressed', String(enabled));
    if (focusLabel) focusLabel.textContent = enabled ? '退出专注' : '专注画面';
  };

  focusButton?.addEventListener('click', () => {
    setFocusMode(!app.classList.contains('focus-mode'));
  });

  document.addEventListener('keydown', event => {
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === 'f' && !window.matchMedia('(max-width: 920px)').matches) {
      event.preventDefault();
      setFocusMode(!app.classList.contains('focus-mode'));
    }
    if (event.key === 'Escape' && app.classList.contains('focus-mode')) {
      setFocusMode(false);
    }
  });

  document.querySelectorAll('[data-workflow-target]').forEach(button => {
    button.addEventListener('click', () => revealWorkflowStep(button.dataset.workflowTarget));
  });

  activateWorkflowStep('input');

  EventBus?.on('canvas-ready', () => {
    app.classList.add('has-image');
    activateWorkflowStep('review');
  });

  EventBus?.on('reference-selected', () => {
    app.classList.add('has-reference');
    activateWorkflowStep('review');
  });

  EventBus?.on('candidate-generation-started', () => {
    app.classList.add('is-reasoning');
    if (referenceDrawer instanceof HTMLDetailsElement) referenceDrawer.open = false;
    activateWorkflowStep('review');
  });

  EventBus?.on('candidates-ready', () => {
    app.classList.remove('is-reasoning');
    app.classList.add('has-candidates');
    activateWorkflowStep('review');
  });

  EventBus?.on('transfer-complete', () => {
    app.classList.add('has-result');
    activateWorkflowStep('recipe');
  });

  EventBus?.on('result-invalidated', () => {
    app.classList.remove('has-result');
  });
}
