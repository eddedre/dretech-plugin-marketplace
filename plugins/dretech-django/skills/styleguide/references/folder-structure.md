# Canonical App Folder Structure

## CRITICAL: Detect the actual project layout FIRST

Before creating or editing any file, find where `manage.py` lives. Django projects have varied layouts:

```
# Layout A: manage.py at repo root
myproject/                     ← repo root
├── apps/
├── config/
├── manage.py                  ← here
└── ...

# Layout B: manage.py nested in a subfolder (common)
kids-gpt/                      ← repo root
├── kidsgpt/                   ← Django root (where manage.py lives)
│   ├── apps/
│   ├── kidsgpt/               ← Django config (settings, urls)
│   ├── manage.py              ← here
│   └── ...
├── docker/
└── .planning/

# Layout C: src/ prefix
myproject/                     ← repo root
├── src/
│   ├── apps/
│   ├── config/
│   └── manage.py              ← here
└── ...
```

**Always run `find . -name manage.py -not -path "*/venv/*"` or check the repo to discover the layout.** All paths below are relative to where `manage.py` lives, NOT the repo root.

## Structure (relative to manage.py location)

```
<django_root>/                 ← where manage.py lives
├── apps/
│   └── <app_name>/
│       ├── __init__.py
│       ├── apps.py                 # name = "apps.<app_name>"
│       ├── models.py               # Data layer
│       ├── services.py             # Write operations / business logic
│       ├── selectors.py            # Read operations / queries
│       ├── views.py                # Thin view layer (Django or DRF)
│       ├── forms.py                # Django forms (for traditional views)
│       ├── urls.py                 # App URL patterns
│       ├── settings.py             # Per-app config & secret accessors
│       ├── factories.py            # Test factories (factory_boy)
│       ├── mixins.py               # View/model mixins (optional)
│       ├── email.py                # Email utilities (optional)
│       ├── context_processors.py   # Template context (optional)
│       ├── management/
│       │   └── commands/           # Management commands
│       ├── migrations/
│       ├── templates/
│       │   └── <app_name>/         # Namespaced templates
│       │       ├── <entity>_list.html
│       │       ├── <entity>_detail.html
│       │       ├── <entity>_form.html
│       │       └── email/          # Email templates (optional)
│       └── tests/
│           ├── __init__.py
│           ├── factories.py        # (or in parent app dir)
│           ├── models/
│           │   ├── __init__.py
│           │   └── test_<model>.py
│           ├── services/
│           │   ├── __init__.py
│           │   └── test_<service>.py
│           └── selectors/
│               ├── __init__.py
│               └── test_<selector>.py
├── config/
│   ├── django/
│   │   ├── base.py                 # Django core + third-party settings ONLY
│   │   ├── local.py                # Dev overrides
│   │   └── production.py           # Prod overrides
│   ├── env.py                      # Environment loader
│   ├── urls.py                     # Root URL config
│   └── wsgi.py
├── templates/                      # Project-wide base templates ONLY (base.html, navbar, footer)
│   ├── base.html                   # ← Global: shared across all apps
│   ├── navbar.html                 # ← Global: shared layout partials
│   └── _footer.html                # ← Global: shared layout partials
│   # NOTE: App-specific templates go INSIDE each app, not here.
│   # See apps/<app>/templates/<app>/ above.
├── static/
├── media/
└── manage.py
```

## Conventions

### Import Namespace

All app imports use the `apps.*` namespace:

```python
# Correct
from apps.core.models import Idea
from apps.core.services import idea_create
from apps.core.selectors import idea_list
from apps.core.settings import DEFAULT_LIST_PAGE_SIZE

# Wrong — missing apps prefix
from core.models import Idea
```

### apps.py Configuration

Every app must set `name` to the fully qualified `apps.*` path:

```python
# apps/<app_name>/apps.py
class PortalConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.portal"
    verbose_name = "Portal"
```

### Template Placement Rules

**Two types of templates, two locations:**

| Template Type | Location | Example |
|--------------|----------|---------|
| **App-specific** (pages, forms, emails for one app) | `apps/<app>/templates/<app>/` | `apps/core/templates/core/idea_list.html` |
| **Project-wide** (base layout, navbar, footer shared across all apps) | `templates/` at Django root | `templates/base.html` |

**App templates go INSIDE the app — always:**
```
apps/core/templates/core/idea_list.html      # Correct — app-specific
apps/core/templates/core/idea_form.html      # Correct — app-specific
templates/base.html                           # Correct — global shared layout
templates/core/idea_list.html                # WRONG — app template in global dir
apps/core/templates/idea_list.html           # WRONG — missing namespace subdirectory
```

Referenced in views as:
```python
template_name = "core/idea_list.html"  # Django resolves via app template loader
```

When creating a new page for an app, ALWAYS put the template in `apps/<app>/templates/<app>/`, not in the project-wide `templates/` directory.

### Settings in INSTALLED_APPS

```python
# config/django/base.py
LOCAL_APPS = [
    "apps.accounts",
    "apps.core",
    "apps.portal",
    "apps.coe",
    "apps.team",
    "apps.adminpanel",
    "apps.reporting",
]
```

### User Model

Always use `get_user_model()`, never import `User` directly:

```python
from django.contrib.auth import get_user_model

User = get_user_model()
```

### Detecting Project Structure

Before generating ANY code, discover the project layout:

1. **Find manage.py**: `find . -name manage.py -not -path "*/venv/*" -not -path "*/.venv/*"` — this is the Django root
2. **Find settings**: Look for `INSTALLED_APPS` or `LOCAL_APPS` in settings files near manage.py
3. **Check app namespace**: Do apps use `apps.*` prefix? Check `INSTALLED_APPS` for `"apps.core"` vs `"core"`
4. **Check existing structure**: List the directory around manage.py to see the actual layout (apps/, config/, templates/)
5. **Do NOT assume the canonical layout** — adapt to what exists. If the project puts Django code in `kidsgpt/` instead of the repo root, all paths must be relative to where manage.py lives
