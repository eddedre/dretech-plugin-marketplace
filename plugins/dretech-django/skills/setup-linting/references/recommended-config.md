# Recommended lint / pre-commit config (merge-friendly)

These snippets are defaults for `/dretech-django:setup-linting`. Prefer merging into existing files over creating parallel configs.

## Ruff (`pyproject.toml`)

```toml
[tool.ruff]
target-version = "py312"
line-length = 88
src = ["apps", "config"]

[tool.ruff.lint]
select = [
  "E",   # pycodestyle errors
  "F",   # pyflakes
  "I",   # isort
  "B",   # bugbear
  "UP",  # pyupgrade
  "DJ",  # flake8-django
]
ignore = [
  "E501",  # line length handled by formatter / project preference
]

[tool.ruff.lint.isort]
known-first-party = ["apps"]

[tool.ruff.format]
quote-style = "double"
```

If `ruff.toml` / `.ruff.toml` already exists, extend that file instead of adding a second Ruff home.

## Flake8 + wemake-python-styleguide (`.flake8`)

```ini
[flake8]
max-line-length = 88
extend-ignore =
    E203,
    W503,
    # Start WPS gently on legacy codebases — tighten later
    WPS305,
    WPS306,
    WPS226,
per-file-ignores =
    apps/*/migrations/*:E501,F401
    tests/*:S101
exclude =
    .git,
    .venv,
    venv,
    migrations,
    node_modules,
    __pycache__
```

Install note (human-run only):

```bash
pip install flake8 wemake-python-styleguide
```

If the project already uses a strict WPS profile, do not loosen it without asking. If the first run is overwhelming on a legacy tree, keep the gentle ignore list above and document that it is intentional.

## django-migration-linter

### Django settings (e.g. `config/django/base.py` or a dedicated settings module)

Only add if no migration-linter config already exists:

```python
# Optional — django-migration-linter
MIGRATION_LINTER_OPTIONS = {
    "exclude_apps": [
        # third-party apps if needed
    ],
}
```

### Run commands (human-run only)

```bash
pip install django-migration-linter
python manage.py lintmigrations
# and always keep the Django built-in check:
python manage.py makemigrations --check
```

If the project does not want a settings block, documenting the management command alone is enough — do not invent settings churn.

## pre-commit (`.pre-commit-config.yaml`)

Merge these hooks into an existing file; do not delete project-specific hooks.

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.9.0  # pin to a current stable when scaffolding
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pycqa/flake8
    rev: 7.1.1
    hooks:
      - id: flake8
        additional_dependencies:
          - wemake-python-styleguide

  # Optional local hook — only if manage.py is discoverable and the project wants it
  - repo: local
    hooks:
      - id: django-makemigrations-check
        name: django makemigrations --check
        entry: python manage.py makemigrations --check
        language: system
        pass_filenames: false
        files: ^.*models\.py$
```

Install / enable (human-run only):

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

## Suggested install block (generic)

Prefer matching the project's package manager. Generic fallback:

```bash
pip install ruff flake8 wemake-python-styleguide django-migration-linter pre-commit
pre-commit install
```

## Suggested run block

```bash
ruff check .
ruff format --check .
flake8
python manage.py makemigrations --check
python manage.py lintmigrations
pre-commit run --all-files
```
