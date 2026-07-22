# Relay Browser 0.7

Relay opens one to four isolated Electron browser screens with guarded synchronization and optional Tor routing.

## What changed in 0.7

- The blocking setup popup was removed.
- Settings now stay in a spacious panel on the right.
- A timestamped Activity Console shows navigation, network changes, Tor output, IP checks, captured actions, and replay results.
- A Tor launch failure no longer prevents the workspace from opening.
- Relay first reuses an existing Tor service on port 9050 or 9150.
- When no service exists, Relay starts a managed Tor process on a free port.
- If Tor still fails, Relay logs the exact error, restores Direct mode, and lets you retry.
- The local Tor bridge uses bounded buffers to prevent the Array buffer allocation crash.
- Each screen uses a separate SOCKS identity while destination hostnames are resolved through Tor.

## Install on macOS

Extract the archive, open Terminal in the extracted folder, and run:

```bash
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

You can also double-click `Start Relay.command` after dependencies have been installed.

## Tor

Install Tor with:

```bash
brew install tor
```

Relay can use an existing Homebrew Tor service:

```bash
brew services start tor
```

Starting the service yourself is optional because Relay can also launch a private managed process. Existing services are preferred because they avoid port and data-directory lock conflicts.

Separate SOCKS identities create isolated Tor streams, but Tor can still choose the same exit relay for multiple screens. Use **Verify public IPs** as the source of truth.

## Synchronization safety

Synchronization pauses for CAPTCHAs and security challenges. Password fields, file uploads, payments, purchases, votes, account deletion, and similar sensitive actions are not mirrored.
