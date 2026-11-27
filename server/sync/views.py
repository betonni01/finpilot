import re
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .accounts import quota_bytes, register_user, registration_mode
from .models import PushSubscription, Reminder, SyncRecord, Vault
from .throttles import AuthThrottle

User = get_user_model()
TABLE_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{0,39}$")
MAX_BATCH = 500
PULL_LIMIT = 500


class LoginView(TokenObtainPairView):
    throttle_classes = [AuthThrottle]


def _vault(user):
    v, _ = Vault.objects.get_or_create(user=user)
    return v


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    mode = registration_mode()
    return Response({"status": "ok", "push": bool(settings.VAPID_PUBLIC_KEY), "registration": "open" if mode == "bootstrap" else mode, "first_user": mode == "bootstrap", "password_reset_email": bool(settings.EMAIL_HOST)})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def register(request):
    try:
        user = register_user(str(request.data.get("email", "")), str(request.data.get("password", "")), str(request.data.get("invite", "")))
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)
    refresh = RefreshToken.for_user(user)
    return Response({"access": str(refresh.access_token), "refresh": str(refresh), "is_staff": user.is_staff}, status=201)


@api_view(["GET", "PUT"])
def keyinfo(request):
    v = _vault(request.user)
    if request.method == "PUT":
        if v.wrapped_key and not request.data.get("replace"):
            return Response({"detail": "Une clé existe déjà pour ce compte."}, status=409)
        salt, wrapped = str(request.data.get("salt", "")), str(request.data.get("wrapped", ""))
        it = int(request.data.get("iter", 600_000))
        if not salt or not wrapped or it < 100_000:
            return Response({"detail": "Paramètres de clé invalides."}, status=400)
        v.kdf_salt, v.kdf_iter, v.wrapped_key = salt, it, wrapped
        v.save()
    return Response({"salt": v.kdf_salt, "iter": v.kdf_iter, "wrapped": v.wrapped_key, "has_key": bool(v.wrapped_key), "seq": v.seq, "email": request.user.email})


@api_view(["GET"])
def pull(request):
    try:
        since = int(request.query_params.get("since", 0))
    except ValueError:
        since = 0
    rows = list(SyncRecord.objects.filter(user=request.user, seq__gt=since).order_by("seq")[: PULL_LIMIT + 1])
    has_more = len(rows) > PULL_LIMIT
    rows = rows[:PULL_LIMIT]
    last = rows[-1].seq if rows else since
    return Response({"records": [r.as_dict() for r in rows], "last_seq": last, "has_more": has_more, "server_seq": _vault(request.user).seq})


class _PushAbort(Exception):
    """Interrompt le lot et annule toute la transaction (rien n'est conservé)."""
    def __init__(self, detail, status):
        super().__init__(detail)
        self.detail = detail
        self.status = status


@api_view(["POST"])
def push(request):
    records = request.data.get("records", [])
    device = str(request.data.get("device", ""))[:64]
    if not isinstance(records, list) or len(records) > MAX_BATCH:
        return Response({"detail": f"Lot invalide (maximum {MAX_BATCH})."}, status=400)
    accepted, conflicts = [], []
    try:
        with transaction.atomic():
            v = Vault.objects.select_for_update().get_or_create(user=request.user)[0]
            for r in records:
                table, key = str(r.get("table", "")), str(r.get("key", ""))
                if not TABLE_RE.match(table) or not key or len(key) > 128:
                    raise _PushAbort(f"Enregistrement invalide : {table}/{key}", 400)
                try:
                    ts = int(r.get("updated_at", 0))
                except (TypeError, ValueError):
                    raise _PushAbort(f"Horodatage invalide : {table}/{key}", 400)
                existing = SyncRecord.objects.filter(user=request.user, table=table, key=key).first()
                # Dernière écriture gagnante : une version serveur plus récente l'emporte et est renvoyée au client.
                if existing and existing.updated_at > ts:
                    conflicts.append(existing.as_dict())
                    continue
                new_payload = "" if r.get("deleted") else str(r.get("payload", ""))
                delta = len(new_payload) - (len(existing.payload) if existing else 0)
                if delta > 0 and v.usage_bytes + delta > quota_bytes():
                    raise _PushAbort(f"Espace de stockage plein ({settings.FINPILOT_QUOTA_MB} Mo). Supprime des documents ou contacte l'administrateur.", 413)
                v.usage_bytes = max(0, v.usage_bytes + delta)
                v.seq += 1
                obj = existing or SyncRecord(user=request.user, table=table, key=key)
                obj.seq, obj.updated_at, obj.deleted, obj.device = v.seq, ts, bool(r.get("deleted")), device
                obj.payload = "" if obj.deleted else str(r.get("payload", ""))
                obj.save()
                accepted.append({"table": table, "key": key, "seq": v.seq})
            v.save(update_fields=["seq", "usage_bytes", "updated_at"])
    except _PushAbort as e:
        return Response({"detail": e.detail}, status=e.status)
    return Response({"accepted": accepted, "conflicts": conflicts, "server_seq": v.seq})


