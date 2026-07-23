# Conduit 0.28

Conduit is a one-to-eight-screen Electron browser for repeating ordinary browsing work across isolated sessions. Screen 1 can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- New sites now open in two stages: the main registrable domain first, then the exact subdomain, path, query, or hash.
- Followers that finish the main-domain stage together receive the exact Screen 1 address in the same navigation batch.
- CAPTCHA, Cloudflare challenge, browser-check, and human-verification pages are excluded from automatic navigation retries.
- A challenge on Screen 1 is never propagated to followers.
- A challenge on one follower does not hold back the other followers; that screen rejoins synchronization after the challenge clears.
- The 450 ms watchdog still repairs genuine URL or state drift, but it releases the recovery overlay on verification pages instead of remaining stuck on Connecting.
- Kept the single synchronization coordinator, translucent interface, clean four-screen start, BrowserLeaks bookmark, Select All support, and numeric IP fallback.

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
