---
name: generate-service
description: Generates Django services following the HackSoft styleguide pattern. Creates service functions or classes for handling write operations with proper validation and structure. Use this skill whenever creating business logic functions, write operations, or any function that creates, updates, or deletes database records. Also use when the user mentions "service", "business logic", "full_clean", "transaction.atomic", "create_user", "set_password", ".delay()", ".enqueue()", "send email task", "background task", "Celery task", or asks where to put write logic in a Django project. MUST be used for any Django function that calls .save(), .create(), .delete(), .update(), .delay(), or .enqueue() — even if the user says "just" or "simple".
license: MIT
metadata:
  author: EddeDre
  version: "1.0.0"
---

You are a Django service generator that creates services following the HackSoft Django Styleguide patterns.

The user's request: $ARGUMENTS

### Pre-Generation Checklist

Before writing any service code, verify you will include ALL of the following. If ANY is missing, the output is wrong:

- [ ] `from __future__ import annotations` as the VERY FIRST import line
- [ ] `*,` keyword-only arguments in function signature
- [ ] Type annotations on ALL parameters AND return type
- [ ] `full_clean()` before EVERY `.save()` call — no exceptions, even for `set_password()` + `save()`
- [ ] `save(update_fields=[...])` on updates (not creates)
- [ ] `transaction.on_commit()` wrapping every `.delay()` / `.enqueue()`
- [ ] `get_user_model()` instead of direct User import
- [ ] `apps.*` namespace for all imports

### Service Generation Rules

1. **Always use keyword-only arguments** (the `*,` pattern, unless 0-1 args)
2. **Add type annotations** for ALL parameters AND return types — no exceptions
3. **ALWAYS add `from __future__ import annotations`** as the VERY FIRST import line in every services.py — this is mandatory, never omit it
4. **Follow naming**: `<entity>_<action>` (e.g., `user_create`, `order_complete`)
5. **Call `full_clean()` before EVERY `.save()`** — use `full_clean(exclude=["status"])` for FSM-protected fields. This includes after `set_password()`, after bulk field updates, after ANY mutation before save.
6. **Use `.save(update_fields=[...])`** on updates — never bare `.save()` on existing objects
7. **Return the created/updated object**
8. **Handle transactions** when coordinating multiple operations
9. **Wrap `.delay()` and `.enqueue()` in `transaction.on_commit()`** — never dispatch tasks against uncommitted data
10. **Use `get_user_model()`** instead of importing User directly from `django.contrib.auth.models`
11. **Add logging** with `import logging` and `logger = logging.getLogger(__name__)`
12. **Use `apps.*` namespace** for all imports: `from apps.<app>.models import <Entity>`

**CRITICAL: Every model mutation in the project MUST go through a service function.** If a view needs to modify a model, create a service for it. Views NEVER call `.save()`, `.create()`, `.delete()` directly.

### Generation Process

1. **Determine the app name** - Check existing Django apps or ask user
2. **Check for existing models** - Read the model to understand fields
3. **Determine service complexity**:
   - Simple? -> Function-based service
   - Complex multi-step? -> Class-based service
4. **Create the service file** in `apps/<app>/services.py` or `apps/<app>/services/<action>.py`
5. **Add imports** (models, typing, exceptions, transaction, logging, etc.)
6. **Generate tests** in `apps/<app>/tests/services/test_<entity>_<action>.py`

### Templates

<template name="function-based-create">
```python
import logging

from django.db import transaction
from django.contrib.auth import get_user_model
from typing import TYPE_CHECKING

from apps.<app>.models import <Entity>

User = get_user_model()
logger = logging.getLogger(__name__)


@transaction.atomic
def <entity>_create(
    *,
    <field1>: <type>,
    <field2>: <type>,
) -> <Entity>:
    """
    Create a new <entity> with the provided data.

    Args:
        <field1>: Description
        <field2>: Description

    Returns:
        The created <entity> instance

    Raises:
        ValidationError: If validation fails
    """
    <entity> = <Entity>(
        <field1>=<field1>,
        <field2>=<field2>,
    )

    <entity>.full_clean()
    <entity>.save()

    logger.info("Created <entity> with id=%s", <entity>.id)

    # Trigger related operations
    # <related_service>(...)

    return <entity>
```
</template>

<template name="function-based-update">
```python
import logging

from django.db import transaction
from django.contrib.auth import get_user_model
from typing import TYPE_CHECKING

from apps.<app>.models import <Entity>

User = get_user_model()
logger = logging.getLogger(__name__)


@transaction.atomic
def <entity>_update(
    *,
    <entity>: <Entity>,
    data: dict,
) -> <Entity>:
    """
    Update an existing <entity> with the provided data.

    Args:
        <entity>: The <entity> instance to update
        data: Dictionary of fields to update

    Returns:
        The updated <entity> instance
    """
    non_side_effect_fields = [
        '<field1>',
        '<field2>',
    ]

    <entity>, has_updated = model_update(
        instance=<entity>,
        fields=non_side_effect_fields,
        data=data
    )

    # Handle side-effects only if something changed
    if has_updated:
        logger.info("Updated <entity> id=%s, fields=%s", <entity>.id, list(data.keys()))

        # Send notifications, trigger tasks, etc.
        transaction.on_commit(
            lambda: <some_task>.delay(<entity>.id)
        )

    return <entity>
```
</template>

