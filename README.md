# Conduit 0.29

Conduit is a one-to-eight-screen Electron browser for repeating ordinary browsing work across isolated sessions. Screen 1 can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Catching up is limited to three automatic repair attempts per follower and target.
- Recovery dismissal is unconditional, preventing an old full-screen overlay from remaining visible after the follower has recovered, paused, or encountered a challenge.
- After the third failed attempt, Conduit stops retrying and reveals the follower's current page.
- A compact panel on the right shows both the follower's current address and the Screen 1 target.
- **Reset screen** clears and rebuilds that follower, then requests a complete resynchronization.
- **Manual control** pauses following for that screen and closes the recovery panel immediately.
- Kept domain-first navigation, CAPTCHA-safe behavior, the single synchronization coordinator, translucent interface, clean four-screen start, BrowserLeaks bookmark, Select All support, and numeric IP fallback.

## Install on macOS

Extract the archive, open Terminal in the extracted folder, and run:

```bash
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

After dependencies are installed, `Start Conduit.command` can also be used.

## Shortcuts

- `⌘,` opens Settings.
- `⌘L` focuses the address bar.
- `⌘A` or `Ctrl+A` selects the focused address or page content.
- `⌘R` reloads the active screen.
- `⌘⇧R` reloads every visible screen.

## Connection modes

**Standard** uses the Mac's normal connection. A device-wide VPN can be used with Standard, but every screen normally receives the same VPN exit IP.

**Multiple IPs** currently uses the local private-route service. A user-supplied HTTP or SOCKS proxy pool can provide one route per Electron session without relying on public free proxies.

## Safety

Security-challenge pages are not mirrored. Password, file-upload, payment, purchase, voting, and account-deletion actions are also not mirrored.
