# Relay Browser 0.7

Relay displays one to four isolated Chromium screens in one spacious workspace. Screen 1 can safely mirror supported activity to the other visible screens.

## What changed in 0.7

- The app opens directly into the browser workspace; there is no blocking setup window.
- Workspace, zoom, synchronization and network controls live in a right-side Settings panel.
- A timestamped Activity Console shows navigation, Tor startup output, DNS routing, IP checks and synchronization results.
- A Tor startup failure returns Relay to Direct mode instead of preventing the app from opening.
- Relay first checks for an existing Tor service on ports 9050 and 9150. It starts a private Tor process only when neither service is available.
- Private Tor runs use a fresh data directory and free ports, preventing stale-lock and port-collision failures.
- The local Tor bridge uses bounded buffers and stream backpressure, fixing the previous Array buffer allocation crash.
- Destination hostnames are sent through SOCKS5 so Tor performs DNS resolution.

## Install

```bash
cd ~/Downloads
rm -rf relay-browser-v0.7
unzip relay-browser-v0.7.zip
cd relay-browser-v0.7
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

You can also double-click `Start Relay.command` after extracting the ZIP.

## Tor

Install Tor once with:

```bash
brew install tor
```

Relay can reuse a Homebrew Tor service on port 9050 or Tor Browser on port 9150. It can also launch its own temporary Tor runtime. Select **Tor split** in the side panel and follow the Activity Console.

Separate sessions and isolated SOCKS authentication encourage separate Tor circuits, but Tor may still choose the same exit relay. **Check IPs** is the source of truth.

## Synchronization safety

Relay mirrors supported clicks, text entry, checkboxes, radio buttons, select menus, scrolling and basic keys from Screen 1. It stops synchronization for CAPTCHAs, security challenges, password fields, file uploads, payments, purchases, voting, account deletion and similar consequential actions.

Cross-origin iframes, closed shadow DOM, canvas-only controls, drag-and-drop and complex editors may not replay correctly. Each replay result appears in the Activity Console.