<template name="class-based-complex">
```python
import logging

from django.db import transaction
from django.contrib.auth import get_user_model

from apps.<app>.models import <Entity>

User = get_user_model()
logger = logging.getLogger(__name__)


class <Entity><Action>Service:
    """
    Handle complex <entity> <action> operation with multiple steps.
    """

    def __init__(
        self,
        *,
        user: User,
        <param1>: <type>,
        <param2>: <type>,
    ):
        self.user = user
        self.<param1> = <param1>
        self.<param2> = <param2>

    @transaction.atomic
    def execute(self) -> <Entity>:
        """
        Execute the <action> operation.

        Returns:
            The created/updated <entity> instance
        """
        self._validate()
        <entity> = self._create_<entity>()
        self._handle_related_operations(<entity>)
        self._trigger_notifications(<entity>)

        logger.info(
            "<Entity> <action> completed by user=%s, id=%s",
            self.user.id,
            <entity>.id,
        )

        return <entity>

    def _validate(self) -> None:
        """Validate preconditions."""
        pass

    def _create_<entity>(self) -> <Entity>:
        """Create the main <entity> object."""
        <entity> = <Entity>(
            <field1>=self.<param1>,
            <field2>=self.<param2>,
            created_by=self.user,
        )
        <entity>.full_clean()
        <entity>.save()
        return <entity>

    def _handle_related_operations(self, <entity>: <Entity>) -> None:
        """Handle related operations."""
        pass

    def _trigger_notifications(self, <entity>: <Entity>) -> None:
        """Trigger async notifications."""
        transaction.on_commit(
            lambda: <notification_task>.delay(<entity>.id)
        )
```
</template>

<template name="test-service">
```python
from django.test import TestCase
from django.contrib.auth import get_user_model
from unittest.mock import patch

from apps.<app>.models import <Entity>
from apps.<app>.services import <entity>_<action>

User = get_user_model()


class <Entity><Action>Tests(TestCase):
    """Tests for <entity>_<action> service."""

    def test_<entity>_<action>_creates_<entity>_with_correct_data(self):
        """Test that <entity> is created with correct data."""
        <field1> = "test value"
        <field2> = "test value 2"

        <entity> = <entity>_<action>(
            <field1>=<field1>,
            <field2>=<field2>,
        )

        self.assertEqual(<entity>.<field1>, <field1>)
        self.assertEqual(<entity>.<field2>, <field2>)
        self.assertIsNotNone(<entity>.id)

    def test_<entity>_<action>_validates_data(self):
        """Test that invalid data raises ValidationError."""
        from django.core.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            <entity>_<action>(
                <field1>="",  # Invalid
                <field2>="test",
            )

    @patch('apps.<app>.tasks.<task_name>.delay')
    def test_<entity>_<action>_triggers_<task>(self, mock_task):
        """Test that async task is triggered on transaction commit."""
        <entity> = <entity>_<action>(
            <field1>="test",
            <field2>="test2",
        )

        # Tasks triggered via transaction.on_commit execute immediately in tests
        mock_task.assert_called_once_with(<entity>.id)
```
</template>

### Workflow

1. **Read the model file** to understand fields
2. **Ask for clarification if needed**:
   - Which fields are required?
   - Are there any related operations?
   - Should we trigger any async tasks?
   - Is validation needed beyond model validation?
3. **Generate the service** (function-based or class-based)
4. **Generate tests**
5. **Create or update files**

### Common Patterns

**Create with related operations:**
```python
import logging

from django.db import transaction
from django.contrib.auth import get_user_model

from apps.users.models import Profile

User = get_user_model()
logger = logging.getLogger(__name__)


@transaction.atomic
def user_create(*, email: str, name: str) -> User:
    user = User(email=email)
    user.full_clean()
    user.save()

    profile_create(user=user, name=name)

    transaction.on_commit(
        lambda: welcome_email_send_task.delay(user.id)
    )

    logger.info("Created user id=%s, email=%s", user.id, user.email)

    return user
```

**Update with side-effects:**
```python
import logging

from django.db import transaction
from django.utils import timezone

from apps.orders.models import Order

logger = logging.getLogger(__name__)


@transaction.atomic
def order_complete(*, order: Order) -> Order:
    if order.status == Order.Status.COMPLETED:
        raise ApplicationError("Order already completed")

    order.status = Order.Status.COMPLETED
    order.completed_at = timezone.now()
    order.full_clean()
    order.save(update_fields=['status', 'completed_at'])

    transaction.on_commit(
        lambda: order_completion_notification_task.delay(order.id)
    )

    logger.info("Completed order id=%s", order.id)

    return order
```

**Delete with validation:**
```python
import logging

from django.contrib.auth import get_user_model

from apps.courses.models import Course

User = get_user_model()
logger = logging.getLogger(__name__)


def course_delete(*, course: Course, deleted_by: User) -> None:
    if course.students.exists():
        raise ApplicationError(
            "Cannot delete course with enrolled students"
        )

    course_id = course.id
    course.delete()

    audit_log_create(
        action="course_deleted",
        user=deleted_by,
        resource_id=course_id,
    )

    logger.info("Deleted course id=%s by user=%s", course_id, deleted_by.id)
```

**Create with full_clean exclude (fields set by signals/defaults):**
```python
import logging

from django.db import transaction

from apps.billing.models import Invoice

logger = logging.getLogger(__name__)


@transaction.atomic
def invoice_create(
    *,
    order_id: int,
    amount: int,
    currency: str,
) -> Invoice:
    invoice = Invoice(
        order_id=order_id,
        amount=amount,
        currency=currency,
    )

    # Exclude 'invoice_number' because it is set by a pre_save signal
    invoice.full_clean(exclude=["invoice_number"])
    invoice.save()

    logger.info("Created invoice id=%s for order=%s", invoice.id, order_id)

    return invoice
```

**Importing per-app settings:**
```python
from apps.<app>.settings import get_<secret>

api_key = get_<secret>()
```

### Output

After generating:
1. Show the created service code
2. Show the test code
3. Explain the key decisions
4. Suggest next steps (create API, add to URLs, etc.)

Now generate the requested Django service.
