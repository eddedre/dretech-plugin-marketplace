# Template Scaffolds

HTML template examples for common Django view patterns. All templates extend `base.html` and use Bootstrap 5 classes by default.

## List Template

```html
{# apps/<app>/templates/<app>/<entity>_list.html #}
{% extends "base.html" %}

{% block title %}<Entity> List{% endblock %}

{% block content %}
<div class="container mt-4">
    <div class="d-flex justify-content-between align-items-center mb-3">
        <h1><Entity> List</h1>
        <a href="{% url '<app>:<entity>-create' %}" class="btn btn-primary">
            Create <Entity>
        </a>
    </div>

    {% if page_obj %}
    <div class="table-responsive">
        <table class="table table-striped">
            <thead>
                <tr>
                    <th><Field1></th>
                    <th><Field2></th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                {% for obj in page_obj %}
                <tr>
                    <td>{{ obj.field1 }}</td>
                    <td>{{ obj.field2 }}</td>
                    <td>{{ obj.created_at|date:"M d, Y" }}</td>
                    <td>
                        <a href="{% url '<app>:<entity>-detail' obj.id %}" class="btn btn-sm btn-outline-primary">View</a>
                        <a href="{% url '<app>:<entity>-update' obj.id %}" class="btn btn-sm btn-outline-secondary">Edit</a>
                    </td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
    </div>

    {% include "_pagination.html" with page_obj=page_obj %}

    {% else %}
    <p class="text-muted">No <entities> found.</p>
    {% endif %}
</div>
{% endblock %}
```

## Detail Template

```html
{# apps/<app>/templates/<app>/<entity>_detail.html #}
{% extends "base.html" %}

{% block title %}{{ <entity>.field1 }}{% endblock %}

{% block content %}
<div class="container mt-4">
    <nav aria-label="breadcrumb">
        <ol class="breadcrumb">
            <li class="breadcrumb-item"><a href="{% url '<app>:<entity>-list' %}"><Entities></a></li>
            <li class="breadcrumb-item active">{{ <entity>.field1 }}</li>
        </ol>
    </nav>

    <div class="card">
        <div class="card-header d-flex justify-content-between align-items-center">
            <h2>{{ <entity>.field1 }}</h2>
            <div>
                <a href="{% url '<app>:<entity>-update' <entity>.id %}" class="btn btn-outline-secondary">Edit</a>
                <a href="{% url '<app>:<entity>-delete' <entity>.id %}" class="btn btn-outline-danger">Delete</a>
            </div>
        </div>
        <div class="card-body">
            <dl class="row">
                <dt class="col-sm-3">Field 1</dt>
                <dd class="col-sm-9">{{ <entity>.field1 }}</dd>

                <dt class="col-sm-3">Field 2</dt>
                <dd class="col-sm-9">{{ <entity>.field2 }}</dd>

                <dt class="col-sm-3">Created</dt>
                <dd class="col-sm-9">{{ <entity>.created_at|date:"M d, Y H:i" }}</dd>
            </dl>
        </div>
    </div>
</div>
{% endblock %}
```

## Form Template (Create / Update)

```html
{# apps/<app>/templates/<app>/<entity>_form.html #}
{% extends "base.html" %}
{% load crispy_forms_tags %}

{% block title %}{% if form.instance.pk %}Edit{% else %}Create{% endif %} <Entity>{% endblock %}

{% block content %}
<div class="container mt-4">
    <nav aria-label="breadcrumb">
        <ol class="breadcrumb">
            <li class="breadcrumb-item"><a href="{% url '<app>:<entity>-list' %}"><Entities></a></li>
            <li class="breadcrumb-item active">
                {% if form.instance.pk %}Edit{% else %}Create{% endif %}
            </li>
        </ol>
    </nav>

    <div class="card">
        <div class="card-header">
            <h2>{% if form.instance.pk %}Edit{% else %}Create{% endif %} <Entity></h2>
        </div>
        <div class="card-body">
            <form method="post">
                {% csrf_token %}
                {{ form|crispy }}
                <div class="mt-3">
                    <button type="submit" class="btn btn-primary">
                        {% if form.instance.pk %}Update{% else %}Create{% endif %}
                    </button>
                    <a href="{% url '<app>:<entity>-list' %}" class="btn btn-outline-secondary">Cancel</a>
                </div>
            </form>
        </div>
    </div>
</div>
{% endblock %}
```

## Delete Confirmation Template

```html
{# apps/<app>/templates/<app>/<entity>_confirm_delete.html #}
{% extends "base.html" %}

{% block title %}Delete {{ <entity>.field1 }}{% endblock %}

{% block content %}
<div class="container mt-4">
    <div class="card border-danger">
        <div class="card-header bg-danger text-white">
            <h2>Confirm Delete</h2>
        </div>
        <div class="card-body">
            <p>Are you sure you want to delete <strong>{{ <entity>.field1 }}</strong>?</p>
            <p class="text-muted">This action cannot be undone.</p>

            <form method="post">
                {% csrf_token %}
                <button type="submit" class="btn btn-danger">Delete</button>
                <a href="{% url '<app>:<entity>-detail' <entity>.id %}" class="btn btn-outline-secondary">Cancel</a>
            </form>
        </div>
    </div>
</div>
{% endblock %}
```

## Pagination Partial

```html
{# templates/_pagination.html #}
{% if page_obj.has_other_pages %}
<nav aria-label="Page navigation" class="mt-3">
    <ul class="pagination justify-content-center">
        {% if page_obj.has_previous %}
        <li class="page-item">
            <a class="page-link" href="?page={{ page_obj.previous_page_number }}{% if query_string %}&{{ query_string }}{% endif %}">
                &laquo; Previous
            </a>
        </li>
        {% else %}
        <li class="page-item disabled">
            <span class="page-link">&laquo; Previous</span>
        </li>
        {% endif %}

        {% for num in page_obj.paginator.page_range %}
            {% if page_obj.number == num %}
            <li class="page-item active">
                <span class="page-link">{{ num }}</span>
            </li>
            {% elif num > page_obj.number|add:"-3" and num < page_obj.number|add:"3" %}
            <li class="page-item">
                <a class="page-link" href="?page={{ num }}{% if query_string %}&{{ query_string }}{% endif %}">{{ num }}</a>
            </li>
            {% endif %}
        {% endfor %}

        {% if page_obj.has_next %}
        <li class="page-item">
            <a class="page-link" href="?page={{ page_obj.next_page_number }}{% if query_string %}&{{ query_string }}{% endif %}">
                Next &raquo;
            </a>
        </li>
        {% else %}
        <li class="page-item disabled">
            <span class="page-link">Next &raquo;</span>
        </li>
        {% endif %}
    </ul>
</nav>
{% endif %}
```

## Conventions

- All templates extend `base.html`
- Use `{% load crispy_forms_tags %}` for form rendering
- Templates are namespaced: `apps/<app>/templates/<app>/<entity>_<action>.html`
- Use Bootstrap 5 classes for consistent styling
- Always include `{% csrf_token %}` in forms
- Use breadcrumb navigation for context
- Add pagination for list views using `_pagination.html` partial
