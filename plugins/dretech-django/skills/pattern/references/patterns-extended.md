# Extended Patterns Reference

## Table of Contents

- [update-service](#update-service) — Update service with model_update helper
- [detail-api](#detail-api) — Detail API endpoint (DRF)
- [update-api](#update-api) — Update API endpoint (DRF PATCH)
- [celery-task](#celery-task) — Celery task (basic and with error handling)
- [model-validation](#model-validation) — Model with validation and constraints
- [exception-handler](#exception-handler) — Custom exception handler (DRF)
- [urls](#urls) — URL configuration
- [test-service](#test-service) — Service test
- [app-settings](#app-settings) — Per-app settings pattern
- [pagination-helper](#pagination-helper) — Pagination helpers (DRF and Django)

---

<a id="update-service"></a>
<pattern name="update-service">
**Update Service with model_update:**

```python
import logging

from django.db import transaction

from apps.<app>.models import <Entity>

logger = logging.getLogger(__name__)


@transaction.atomic
def <entity>_update(
    *,
    <entity>: <Entity>,
    data: dict,
) -> <Entity>:
    """Update an existing <entity>."""
    non_side_effect_fields = [
        '<field1>',
        '<field2>',
    ]

    <entity>, has_updated = model_update(
        instance=<entity>,
        fields=non_side_effect_fields,
        data=data
    )

    if has_updated:
        transaction.on_commit(
            lambda: update_task.delay(<entity>.id)
        )

    return <entity>
```

**model_update helper:**

```python
def model_update(
    *,
    instance,
    fields: list,
    data: dict
):
    has_updated = False

    for field in fields:
        if field in data:
            setattr(instance, field, data[field])
            has_updated = True

    if has_updated:
        instance.full_clean()
        instance.save(update_fields=fields)

    return instance, has_updated
```
</pattern>

<a id="detail-api"></a>
<pattern name="detail-api">
**Detail API (DRF):**

```python
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.<app>.selectors import <entity>_get


class <Entity>DetailApi(APIView):
    class OutputSerializer(serializers.Serializer):
        id = serializers.IntegerField()
        <field1> = serializers.CharField()
        nested = serializers.SerializerMethodField()

        def get_nested(self, obj):
            return {'id': obj.nested.id, 'name': obj.nested.name}

    def get(self, request, <entity>_id):
        <entity> = <entity>_get(<entity>_id=<entity>_id)
        serializer = self.OutputSerializer(<entity>)
        return Response(serializer.data)
```
</pattern>

<a id="update-api"></a>
<pattern name="update-api">
**Update API (DRF — PATCH for partial updates):**

```python
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from apps.<app>.services import <entity>_update
from apps.<app>.selectors import <entity>_get


class <Entity>UpdateApi(APIView):
    permission_classes = [IsAuthenticated]

    class InputSerializer(serializers.Serializer):
        <field1> = serializers.CharField(required=False)
        <field2> = serializers.CharField(required=False)

    def patch(self, request, <entity>_id):
        serializer = self.InputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        <entity> = <entity>_get(<entity>_id=<entity>_id)
        <entity>_update(<entity>=<entity>, data=serializer.validated_data)
        return Response(status=status.HTTP_200_OK)
```
</pattern>

<a id="celery-task"></a>
<pattern name="celery-task">
**Celery Task:**

```python
from celery import shared_task


@shared_task
def <entity>_process_task(<entity>_id):
    from apps.<app>.models import <Entity>
    from apps.<app>.services import <entity>_process

    <entity> = <Entity>.objects.get(id=<entity>_id)
    <entity>_process(<entity>)
```

**With Error Handling:**

```python
from celery import shared_task


def _<entity>_process_failure(self, exc, task_id, args, kwargs, einfo):
    <entity>_id = args[0]
    from apps.<app>.models import <Entity>
    from apps.<app>.services import <entity>_mark_failed

    <entity> = <Entity>.objects.get(id=<entity>_id)
    <entity>_mark_failed(<entity>, error=str(exc))


@shared_task(bind=True, on_failure=_<entity>_process_failure)
def <entity>_process_task(self, <entity>_id):
    from apps.<app>.models import <Entity>
    from apps.<app>.services import <entity>_process

    <entity> = <Entity>.objects.get(id=<entity>_id)

    try:
        <entity>_process(<entity>)
    except Exception as exc:
        self.retry(exc=exc, countdown=60, max_retries=3)
```
</pattern>

<a id="model-validation"></a>
<pattern name="model-validation">
**Model with Validation:**

```python
from django.db import models
from django.core.exceptions import ValidationError
from django.db.models import Q, F


class <Entity>(BaseModel):
    name = models.CharField(max_length=255)
    start_date = models.DateField()
    end_date = models.DateField()

    def clean(self):
        if self.start_date >= self.end_date:
            raise ValidationError({
                'end_date': 'End date must be after start date'
            })

    @property
    def is_active(self) -> bool:
        from django.utils import timezone
        now = timezone.now().date()
        return self.start_date <= now <= self.end_date

    class Meta:
        constraints = [
            models.CheckConstraint(
                name='start_before_end',
                check=Q(start_date__lt=F('end_date'))
            )
        ]
```
</pattern>

<a id="exception-handler"></a>
<pattern name="exception-handler">
**Exception Handler:**

```python
# apps/core/exceptions.py
class ApplicationError(Exception):
    def __init__(self, message: str, extra: dict = None):
        super().__init__(message)
        self.message = message
        self.extra = extra or {}


# apps/core/handlers.py (for DRF projects)
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import exceptions
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework.serializers import as_serializer_error

from apps.core.exceptions import ApplicationError


def custom_exception_handler(exc, ctx):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(as_serializer_error(exc))

    if isinstance(exc, ApplicationError):
        return Response(
            {'message': exc.message, 'extra': exc.extra},
            status=400
        )

    response = exception_handler(exc, ctx)

    if response is None:
        return Response({'message': 'Server error'}, status=500)

    return response


# config/django/base.py
REST_FRAMEWORK = {
    'EXCEPTION_HANDLER': 'apps.core.handlers.custom_exception_handler',
}
```
</pattern>

<a id="urls"></a>
<pattern name="urls">
**URL Configuration:**

```python
from django.urls import path, include

from apps.<app>.views import (
    <Entity>ListView,
    <Entity>CreateView,
    <Entity>DetailView,
    <Entity>UpdateView,
    <Entity>DeleteView,
)

app_name = "<app>"

urlpatterns = [
    path('<entities>/', <Entity>ListView.as_view(), name='<entity>-list'),
    path('<entities>/create/', <Entity>CreateView.as_view(), name='<entity>-create'),
    path('<entities>/<int:<entity>_id>/', <Entity>DetailView.as_view(), name='<entity>-detail'),
    path('<entities>/<int:<entity>_id>/update/', <Entity>UpdateView.as_view(), name='<entity>-update'),
    path('<entities>/<int:<entity>_id>/delete/', <Entity>DeleteView.as_view(), name='<entity>-delete'),
]
```
</pattern>

<a id="test-service"></a>
<pattern name="test-service">
**Service Test:**

```python
from django.test import TestCase
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from unittest.mock import patch

from apps.<app>.models import <Entity>
from apps.<app>.services import <entity>_create

User = get_user_model()


class <Entity>CreateTests(TestCase):
    def test_<entity>_create_success(self):
        result = <entity>_create(<field1>="test", <field2>="value")
        self.assertIsNotNone(result.id)
        self.assertEqual(result.<field1>, "test")

    def test_<entity>_create_validation_error(self):
        with self.assertRaises(ValidationError):
            <entity>_create(<field1>="", <field2>="value")

    @patch('apps.<app>.tasks.process_task.delay')
    def test_<entity>_create_triggers_task(self, mock_task):
        result = <entity>_create(<field1>="test", <field2>="value")
        mock_task.assert_called_once_with(result.id)
```
</pattern>

<a id="app-settings"></a>
<pattern name="app-settings">
**Per-App Settings:**

```python
# apps/<app>/settings.py
"""
App-level settings for the <app> app.

Rules:
- Non-secret config: constants (loaded eagerly at import time)
- Secrets: accessor functions (read os.environ at call time)
"""
import os

# --- Non-secret config (safe to load eagerly) ---

DEFAULT_LIST_PAGE_SIZE = 25
MAX_LIST_PAGE_SIZE = 100
ENABLE_FEATURE_FLAG = True

# --- Secret accessor functions (lazy — read at call time only) ---

def get_api_key() -> str:
    return os.environ["<APP>_API_KEY"]

def get_api_url() -> str:
    value = os.getenv("<APP>_API_URL", "https://api.example.com")
    return value
```

**Usage:**

```python
# In services/selectors — import directly
from apps.<app>.settings import DEFAULT_LIST_PAGE_SIZE, get_api_key

# Config constants
qs = <Entity>.objects.all()[:DEFAULT_LIST_PAGE_SIZE]

# Secrets via function call (lazy)
api_key = get_api_key()
```
</pattern>

<a id="pagination-helper"></a>
<pattern name="pagination-helper">
**Pagination Helper (DRF):**

```python
from rest_framework.response import Response


def get_paginated_response(
    *,
    pagination_class,
    serializer_class,
    queryset,
    request,
    view
):
    paginator = pagination_class()

    page = paginator.paginate_queryset(queryset, request, view=view)

    if page is not None:
        serializer = serializer_class(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    serializer = serializer_class(queryset, many=True)
    return Response(serializer.data)
```

**Django Paginator (Traditional Views):**

```python
from django.core.paginator import Paginator


def paginate_queryset(queryset, request, page_size=25):
    paginator = Paginator(queryset, page_size)
    page_number = request.GET.get("page")
    return paginator.get_page(page_number)
```
</pattern>
