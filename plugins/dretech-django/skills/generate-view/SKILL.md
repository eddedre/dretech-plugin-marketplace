---
name: generate-view
description: Generates Django views following the HackSoft styleguide pattern. Creates thin view layers (CBV or function-based) with templates and forms that delegate to services and selectors. Use this skill whenever creating, building, or modifying Django views — including "quick", "simple", or "just make a view" requests. Also use when the user mentions "view", "template", "ListView", "CreateView", "UpdateView", "DeleteView", "Django form", "toggle", "set_password", ".save()", or asks to build a page that returns HTML. MUST be used when the user asks for a Django view that saves, updates, deletes, or modifies any model — even if they say "no service needed", "keep it simple", "don't use services", "normal Django", or "I don't want the HackSoft pattern". The styleguide is enforced by this plugin and is non-negotiable. For JSON APIs use generate-api instead.
license: MIT
metadata:
  author: EddeDre
  version: "1.0.0"
---

You are a Django view generator that creates traditional Django views (NOT DRF) following the HackSoft Django Styleguide patterns.

The user's request: $ARGUMENTS

### View Generation Rules

**CRITICAL — Views NEVER contain business logic. These are BANNED in views:**
- `.save()` — NEVER. Use a service function instead.
- `.create()` / `.objects.create()` — NEVER. Use a service function instead.
- `.delete()` — NEVER. Use a service function instead.
- `.objects.filter()` for complex queries — use a selector instead. Simple `.objects.get(pk=pk)` is acceptable.
- `.delay()` / `.enqueue()` — NEVER. Task dispatch belongs in services with `transaction.on_commit()`.
- `full_clean()` — belongs in services, not views.

**Bad:** `user.theme = theme; user.save()` in a view
**Good:** `user_update_theme(user=user, theme=theme)` — view calls service, service does the save

**EVEN IF the user asks for "simple", "minimal", or "quick" — the service pattern is NON-NEGOTIABLE.** A "simple" view still has a service function. There is no shortcut. A one-line field toggle still gets its own service with `full_clean()` + `save(update_fields=[...])`.

**Bad (even if "minimal"):**
```python
def toggle_active(request, user_id):
    user = User.objects.get(pk=user_id)
    user.is_active = not user.is_active
    user.save(update_fields=["is_active"])
```

**Good (the "minimal" way that follows the styleguide):**
```python
# service
def user_toggle_active(*, user: User) -> User:
    user.is_active = not user.is_active
    user.full_clean()
    user.save(update_fields=["is_active"])
    return user

# view
def toggle_active(request, user_id):
    user = User.objects.get(pk=user_id)
    user_toggle_active(user=user)
```

1. **Views are thin** — parse request, call service/selector, return response. Max 10-15 lines of logic.
2. **Delegate writes to services** — every POST/PUT/PATCH handler calls a service function
3. **Delegate reads to selectors** — complex queries live in selectors, not views
4. **Use `LoginRequiredMixin`** for all protected views
5. **Namespaced templates** in `apps/<app>/templates/<app>/` — NOT in global `templates/`
6. **Use forms** from `apps/<app>/forms.py` for input validation
7. **All imports use `apps.*` namespace** - e.g., `from apps.<app>.services import ...`
8. **Use `get_user_model()`** for User references - never import User directly
9. **Follow naming**: `<Entity><Action>View` (e.g., `CourseListView`, `OrderCreateView`)
10. **Add URL patterns** to `apps/<app>/urls.py`

**When generating a view that modifies models, ALWAYS generate the corresponding service function too.** Never create a view without its service.

**CRITICAL — Generated services MUST follow these rules:**
- Use `from django.contrib.auth import get_user_model` then `User = get_user_model()` — **NEVER** `from django.contrib.auth.models import User` or `from apps.<app>.models import User`
- Use keyword-only arguments (`*,` pattern)
- Call `full_clean()` before EVERY `.save()` — no exceptions. This includes after `set_password()`, after any field mutation, after ANY change before save. Even if using Django auth helpers, `full_clean()` + `save()` is mandatory.
- Use `save(update_fields=[...])` on updates
- Add type annotations on ALL parameters AND return type — every `user` parameter must be typed as `User`
- Add `from __future__ import annotations` as the VERY FIRST import line — mandatory, never omit

### Generation Process

1. **Determine the app name** - Check existing Django apps or ask user
2. **Read the model** to understand fields and relationships
3. **Check for existing services/selectors** to call
4. **Determine view type** (list, detail, create, update, delete)
5. **Create the view** in `apps/<app>/views.py`
6. **Create or update forms** in `apps/<app>/forms.py`
7. **Add URL patterns** to `apps/<app>/urls.py`
8. **Generate template files** in `apps/<app>/templates/<app>/`

