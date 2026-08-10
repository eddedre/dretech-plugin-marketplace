---
name: pagination
description: Comprehensive guide to pagination in Django following best practices. Covers Django Paginator for traditional views and DRF pagination (LimitOffset, PageNumber, Cursor) for REST APIs. Use this skill whenever implementing pagination, adding page navigation, optimizing large querysets, or the user mentions "paginator", "page_obj", "LimitOffsetPagination", "CursorPagination", "get_paginated_response", or asks how to paginate a list view or API endpoint.
license: MIT
metadata:
  author: EddeDre
  version: "1.0.0"
---

You are a Django pagination expert. Help developers implement proper pagination for both traditional Django views and Django REST Framework APIs.

The user's request: $ARGUMENTS

### Django Paginator (Traditional Views)

For projects using traditional Django views, use Django's built-in `Paginator`.

**Basic Paginator in a View:**

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
        page_obj = paginator.get_page(request.GET.get("page"))

        return render(request, self.template_name, {
            "page_obj": page_obj,
            "<entities>": page_obj.object_list,
        })
```

**Template Pagination Controls:**

```html
{% if page_obj.has_other_pages %}
<nav aria-label="Page navigation">
    <ul class="pagination">
        {% if page_obj.has_previous %}
        <li class="page-item">
            <a class="page-link" href="?page={{ page_obj.previous_page_number }}">Previous</a>
        </li>
        {% endif %}

        {% for num in page_obj.paginator.page_range %}
        <li class="page-item {% if page_obj.number == num %}active{% endif %}">
            <a class="page-link" href="?page={{ num }}">{{ num }}</a>
        </li>
        {% endfor %}

        {% if page_obj.has_next %}
        <li class="page-item">
            <a class="page-link" href="?page={{ page_obj.next_page_number }}">Next</a>
        </li>
        {% endif %}
    </ul>
</nav>
{% endif %}
```

**Preserving Query Parameters:**

When combining pagination with filters/search, preserve query params:

```html
<a class="page-link" href="?page={{ num }}&{{ request.GET.urlencode }}">{{ num }}</a>
```

Or build the URL in the view:

```python
from urllib.parse import urlencode

def get(self, request):
    # ... paginate ...
    query_params = request.GET.copy()
    query_params.pop('page', None)
    context["query_string"] = query_params.urlencode()
    return render(request, self.template_name, context)
```

```html
<a href="?page={{ num }}{% if query_string %}&{{ query_string }}{% endif %}">{{ num }}</a>
```

**Page Size from App Settings:**

```python
# apps/<app>/settings.py
DEFAULT_LIST_PAGE_SIZE = 25
MAX_LIST_PAGE_SIZE = 100
```

---

### DRF Pagination

For projects using Django REST Framework.

#### Recommended: LimitOffsetPagination

**Why we prefer it:**
- Direct control over limit and offset
- Works well with HackSoft selectors
- Client-friendly API (`?limit=20&offset=40`)

```python
from rest_framework.views import APIView
from rest_framework.pagination import LimitOffsetPagination
from rest_framework import serializers

from apps.<app>.selectors import <entity>_list


class <Entity>ListApi(APIView):
    class Pagination(LimitOffsetPagination):
        default_limit = 20
        max_limit = 100

    class OutputSerializer(serializers.Serializer):
        id = serializers.IntegerField()
        name = serializers.CharField()
        created_at = serializers.DateTimeField()

    def get(self, request):
        queryset = <entity>_list(fetched_by=request.user)

        return get_paginated_response(
            pagination_class=self.Pagination,
            serializer_class=self.OutputSerializer,
            queryset=queryset,
            request=request,
            view=self
        )
```

#### PageNumber Pagination (Alternative)

Use when clients prefer page-based navigation:

```python
from rest_framework.pagination import PageNumberPagination

class <Entity>ListApi(APIView):
    class Pagination(PageNumberPagination):
        page_size = 20
        page_size_query_param = 'page_size'
        max_page_size = 100
```

#### Cursor Pagination (For Large Datasets)

Best for large datasets (millions of records), real-time feeds, and consistent results:

```python
from rest_framework.pagination import CursorPagination

class <Entity>ListApi(APIView):
    class Pagination(CursorPagination):
        page_size = 20
        ordering = '-created_at'  # Required! Must match index
        cursor_query_param = 'cursor'
```

**Important:** CursorPagination requires a database index on the ordering field.

#### Pagination Helper Function

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

### Performance Considerations

**1. Count Queries Can Be Expensive**

```python
# Option A: Disable count (faster)
class FastPagination(LimitOffsetPagination):
    def get_count(self, queryset):
        return None

# Option B: Cached count
from django.core.cache import cache

class CachedCountPagination(LimitOffsetPagination):
    def get_count(self, queryset):
        cache_key = f"count:{queryset.model.__name__}"
        count = cache.get(cache_key)
        if count is None:
            count = super().get_count(queryset)
            cache.set(cache_key, count, 300)
        return count
```

**2. Optimize Querysets BEFORE Pagination** - Always use select_related/prefetch_related in selectors.

**3. Avoid Deep Offsets** - Use CursorPagination for large offsets (DRF) or keyset pagination for Django views.

### Quick Reference

| Use Case | Pagination Type | Why |
|----------|----------------|-----|
| Traditional Django views | Django `Paginator` | Built-in, template-friendly |
| Standard REST API lists | LimitOffset | Best balance |
| Mobile API apps | LimitOffset (smaller limits) | Bandwidth |
| Admin panels | LimitOffset (larger limits) | Productivity |
| Large datasets (1M+ records) | Cursor | Performance |
| Real-time feeds | Cursor | Consistency |
| Legacy API compatibility | PageNumber | Client expectation |

Now help the user implement pagination for their Django project.
