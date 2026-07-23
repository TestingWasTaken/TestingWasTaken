'use strict';

const setupEyebrow = document.querySelector('#setup-eyebrow');

function refreshBuildLabel() {
  if (!setupEyebrow) return;
  if (setupEyebrow.textContent.trim() === 'Relay 0.11') {
    setupEyebrow.textContent = 'Relay 0.13 / Configuration';
  }
}

refreshBuildLabel();

if (setupEyebrow) {
  new MutationObserver(refreshBuildLabel).observe(setupEyebrow, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}
