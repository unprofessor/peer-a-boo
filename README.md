# Peer-a-Boo 👻

A web-based P2P baby monitor using WebRTC.

## Features

- **Baby Station**: Streams video/audio from the device. Generates a QR code for
  easy pairing. Full-screen video preview with slide-up settings drawer.
- **Parent Station**: Connects to the Baby Station to monitor. Features motion
  detection with adjustable sensitivity and non-disruptive toast alerts.
- **P2P**: Direct connection using PeerJS (no video server required).
- **Wake Lock**: Prevents devices from sleeping while monitoring.
- **Modern UI**: Dark theme, video-centric design, responsive layout for mobile
  and desktop.

## How to Run Locally

1. Install dependencies:

    ```bash
    bun install
    ```

2. Start the development server:

    ```bash
    bun run dev
    ```

3. Open `http://localhost:5173` in your browser.

### Optional: HTTPS Dev Server

Some browsers require HTTPS even during development when you access the app
from another device on your network. Use the HTTPS helper script when you need
to test WebRTC from phones or tablets on the same LAN.

1. Run the secure dev server:

   ```bash
   bun run dev:https
   ```

2. On the first run the script creates `certs/dev.cert.pem` and
  `certs/dev.key.pem`. Trust the certificate in your OS keychain if you want to
  remove browser warnings.
3. Visit `https://localhost:5173` (or the LAN IP of your machine) and accept
  the certificate warning if it appears.
4. Repeat the command whenever you need HTTPS; the existing certificate will be
  reused automatically.

#### Share to Other Devices

When another device on your network needs to load the dev server, expose Vite
on all interfaces:

```bash
bun run dev:https -- --host 0.0.0.0
```

Replace `dev:https` with `dev` if you only need HTTP. Visit
`https://<your-lan-ip>:5173` (or `http://` if not using HTTPS) from the other
device and accept the certificate warning when prompted.

### Optional: Local Signaling Server

By default both stations register with the public PeerJS server
(`0.peerjs.com`). To use a local one instead:

1. Start the signaling server on port 9000:

   ```bash
   bun run signal
   ```

2. Point the app at it in `.env.local` (gitignored), then restart Vite:

   ```bash
   VITE_PEER_HOST=localhost
   VITE_PEER_PORT=9000
   ```

`VITE_PEER_PATH` and `VITE_PEER_SECURE` (`true`/`false`) are also read. When
`VITE_PEER_SECURE` is unset, the app uses `wss` exactly when the page itself is
served over HTTPS.

The server releases a room ID 15 seconds after its holder stops sending
heartbeats (`--alive_timeout 15000`), instead of the default 60 seconds, so a
reloaded Baby Station can reclaim its room quickly.

## How to Use

1. **Baby Station**:
    - Open the app on the device you want to leave with the baby (e.g., Laptop).
    - Select "Baby Station" from the role cards.
    - Allow camera/microphone access.
    - Tap the gear icon to open settings and view the QR code and Room ID.

2. **Parent Station**:
    - Open the app on your monitoring device (e.g., Phone).
    - **Option A**: Scan the QR code from the Baby Station.
    - **Option B**: Enter the Room ID on the landing page, then select "Parent
      Station".
    - The video stream will connect automatically. Use the gear icon to adjust
      motion detection sensitivity or pause alerts.

## Deployment (Important for Mobile)

To use this on a mobile phone (Parent Station) connecting to a laptop (Baby
Station), you **must** deploy this to a secure HTTPS host (like GitHub Pages,
Vercel, or Netlify).

**Why?** Browsers block Camera/Microphone access on insecure (HTTP) origins,
except for `localhost`. Since your phone cannot access `localhost` on your
laptop, you need a public HTTPS URL.

### Deploy to GitHub Pages

1. Push this code to a GitHub repository.
2. Go to the repository **Settings** > **Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. The included workflow (`.github/workflows/deploy.yml`) will automatically
   build and deploy the app to GitHub Pages on every push to `main`.

### Deploy to Netlify/Vercel

1. Run `bun run build`.
2. Upload the `dist` folder to your hosting provider.
