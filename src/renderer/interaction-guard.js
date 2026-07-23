'use strict';

(() => {
  const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');

  // Ignore only true no-op assignments. The compatibility renderer rewrites
  // a few labels and older Electron builds can otherwise enter a mutation loop.
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

  function addOption(select, value, label) {
    if (!select || select.querySelector(`option[value="${value}"]`)) return;
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = label;
    select.appendChild(option);
  }

  function prepareEightPaneControls() {
    const quickCount = document.querySelector('#quick-screen-count');
    const setupCount = document.querySelector('#setup-screen-count');

    for (let count = 5; count <= 8; count += 1) {
      addOption(quickCount, count, String(count));
      addOption(setupCount, count, `${count} panes${count >= 7 ? ' · high load' : ''}`);
    }

    const resetGrid = document.querySelector('.screen-reset-grid');
    if (resetGrid) {
      for (let count = 5; count <= 8; count += 1) {
        if (resetGrid.querySelector(`[data-screen="${count}"]`)) continue;
        const button = document.createElement('button');
        button.className = 'screen-reset-button';
        button.dataset.screen = String(count);
        const strong = document.createElement('strong');
        strong.textContent = `Pane ${count}`;
        const small = document.createElement('small');
        small.textContent = 'Reset follower';
        button.append(strong, small);
        resetGrid.appendChild(button);
      }
    }
  }

  function tuneInterfaceCopy() {
    document.querySelector('.conduit-brand small')?.remove();

    const quickFilterLabel = document.querySelector('#quick-adblock > span');
    if (quickFilterLabel) quickFilterLabel.textContent = 'Ad filter';

    const sections = [...document.querySelectorAll('.setup-options .option-section')];
    const layoutSection = sections[0];
    const routeSection = sections[1];
    const filterSection = document.querySelector('.protection-section');

    if (layoutSection) {
      const title = layoutSection.querySelector('h2');
      const detail = layoutSection.querySelector('.section-title p');
      if (title) title.textContent = 'Workspace matrix';
      if (detail) detail.textContent = 'Arrange panes and set a shared reading scale.';

      if (!layoutSection.querySelector('.performance-caution')) {
        const note = document.createElement('p');
        note.className = 'performance-caution';
        note.textContent = '5–8 panes are experimental. Extra sessions can increase memory use, battery drain, and interface lag.';
        layoutSection.appendChild(note);
      }
    }

    if (routeSection) {
      const title = routeSection.querySelector('h2');
      const detail = routeSection.querySelector('.section-title p');
      if (title) title.textContent = 'IP address / location';
      if (detail) detail.remove();
    }

    if (filterSection) {
      const title = filterSection.querySelector('h2');
      const detail = filterSection.querySelector('.section-title p');
      if (title) {
        title.textContent = 'Ad filter';
        if (!title.querySelector('.beta-badge')) {
          const badge = document.createElement('span');
          badge.className = 'beta-badge';
          badge.textContent = 'Beta';
          title.appendChild(badge);
        }
      }
      if (detail) detail.textContent = 'May interfere with sign-in, media, checkout, or interactive page controls.';
    }

    const ledgerTitle = document.querySelector('.trace-heading .eyebrow');
    const ledgerMeta = document.querySelector('.trace-heading > span');
    if (ledgerTitle) ledgerTitle.textContent = 'Conduit ledger';
    if (ledgerMeta) ledgerMeta.textContent = 'token / signal';

    document.querySelector('.live-badge')?.remove();
    const eyebrow = document.querySelector('#setup-eyebrow');
    if (eyebrow) eyebrow.textContent = 'Conduit 0.15';
  }

  prepareEightPaneControls();
  tuneInterfaceCopy();

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = 'styles-v15.css';
  document.head.appendChild(styleLink);

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

  window.addEventListener('load', () => {
    const script = document.createElement('script');
    script.src = 'ui-v15.js';
    document.body.appendChild(script);
  }, { once: true });
})();