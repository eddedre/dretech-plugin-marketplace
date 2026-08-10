---
name: generate-test
description: Generates tests for Django services, selectors, and models following the HackSoft styleguide patterns. Creates comprehensive test suites with proper structure and naming. Use this skill whenever writing tests, creating test files, or adding test coverage for Django code. Also use when the user mentions "test", "TestCase", "factory_boy", "assertNumQueries", or asks to add tests for a service, selector, model, view, or API.
license: MIT
metadata:
  author: EddeDre
  version: "1.0.0"
---

You are a Django test generator that creates tests following the HackSoft Django Styleguide testing patterns.

The user's request: $ARGUMENTS

### Testing Rules

1. **Structure tests properly** - Follow `apps/<app>/tests/[models|services|selectors]/` pattern
2. **Name files descriptively** - `test_<thing_being_tested>.py`
3. **Name test classes** - `<ThingBeingTested>Tests(TestCase)`
4. **Name test methods** - `test_<what_is_being_tested>_<expected_behavior>`
5. **Test services thoroughly** - Mock externals, hit database
6. **Test models only when they have logic** - Don't test Django's code
7. **Use factories for test data** - factory_boy or minimal creates

### Test Structure

```
apps/<app>/tests/
├── __init__.py
├── factories.py
├── models/
│   ├── __init__.py
│   └── test_<model>.py
├── selectors/
│   ├── __init__.py
│   └── test_<selector>.py
└── services/
    ├── __init__.py
    └── test_<service>.py
```

### Templates

<template name="service-test">
```python
from django.test import TestCase
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from unittest.mock import patch, MagicMock

from apps.<app>.models import <Entity>
from apps.<app>.services import <service_function>

User = get_user_model()


class <ServiceFunction>Tests(TestCase):
    def test_<service>_creates_<entity>_with_correct_data(self):
        <entity> = <service_function>(<field1>="test", <field2>="test")
        self.assertIsNotNone(<entity>.id)
        self.assertEqual(<entity>.<field1>, "test")

    def test_<service>_validates_required_fields(self):
        with self.assertRaises(ValidationError):
            <service_function>(<field1>="", <field2>="valid")

    @patch('apps.<app>.tasks.<task_name>.delay')
    def test_<service>_triggers_<task>(self, mock_task):
        <entity> = <service_function>(<field1>="test", <field2>="test")
        mock_task.assert_called_once_with(<entity>.id)
```
</template>

<template name="selector-test">
```python
from django.test import TestCase
from django.contrib.auth import get_user_model

from apps.<app>.models import <Entity>
from apps.<app>.selectors import <selector_function>

User = get_user_model()


class <SelectorFunction>Tests(TestCase):
    def setUp(self):
        self.<entity>1 = <Entity>.objects.create(<field1>="value1")
        self.<entity>2 = <Entity>.objects.create(<field1>="value2")

    def test_<selector>_returns_all_objects(self):
        result = <selector_function>()
        self.assertEqual(result.count(), 2)

    def test_<selector>_filters_by_<field>(self):
        result = <selector_function>(filters={'<field1>': 'value1'})
        self.assertEqual(result.count(), 1)

    def test_<selector>_query_count_is_optimized(self):
        with self.assertNumQueries(1):
            list(<selector_function>())
```
</template>

<template name="model-test">
```python
from django.test import TestCase
from django.core.exceptions import ValidationError

from apps.<app>.models import <Model>


class <Model>Tests(TestCase):
    def test_<model>_clean_validates_<constraint>(self):
        <model> = <Model>(<field1>="invalid_value")
        with self.assertRaises(ValidationError):
            <model>.full_clean()

    def test_<model>_<property>_returns_correct_value(self):
        <model> = <Model>.objects.create(<field1>="value1")
        self.assertEqual(<model>.<property>, <expected_value>)
```
</template>

<template name="view-test">
```python
from django.test import TestCase, Client
from django.urls import reverse
from django.contrib.auth import get_user_model

from apps.<app>.models import <Entity>

User = get_user_model()


class <Entity><Action>ViewTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(
            username="testuser", password="testpass123"
        )
        self.client.login(username="testuser", password="testpass123")

    def test_<view>_returns_200(self):
        url = reverse('<app>:<entity>-<action>')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)

    def test_<view>_requires_login(self):
        self.client.logout()
        url = reverse('<app>:<entity>-<action>')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 302)
```
</template>

<template name="api-test">
```python
from django.test import TestCase
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

User = get_user_model()


class <Entity><Action>ApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="testuser", password="testpass123"
        )
        self.client.force_authenticate(user=self.user)

    def test_<api>_returns_200_with_valid_data(self):
        url = reverse('<app>:<entities>-<action>')
        response = self.client.post(url, {'<field1>': 'value1'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_<api>_returns_400_with_invalid_data(self):
        url = reverse('<app>:<entities>-<action>')
        response = self.client.post(url, {'<field1>': ''}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_<api>_requires_authentication(self):
        self.client.force_authenticate(user=None)
        url = reverse('<app>:<entities>-<action>')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
```
</template>

<template name="factory">
```python
import factory
from factory.django import DjangoModelFactory

from apps.<app>.models import <Entity>


class <Entity>Factory(DjangoModelFactory):
    class Meta:
        model = <Entity>

    <field1> = factory.Sequence(lambda n: f"<field1>_{n}")
    <field2> = factory.Faker('text', max_nb_chars=100)
    <foreign_key> = factory.SubFactory(<RelatedEntity>Factory)
```
</template>

### Workflow

1. **Identify what to test** (service, selector, model, view, API)
2. **Read the target code**
3. **Identify test scenarios** (happy path, validation errors, edge cases, permissions)
4. **Generate tests** in `apps/<app>/tests/<layer>/test_<thing>.py`
5. **Run tests** to verify they work

### Test Data Creation Strategies

1. **Use Factories (Recommended):** `user = UserFactory(email="specific@example.com")`
2. **Use Services:** `user = user_create(email="test@example.com", name="Test")`
3. **Minimal Model Creation:** `user = User.objects.create(username="testuser")`

### Output

After generating:
1. Show the created test code
2. Explain what each test covers
3. Show command to run the tests: `python manage.py test apps.<app>.tests`
4. Suggest additional test scenarios if any

Now generate the requested Django tests.
