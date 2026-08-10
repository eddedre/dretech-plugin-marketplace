# Per-App Settings Pattern

App-specific configuration belongs in `apps/<app>/settings.py`, **NOT** in `config/django/base.py`.

Global `base.py` is reserved for:
- Django core settings (`SECRET_KEY`, `DATABASES`, `INSTALLED_APPS`, middleware)
- Third-party app configuration (`CRISPY_TEMPLATE_PACK`, `ALLAUTH_*`, etc.)

Everything else goes in the app that uses it.

## Pattern

```python
# apps/<app>/settings.py
"""
App-level settings for the <app> app.

Secrets are exposed as accessor functions (lazy-loaded from os.environ)
rather than module-level constants, so they are only read when actually needed.

Rules:
- Non-secret config: constants (loaded eagerly at import time)
- Secrets: accessor functions (read os.environ at call time)
"""
import os


def _env(name: str, default: str | None = None) -> str:
    """Read an environment variable, raising RuntimeError if missing and no default."""
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _env_bool(name: str, default: bool = False) -> bool:
    """Read an environment variable as a boolean."""
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# --- Non-secret config (safe to load eagerly) ---

DEFAULT_LIST_PAGE_SIZE = 25
MAX_LIST_PAGE_SIZE = 100
ENABLE_APPROVAL_WORKFLOW = True
DEFAULT_STATUS = "draft"


# --- Secret accessor functions (lazy — read at call time only) ---
# Add these only when the app needs to talk to an external system

def get_external_api_key() -> str:
    return _env("COE_EXTERNAL_API_KEY")


def get_external_api_url() -> str:
    return _env("COE_EXTERNAL_API_URL", default="https://api.example.com")
```

## Usage

### Non-secret config in services/selectors

```python
from apps.coe.settings import DEFAULT_LIST_PAGE_SIZE, ENABLE_APPROVAL_WORKFLOW


def idea_list(*, filters: dict = None) -> QuerySet:
    qs = Idea.objects.all()[:DEFAULT_LIST_PAGE_SIZE]
    if ENABLE_APPROVAL_WORKFLOW:
        qs = qs.filter(approved=True)
    return qs
```

### Secrets in services

```python
from apps.core.settings import get_graph_client_id, get_graph_client_secret


def sync_user_avatar(*, user: User) -> None:
    # Secrets are read at call time, not at import time
    client_id = get_graph_client_id()
    client_secret = get_graph_client_secret()
    # ... use credentials ...
```

## Rules

1. **Non-secret config** → module-level constants (loaded eagerly at import time)
2. **Secrets** → accessor functions that read `os.environ` at call time (lazy)
3. **App settings are imported directly**: `from apps.<app>.settings import CONSTANT`
4. **Never use `from django.conf import settings`** to access app-specific config
5. **`config/django/base.py`** is reserved for Django/third-party config only

## Why This Pattern?

### Problem with `django.conf.settings`

```python
# config/django/base.py
GRAPH_CLIENT_SECRET = env("GRAPH_CLIENT_SECRET")  # Loaded at startup

# Any module can now do:
from django.conf import settings
secret = settings.GRAPH_CLIENT_SECRET  # Available everywhere!
```

This means a module that has nothing to do with Microsoft Graph (e.g., a reporting selector) can access Graph API secrets. The blast radius of a code injection or import-time error is the entire settings object.

### Solution: per-app settings with accessor functions

```python
# Only apps/core/settings.py knows about Graph secrets
def get_graph_client_secret() -> str:
    return os.environ["GRAPH_CLIENT_SECRET"]

# Only code that explicitly imports from apps.core.settings can use it
from apps.core.settings import get_graph_client_secret
```

Benefits:
- **Least privilege** — only the app that needs a secret can access it
- **Lazy loading** — secrets are read when called, not at startup
- **Explicit dependencies** — imports show exactly which settings a module uses
- **Testability** — easy to mock individual accessor functions
- **Failure isolation** — a missing env var only fails when the accessor is called, not at startup
