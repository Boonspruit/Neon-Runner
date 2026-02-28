# Neon-Runner

A Tron-inspired survival game rendered with Three.js + WebGL.

## Features
- Arrow keys/WASD for desktop and swipe controls for mobile.
- AI bot riders that attempt to trap the player with light walls.
- Close-call multiplier
- Trail customization unlocks with neon colors and particle styles.
- Texture atlas-driven particle effects and reduced trail-only neon glow to reduce texture churn.
- Tall digital-skyline outer wall with glowing outlines/data-window flicker for a more immersive arena.
- Web Worker-assisted bot scoring to move AI scoring calculations off the main UI thread.

## Run
Serve the folder with any static server (required for Service Worker + CDN loading).

- The app registers `sw.js` and pre-caches the game shell and Three.js dependencies before the gameplay script starts.
- On first visit, the Service Worker is installed/activated and then used to warm caches; subsequent launches start faster and are resilient to transient network issues.

