# Relay Browser 0.5

A plain Electron browser that displays one to four independent screens.

## Main controls

- **Screens:** one to four independent sessions.
- **Zoom:** applies the same zoom level to every visible screen.
- **Sync activity:** mirrors safe clicks, typing, checkboxes, radio buttons, select menus and scrolling from Screen 1.
- **Network:** Direct or Tor split.
- **Check IPs:** verifies each screen through its own Electron session.

## DNS protection in Tor split mode

Relay does not point Chromium straight at Tor SOCKS. Each screen connects to a small local HTTP CONNECT bridge. The bridge sends the destination hostname to Tor with a SOCKS5 domain-name request, so Tor performs the destination lookup remotely. The generated Tor configuration also enables `SafeSocks 1` and `TestSocks 1`. QUIC is disabled and non-proxied WebRTC UDP is disabled.

Different Tor listener ports are isolated from one another by Tor. Separate circuits do not guarantee four unique exit IP addresses, so Relay reports duplicates honestly.

## Safety

Activity sync pauses when a screen shows a CAPTCHA or security challenge, when screens are on different pages, or when a password, file upload, payment, purchase, vote, account deletion or similar sensitive action is detected. CAPTCHAs are never copied, solved or bypassed.

## Install

```bash
cd ~/Downloads/relay-browser-v0.5
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm test
npm start
```

Tor split requires Tor:

```bash
brew install tor
```

You can also double-click `Start Relay.command`.
