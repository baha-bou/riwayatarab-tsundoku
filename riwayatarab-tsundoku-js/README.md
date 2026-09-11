# Riwayatarab — Tsundoku/LNReader JS plugin

This repository contains a JS/TypeScript plugin for riwayatarab.com.

## Features
- Search
- Novel details
- Chapter list
- Chapter pagination
- Chapter reading
- Previous/next chapter navigation (the app follows the chapter paths exposed by the site)

## Important
The source is written against the current LNReader plugin API. Tsundoku can consume LNReader-style JS plugins, but the exact repository manifest format can vary by Tsundoku build.

The plugin deliberately uses defensive selectors because the site does not expose a stable public API.

## Build
Use the current LNReader plugin toolchain (Node.js 22+):
1. Put `plugins/arabic/riwayatarab.ts` into an LNReader-compatible plugin repository.
2. Run the repository's normal plugin build.
3. Publish the generated `.dist/plugins.min.json` and compiled JS.
4. Add the raw URL of `plugins.min.json` to Tsundoku -> JS Plugin Repos.

The `plugins.min.json` in this package is a ready manifest template; replace `YOUR_GITHUB_USER` and `YOUR_REPO` with your GitHub repository path after publishing.