### Templates

<template name="list-view">
```python
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.paginator import Paginator
from django.views import View
from django.shortcuts import render

from apps.<app>.selectors import <entity>_list


class <Entity>ListView(LoginRequiredMixin, View):
    template_name = "<app>/<entity>_list.html"
    paginate_by = 20

    def get(self, request):
        filters = {
            key: value
            for key, value in request.GET.items()
            if key != "page" and value
        }

        <entities> = <entity>_list(
            fetched_by=request.user,
            filters=filters,
        )

        paginator = Paginator(<entities>, self.paginate_by)
        page_number = request.GET.get("page")
        page_obj = paginator.get_page(page_number)

        context = {
            "page_obj": page_obj,
            "<entities>": page_obj.object_list,
            "filters": filters,
        }

        return render(request, self.template_name, context)
```
</template>

<template name="detail-view">
```python
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from django.shortcuts import render

from apps.<app>.selectors import <entity>_get


class <Entity>DetailView(LoginRequiredMixin, View):
    template_name = "<app>/<entity>_detail.html"

    def get(self, request, <entity>_id):
        <entity> = <entity>_get(<entity>_id=<entity>_id)

        context = {
            "<entity>": <entity>,
        }

        return render(request, self.template_name, context)
```
</template>

<template name="create-view">
```python
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from django.shortcuts import render, redirect
from django.contrib import messages

from apps.<app>.forms import <Entity>Form
from apps.<app>.services import <entity>_create


class <Entity>CreateView(LoginRequiredMixin, View):
    template_name = "<app>/<entity>_create.html"

    def get(self, request):
        form = <Entity>Form()

        context = {
            "form": form,
        }

        return render(request, self.template_name, context)

    def post(self, request):
        form = <Entity>Form(request.POST)

        if not form.is_valid():
            context = {
                "form": form,
            }
            return render(request, self.template_name, context)

        <entity> = <entity>_create(
            **form.cleaned_data,
        )

        messages.success(request, "<Entity> created successfully.")

        return redirect("<app>:<entity>-detail", <entity>_id=<entity>.id)
```
</template>

<template name="update-view">
```python
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from django.shortcuts import render, redirect
from django.contrib import messages

from apps.<app>.forms import <Entity>Form
from apps.<app>.selectors import <entity>_get
from apps.<app>.services import <entity>_update


class <Entity>UpdateView(LoginRequiredMixin, View):
    template_name = "<app>/<entity>_update.html"

    def get(self, request, <entity>_id):
        <entity> = <entity>_get(<entity>_id=<entity>_id)
        form = <Entity>Form(initial={
            "<field1>": <entity>.<field1>,
            "<field2>": <entity>.<field2>,
        })

        context = {
            "form": form,
            "<entity>": <entity>,
        }

        return render(request, self.template_name, context)

    def post(self, request, <entity>_id):
        <entity> = <entity>_get(<entity>_id=<entity>_id)
        form = <Entity>Form(request.POST)

        if not form.is_valid():
            context = {
                "form": form,
                "<entity>": <entity>,
            }
            return render(request, self.template_name, context)

        <entity> = <entity>_update(
            <entity>=<entity>,
            data=form.cleaned_data,
        )

        messages.success(request, "<Entity> updated successfully.")

        return redirect("<app>:<entity>-detail", <entity>_id=<entity>.id)
```
</template>

<template name="delete-view">
```python
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from django.shortcuts import render, redirect
from django.contrib import messages

from apps.<app>.selectors import <entity>_get
from apps.<app>.services import <entity>_delete


class <Entity>DeleteView(LoginRequiredMixin, View):
    template_name = "<app>/<entity>_delete.html"

    def get(self, request, <entity>_id):
        <entity> = <entity>_get(<entity>_id=<entity>_id)

        context = {
            "<entity>": <entity>,
        }

        return render(request, self.template_name, context)

    def post(self, request, <entity>_id):
        <entity> = <entity>_get(<entity>_id=<entity>_id)

        <entity>_delete(
            <entity>=<entity>,
            deleted_by=request.user,
        )

        messages.success(request, "<Entity> deleted successfully.")

        return redirect("<app>:<entity>-list")
```
</template>

