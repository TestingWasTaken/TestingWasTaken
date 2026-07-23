# Conduit 0.16

Conduit is a linked one-to-eight-pane Electron browser. Pane 1 can lead supported activity across the remaining panes, while each pane keeps an isolated browser session and can optionally use an isolated network route.

## What changed in 0.16

- Made all eight pane choices and reset controls native to the interface instead of injecting panes 5–8 after startup.
- Fixed the Settings footer so Apply settings remains fully visible at every supported window size.
- Added four persistent interface palettes: Mineral, Graphite, Dune, and Moss.
- Changed the Settings heading from Workspace to Settings.
- Replaced the dramatic blur/zoom transition with a shorter fade-and-slide motion.
- Increased scroll sampling frequency and moved follower scrolling onto a continuous local animation loop.
- Added “Made with ♥ by Jujhar” with a secure external link to the author’s GitHub profile.
- Kept the 3×2 and 4×2 workspace matrices for five to eight panes, with a performance warning for heavier layouts.

## Install on macOS

Extract the archive, open Terminal in the extracted folder, and run:

```bash
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

After dependencies are installed, you can also double-click `Start Conduit.command`.

## Toolbar controls

- **Panes:** choose one to eight panes.
- **Zoom:** change the shared page scale.
- **Route:** switch between the standard route and isolated per-pane identities.
- **Follow pane 1:** enable or disable linked activity.
- **Ad filter:** enable or disable the beta advertising and tracker request filter.

## Pane linking

When **Follow pane 1** is enabled, Conduit mirrors supported clicks, typing, selections, navigation, and scrolling from Pane 1 to visible follower panes. Window scrolling is sampled continuously and each follower eases toward the newest controller position.

CAPTCHA and security-challenge interfaces are not mirrored. Password fields, file uploads, payments, purchases, votes, account deletion, and similar sensitive actions are excluded.

## Isolated routes

The isolated route option connects to a compatible local SOCKS service on port 9050 or 9150. Conduit does not launch that service itself. Separate route identities do not guarantee different public exit addresses, so route verification remains available in Settings.
