# Lessons

## Plugin naming: repo name ≠ plugin name ≠ skill namespace
- When renaming a Claude Code plugin, treat THREE identifiers separately: git repo name (discoverability), package name (`package.json`), and plugin `name` (which DERIVES the skill slash-command namespace).
- A long plugin `name` makes every slash command verbose (`/very-long-name:audit`). Keep the plugin `name` short even when the repo name is long/descriptive.
- Decision for this project: repo `dretech-claude-plugin-django`, package `dretech-django-plugin`, plugin name/namespace `dretech-django`.

## Django styleguide plugin hooks
- Claude Code plugin hooks are just shipped executables (any language) wired via `hooks.json`; this plugin's hook is Node. For accurate Python parsing, shell out to a stdlib `ast` helper rather than fighting regex — and fail OPEN (never block on missing interpreter or mid-edit syntax error).
- The plugin only runs inside Django projects, so `python3` availability is a safe assumption for the helper (but still fail-open defensively).
