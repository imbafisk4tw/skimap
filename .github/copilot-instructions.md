# Copilot instructions (repo-wide)

## Project type
Static GitHub Pages app (no backend, no build step by default).

## Primary goal
Maintain a consistent Leaflet-based ski resort map with search/filter/export UI.

## Do not do
- Do not introduce frameworks or build tooling unless explicitly requested.
- Do not change UI layout or CSS broadly unless explicitly requested.
- Do not rename data fields without updating all consumers.

## Data contracts
- `resorts.json`: must contain at least `id`, `name`, `lat`, `lon`.
- If grouped resorts exist (multiple entrypoints), use `verbund.id` to group them.
- Keep `searchFilter.js` aligned with the data schema.

## Path handling (GitHub Pages)
Prefer relative fetch paths like `./resorts.json` and `./travel_times.json`.

## Coding style
- Keep functions small and named clearly.
- Avoid global variables when possible; if needed, keep them scoped in one module.
- Add short comments only where the intent is not obvious.

## When implementing features
1. Identify relevant files and list them in the PR description.
2. Keep changes minimal.
3. Add a quick manual test checklist to the PR.

## Testing
At minimum:
- App loads locally via simple static server.
- App loads on GitHub Pages.
- Search and filters still work.
