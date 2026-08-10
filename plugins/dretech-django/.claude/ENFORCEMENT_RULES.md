# Django Styleguide Enforcement Rules

This document details all rules enforced by the pre-tool hook and auditor.
Stable rule IDs match `.claude/RULE_CATALOG.json` (the machine-checkable source of truth).
Hook findings render as `[SEVERITY][RULE-ID] message`.

## CRITICAL Violations (Block Commit)

These violations will **block** code from being committed:

### SVC-001: Services Must Use Keyword-Only Arguments

**Rule:** Service functions must use `*, ` to enforce keyword-only arguments

```python
# BLOCKED
def user_create(email, name):
    pass

# ALLOWED
def user_create(*, email: str, name: str) -> User:
    pass
```

**Why:** Prevents accidental argument ordering mistakes and makes code self-documenting.

### SVC-002: Services Must Call full_clean() Before save()

**Rule:** Always call `full_clean()` before `save()` to ensure validation

```python
# BLOCKED
def user_create(*, email: str) -> User:
    user = User(email=email)
    user.save()  # Missing full_clean()!
    return user

# ALLOWED
def user_create(*, email: str) -> User:
    user = User(email=email)
    user.full_clean()  # Validation! Use exclude=[...] if needed
    user.save()
    return user
```

**Why:** Ensures model validation runs before saving to database.

### VIEW-001: Views and APIs Must Not Contain Business Logic

**Rule:** Views and APIs should only validate input and delegate to services/selectors

```python
# BLOCKED (in views.py or apis.py)
class IdeaCreateView(LoginRequiredMixin, View):
    def post(self, request):
        idea = Idea(title=request.POST['title'])
        idea.save()  # Business logic in view!
        return redirect('...')

# ALLOWED
class IdeaCreateView(LoginRequiredMixin, View):
    def post(self, request):
        form = IdeaForm(request.POST)
        if form.is_valid():
            idea_create(submitter=request.user, **form.cleaned_data)  # Delegate!
            return redirect('...')
        return render(request, self.template_name, {"form": form})
```

**Why:** Separates concerns — business logic belongs in services.

### API-002: API Files Must Use DRF, Not Plain Django Views

**Rule:** In `apis.py` files, import `APIView` from `rest_framework.views`, not `django.views`

```python
# BLOCKED (in apis.py only)
from django.views import View
from django.views.generic import ListView

# ALLOWED (in apis.py)
from rest_framework.views import APIView
from rest_framework.response import Response
```

**Note:** This rule only applies to files named `apis.py` or in an `apis/` directory. Traditional Django views in `views.py` are fine.

**Why:** API files should use DRF's features (JSON parsing, authentication, permissions).

### API-003: APIs Must Import DRF APIView

**Rule:** API files with `*Api(` classes must import `from rest_framework.views import APIView`

**Why:** Makes dependencies explicit and catches import errors early.

### SVC-004: Async Task Dispatch Must Use transaction.on_commit()

**Rule:** Trigger Celery tasks only after transaction commits

```python
# BLOCKED
@transaction.atomic
def user_create(*, email: str) -> User:
    user = User(email=email)
    user.save()
    welcome_email_task.delay(user.id)  # Runs before commit!
    return user

# ALLOWED
@transaction.atomic
def user_create(*, email: str) -> User:
    user = User(email=email)
    user.save()
    transaction.on_commit(
        lambda: welcome_email_task.delay(user.id)
    )
    return user
```

**Why:** Prevents tasks from running if transaction fails/rolls back.

### TASK-001: Celery Tasks Must Not Contain Business Logic

**Rule:** Tasks should only fetch data and call services

```python
# BLOCKED
@shared_task
def process_user_task(user_id):
    user = User.objects.get(id=user_id)
    user.is_active = True
    user.save()  # Business logic in task!

# ALLOWED
@shared_task
def process_user_task(user_id):
    user = User.objects.get(id=user_id)
    from apps.accounts.services import user_activate
    user_activate(user)  # Delegate to service!
```

**Why:** Makes business logic testable and reusable.

### SEL-002: Selectors Must Be Pure Reads — No Write Operations

**Rule:** Selectors must contain only ORM reads. Move `.save()`, `.create()`, `.delete()`, `.update()` to services.

