---
name: audit
description: Quick audit of Django code against HackSoft styleguide. Analyzes current file or entire app for violations including business logic separation, settings security, folder structure, and import conventions. Use this skill whenever reviewing Django code quality, checking for violations, or ensuring styleguide compliance. Also use when the user mentions "audit", "code review", "styleguide check", "violations", or asks to review Django code against best practices.
license: MIT
compatibility: Requires Agent tool to launch the styleguide-auditor subagent
metadata:
  author: EddeDre
  version: "1.1.0"
---

You are performing a Django styleguide audit. Use the styleguide-auditor agent for comprehensive analysis.

The user's request: $ARGUMENTS

### Quick Audit Process

1. **Determine scope**:
   - If user provides file path -> audit that file
   - If user provides app name -> audit entire app
   - If no target -> ask what to audit

2. **Launch auditor**:
   ```
   Use Agent tool with subagent_type="dretech-django:styleguide-auditor"
   ```

3. **Present results** grouped by category (see output format below). Every finding line MUST include a rule ID (`[SEVERITY][RULE-ID] ...`).

### Full Audit Checklist

The auditor checks all of the following. Rule IDs come from `.claude/RULE_CATALOG.json`.

**Project Setup (softened / advisory)**
- Django version: recommend 6.x. Flag any Django <6.0 as **IMPORTANT advisory** with rule ID `ARCH-DJANGO-VERSION` — never blocking
- Dependencies: report packages with <1,000 GitHub stars as **IMPORTANT advisory** with rule ID `ARCH-PACKAGE-STARS` — never blocking
- Dependencies: check for outdated pinned versions (advisory)

**Architecture**
- Project structure: find where `manage.py` lives — do NOT assume repo root
- Folder structure: each app has services.py, selectors.py, settings.py, tests/ (`ARCH-010`)
- Import namespace: all imports use `from apps.<app>.*` format (`IMP-001`)
- Template placement: app-specific templates in `apps/<app>/templates/<app>/`, NOT in global `templates/` (`ARCH-011`)
- Global templates (`base.html`, navbar, footer) in `templates/` at Django root only
- apps.py: must set `name = "apps.<app_name>"` (`ARCH-012`)
- **ARCH-001**: business logic in model `save()`, custom managers/querysets, or signals (IMPORTANT)
- **ARCH-002**: model-level validation without a matching DB constraint when the mapping is obvious (IMPORTANT, advisory)

**Business Logic Separation**
- Services: keyword-only args (`*,`) (`SVC-001`)
- Services: `full_clean()` before `save()` (`SVC-002`)
- Services: `transaction.on_commit()` for ALL `.delay()` and `.enqueue()` calls (`SVC-004`)
- Services: `full_clean(exclude=["status"])` when FSM-protected fields exist
- Views/APIs: no business logic (no `.save()`, `.create()`, `.filter()`, `.enqueue()`, `.delay()` directly) (`VIEW-001` / `VIEW-002`)
- Views/APIs: delegate to services (write) and selectors (read)
- Views/APIs: no task dispatching — `.enqueue()`/`.delay()` belong in services
- APIs: DRF `APIView` not ViewSets (when using DRF) (`API-001`)
- APIs: must import from `rest_framework.views` not `django.views` (in `apis.py` files only) (`API-002` / `API-003`)
- APIs: nested `InputSerializer`/`OutputSerializer` (`API-005` / `API-006`)
- Tasks: delegate to services, no business logic (`TASK-001`)
- Tasks: `transaction.on_commit()` for async dispatch

**Settings & Security**
- Per-app settings: app config lives in `apps/<app>/settings.py`, not `config/django/base.py` (`SET-001`)
- Secrets: use accessor functions with `os.environ`, not `env()` in global settings (`SET-001`)
- No `from django.conf import settings` for app-specific config in services/selectors/views (`SET-002`)
- Never log passwords, tokens, secrets, or PII (`SEC-001`)
- Never expose raw exceptions in HTTP responses (`str(e)` in Response) (`SEC-002`)
- Timing-safe comparisons for tokens (`hmac.compare_digest()`)
- Production settings: `DEBUG=False`, `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, etc.
- SQL injection: no raw SQL with string formatting
- **SEC-DRF-DEFAULTS**: DRF settings missing `DEFAULT_PERMISSION_CLASSES` and/or default throttling (`DEFAULT_THROTTLE_CLASSES` / `DEFAULT_THROTTLE_RATES`) — IMPORTANT

**Tests**
- **TEST-002**: existing services/selectors/models lacking tests (IMPORTANT backlog). Group findings so a zero-test project stays readable. Prefer layer-level aggregation. Suggest preferred test paths. Never blocking. (Forward pressure on *new* code is the hook's `TEST-001`.)

**Code Quality**
- Type annotations on services and selectors (`QUAL-002`)
- `from __future__ import annotations` (`QUAL-001`)
- Query optimization: `select_related`/`prefetch_related` in selectors (`SEL-001`)
- APIs use nested `InputSerializer`/`OutputSerializer` (DRF)
- APIs use DRF `Response` (`API-004`)
- `get_user_model()` instead of importing User directly

### High-Violation Handling

When the target has many findings (legacy codebases, synthetic high-violation fixtures):

1. Group findings by category (Architecture / Business Logic / Settings & Security / Code Quality / Security)
2. Cite rule IDs on every line
3. Aggregate repeated violations at file/layer level so the report stays readable
4. Always finish with a **Summary** block of counts (Critical / Important / Minor, distinct rule IDs, top findings)
5. Softened gates (`ARCH-DJANGO-VERSION`, `ARCH-PACKAGE-STARS`, `ARCH-002`) remain advisory and do not dominate the report

### Output Format

After audit:
```
# Django Styleguide Audit Report

**Scope:** <file or app audited>

## Architecture
- [IMPORTANT][ARCH-001] ...
- [IMPORTANT][ARCH-002] ...
- [IMPORTANT][ARCH-DJANGO-VERSION] ... (advisory)
- [IMPORTANT][ARCH-PACKAGE-STARS] ... (advisory)
- Folder structure violations: X
- Import namespace violations: X

## Business Logic Separation
- Critical violations: X
- Important violations: X

## Settings & Security
- Secrets exposure issues: X
- Missing per-app settings: X
- [IMPORTANT][SEC-DRF-DEFAULTS] DEFAULT_PERMISSION_CLASSES / throttling missing

## Code Quality
- Type annotation gaps: X
- Query optimization issues: X

## Security
- Sensitive logging: X
- Exception exposure: X

## Summary
- Critical: X
- Important: X
- Minor: X
- Distinct rule IDs: N

**Top Violations:**
1. [CRITICAL][RULE-ID] <violation in file:line>
2. [CRITICAL][RULE-ID] <violation in file:line>
3. [IMPORTANT][RULE-ID] <violation in file:line>

Would you like me to:
1. Show full audit report
2. Fix critical violations automatically
3. Audit a different file/app
```

### Tool Restrictions

- Use Agent tool to launch styleguide-auditor agent
- Use Read to check files exist
- Use Glob to find files in app
- DO NOT use Edit/Write (auditor reports only)

Now perform the audit by launching the styleguide-auditor agent.
