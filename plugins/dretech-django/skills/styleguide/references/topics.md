# Styleguide Topic Reference

Detailed examples and templates for each Django Styleguide topic. Navigate to a specific section using the table of contents below.

## Table of Contents

- [Services](#services)
- [Selectors](#selectors)
- [Views](#views)
- [APIs](#apis)
- [Models](#models)
- [Testing](#testing)
- [Celery](#celery)
- [Settings](#settings)
- [Security](#security)
- [Errors](#errors)

---

## Services

**Services Pattern:**

Services handle write operations and contain business logic. They should:
- Use keyword-only arguments (unless 0-1 args)
- Apply type annotations
- Follow naming: `<entity>_<action>` (e.g., `user_create`)
- Call `full_clean()` before saving (use `exclude=[...]` when needed)
- Return the created/updated object

**Function-based (simple):**
```python
import logging

from django.contrib.auth import get_user_model
from django.db import transaction

from apps.accounts.services import profile_create

User = get_user_model()
logger = logging.getLogger(__name__)


def user_create(*, email: str, name: str) -> User:
    user = User(email=email)
    user.full_clean()
    user.save()

    profile_create(user=user, name=name)

    return user
```

**Class-based (complex flows):**
```python
from django.contrib.auth import get_user_model
from django.db import transaction

User = get_user_model()


class FileUploadService:
    def __init__(self, user: User, file_obj):
        self.user = user
        self.file_obj = file_obj

    def create(self, file_name: str = "") -> "File":
        from apps.files.models import File

        obj = File(
            file=self.file_obj,
            name=file_name or self.file_obj.name,
            uploaded_by=self.user
        )
        obj.full_clean()
        obj.save()

        return obj
```

**Update Pattern:**
```python
from django.contrib.auth import get_user_model

User = get_user_model()


def user_update(*, user: User, data) -> User:
    non_side_effect_fields = ['first_name', 'last_name']

    user, has_updated = model_update(
        instance=user,
        fields=non_side_effect_fields,
        data=data
    )

    # Handle side-effects (e.g., sending emails)
    if has_updated:
        # ... side effect logic ...
        pass

    return user
```

---

## Selectors

**Selectors Pattern:**

Selectors handle read operations and data fetching. They should:
- Return querysets, lists, or individual objects
- Handle filtering and query optimization
- Follow naming: `<entity>_<action>` (e.g., `user_list`, `user_get`)
- Use keyword-only arguments

**List Example:**
```python
from django.contrib.auth import get_user_model
from django.db.models import QuerySet, Q

User = get_user_model()


def user_list(*, fetched_by: User, filters=None) -> QuerySet[User]:
    filters = filters or {}

    user_ids = user_get_visible_for(user=fetched_by)

    query = Q(id__in=user_ids)

    if email := filters.get('email'):
        query &= Q(email=email)

    return User.objects.filter(query)
```

**Get Example:**
```python
from apps.core.models import Course


def course_detail(*, course_id: int) -> Course:
    try:
        return Course.objects.get(id=course_id)
    except Course.DoesNotExist:
        raise ApplicationError("Course not found")
```

**Complex Queries:**
```python
from apps.core.models import FeedItem


def feed_get(*, user: "User") -> list["FeedItem"]:
    return FeedItem.objects\
        .select_related('author', 'category')\
        .prefetch_related('tags', 'likes')\
        .filter(is_published=True)\
        .order_by('-created_at')
```

---

## Views

**Views Pattern (Traditional Django):**

Views should be thin layers that delegate to services and selectors. No business logic.

**ListView using selector:**
```python
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from django.shortcuts import render

from apps.core.selectors import idea_list


class IdeaListView(LoginRequiredMixin, View):
    template_name = "core/idea_list.html"

    def get(self, request):
        ideas = idea_list(fetched_by=request.user)
        return render(request, self.template_name, {"ideas": ideas})
```

**CreateView using service:**
```python
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from django.shortcuts import render, redirect

from apps.core.forms import IdeaForm
from apps.core.services import idea_create


class IdeaCreateView(LoginRequiredMixin, View):
    template_name = "core/idea_form.html"

    def get(self, request):
        form = IdeaForm()
        return render(request, self.template_name, {"form": form})

    def post(self, request):
        form = IdeaForm(request.POST)
        if form.is_valid():
            idea_create(
                submitter=request.user,
                **form.cleaned_data,
            )
            return redirect("core:idea-list")
        return render(request, self.template_name, {"form": form})
```

Template files go in `apps/<app>/templates/<app>/`:
- `idea_list.html` — extends `base.html`
- `idea_form.html` — extends `base.html`
- `idea_detail.html` — extends `base.html`

---

## APIs

**API Pattern (Django REST Framework):**

For projects using DRF, APIs should be thin interface layers. Follow these rules:
- One API per operation (not ViewSets for this pattern)
- Inherit from `rest_framework.views.APIView`
- NO business logic in APIs
- Use dedicated Input/Output serializers
- Name: `<Entity><Action>Api`
- Call services for writes, selectors for reads

**List API:**
```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.pagination import LimitOffsetPagination
from rest_framework import serializers

from apps.accounts.selectors import user_list


class UserListApi(APIView):
    class Pagination(LimitOffsetPagination):
        default_limit = 20

    class FilterSerializer(serializers.Serializer):
        id = serializers.IntegerField(required=False)
        email = serializers.EmailField(required=False)

    class OutputSerializer(serializers.Serializer):
        id = serializers.IntegerField()
        email = serializers.EmailField()
        first_name = serializers.CharField()

    def get(self, request):
        filters_serializer = self.FilterSerializer(data=request.query_params)
        filters_serializer.is_valid(raise_exception=True)

        users = user_list(
            fetched_by=request.user,
            filters=filters_serializer.validated_data
        )

        return get_paginated_response(
            pagination_class=self.Pagination,
            serializer_class=self.OutputSerializer,
            queryset=users,
            request=request,
            view=self
        )
```

**Create API:**
```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated

from apps.core.services import course_create


class CourseCreateApi(APIView):
    permission_classes = [IsAuthenticated]

    class InputSerializer(serializers.Serializer):
        name = serializers.CharField()
        start_date = serializers.DateField()
        end_date = serializers.DateField()

    def post(self, request):
        serializer = self.InputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        course_create(**serializer.validated_data)

        return Response(status=status.HTTP_201_CREATED)
```

**Why APIView and not ViewSets?**

The HackSoft pattern prefers `APIView` because:
1. **Explicit is better than implicit** — Each operation is clearly defined
2. **One operation per class** — Makes code easier to navigate
3. **No hidden magic** — You see exactly what each endpoint does
4. **Better for services pattern** — Clear where to call service functions

---

## Models

**Model Pattern:**

Models should focus on data representation, not business logic.

**Base Model:**
```python
class BaseModel(models.Model):
    created_at = models.DateTimeField(db_index=True, default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
```

**Validation in Models:**
Use `clean()` for simple validation across non-relational fields:

```python
from apps.core.models import BaseModel


class Course(BaseModel):
    name = models.CharField(max_length=255)
    start_date = models.DateField()
    end_date = models.DateField()

    def clean(self):
        if self.start_date >= self.end_date:
            raise ValidationError("End date must be after start date")

    class Meta:
        constraints = [
            models.CheckConstraint(
                name="start_date_before_end_date",
                check=Q(start_date__lt=F("end_date"))
            )
        ]
```

**Properties and Methods:**
```python
class Course(BaseModel):
    @property
    def has_started(self) -> bool:
        return self.start_date <= timezone.now().date()

    def set_new_access_code(self):
        self.access_code = get_random_string(8)
        self.access_code_expires = timezone.now() + timedelta(days=7)
        return self
```

Move complex calculations to selectors or services.

---

## Testing

**Testing Structure:**

```
apps/<app_name>/tests/
├── __init__.py
├── factories.py
├── models/
│   ├── __init__.py
│   └── test_course.py
├── selectors/
│   ├── __init__.py
│   └── test_user_list.py
└── services/
    ├── __init__.py
    └── test_user_create.py
```

**Naming:**
- File: `test_<thing_being_tested>.py`
- Class: `<ThingBeingTested>Tests(TestCase)`

**Service Tests:**
```python
from django.test import TestCase
from django.contrib.auth import get_user_model
from unittest.mock import patch

from apps.accounts.services import user_create

User = get_user_model()


class UserCreateTests(TestCase):
    @patch('apps.emails.services.welcome_email_send')
    def test_user_create_sends_welcome_email(self, mock_email):
        email = "test@example.com"

        user = user_create(email=email, name="Test")

        self.assertEqual(user.email, email)
        mock_email.assert_called_once_with(user=user)
```

**Test Data Creation:**
1. Use factories (`factory_boy`)
2. Use services themselves
3. Minimal `Model.objects.create()` calls

---

## Celery

**Celery Integration:**

Tasks should call services—NO business logic in tasks.

**Task Structure:**
```python
@shared_task
def email_send_task(email_id):
    from apps.emails.models import Email
    from apps.emails.services import email_send

    email = Email.objects.get(id=email_id)
    email_send(email)
```

**Triggering from Services:**
```python
from django.db import transaction


@transaction.atomic
def user_complete_onboarding(user: "User") -> "User":
    user.onboarding_completed = True
    user.save(update_fields=['onboarding_completed'])

    # Execute on transaction commit
    transaction.on_commit(
        lambda: welcome_email_send_task.delay(user.id)
    )

    return user
```

---

## Settings

**Settings Organization:**

For the full per-app settings pattern, read `app-settings.md` (sibling reference file).

**Key principle:** App-specific config belongs in `apps/<app>/settings.py`, NOT in `config/django/base.py`.

```
config/django/base.py       → Django core + third-party settings ONLY
apps/<app>/settings.py       → App-specific config + secret accessors
```

**Per-app settings example:**
```python
# apps/coe/settings.py

# Non-secret config (loaded eagerly)
DEFAULT_LIST_PAGE_SIZE = 25
ENABLE_APPROVAL_WORKFLOW = True

# Secret accessor functions (lazy — read os.environ at call time)
import os

def get_external_api_key() -> str:
    return os.environ["COE_EXTERNAL_API_KEY"]
```

**Usage:**
```python
from apps.coe.settings import DEFAULT_LIST_PAGE_SIZE, get_external_api_key

# Config constants imported directly
qs = Idea.objects.all()[:DEFAULT_LIST_PAGE_SIZE]

# Secrets accessed via function call (lazy)
api_key = get_external_api_key()
```

**Rules:**
1. Non-secret config → module-level constants
2. Secrets → accessor functions using `os.environ`
3. Never use `from django.conf import settings` for app-specific config
4. `config/django/base.py` is for Django/third-party config only

---

## Security

**Security:**

For the full security reference, read `security.md` (sibling reference file). Key points:

**Secrets Handling — per-app accessor functions (not global settings):**
```python
# apps/core/settings.py
import os

def get_graph_client_secret() -> str:
    return os.environ["GRAPH_CLIENT_SECRET"]
```

**Production Settings — required in `config/django/production.py`:**
```python
DEBUG = False
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin"
```

**Service-Level Security:**
- Never log passwords, tokens, or PII
- Strip metadata from uploaded files in services
- Never expose stack traces in production error responses
- Use `hmac.compare_digest()` for token comparison (prevents timing attacks)

**What NOT to do in services:**
```python
# BAD — logs sensitive data
logger.info(f"User login: {email}, password: {password}")

# BAD — exposes internals
except Exception as e:
    return Response({"error": str(e)}, status=500)
```

---

## Errors

**Error Handling:**

**Application Errors:**
```python
class ApplicationError(Exception):
    def __init__(self, message: str, extra: dict = None):
        super().__init__(message)
        self.message = message
        self.extra = extra or {}
```

**Django vs DRF ValidationError:**
Django's ValidationError causes 500 errors in DRF. Convert them:

```python
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import exceptions
from rest_framework.serializers import as_serializer_error


def custom_exception_handler(exc, ctx):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(as_serializer_error(exc))

    if isinstance(exc, ApplicationError):
        return Response(
            {'message': exc.message, 'extra': exc.extra},
            status=400
        )

    response = exception_handler(exc, ctx)
    return response
```
