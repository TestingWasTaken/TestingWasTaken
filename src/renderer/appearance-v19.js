'use strict';

(() => {
  const APPEARANCE_KEY = 'conduit.appearance.v18';
  const saved = localStorage.getItem(APPEARANCE_KEY);
  const explicitAppearance = saved === 'dark' ? 'dark' : 'light';

  localStorage.setItem(APPEARANCE_KEY, explicitAppearance);
  document.documentElement.dataset.appearance = explicitAppearance;

  const displayHome = (value) => String(value || '').replace(/^relay:\/\/welcome\/?$/i, 'relay://home');
  const mapWorkspace = (state) => {
    if (!state || typeof state !== 'object') return state;
    return {
      ...state,
      currentURL: displayHome(state.currentURL),
      paneURLs: Array.isArray(state.paneURLs) ? state.paneURLs.map(displayHome) : state.paneURLs,
    };
  };

  const originalGetWorkspace = window.conduit.getWorkspace;
  window.conduit.getWorkspace = async () => mapWorkspace(await originalGetWorkspace());

  const originalOnState = window.conduit.onState;
  window.conduit.onState = (callback) => originalOnState((state) => callback(mapWorkspace(state)));

  const originalNavigate = window.conduit.navigate;
  window.conduit.navigate = (value) => originalNavigate(displayHome(value));

  window.addEventListener('DOMContentLoaded', () => {
    const appearance = document.querySelector('#setting-appearance');
    if (appearance) appearance.value = explicitAppearance;

    document.querySelector('#home-link')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.conduit.navigate('relay://home');
    }, true);
  }, { once: true });
})();
