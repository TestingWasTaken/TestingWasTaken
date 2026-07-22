# Relay Browser 0.8

Relay opens one to four isolated Electron browser screens with guarded synchronization and optional local Tor routing.

## What changed in 0.8

- Restored the Relay 0.6-style guided setup window.
- Removed the permanent right-hand Settings and Activity Console panel.
- Returned the browser workspace to the full window width.
- Setup applies four visible stages: workspace, network/DNS, public-IP verification, and synchronization.
- Tor failures no longer close setup or produce an unhandled remote-method error.
- Relay no longer launches or manages its own Tor process.
- Tor split only connects to an existing local SOCKS service on port 9050 or 9150.
- When Tor is unavailable, setup offers **Continue in Direct** and keeps the workspace usable.
- Each screen receives a separate SOCKS username so Tor can isolate its streams.
- Destination hostnames are sent through the bounded local SOCKS5 bridge for remote DNS resolution.
- The bounded bridge fix remains included to prevent unlimited memory allocation.

## Install on macOS

Extract the archive, open Terminal in the extracted folder, and run:

```bash
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

You can also double-click `Start Relay.command` after dependencies have been installed.

## Using Tor split

Relay deliberately does not start Tor itself. Install and start the Homebrew service before opening the workspace in Tor mode:

```bash
brew install tor
brew services start tor
```

Alternatively, open Tor Browser and leave it running. Relay checks local SOCKS ports 9050 and 9150.

To stop the Homebrew Tor service later:

```bash
brew services stop tor
```

Separate SOCKS identities create isolated Tor streams, but Tor can still choose the same exit relay for multiple screens. Use **Check IPs** as the source of truth.

## Synchronization safety

Synchronization pauses for CAPTCHAs and security challenges. Password fields, file uploads, payments, purchases, votes, account deletion, and similar sensitive actions are not mirrored.