### VIEW-002: Views and APIs Must Not Dispatch Tasks Directly

**Rule:** `.delay()` / `.enqueue()` belong in services, wrapped in `transaction.on_commit()`. Views/APIs call services.

### SEC-001: Never Log Sensitive Data

**Rule:** Never log passwords, secrets, tokens, API keys, or credit card numbers

```python
# BLOCKED
logger.info(f"User login: {email}, password: {password}")
logger.debug(f"API call with key: {api_key}")
print(f"Token: {secret_token}")

# ALLOWED
logger.info("User login attempt", extra={"email": email})
logger.debug("API call initiated")
```

**Why:** Sensitive data in logs can be exposed via log aggregation systems, shared log files, or error tracking services.

### SEC-002: Never Expose Raw Exceptions in Responses

**Rule:** Never return `str(e)` or raw exception messages in HTTP responses

```python
# BLOCKED
except Exception as e:
    return Response({"error": str(e)}, status=500)

# ALLOWED
except Exception:
    logger.exception("Unexpected error in payment processing")
    return Response({"message": "An error occurred"}, status=500)
```

**Why:** Raw exception messages leak internal details (database schema, file paths, library versions) that help attackers.

## IMPORTANT Violations (Warn)

These violations generate warnings but don't block commits:

### API-001: Use APIView Instead of ViewSets (HackSoft Pattern)

**Rule:** Prefer `APIView` over `ViewSet` for clarity (DRF only)

**Why:** One operation per class is clearer and more explicit.

### QUAL-002: Type Annotations Required

**Rule:** Services and selectors must have type annotations

```python
# WARNING
def user_create(*, email, name):
    pass

# PREFERRED
def user_create(*, email: str, name: str) -> User:
    pass
```

**Why:** Self-documenting code and better IDE support.

### QUAL-001: Services and Selectors Should Use from __future__ import annotations

**Rule:** Add `from __future__ import annotations` at the top of service/selector files for forward reference support.

### API-004: APIs Should Use DRF Response

**Rule:** Import and use `Response` from `rest_framework.response` (DRF only)

### API-005: APIs Should Use Nested InputSerializer

**Rule:** Define `InputSerializer` as an inner class on create/update APIs (DRF only)

### API-006: APIs Should Use Nested OutputSerializer

**Rule:** Define `OutputSerializer` as an inner class on list/detail APIs (DRF only)

### SEL-001: Selectors Should Optimize Queries

**Rule:** Use `select_related()` and `prefetch_related()` to avoid N+1 queries

```python
# WARNING
def user_list() -> QuerySet[User]:
    return User.objects.all()

# PREFERRED
def user_list() -> QuerySet[User]:
    return User.objects\
        .select_related('profile')\
        .prefetch_related('groups')\
        .all()
```

### SET-001: Per-App Settings — No App Config in Global Settings

**Rule:** App-specific configuration belongs in `apps/<app>/settings.py`, not `config/django/base.py`

```python
# WARNING — app config in global settings
# config/django/base.py
COE_API_KEY = env("COE_API_KEY")
DEFAULT_PAGE_SIZE = 25

# PREFERRED — per-app settings
# apps/coe/settings.py
import os

DEFAULT_PAGE_SIZE = 25

def get_api_key() -> str:
    return os.environ["COE_API_KEY"]
```

**Why:** Least privilege — only the app that needs config can access it. Secrets read lazily, not at startup.

### SET-002: Use Per-App Settings, Not django.conf.settings

**Rule:** Don't use `from django.conf import settings` in services/selectors/views for app-specific config

```python
# WARNING
from django.conf import settings
page_size = settings.DEFAULT_PAGE_SIZE

# PREFERRED
from apps.coe.settings import DEFAULT_PAGE_SIZE
page_size = DEFAULT_PAGE_SIZE
```

**Why:** Explicit imports show dependencies. `django.conf.settings` exposes everything.

### IMP-001: Import Namespace — Use apps.* Prefix

**Rule:** All app imports must use `from apps.<app>.*` format

```python
# WARNING
from core.models import Idea
from accounts.services import user_create

# PREFERRED
from apps.core.models import Idea
from apps.accounts.services import user_create
```

**Why:** Consistent, unambiguous imports that match `INSTALLED_APPS`.

