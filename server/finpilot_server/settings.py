"""Paramètres du serveur FINPILOT. Tout se configure par variables d'environnement."""
import os
from datetime import timedelta
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in ("1", "true", "yes", "on")


def env_list(name: str, default: str = "") -> list[str]:
    return [x.strip() for x in os.environ.get(name, default).split(",") if x.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
import sys  # noqa: E402

_TESTING = "pytest" in sys.modules or "test" in sys.argv
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or ("dev-insecure-key-for-local-tests-only-0123456789" if DEBUG or _TESTING else "")
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY doit être défini en production.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
_render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "")
if _render_host and _render_host not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(_render_host)
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "sync",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "finpilot_server.urls"
WSGI_APPLICATION = "finpilot_server.wsgi.application"
TEMPLATES: list = []

DATABASES = {
    "default": dj_database_url.config(default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=60)
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Europe/Paris"
USE_TZ = True

# Les documents justificatifs voyagent dans la synchro : on accepte des requêtes plus grosses.
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get("FINPILOT_MAX_REQUEST_MB", "40")) * 1024 * 1024

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_RATES": {"auth": os.environ.get("FINPILOT_AUTH_RATE", "10/min"), "user": "600/min"},
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.UserRateThrottle"],
    "EXCEPTION_HANDLER": "rest_framework.views.exception_handler",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.environ.get("FINPILOT_SESSION_DAYS", "30"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

CORS_ALLOWED_ORIGINS = env_list("FINPILOT_CORS_ORIGINS")
CORS_ALLOW_ALL_ORIGINS = DEBUG and not CORS_ALLOWED_ORIGINS

# Inscription : "invite" (code requis, par défaut), "open" (libre) ou "closed". Le tout premier compte devient administrateur.
FINPILOT_REGISTRATION = os.environ.get("FINPILOT_REGISTRATION", "invite").lower()
FINPILOT_QUOTA_MB = int(os.environ.get("FINPILOT_QUOTA_MB", "250"))
FINPILOT_PUBLIC_URL = os.environ.get("FINPILOT_PUBLIC_URL", "")

# Courriel (facultatif) : pour envoyer les codes de réinitialisation de mot de passe
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "FINPILOT <no-reply@localhost>")
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend" if EMAIL_HOST else "django.core.mail.backends.locmem.EmailBackend"

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
if not DEBUG:
    SECURE_HSTS_SECONDS = 31536000

LOGGING = {
    "version": 1,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
}
