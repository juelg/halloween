# Embodied Agent v0.1

A Halloween costume: a robot that escaped an AI lab. An LED face mask shows its expressions, and an Android phone on a chest harness is its eye and brain. Guests scan a QR code to read its thoughts and, if they solve a riddle (or convince it), to borrow its face.

Plain HTML/JS/CSS, ES modules, pinned CDN versions, no build step. See **[SETUP.md](SETUP.md)** for running it, the Firebase relay, GitHub Pages and the Friday mask lab.

| file | what |
|---|---|
| `index.html` | public guest page: thought feed and the riddle/emote easter egg (what the QR code opens) |
| `robot-*.html` | control page, on the phone: camera, triggers, Claude calls, voice, mask control. Unlisted name so guests don't stumble on it; it holds no secrets (the key and token live only in the phone's browser) |
| `mind.html` | old guest URL, redirects to `index.html` |
| `qr.html`, `qr.png`, `qr-tags.pdf` | printable "SCAN TO READ MY MIND" poster |
| `js/config.js` | every tunable number (trigger distance, cooldowns, rate limits, models) |
| `js/brain.js` | the robot's behaviours (idle, sleep, reactions, crash gag, selfie, talk mode, guest control) |
| `js/vision.js` | camera, MediaPipe face detection, thumbs-up, covered-lens detection |
| `js/claude.js` | Anthropic Messages API calls, prompts and guardrails, JSON validation, canned fallbacks |
| `js/mask.js` | adapter: `showFace`, `scrollText`, `setBrightness`, `playEmoteBitmap` to the simulator and/or the real mask |
| `js/mask-ble.js` | Shining Mask Web Bluetooth protocol |
| `js/sim.js` | on-screen LED mask simulator |
| `js/faces.js` | expression pixel art and built-in id map |
| `js/bitmap.js` | text and emote to the mask's 16-row column format |
| `js/relay.js` | Firebase Realtime Database relay, plus a local BroadcastChannel relay for testing |
| `js/game.js` | phone side of the guest game: validation, rate limits, judge, render, safety screen, queue, veto |
| `database.rules.json` | RTDB security rules |
| `firebase-config.js` | public Firebase web config |

Privacy:
- The phone sends one downscaled in-memory frame to Claude per reaction. Nothing else is stored or uploaded.
- Selfies need a 👍 and stay on the phone.
- The Anthropic key and the relay write token live only in the phone's `localStorage`.

The mask protocol was ported from [BrickCraftDream/Shining-Mask-stuff](https://github.com/BrickCraftDream/Shining-Mask-stuff), [GoneUp/mask-go](https://github.com/GoneUp/mask-go) (MIT) and [beclamide/mask-controller](https://github.com/beclamide/mask-controller) (MIT). QR codes use [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, vendored).
