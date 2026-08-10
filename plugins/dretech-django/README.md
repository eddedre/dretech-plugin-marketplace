# Django HackSoft Styleguide Plugin for Claude Code

A Claude Code plugin that enforces and assists with the [HackSoft Django Styleguide](https://github.com/HackSoftware/Django-Styleguide).

## Installation

```bash
claude plugin install <path-or-url>
# or for development testing:
claude --plugin-dir /path/to/dretech-django-plugin
```

## Overview

The HackSoft Django Styleguide promotes clean architecture through strict separation of concerns:
- **Services** - Handle write operations (business logic)
- **Selectors** - Handle read operations (queries)
- **APIs** - Thin interface layer using **Django REST Framework** (no business logic)
- **Models** - Data representation (minimal logic)

All API code uses [Django REST Framework](https://www.django-rest-framework.org/) (`djangorestframework` package). We use DRF's `APIView` class (not ViewSets) because:
- One operation per class (clearer)
- Explicit over implicit
- Better for services pattern
- Easier to understand

## Skills (Slash Commands)

All skills are namespaced as `dretech-django:<skill-name>`.

### `/dretech-django:styleguide [topic]`
Get expert guidance on Django best practices.

**Topics:** `services`, `selectors`, `apis`, `models`, `testing`, `celery`, `errors`, `settings`

### `/dretech-django:generate-service <entity> <action> [--complex]`
Generate a service following HackSoft patterns.

```
/dretech-django:generate-service user create
/dretech-django:generate-service order complete
/dretech-django:generate-service file upload --complex
```

### `/dretech-django:generate-selector <entity> <action>`
Generate a selector for read operations.

```
/dretech-django:generate-selector user list
/dretech-django:generate-selector course get
```

### `/dretech-django:generate-api <entity> <action>`
Generate a REST API endpoint.

```
/dretech-django:generate-api user list
/dretech-django:generate-api course create
```

### `/dretech-django:generate-test <type> <target>`
Generate tests for services, selectors, or models.

```
/dretech-django:generate-test service user_create
/dretech-django:generate-test selector course_list
```

### `/dretech-django:pattern <pattern-name>`
Quick copy-paste pattern reference.

**Available patterns:** `create-service`, `update-service`, `list-selector`, `get-selector`, `list-api`, `create-api`, `detail-api`, `update-api`, `celery-task`, `model-validation`, `exception-handler`, `urls`, `test-service`, `pagination-helper`

### `/dretech-django:audit [target]`
Audit code against the styleguide.

```
/dretech-django:audit users/services.py
/dretech-django:audit users
```

### `/dretech-django:pagination [type]`
Learn about DRF pagination patterns (`limit-offset`, `page-number`, `cursor`).

### `/dretech-django:setup-linting`
Scaffold or extend Ruff, Flake8/wemake-python-styleguide, django-migration-linter, and pre-commit for a target Django project. Discovers `manage.py` first, merges into existing config when present, prints install/run commands only, and never auto-installs packages.

```
/dretech-django:setup-linting
/dretech-django:setup-linting backend
```

## Agent

### `styleguide-auditor`
Deep code analysis agent that audits Django code against HackSoft patterns. Automatically invoked by `/dretech-django:audit`.

## Hook

### `pre-styleguide-check.js`
Pre-tool-use validation hook that runs automatically on Edit/Write operations targeting Python files in Django app directories.

**What it checks:**
1. Services use `*, ` for keyword-only args
2. Services call `full_clean()` before `save()`
3. APIs don't contain business logic
4. APIs use DRF, not plain Django Views
5. DRF APIView imports present
6. Selectors optimize queries
7. Type annotations present
8. Celery tasks call services
9. Tasks use `transaction.on_commit()`
10. APIs use nested InputSerializer/OutputSerializer

**Severity Levels:**
- **CRITICAL** - Blocks the operation, must fix
- **IMPORTANT** - Warning, should fix

## Quick Start

1. **Get guidance:** `/dretech-django:styleguide services`
2. **Generate a service:** `/dretech-django:generate-service user create`
3. **Generate an API:** `/dretech-django:generate-api user create`
4. **Audit your code:** `/dretech-django:audit users`
5. **Quick patterns:** `/dretech-django:pattern create-service`
6. **Scaffold linting:** `/dretech-django:setup-linting`

## Do's and Don'ts

### Services
- Use keyword-only arguments: `def user_create(*, email: str)`
- Add type annotations: `-> User`
- Call `full_clean()` before `save()`
- Use `@transaction.atomic` for multi-step operations
- Trigger tasks with `transaction.on_commit()`

### APIs
- Use Django REST Framework (`from rest_framework.views import APIView`)
- One API per operation (not ViewSets)
- Use nested `InputSerializer`/`OutputSerializer`
- Call services for writes, selectors for reads
- NO business logic in APIs

### Selectors
- Use `select_related()` for ForeignKey/OneToOne
- Use `prefetch_related()` for ManyToMany
- Return QuerySet, list, or objects
- Handle `.DoesNotExist` exceptions

## Testing

```bash
npm install              # First time only
npm run test:hooks       # Hook tests — fast, no API cost (~2s, 33 tests)
RUN_SKILL_TESTS=1 npm run test:skills  # Skill tests — uses API (~50s, 6 tests)
```

Hook tests validate the styleguide enforcement rules in `pre-styleguide-check.js` (IDs from `.claude/RULE_CATALOG.json`). Skill tests verify all 10 skills load and trigger correctly via `claude -p --plugin-dir`.

See [TESTING.md](./TESTING.md) for full details on writing and running tests.

## Learning Resources

- **HackSoft Django Styleguide**: https://github.com/HackSoftware/Django-Styleguide
- **Example Project**: https://github.com/HackSoftware/Django-Styleguide-Example

## License

MIT
