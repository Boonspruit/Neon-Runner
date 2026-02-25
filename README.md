# Neon-Runner

A Tron-inspired survival game rendered with Three.js + WebGL.

## Features
- Arrow keys/WASD for desktop and swipe controls for mobile.
- AI bot riders that attempt to trap the player with light walls.
- Close-call multiplier + speed boosts for near misses.
- Power-ups:
  - **Phase Shift:** pass through one wall.
  - **System Overload:** temporary slow-motion for tighter corridors.
- Trail customization unlocks with neon colors and particle styles.
- Dynamic synthwave-style generated audio that intensifies with speed.

## Run
Serve the folder with any static server (recommended so the Three.js CDN script loads reliably).


## Custom Music
- For copyright-safe background music, place your own licensed loop at `assets/synthwave-loop.mp3`.
- The game will auto-play that file when available, and fall back to built-in procedural synth if the file is missing.
- You can replace it with any `.mp3` you own rights to (same filename), then refresh.