@api_view(["POST"])
def reset_data(request):
    """Efface les données synchronisées (la clé est conservée sauf demande)."""
    SyncRecord.objects.filter(user=request.user).delete()
    v = _vault(request.user)
    v.usage_bytes = 0
    v.save()
    if request.data.get("forget_key"):
        v.kdf_salt, v.wrapped_key = "", ""
        v.save()
    return Response({"ok": True})


@api_view(["POST"])
def logout_all(request):
    for t in OutstandingToken.objects.filter(user=request.user):
        BlacklistedToken.objects.get_or_create(token=t)
    return Response({"ok": True})


@api_view(["POST"])
def change_password(request):
    user = request.user
    if not user.check_password(str(request.data.get("old_password", ""))):
        return Response({"detail": "Mot de passe actuel incorrect."}, status=400)
    new = str(request.data.get("new_password", ""))
    try:
        password_validation.validate_password(new, user)
    except ValidationError as e:
        return Response({"detail": " ".join(e.messages)}, status=400)
    user.set_password(new)
    user.save()
    return Response({"ok": True})


@api_view(["DELETE"])
def delete_account(request):
    if not request.user.check_password(str(request.data.get("password", ""))):
        return Response({"detail": "Mot de passe incorrect."}, status=400)
    request.user.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ notifications
@api_view(["GET"])
@permission_classes([AllowAny])
def vapid_key(request):
    return Response({"public_key": settings.VAPID_PUBLIC_KEY})


@api_view(["POST", "DELETE"])
def subscribe(request):
    sub = request.data.get("subscription") or {}
    endpoint = str(sub.get("endpoint", ""))
    if request.method == "DELETE":
        PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({"ok": True})
    keys = sub.get("keys") or {}
    if not endpoint.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        return Response({"detail": "Abonnement invalide."}, status=400)
    PushSubscription.objects.update_or_create(endpoint=endpoint, defaults={"user": request.user, "p256dh": keys["p256dh"], "auth": keys["auth"], "device": str(request.data.get("device", ""))[:64]})
    return Response({"ok": True}, status=201)


@api_view(["POST"])
def reminders(request):
    """Remplace tous les rappels futurs non envoyés de l'utilisateur."""
    items = request.data.get("reminders", [])
    if not isinstance(items, list) or len(items) > 200:
        return Response({"detail": "Liste invalide."}, status=400)
    now = timezone.now()
    with transaction.atomic():
        Reminder.objects.filter(user=request.user, sent_at__isnull=True).delete()
        sent_keys = set(Reminder.objects.filter(user=request.user).values_list("key", flat=True))
        created = 0
        for it in items:
            key = str(it.get("key", ""))[:200]
            when = parse_datetime(str(it.get("fire_at", "")))
            if not key or not when or key in sent_keys:
                continue
            if timezone.is_naive(when):
                when = timezone.make_aware(when)
            if when < now:
                continue
            Reminder.objects.create(user=request.user, device=str(request.data.get("device", ""))[:64], key=key, fire_at=when, title=str(it.get("title", "FINPILOT"))[:120], body=str(it.get("body", ""))[:500])
            created += 1
        # ménage des rappels envoyés depuis plus de 60 jours
        Reminder.objects.filter(user=request.user, sent_at__lt=now - timedelta(days=60)).delete()
    return Response({"scheduled": created})
