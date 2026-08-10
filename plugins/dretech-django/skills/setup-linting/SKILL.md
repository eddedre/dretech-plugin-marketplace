---
name: setup-linting
description: Scaffold or extend Ruff, Flake8/wemake-python-styleguide, django-migration-linter, and pre-commit for a Django project. Discovers manage.py first, merges into existing pyproject.toml/.pre-commit-config.yaml when present, never auto-installs packages, and only prints install/run commands. Use when the user asks to set up linting, pre-commit, Ruff, WPS, Flake8, migration linting, or mentions /dretech-django:setup-linting.
license: MIT
metadata:
  author: EddeDre
  version: "1.0.0"
---

You are scaffolding linting and pre-commit for a **target Django project** (not this plugin repo). Follow every step. Prefer merge over overwrite. Never auto-install packages.

The user's request: $ARGUMENTS

### Non-negotiable rules

1. **Discover `manage.py` first.** Do NOT assume the Django project root is the repo root. Search with Glob for `manage.py` (and common nestings like `backend/manage.py`, `src/manage.py`). All paths below are relative to the directory that contains `manage.py` (the Django root).
2. **Inspect before writing.** Read existing:
   - `pyproject.toml`
   - `setup.cfg` / `.flake8` / `tox.ini`
   - `.pre-commit-config.yaml`
   - `ruff.toml` / `.ruff.toml` if present
   - any existing `django-migration-linter` config
3. **Prefer merge over overwrite.** Extend existing tool tables/sections. Never clobber unrelated project config. If a file is missing, create only what is needed.
4. **Never auto-install packages.** Print install and run commands for the human to execute. Do not run `pip install`, `poetry add`, `uv add`, or equivalent unless the user explicitly asks you to install after seeing the commands.
5. **Print run commands** after scaffolding:
   - `ruff check .`
   - `ruff format --check .`
   - `flake8` (or the project's Flake8 entrypoint)
   - `python manage.py makemigrations --check`
   - migration linter command (see references)
   - `pre-commit run --all-files` (if pre-commit was configured)

### Process

1. **Find Django root**
   - Glob for `manage.py`
   - If multiple, ask which project to target (or use the one the user named)
   - Set `DJANGO_ROOT` to that directory

2. **Inventory existing config**
   - Note which of Ruff / Flake8 / WPS / pre-commit / migration-linter already exist
   - Note package manager if obvious (`pyproject.toml` with poetry/uv/pdm, `requirements*.txt`, etc.)

3. **Scaffold or extend**
   - **Ruff** — primary linter/formatter. Put config under `[tool.ruff]` / `[tool.ruff.lint]` in `pyproject.toml` (preferred) or `ruff.toml` if that already exists.
   - **Flake8 / wemake-python-styleguide** — complementary style rules. Prefer extending `.flake8` or `setup.cfg` `[flake8]` if present; otherwise create `.flake8`. Do not enable every WPS code blindly — start with a sensible subset and note that WPS is strict.
   - **django-migration-linter** — add settings or management-command guidance so migrations stay forward-safe.
   - **`.pre-commit-config.yaml`** — add (or merge) hooks for `ruff`, `ruff-format`, optional `flake8`, and a migration check hook if practical. Preserve any existing hooks the project already has.

4. **Emit install + run commands only**
   - Show a single install block matching the project's package manager when known; otherwise show a generic `pip` example
   - Show the run commands listed above
   - Explicitly say: packages are **not** installed by this skill

5. **Summarize what changed**
   - Files created vs files extended
   - What was left alone and why (merge policy)

### Config snippets

Use the concrete recommended snippets in `references/recommended-config.md`. Adapt them to what already exists rather than pasting blindly on top of conflicting settings.

### Output shape

After finishing:

```
# setup-linting result

**Django root:** <path containing manage.py>

## Changes
- Created: ...
- Extended: ...
- Left alone: ...

## Install (human runs these — not auto-installed)
```bash
# example — adjust to project package manager
pip install ruff flake8 wemake-python-styleguide django-migration-linter pre-commit
pre-commit install
```

## Run
```bash
ruff check .
ruff format --check .
flake8
python manage.py makemigrations --check
# migration linter — see references/recommended-config.md
pre-commit run --all-files
```

## Notes
- Merge preferred over overwrite
- Soften WPS if the project is legacy and the first run is too noisy
```

### Tool usage

- Use Glob / Read to find `manage.py` and inspect config
- Use Edit / Write only to merge or create lint/pre-commit config files in the **target** Django project
- Do NOT run package installs
- Do NOT modify application business logic

Now set up linting for the requested Django project.
