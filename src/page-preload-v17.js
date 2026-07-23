'use strict';

const { ipcRenderer } = require('electron');

const screenArgument = process.argv.find((value) => value.startsWith('--relay-screen='));
const screenNumber = Number(screenArgument?.split('=')[1] || 0);
const isFollower = Number.isInteger(screenNumber) && screenNumber >= 2 && screenNumber <= 8;

function registerPane() {
  if (!Number.isInteger(screenNumber) || screenNumber < 1 || screenNumber > 8) return;
  ipcRenderer.send('register-screen-v12', { screenNumber });
}

registerPane();
window.addEventListener('DOMContentLoaded', registerPane, { once: true });
window.addEventListener('load', registerPane, { once: true });
setInterval(registerPane, 1800);

if (isFollower) {
  const nativeOn = ipcRenderer.on.bind(ipcRenderer);
  let targetState = null;
  let animationFrame = 0;
  let lastFrame = 0;
  let lastTargetAt = 0;

  function moveTowardTarget(time) {
    if (!targetState) {
      animationFrame = 0;
      return;
    }

    const root = document.scrollingElement || document.documentElement;
    const maxX = Math.max(0, root.scrollWidth - innerWidth);
    const maxY = Math.max(0, root.scrollHeight - innerHeight);
    const targetX = targetState.xRatio * maxX;
    const targetY = targetState.yRatio * maxY;
    const deltaX = targetX - scrollX;
    const deltaY = targetY - scrollY;
    const distance = Math.hypot(deltaX, deltaY);
    const deltaTime = Math.max(1, Math.min(42, time - (lastFrame || time)));
    lastFrame = time;

    // A slower response at short distances prevents the small staircase motion
    // that was visible when many panes were following at once.
    const response = distance > 900 ? 54 : distance > 260 ? 72 : 96;
    const alpha = 1 - Math.exp(-deltaTime / response);

    if (distance < 0.28 && time - lastTargetAt > 90) {
      scrollTo(targetX, targetY);
      animationFrame = 0;
      return;
    }

    scrollTo(scrollX + (deltaX * alpha), scrollY + (deltaY * alpha));
    animationFrame = requestAnimationFrame(moveTowardTarget);
  }

  function receiveControllerState(state) {
    targetState = {
      xRatio: Math.max(0, Math.min(1, Number(state?.scrollXRatio) || 0)),
      yRatio: Math.max(0, Math.min(1, Number(state?.scrollYRatio) || 0)),
    };
    lastTargetAt = performance.now();

    if (!animationFrame) {
      lastFrame = lastTargetAt;
      animationFrame = requestAnimationFrame(moveTowardTarget);
    }
  }

  nativeOn('controller-state-v12', (_event, state) => receiveControllerState(state));

  // The older preload applies the same state in several visible jumps. Keep all
  // its click/input/navigation logic, but replace only that scroll listener.
  ipcRenderer.on = function conduitOn(channel, listener) {
    if (channel === 'controller-state-v12') return ipcRenderer;
    return nativeOn(channel, listener);
  };
}

require('./page-preload');
