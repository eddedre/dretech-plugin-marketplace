# Django Security Reference

Comprehensive security practices for Django projects, organized by enforcement layer.

## 1. Already Enforced by Plugin

These are automatically checked by the pre-tool hook:

| Practice | Enforcement |
|----------|-------------|
| Per-app secrets (not global settings) | Hook checks `config/django/base.py` writes |
| Never log passwords, tokens, PII | Hook blocks `logger.*password/secret/token` |
| Never expose stack traces in responses | Hook blocks `str(e)` in Response |
| Services call `full_clean()` before `save()` | Hook blocks missing validation |
| Celery tasks delegate to services | Hook blocks `.save()` in tasks |
| `transaction.on_commit()` for async tasks | Hook blocks `.delay()` outside `on_commit` |

## 2. Django Settings Checklist

Required in `config/django/production.py`:

```python
# --- Security ---
DEBUG = False
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]  # Never hardcode

# --- HTTPS ---
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# --- HSTS ---
SECURE_HSTS_SECONDS = 31536000        # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# --- Cookies ---
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True

# --- Headers ---
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin"

# --- Auth ---
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- Sessions ---
SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_AGE = 1209600  # 2 weeks
```

## 3. Service-Level Security Patterns

### Never Log Sensitive Data

```python
# BAD
logger.info(f"User login: {email}, password: {password}")
logger.debug(f"API call with key: {api_key}")

# GOOD
logger.info("User login attempt", extra={"email": email})
logger.debug("API call initiated")
```

### Never Expose Exceptions in Responses

```python
# BAD — leaks internals (DB schema, file paths, library versions)
except Exception as e:
    return Response({"error": str(e)}, status=500)

# GOOD — log internally, return generic message
except Exception:
    logger.exception("Unexpected error in payment processing")
    return Response({"message": "An error occurred"}, status=500)
```

### Timing-Safe Token Comparison

```python
import hmac

# BAD — vulnerable to timing attacks
if user_token == stored_token:
    grant_access()

# GOOD — constant-time comparison
if hmac.compare_digest(user_token, stored_token):
    grant_access()
```

### File Upload Security

```python
def file_upload(*, user: "User", file_obj) -> "File":
    # Validate file type
    allowed_types = {"image/jpeg", "image/png", "application/pdf"}
    if file_obj.content_type not in allowed_types:
        raise ValidationError("File type not allowed")

    # Validate file size
    max_size = 10 * 1024 * 1024  # 10MB
    if file_obj.size > max_size:
        raise ValidationError("File too large")

    # Strip EXIF/metadata in service layer
    cleaned_file = strip_metadata(file_obj)

    obj = File(file=cleaned_file, uploaded_by=user)
    obj.full_clean()
    obj.save()
    return obj
```

### Rate Limiting

```python
# In DRF APIs — use throttle classes
from rest_framework.throttling import UserRateThrottle

class BurstRateThrottle(UserRateThrottle):
    rate = "10/minute"

class CourseCreateApi(APIView):
    throttle_classes = [BurstRateThrottle]
    # ...
```

### SQL Injection Prevention

```python
# BAD — raw SQL with string formatting
User.objects.raw(f"SELECT * FROM users WHERE name = '{name}'")

# GOOD — parameterized queries
User.objects.raw("SELECT * FROM users WHERE name = %s", [name])

# BEST — use ORM
User.objects.filter(name=name)
```

## 4. Input Validation

### Serializer Validation (DRF)

```python
class InputSerializer(serializers.Serializer):
    email = serializers.EmailField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    url = serializers.URLField(required=False)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be positive")
        return value
```

### Form Validation (Django)

```python
class IdeaForm(forms.ModelForm):
    class Meta:
        model = Idea
        fields = ["title", "description"]

    def clean_title(self):
        title = self.cleaned_data["title"]
        if len(title) < 3:
            raise ValidationError("Title must be at least 3 characters")
        return title
```

## 5. Infrastructure & Deployment (Not Enforced by Plugin)

These are outside Django code but important for overall security:

- **CORS**: Configure `django-cors-headers` with specific origins, not `CORS_ALLOW_ALL_ORIGINS = True`
- **CSP**: Use `django-csp` to set Content-Security-Policy headers
- **Database**: Use SSL connections, rotate credentials, least-privilege DB users
- **Static files**: Serve via CDN/reverse proxy, not Django in production
- **Dependencies**: Run `pip-audit` or `safety check` in CI
- **Secrets management**: Use vault/cloud secret managers in production, `os.environ` in code
- **Backups**: Automated, encrypted, tested restoration
- **Logging**: Centralized logging (ELK, Datadog), never log to local files in production
- **2FA**: Consider `django-otp` or `django-allauth` for admin accounts

## Summary

| Layer | Responsibility |
|-------|---------------|
| Plugin hook | Catches obvious violations at code-write time |
| Django settings | Framework-level security (HTTPS, cookies, headers) |
| Services | Input validation, safe logging, constant-time comparisons |
| Infrastructure | CORS, CSP, database security, dependency scanning |