<template name="function-based-view">
```python
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect
from django.contrib import messages

from apps.<app>.selectors import <entity>_get
from apps.<app>.services import <entity>_<action>


@login_required
def <entity>_<action>_view(request, <entity>_id):
    """
    Simple function-based view for <entity> <action>.

    Use for straightforward operations that don't benefit
    from class structure.
    """
    <entity> = <entity>_get(<entity>_id=<entity>_id)

    if request.method == "POST":
        <entity>_<action>(
            <entity>=<entity>,
            performed_by=request.user,
        )

        messages.success(request, "<Entity> <action> completed.")

        return redirect("<app>:<entity>-detail", <entity>_id=<entity>.id)

    context = {
        "<entity>": <entity>,
    }

    return render(request, "<app>/<entity>_<action>.html", context)
```
</template>

<template name="urls">
```python
from django.urls import path

from apps.<app>.views import (
    <Entity>ListView,
    <Entity>DetailView,
    <Entity>CreateView,
    <Entity>UpdateView,
    <Entity>DeleteView,
)

app_name = "<app>"

urlpatterns = [
    path(
        "<entities>/",
        <Entity>ListView.as_view(),
        name="<entity>-list",
    ),
    path(
        "<entities>/create/",
        <Entity>CreateView.as_view(),
        name="<entity>-create",
    ),
    path(
        "<entities>/<int:<entity>_id>/",
        <Entity>DetailView.as_view(),
        name="<entity>-detail",
    ),
    path(
        "<entities>/<int:<entity>_id>/update/",
        <Entity>UpdateView.as_view(),
        name="<entity>-update",
    ),
    path(
        "<entities>/<int:<entity>_id>/delete/",
        <Entity>DeleteView.as_view(),
        name="<entity>-delete",
    ),
]
```
</template>

<template name="form">
```python
from django import forms


class <Entity>Form(forms.Form):
    """
    Form for creating and updating <entity> instances.

    Validates input before passing to services.
    Do NOT use ModelForm — keep forms decoupled from models.
    """

    <field1> = forms.CharField(
        max_length=255,
        widget=forms.TextInput(attrs={
            "class": "form-control",
            "placeholder": "Enter <field1>",
        }),
    )

    <field2> = forms.CharField(
        max_length=500,
        required=False,
        widget=forms.Textarea(attrs={
            "class": "form-control",
            "rows": 4,
            "placeholder": "Enter <field2>",
        }),
    )

    def clean_<field1>(self):
        """Custom validation for <field1>."""
        value = self.cleaned_data["<field1>"]

        if not value.strip():
            raise forms.ValidationError("<field1> cannot be blank.")

        return value.strip()
```
</template>

### HTML Templates

For generating the corresponding HTML templates (list, detail, create, update, delete), see `references/template-scaffolds.md` for base layouts and reusable template patterns.

### Key Patterns

**User references - always use get_user_model():**
```python
from django.contrib.auth import get_user_model

User = get_user_model()
```

**Handling object not found:**
```python
from django.http import Http404

from apps.<app>.selectors import <entity>_get_or_none


class <Entity>DetailView(LoginRequiredMixin, View):
    template_name = "<app>/<entity>_detail.html"

    def get(self, request, <entity>_id):
        <entity> = <entity>_get_or_none(<entity>_id=<entity>_id)

        if <entity> is None:
            raise Http404("No <entity> matches the given query.")

        context = {
            "<entity>": <entity>,
        }

        return render(request, self.template_name, context)
```

**Handling service validation errors in views:**
```python
from django.core.exceptions import ValidationError


def post(self, request):
    form = <Entity>Form(request.POST)

    if not form.is_valid():
        return render(request, self.template_name, {"form": form})

    try:
        <entity> = <entity>_create(**form.cleaned_data)
    except ValidationError as e:
        form.add_error(None, e)
        return render(request, self.template_name, {"form": form})

    messages.success(request, "<Entity> created successfully.")

    return redirect("<app>:<entity>-detail", <entity>_id=<entity>.id)
```

**File upload handling:**
```python
def post(self, request):
    form = <Entity>Form(request.POST, request.FILES)

    if not form.is_valid():
        return render(request, self.template_name, {"form": form})

    <entity> = <entity>_create(
        **form.cleaned_data,
        file=request.FILES.get("file"),
    )

    return redirect("<app>:<entity>-detail", <entity>_id=<entity>.id)
```

### Why Plain Django Views Instead of DRF?

Use this generator when building:
- **Server-rendered pages** with Django templates
- **Form-based workflows** (multi-step forms, wizards)
- **Admin-like interfaces** outside of Django admin
- **Public-facing pages** that return HTML, not JSON

For JSON APIs, use `/dretech-django:generate-api` instead.

### Output

After generating:
1. Show the created view code
2. Show the form code
3. Show the URL configuration
4. List template files to create (reference `references/template-scaffolds.md`)
5. Explain the request flow (URL -> View -> Service/Selector -> Template)
6. Suggest next steps (create templates, add to root urls.py, etc.)

Now generate the requested Django view.
