---
name: pattern
description: Quick reference for common Django patterns following HackSoft styleguide. Shows copy-pasteable code snippets for services, selectors, APIs, views, tests, Celery tasks, pagination, and app settings. Use this skill whenever you need a quick Django code snippet, template, or boilerplate. Also use when the user says "show me the pattern for", "quick snippet", "boilerplate", or needs a copy-paste starting point for any HackSoft Django pattern.
license: MIT
metadata:
  author: EddeDre
  version: "1.0.0"
---

You provide quick, copy-pasteable code patterns for common Django scenarios. Be brief and show working code immediately.

The user's request: $ARGUMENTS

### Available Patterns

<pattern name="create-service">
**Simple Create Service:**

```python
import logging

from django.db import transaction
from django.contrib.auth import get_user_model

from apps.<app>.models import <Entity>

User = get_user_model()
logger = logging.getLogger(__name__)


@transaction.atomic
def <entity>_create(
    *,
    <field1>: str,
    <field2>: str,
) -> <Entity>:
    """Create a new <entity>."""
    <entity> = <Entity>(
        <field1>=<field1>,
        <field2>=<field2>,
    )

    <entity>.full_clean()
    <entity>.save()

    return <entity>
```
</pattern>

<pattern name="list-selector">
**List Selector with Filters:**

```python
from django.db.models import QuerySet, Q

from apps.<app>.models import <Entity>


def <entity>_list(
    *,
    filters: dict = None,
) -> QuerySet[<Entity>]:
    """Get list of <entities> with filtering."""
    filters = filters or {}

    qs = <Entity>.objects.all()

    query = Q()

    if field := filters.get('field'):
        query &= Q(field=field)

    if search := filters.get('search'):
        query &= Q(name__icontains=search)

    return qs.filter(query)\
        .select_related('foreign_key_field')\
        .prefetch_related('many_to_many_field')\
        .order_by('-created_at')
```
</pattern>

<pattern name="get-selector">
**Get Single Object:**

```python
from apps.<app>.models import <Entity>


def <entity>_get(*, <entity>_id: int) -> <Entity>:
    """Get <entity> by ID."""
    try:
        return <Entity>.objects\
            .select_related('related_field')\
            .get(id=<entity>_id)
    except <Entity>.DoesNotExist:
        raise ApplicationError(
            message="<Entity> not found",
            extra={"<entity>_id": <entity>_id}
        )
```
</pattern>

<pattern name="list-view">
**List View (Traditional Django):**

```python
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.paginator import Paginator
from django.views import View
from django.shortcuts import render

from apps.<app>.selectors import <entity>_list
from apps.<app>.settings import DEFAULT_LIST_PAGE_SIZE


class <Entity>ListView(LoginRequiredMixin, View):
    template_name = "<app>/<entity>_list.html"

    def get(self, request):
        <entities> = <entity>_list(fetched_by=request.user)
        paginator = Paginator(<entities>, DEFAULT_LIST_PAGE_SIZE)
        page = paginator.get_page(request.GET.get("page"))
        return render(request, self.template_name, {"page_obj": page})
```
</pattern>

<pattern name="create-view">
**Create View (Traditional Django):**

```python
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from django.shortcuts import render, redirect

from apps.<app>.forms import <Entity>Form
from apps.<app>.services import <entity>_create


class <Entity>CreateView(LoginRequiredMixin, View):
    template_name = "<app>/<entity>_form.html"

    def get(self, request):
        form = <Entity>Form()
        return render(request, self.template_name, {"form": form})

    def post(self, request):
        form = <Entity>Form(request.POST)
        if form.is_valid():
            <entity>_create(
                created_by=request.user,
                **form.cleaned_data,
            )
            return redirect("<app>:<entity>-list")
        return render(request, self.template_name, {"form": form})
```
</pattern>

<pattern name="list-api">
**List API (DRF):**

```python
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import LimitOffsetPagination

from apps.<app>.selectors import <entity>_list


class <Entity>ListApi(APIView):
    class Pagination(LimitOffsetPagination):
        default_limit = 20
        max_limit = 100

    class FilterSerializer(serializers.Serializer):
        field = serializers.CharField(required=False)
        search = serializers.CharField(required=False)

    class OutputSerializer(serializers.Serializer):
        id = serializers.IntegerField()
        <field1> = serializers.CharField()
        created_at = serializers.DateTimeField()

    def get(self, request):
        filters_serializer = self.FilterSerializer(data=request.query_params)
        filters_serializer.is_valid(raise_exception=True)

        <entities> = <entity>_list(filters=filters_serializer.validated_data)

        return get_paginated_response(
            pagination_class=self.Pagination,
            serializer_class=self.OutputSerializer,
            queryset=<entities>,
            request=request,
            view=self
        )
```
</pattern>

<pattern name="create-api">
**Create API (DRF):**

```python
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from apps.<app>.services import <entity>_create


class <Entity>CreateApi(APIView):
    permission_classes = [IsAuthenticated]

    class InputSerializer(serializers.Serializer):
        <field1> = serializers.CharField()
        <field2> = serializers.CharField(required=False)

    def post(self, request):
        serializer = self.InputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        <entity>_create(**serializer.validated_data)
        return Response(status=status.HTTP_201_CREATED)
```
</pattern>

### More Patterns

The following patterns are available in `references/patterns-extended.md` — read from there when needed:

- **update-service** — Update service with `model_update` helper
- **detail-api** — Detail API endpoint (DRF)
- **update-api** — Update API endpoint (DRF PATCH)
- **celery-task** — Celery task (basic and with error handling)
- **model-validation** — Model with validation and constraints
- **exception-handler** — Custom exception handler (DRF)
- **urls** — URL configuration
- **test-service** — Service test
- **app-settings** — Per-app settings pattern
- **pagination-helper** — Pagination helpers (DRF and Django)

### Usage

When the user requests a pattern, show the relevant code immediately with minimal explanation. If the pattern is listed under "More Patterns", read it from `references/patterns-extended.md` first. If user requests a pattern not listed, show closest match and list available patterns.

**All patterns:** `create-service`, `update-service`, `list-selector`, `get-selector`, `list-view`, `create-view`, `list-api`, `create-api`, `detail-api`, `update-api`, `celery-task`, `model-validation`, `exception-handler`, `urls`, `test-service`, `app-settings`, `pagination-helper`
