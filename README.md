# Conduit 0.17

Conduit is a linked one-to-eight-pane Electron browser. Pane 1 can lead supported activity across visible follower panes, while every pane keeps an isolated browser session and may optionally use an isolated route.

## What changed in 0.17

- Fixed the remaining four-pane preload limit, so panes 5–8 now register with the same synchronization engine as panes 1–4.
- Added an eight-pane-aware preload without replacing the working click, input, navigation, and safety logic.
- Replaced the older follower scroll jumps with a slower continuous easing loop.
- Made 80% the starting page scale and automatically selects it when five to eight panes are chosen.
- Replaced the large 01–05 number tiles with smaller functional glyphs.
- Rebuilt `relay://welcome` as a quiet local test page with restrained, slightly irregular hand-tuned spacing.
- Preserved the four interface palettes, native pane reset controls, fixed Settings footer, isolated routes, and beta ad filter.

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
- **Zoom:** change the shared page scale. Dense layouts begin at 80%.
- **Route:** switch between the standard route and isolated per-pane identities.
- **Follow pane 1:** enable or disable linked activity.
- **Ad filter:** enable or disable the beta advertising and tracker request filter.

## Pane linking

When **Follow pane 1** is enabled, Conduit mirrors supported clicks, typing, selections, navigation, and scrolling from Pane 1 to all visible follower panes, including panes 5–8.

CAPTCHA and security-challenge interfaces are not mirrored. Password fields, file uploads, payments, purchases, votes, account deletion, and similar sensitive actions are excluded.

## Isolated routes

The isolated route option connects to a compatible local SOCKS service on port 9050 or 9150. Conduit does not launch that service itself. Separate route identities do not guarantee different public exit addresses, so route verification remains available in Settings.
