'use strict';

(() => {
  const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');

  // The Conduit copy-normalizer watches text mutations. Reassigning identical
  // text can otherwise create a mutation loop that starves pointer and keyboard
  // events in Electron. Ignore only true no-op assignments.
  if (descriptor?.get && descriptor?.set && descriptor.configurable) {
    Object.defineProperty(Node.prototype, 'textContent', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        const next = value == null ? '' : String(value);
        if (descriptor.get.call(this) === next) return;
        descriptor.set.call(this, next);
      },
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    const toolbar = document.querySelector('.toolbar');
    const quickControls = document.querySelector('.quick-controls');
    const backdrop = document.querySelector('#setup-backdrop');
    const dialog = document.querySelector('#setup-dialog');

    const style = document.createElement('style');
    style.dataset.conduitInteractionFix = 'true';
    style.textContent = `
      #labels { pointer-events: none !important; }
      .toolbar,
      .toolbar *,
      #setup-dialog,
      #setup-dialog * { pointer-events: auto; }
      #setup-backdrop.hidden {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      #setup-backdrop:not(.hidden) {
        visibility: visible;
        pointer-events: auto;
      }
    `;
    document.head.appendChild(style);

    toolbar?.setAttribute('data-interactive', 'true');
    quickControls?.setAttribute('data-interactive', 'true');
    backdrop?.setAttribute('data-interactive', 'true');
    dialog?.setAttribute('data-interactive', 'true');

    // Recover from a stale busy class if an interrupted apply operation left
    // the toolbar locked while the configuration sheet is no longer visible.
    window.setInterval(() => {
      if (!quickControls || !backdrop) return;
      if (!backdrop.classList.contains('hidden')) return;
      if (!quickControls.classList.contains('is-busy')) return;

      quickControls.classList.remove('is-busy');
      quickControls.querySelectorAll('button, select, input').forEach((control) => {
        control.disabled = false;
      });
    }, 2000);
  }, { once: true });
})();