### SVC-003: Use .save(update_fields=[...]) for Updates

**Rule:** When updating existing objects, specify `update_fields` to avoid overwriting concurrent changes and improve performance.

### TEST-001: New Service/Selector Code Without Tests (Forward Pressure)

**Rule:** When a new service/selector file is written, or a new public function is added to an existing one, warn if the corresponding layer test path is missing. Never blocks.

```python
# WARNING (no tests dir/file for this layer)
# apps/core/services.py
def idea_create(*, title: str) -> None:
    pass

# SUPPRESSED once tests exist
# apps/core/tests/services/test_idea.py  (or test_services*.py)
```

**Mapping:**
- `apps/<app>/services.py` → `apps/<app>/tests/services/` (any `test_*.py`) or `apps/<app>/tests/test_services*.py`
- `apps/<app>/selectors.py` → `apps/<app>/tests/selectors/` (any `test_*.py`) or `apps/<app>/tests/test_selectors*.py`
- `apps/<app>/services/<name>.py` → preferred `apps/<app>/tests/services/test_<name>.py`; any `apps/<app>/tests/services/test_*.py` suppresses the warning
- `apps/<app>/selectors/<name>.py` → analogous under `tests/selectors/`

**Why:** Forward pressure toward test coverage on new code without penalizing legacy files (existing functions in existing files are never flagged by this hook rule — that backlog is `TEST-002`, the auditor's job).

### ARCH-010: Folder Structure — Canonical App Layout

**Rule:** Each app should have at minimum: `__init__.py`, `apps.py` (with `name = "apps.<app>"`), `settings.py`

### ARCH-011: Template Namespacing

**Rule:** Templates must be in `templates/<app>/` subdirectory

```
# CORRECT
apps/core/templates/core/idea_list.html

# WRONG
apps/core/templates/idea_list.html
```

### ARCH-012: apps.py Must Set Correct Name

**Rule:** `apps.py` must set `name = "apps.<app_name>"`

```python
# CORRECT
class CoreConfig(AppConfig):
    name = "apps.core"

# WRONG
class CoreConfig(AppConfig):
    name = "core"
```

## Auditor-Only Rules (judgment / advisory)

These rules are enforced by the styleguide-auditor agent (not the PreToolUse hook). They are IMPORTANT (never block) and several are explicitly advisory.

### TEST-002: Existing Services/Selectors/Models Lacking Tests (Backlog)

**Severity:** IMPORTANT
**Implementation:** auditor
**Rule:** Auditor reports public functions/classes lacking obvious tests and groups findings into a readable backlog. Prefer layer-level aggregation when a whole layer is untested. Suggest preferred test paths. Never blocks.

### ARCH-001: Business Logic in Model save()/Managers/Signals

**Severity:** IMPORTANT
**Implementation:** auditor
**Rule:** Business logic in model `save()`, custom managers/querysets, or signals belongs in services. Some trivial `save()` overrides (e.g. slug generation) may be acceptable — document the judgment.

### ARCH-002: Model Validation Without Matching DB Constraints

**Severity:** IMPORTANT (advisory)
**Implementation:** auditor
**Rule:** Model-level validation should preferably have matching DB constraints (`CheckConstraint`/`UniqueConstraint`) when mappable to SQL. Not every validation maps cleanly — only flag the obvious ones. Never blocks.

### SEC-DRF-DEFAULTS: DRF Settings Missing Default Permission Classes or Throttling

**Severity:** IMPORTANT
**Implementation:** auditor
**Rule:** DRF settings should declare `DEFAULT_PERMISSION_CLASSES` and default throttling (`DEFAULT_THROTTLE_CLASSES` / `DEFAULT_THROTTLE_RATES`). Report when missing.

### ARCH-DJANGO-VERSION: Django Version Below Latest 6.x (Advisory)

**Severity:** IMPORTANT (advisory, never blocking)
**Implementation:** auditor
**Rule:** Softened gate — report Django below latest 6.x as an advisory finding. Do not treat as a hard failure; do not recommend blocking CI solely on this.

### ARCH-PACKAGE-STARS: Dependency Below 1,000-Star Adoption Bar (Advisory)

**Severity:** IMPORTANT (advisory, never blocking)
**Implementation:** auditor
**Rule:** Softened gate — report packages below the 1,000-star adoption bar as advisory findings. Adoption is a recommendation, not a hard requirement.

## Enforcement Mechanism

### Pre-Tool Hook

The hook runs automatically on `Edit` and `Write` operations:

**Location:** `hooks/pre-styleguide-check.js`

**What it checks:**
- All CRITICAL violations currently implemented in the hook (blocks commit)
- All IMPORTANT violations currently implemented in the hook (warns but allows)
- Every finding cites its rule ID from `.claude/RULE_CATALOG.json`

### Auditor Subagent

For comprehensive analysis:

```bash
/dretech-django:audit <file-or-app>
```

The auditor checks the full rule catalog (including auditor-only ARCH/TEST/SEC rules) and provides detailed reports with fixes, grouped by category: Architecture, Business Logic Separation, Settings & Security, Code Quality.

## Summary Table

| ID | Rule | Severity | Blocks? | Layer | Implementation |
|----|------|----------|---------|-------|----------------|
| SVC-001 | Keyword-only args | CRITICAL | Yes | Services | hook-js |
| SVC-002 | full_clean() before save() | CRITICAL | Yes | Services | hook-js |
| SVC-003 | save(update_fields=...) | IMPORTANT | No | Services | hook-js |
| SVC-004 | transaction.on_commit() | CRITICAL | Yes | Services | hook-js |
| VIEW-001 | No business logic in views/APIs | CRITICAL | Yes | Views/APIs | hook-js |
| VIEW-002 | No task dispatch in views/APIs | CRITICAL | Yes | Views/APIs | hook-js |
| API-001 | APIView not ViewSets | IMPORTANT | No | APIs | hook-js |
| API-002 | API files use DRF not Django Views | CRITICAL | Yes | APIs | hook-js |
| API-003 | Import DRF APIView | CRITICAL | Yes | APIs | hook-js |
| API-004 | DRF Response import | IMPORTANT | No | APIs | hook-js |
| API-005 | Nested InputSerializer | IMPORTANT | No | APIs | hook-js |
| API-006 | Nested OutputSerializer | IMPORTANT | No | APIs | hook-js |
| SEL-001 | Query optimization | IMPORTANT | No | Selectors | hook-js |
| SEL-002 | Selectors pure reads | CRITICAL | Yes | Selectors | hook-js |
| QUAL-001 | __future__ annotations | IMPORTANT | No | Services/Selectors | hook-js |
| QUAL-002 | Type annotations | IMPORTANT | No | Services/Selectors | hook-js |
| TASK-001 | No logic in tasks | CRITICAL | Yes | Tasks | hook-js |
| SET-001 | Per-app settings | IMPORTANT | No | Settings | hook-js |
| SET-002 | No django.conf.settings for app config | IMPORTANT | No | Services/Selectors/Views | hook-js |
| SEC-001 | Never log sensitive data | CRITICAL | Yes | Security | hook-js |
| SEC-002 | Never expose exceptions in responses | CRITICAL | Yes | Security | hook-js |
| IMP-001 | apps.* import namespace | IMPORTANT | No | All | hook-js |
| ARCH-010 | Canonical folder structure | IMPORTANT | No | Architecture | auditor |
| ARCH-011 | Template namespacing | IMPORTANT | No | Templates | auditor |
| ARCH-012 | apps.py name | IMPORTANT | No | Architecture | auditor |
| TEST-001 | New code without tests | IMPORTANT | No | Tests | hook-js |
| TEST-002 | Existing missing tests backlog | IMPORTANT | No | Tests | auditor |
| ARCH-001 | Logic in model save/managers/signals | IMPORTANT | No | Architecture | auditor |
| ARCH-002 | Validation without DB constraints | IMPORTANT | No | Architecture | auditor |
| SEC-DRF-DEFAULTS | DRF defaults missing | IMPORTANT | No | Security | auditor |
| ARCH-DJANGO-VERSION | Django version advisory | IMPORTANT | No | Architecture | auditor |
| ARCH-PACKAGE-STARS | Package stars advisory | IMPORTANT | No | Architecture | auditor |

---

**Version:** 3.0.0
**Last Updated:** 2026-08-04
**Catalog:** `.claude/RULE_CATALOG.json`
