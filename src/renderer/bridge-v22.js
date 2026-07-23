'use strict';

(() => {
  const api = window.conduit;
  if (!api) return;

  const original = {
    navigate: api.navigate,
    setPaneCount: api.setPaneCount,
    setPolicy: api.setPolicy,
    setFollowing: api.setFollowing,
    pausePane: api.pausePane,
    resetPane: api.resetPane,
    setSettingsVisible: api.setSettingsVisible,
    getWorkspace: api.getWorkspace,
    onState: api.onState,
    onHealth: api.onHealth,
  };

  let navigationPromise = null;
  let lastHookState = '';
  let finishPromise = null;

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function defaultPaneName(value, index) {
    const text = String(value || '').trim();
    if (index === 0 && (!text || text === 'Main' || text === 'Pane 1')) return 'Main screen';
    if (index > 0 && (!text || text === `Pane ${index + 1}`)) {
      return `Follower ${String.fromCharCode(64 + index)}`;
    }
    return text || (index === 0 ? 'Main screen' : `Follower ${String.fromCharCode(64 + index)}`);
  }

  function routeWithFallback(item) {
    if (!item || typeof item !== 'object') return item;
    if (!item.ok) return item;
    const location = String(item.location || '').trim();
    if (!location || /^location unavailable$/i.test(location)) {
      return { ...item, location: 'IP swapped · location unavailable' };
    }
    return item;
  }

  function mapState(state) {
    if (!state || typeof state !== 'object') return state;
    return {
      ...state,
      paneLabels: Array.isArray(state.paneLabels)
        ? state.paneLabels.map(defaultPaneName)
        : state.paneLabels,
      ips: Array.isArray(state.ips) ? state.ips.map(routeWithFallback) : state.ips,
    };
  }

  function connectionElements() {
    return {
      screen: document.querySelector('#connection-screen'),
      title: document.querySelector('#connection-title'),
      message: document.querySelector('#connection-message'),
      fill: document.querySelector('#connection-progress-fill'),
      label: document.querySelector('#connection-progress-label'),
    };
  }

  async function finishSetup(message = 'Reconnecting panes…') {
    if (finishPromise) return finishPromise;
    finishPromise = (async () => {
      const elements = connectionElements();
      if (elements.screen) {
        elements.title.textContent = 'Finishing setup';
        elements.message.textContent = message;
        elements.fill.style.width = '72%';
        elements.label.textContent = '72%';
        elements.screen.classList.remove('hidden');
      }

      try {
        await api.resyncAll();
        await wait(480);
        if (elements.fill) elements.fill.style.width = '100%';
        if (elements.label) elements.label.textContent = '100%';
        if (elements.message) elements.message.textContent = 'Panes connected';
        await wait(180);
      } finally {
        elements.screen?.classList.add('hidden');
        finishPromise = null;
      }
    })();
    return finishPromise;
  }

  async function syncHooks(next) {
    try {
      return await api.syncV22State(next);
    } catch {
      return null;
    }
  }

  api.getWorkspace = async () => mapState(await original.getWorkspace());
  api.onState = (callback) => original.onState((state) => {
    const mapped = mapState(state);
    syncHooks({ visibleCount: Number(mapped?.screenCount || 4) });
    callback(mapped);
  });
  api.onHealth = (callback) => original.onHealth((health) => {
    const signature = JSON.stringify({
      visibleCount: health?.visiblePaneCount,
      following: health?.followingEnabled,
      policy: health?.policy,
    });
    if (signature !== lastHookState) {
      lastHookState = signature;
      syncHooks({
        visibleCount: Number(health?.visiblePaneCount || 4),
        following: Boolean(health?.followingEnabled),
        policy: health?.policy || {},
      });
    }
    callback(health);
  });

  api.setPaneCount = async (value) => {
    const result = await original.setPaneCount(value);
    await syncHooks({ visibleCount: Number(value) || 4 });
    return result;
  };

  api.setPolicy = async (nextPolicy) => {
    const result = await original.setPolicy(nextPolicy);
    await syncHooks({ policy: nextPolicy || {} });
    return result;
  };

  api.setFollowing = async (enabled) => {
    const result = await original.setFollowing(enabled);
    await syncHooks({ following: Boolean(enabled) });
    return result;
  };

  api.pausePane = async (pane, shouldPause) => {
    const result = await original.pausePane(pane, shouldPause);
    if (result?.ok !== false) {
      await syncHooks({ pause: { pane: Number(pane), paused: Boolean(shouldPause) } });
    }
    return result;
  };

  api.navigate = async (value) => {
    const destination = String(value || '').trim() || 'relay://home';
    if (navigationPromise) return navigationPromise;

    navigationPromise = (async () => {
      const go = document.querySelector('#go');
      const previous = go?.textContent || 'Go';
      if (go) {
        go.disabled = true;
        go.textContent = 'Opening…';
      }

      try {
        let result = await original.navigate(destination);
        if (result?.ok === false) {
          await wait(220);
          result = await original.navigate(destination);
        }
        if (result?.ok === false && go) {
          go.title = result.error || 'The address could not be opened.';
          go.textContent = 'Try again';
          await wait(700);
        }
        return result;
      } catch (error) {
        if (go) {
          go.title = error?.message || String(error);
          go.textContent = 'Try again';
          await wait(700);
        }
        return { ok: false, error: error?.message || String(error) };
      } finally {
        if (go) {
          go.disabled = false;
          go.textContent = previous;
        }
        navigationPromise = null;
      }
    })();

    return navigationPromise;
  };

  api.resetPane = async (pane) => {
    await api.forgetPaneV22(Number(pane));
    const result = await original.resetPane(pane);
    if (result?.ok !== false) await finishSetup('Reconnecting the reset pane…');
    return result;
  };

  api.setSettingsVisible = async (visible) => {
    const result = await original.setSettingsVisible(visible);
    if (visible === false && result?.ok !== false) {
      setTimeout(() => finishSetup('Applying the follower setup again…'), 0);
    }
    return result;
  };

  function cleanPaneControls() {
    const list = document.querySelector('#topology-list');
    if (!list) return;
    list.querySelectorAll('.pane-number').forEach((element) => element.remove());
    list.querySelectorAll('button[data-action="focus"]').forEach((element) => element.remove());
    list.querySelectorAll('.pane-card').forEach((element) => element.classList.add('pane-row-v22'));
    document.querySelector('#show-all-panes')?.remove();
  }

  window.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('#address-form');
    const go = document.querySelector('#go');
    go?.addEventListener('click', (event) => {
      event.preventDefault();
      form?.requestSubmit();
    }, true);

    cleanPaneControls();
    const list = document.querySelector('#topology-list');
    if (list) {
      new MutationObserver(cleanPaneControls).observe(list, { childList: true, subtree: true });
    }
  }, { once: true });
})();
