# Conduit 0.27

Conduit is a one-to-eight-screen Electron browser for repeating ordinary browsing work across isolated sessions. Screen 1 can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Added a 450 ms URL watchdog that continuously compares every active follower with Screen 1.
- A follower that remains behind enters a temporary Catching up screen, retries the Screen 1 address with increasing delays, and exits recovery automatically when the URLs match.
- Kept the single v26 synchronization coordinator; the watchdog repairs drift without owning Follow state.
- Added native Edit-menu commands and explicit Control/Command+A handling inside pane pages and the address field.
- The checkmyip bookmark now opens `https://browserleaks.com/ip`.
- Added `[BETA]` beside IP address and location checking.
- Kept the translucent interface, clean four-screen start, 80% scale, numeric IP fallback, and welcome page.

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

Security-challenge pages are skipped. Password, file-upload, payment, purchase, voting, and account-deletion actions are not mirrored.
