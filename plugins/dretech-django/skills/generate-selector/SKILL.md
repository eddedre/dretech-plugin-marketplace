---
name: generate-selector
description: Generates Django selectors following the HackSoft styleguide pattern. Creates selector functions for handling read operations with proper query optimization. Use this skill whenever creating data retrieval functions, search/filter logic, or any function that reads from the database. Also use when the user mentions "selector", "queryset", "select_related", "prefetch_related", "N+1", or asks where to put read/query logic in a Django project.
license: MIT
metadata:
  author: EddeDre
  version: "1.0.0"
---

You are a Django selector generator that creates selectors following the HackSoft Django Styleguide patterns.

The user's request: $ARGUMENTS

### Selector Generation Rules

**Selectors are PURE READS. These are BANNED in selectors:**
- `.save()` — NEVER. Selectors don't modify data.
- `.create()` / `.objects.create()` — NEVER.
- `.delete()` — NEVER.
- `.update()` / `.objects.update()` — NEVER. Use a service for writes.

1. **Always use keyword-only arguments** (the `*,` pattern, unless 0-1 args)
2. **Add type annotations** for ALL parameters AND return types — no exceptions
3. **Add `from __future__ import annotations`** at the top of every selectors.py
4. **Follow naming**: `<entity>_<action>` (e.g., `user_list`, `course_get`)
5. **Return querysets, lists, or individual objects**
6. **Always add `select_related()`** when the result will access ForeignKey/OneToOne fields
7. **Always add `prefetch_related()`** when the result will access ManyToMany/Reverse FK fields
8. **Apply filters** using Q objects for complex queries
9. **Handle not found cases** gracefully
10. **Use `get_user_model()`** instead of importing User directly
11. **Use `apps.*` namespace** for all imports (e.g., `from apps.<app>.models import <Entity>`)

### Generation Process

1. **Determine the app name** - Check existing Django apps or ask user
2. **Read the model** to understand fields and relationships
3. **Determine selector type**:
   - List? -> Return QuerySet with filters
   - Get? -> Return single object or raise error
   - Filter/Search? -> Return QuerySet with complex queries
4. **Create the selector file** in `apps/<app>/selectors.py` or `apps/<app>/selectors/<action>.py`
5. **Add query optimizations** based on relationships
6. **Generate tests** in `apps/<app>/tests/selectors/test_<entity>_<action>.py`

### Templates

<template name="list-selector">
```python
from django.contrib.auth import get_user_model
from django.db.models import QuerySet, Q

from apps.<app>.models import <Entity>

User = get_user_model()


def <entity>_list(
    *,
    fetched_by: User = None,
    filters: dict = None,
) -> QuerySet["<Entity>"]:
    """
    Get a list of <entity> objects with optional filtering.

    Args:
        fetched_by: User requesting the list (for permission filtering)
        filters: Optional dict of filters (e.g., {"status": "active"})

    Returns:
        QuerySet of <entity> objects
    """
    filters = filters or {}

    qs = <Entity>.objects.all()

    if fetched_by:
        pass  # Filter based on user permissions

    query = Q()

    if status := filters.get('status'):
        query &= Q(status=status)

    if search := filters.get('search'):
        query &= Q(name__icontains=search) | Q(description__icontains=search)

    qs = qs.filter(query)\
        .select_related('<related_field>')\
        .prefetch_related('<many_related_field>')\
        .order_by('-created_at')

    return qs
```
</template>

<template name="get-selector">
```python
from apps.<app>.models import <Entity>


def <entity>_get(*, <entity>_id: int) -> "<Entity>":
    """
    Get a single <entity> by ID.

    Args:
        <entity>_id: The ID of the <entity>

    Returns:
        The <entity> instance

    Raises:
        <Entity>.DoesNotExist: If <entity> not found
    """
    return <Entity>.objects\
        .select_related('<related_field>')\
        .prefetch_related('<many_related_field>')\
        .get(id=<entity>_id)


def <entity>_get_or_none(*, <entity>_id: int) -> "<Entity>" | None:
    """Get a single <entity> by ID or return None if not found."""
    try:
        return <entity>_get(<entity>_id=<entity>_id)
    except <Entity>.DoesNotExist:
        return None
```
</template>

<template name="test-selector">
```python
from django.test import TestCase

from apps.<app>.models import <Entity>
from apps.<app>.selectors import <entity>_<action>


class <Entity><Action>Tests(TestCase):
    """Tests for <entity>_<action> selector."""

    def setUp(self):
        self.<entity>1 = <Entity>.objects.create(
            <field1>="test1",
            <field2>="value1",
        )
        self.<entity>2 = <Entity>.objects.create(
            <field1>="test2",
            <field2>="value2",
        )

    def test_<entity>_<action>_returns_all_objects(self):
        result = <entity>_<action>()
        self.assertEqual(result.count(), 2)

    def test_<entity>_<action>_filters_correctly(self):
        result = <entity>_<action>(filters={'<field1>': 'test1'})
        self.assertEqual(result.count(), 1)

    def test_<entity>_<action>_returns_empty_for_no_matches(self):
        result = <entity>_<action>(filters={'<field1>': 'nonexistent'})
        self.assertEqual(result.count(), 0)

    def test_<entity>_<action>_query_count(self):
        with self.assertNumQueries(1):
            list(<entity>_<action>())
```
</template>

### Query Optimization Guidelines

**Use select_related for:** OneToOneField, ForeignKey
**Use prefetch_related for:** ManyToManyField, Reverse ForeignKey (related_name)
**Use Prefetch() for:** Filtered prefetches, Nested prefetches
**Use annotate() for:** Counts, Aggregations (Sum, Avg, etc.), Conditional expressions

### Output

After generating:
1. Show the created selector code
2. Show the test code
3. Explain query optimizations applied
4. Suggest next steps (create API, test query count, etc.)

Now generate the requested Django selector.
