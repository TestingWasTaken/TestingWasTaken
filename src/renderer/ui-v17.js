'use strict';

(() => {
  const quickCount = document.querySelector('#quick-screen-count');
  const quickZoom = document.querySelector('#quick-zoom');
  const setupCount = document.querySelector('#setup-screen-count');
  const setupZoom = document.querySelector('#setup-zoom');
  const setupEyebrow = document.querySelector('#setup-eyebrow');

  const marks = [
    { glyph: '⌗', label: 'Workspace' },
    { glyph: '↗', label: 'Route' },
    { glyph: '⊘', label: 'Ad filter' },
    { glyph: '◐', label: 'Palette' },
    { glyph: '↺', label: 'Reset' },
  ];

  function setZoom(select, value = '0.8') {
    if (!select || !select.querySelector(`option[value="${value}"]`)) return;
    select.value = value;
  }

  function useAutomaticScale(count, source) {
    const paneCount = Math.max(1, Math.min(8, Number(count) || 1));
    if (paneCount < 5) return;

    setZoom(setupZoom);
    setZoom(quickZoom);

    if (source === 'quick' && setupZoom) setupZoom.value = '0.8';
    if (source === 'settings' && quickZoom) quickZoom.value = '0.8';
  }

  function decorateScaleControl() {
    const fieldLabel = setupZoom?.closest('.field')?.querySelector(':scope > span');
    if (fieldLabel) fieldLabel.textContent = 'Page scale · auto 80%';

    const setupOption = setupZoom?.querySelector('option[value="0.8"]');
    if (setupOption) setupOption.textContent = '80% · recommended';
  }

  function replaceSectionNumbers() {
    const elements = [...document.querySelectorAll('.section-number')];
    elements.forEach((element, index) => {
      const mark = marks[index];
      if (!mark) return;
      element.textContent = mark.glyph;
      element.classList.add('section-glyph');
      element.title = mark.label;
      element.setAttribute('aria-label', mark.label);
    });
  }

  // New workspaces begin at 80%. The preference is still editable afterwards.
  setZoom(quickZoom);
  setZoom(setupZoom);
  decorateScaleControl();
  replaceSectionNumbers();

  // Capture runs before the existing quick-control handler, so an eight-pane
  // selection is applied together with its safer 80% scale in one operation.
  quickCount?.addEventListener('change', () => {
    useAutomaticScale(quickCount.value, 'quick');
  }, true);

  setupCount?.addEventListener('change', () => {
    useAutomaticScale(setupCount.value, 'settings');
  });

  if (setupEyebrow) setupEyebrow.textContent = 'Conduit 0.17';
})();
