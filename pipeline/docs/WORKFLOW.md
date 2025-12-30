
---

### C) `docs/WORKFLOW.md`
```md
# Workflow (human + AI)

## Local development
This repo is static. Run a local server so `fetch()` works:
- VS Code: "Live Server" extension, or
- Python: `python -m http.server 8000`
Then open: `http://localhost:8000/`

## How to ask an AI for changes (best practice)
When creating a task for an AI agent:
1. State the goal in one sentence.
2. List explicit acceptance criteria.
3. List "do not change" constraints.
4. Mention the relevant files by path.

Example:
Goal:
- Add search by `verbund` id so typing "skiwelt" and pressing Enter filters to those resorts.

Acceptance criteria:
- Enter triggers filtering by `verbund.id` if it matches.
- Normal resort name search still works.
- No UI layout changes.

Relevant files:
- `searchFilter.js`, `resorts.json`, `index.html`

## PR discipline (even if you work alone)
- One PR per feature/bug.
- Keep diffs small.
- Put screenshots in PR description if UI changed.
- Link the issue.

## Regression checklist
- Map loads on GitHub Pages (check relative paths: `./resorts.json`).
- Resorts show as markers.
- Search input is visible and usable.
- Filters update marker visibility.
- Export (if present) still works.
