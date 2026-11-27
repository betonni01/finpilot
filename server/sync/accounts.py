"""Comptes : inscription (ouverte, sur invitation ou fermée), profil, mot de passe oublié, administration."""
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model, password_validation
from django.contrib.auth.hashers import check_password, make_password
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Invite, PasswordReset, SyncRecord, Vault
from .throttles import AuthThrottle

User = get_user_model()
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sans caractères ambigus


def new_code(n=10):
    return "".join(secrets.choice(ALPHABET) for _ in range(n))


def quota_bytes():
    return settings.FINPILOT_QUOTA_MB * 1024 * 1024


def revoke_sessions(user):
    for t in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=t)


def registration_mode():
    if not User.objects.exists():
        return "bootstrap"  # premier compte = administrateur, sans invitation
    return settings.FINPILOT_REGISTRATION if settings.FINPILOT_REGISTRATION in ("open", "invite", "closed") else "invite"


def register_user(email, password, invite_code=""):
    """Crée le compte ou lève ValueError avec un message lisible."""
    import re
    email = email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise ValueError("Adresse e-mail invalide.")
    with transaction.atomic():
        mode = registration_mode()
        if mode == "closed":
            raise ValueError("Les inscriptions sont fermées sur ce serveur.")
        invite = None
        if mode == "invite":
            invite = Invite.objects.select_for_update().filter(code=invite_code.strip().upper()).first()
            if not invite or not invite.is_valid():
                raise ValueError("Code d'invitation invalide ou expiré. Demande un code à l'administrateur.")
        if User.objects.filter(username=email).exists():
            raise ValueError("Un compte existe déjà avec cette adresse.")
        user = User(username=email, email=email)
        try:
            password_validation.validate_password(password, user)
        except ValidationError as e:
            raise ValueError(" ".join(e.messages))
        user.set_password(password)
        if mode == "bootstrap":
            user.is_staff = user.is_superuser = True
        user.save()
        Vault.objects.get_or_create(user=user)
        if invite:
            invite.uses += 1
            invite.save(update_fields=["uses"])
    return user


@api_view(["GET"])
def me(request):
    v, _ = Vault.objects.get_or_create(user=request.user)
    u = request.user
    return Response({"email": u.email, "is_staff": u.is_staff, "date_joined": u.date_joined, "usage_bytes": v.usage_bytes, "quota_bytes": quota_bytes(),
                     "records": SyncRecord.objects.filter(user=u).count(), "has_key": bool(v.wrapped_key)})


# ------------------------------------------------------------------ mot de passe oublié
def _create_reset(user, hours=1):
    code = new_code(8)
    PasswordReset.objects.filter(user=user, used=False).update(used=True)
    PasswordReset.objects.create(user=user, code_hash=make_password(code), expires_at=timezone.now() + timedelta(hours=hours))
    return code


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def password_reset_request(request):
    email = str(request.data.get("email", "")).strip().lower()
    user = User.objects.filter(username=email, is_active=True).first()
    email_on = bool(settings.EMAIL_HOST)
    if user and email_on:
        code = _create_reset(user)
        url = settings.FINPILOT_PUBLIC_URL
        send_mail("FINPILOT : code de réinitialisation",
                  f"Ton code de réinitialisation FINPILOT est : {code}\nIl est valable une heure.{f' Application : {url}' if url else ''}\n\n"
                  "Ce code permet de changer le mot de passe du compte. Tes données restent déchiffrables avec ta phrase secrète de synchronisation.\n"
                  "Si tu n'as rien demandé, ignore ce message.", None, [user.email], fail_silently=True)
    # réponse identique que le compte existe ou non
    return Response({"email_enabled": email_on})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def password_reset_confirm(request):
    email = str(request.data.get("email", "")).strip().lower()
    code = str(request.data.get("code", "")).strip().upper()
    new = str(request.data.get("new_password", ""))
    user = User.objects.filter(username=email, is_active=True).first()
    err = Response({"detail": "Code invalide ou expiré."}, status=400)
    if not user:
        return err
    r = PasswordReset.objects.filter(user=user, used=False, expires_at__gt=timezone.now()).order_by("-created_at").first()
    if not r or r.attempts >= 5:
        return err
    if not check_password(code, r.code_hash):
        r.attempts += 1
        r.save(update_fields=["attempts"])
        return err
    try:
        password_validation.validate_password(new, user)
    except ValidationError as e:
        return Response({"detail": " ".join(e.messages)}, status=400)
    user.set_password(new)
    user.save()
    r.used = True
    r.save(update_fields=["used"])
    revoke_sessions(user)
    refresh = RefreshToken.for_user(user)
    return Response({"access": str(refresh.access_token), "refresh": str(refresh)})


# ------------------------------------------------------------------ administration
def _user_row(u, stats):
    s = stats.get(u.id, {})
    return {"id": u.id, "email": u.email, "date_joined": u.date_joined, "last_login": u.last_login, "is_active": u.is_active, "is_staff": u.is_staff,
            "records": s.get("records", 0), "usage_bytes": s.get("usage", 0)}


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_users(request):
    counts = {r["user"]: r["n"] for r in SyncRecord.objects.values("user").annotate(n=Count("id"))}
    usage = {v.user_id: v.usage_bytes for v in Vault.objects.all()}
    stats = {uid: {"records": counts.get(uid, 0), "usage": usage.get(uid, 0)} for uid in set(counts) | set(usage)}
    users = User.objects.order_by("-date_joined")
    return Response({"users": [_user_row(u, stats) for u in users], "registration": registration_mode(), "quota_bytes": quota_bytes(), "email_enabled": bool(settings.EMAIL_HOST)})


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAdminUser])
def admin_user(request, pk):
    u = User.objects.filter(pk=pk).first()
    if not u:
        return Response({"detail": "Introuvable."}, status=404)
    if u.pk == request.user.pk:
        return Response({"detail": "Impossible de modifier ou supprimer ton propre compte ici."}, status=400)
    if request.method == "DELETE":
        u.delete()
        return Response(status=204)
    if "is_active" in request.data:
        u.is_active = bool(request.data["is_active"])
        if not u.is_active:
            revoke_sessions(u)
    if "is_staff" in request.data:
        u.is_staff = bool(request.data["is_staff"])
    u.save()
    return Response(_user_row(u, {}))


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_reset_code(request, pk):
    """Code de réinitialisation à transmettre soi-même (valable 24 h), quand aucun e-mail n'est configuré."""
    u = User.objects.filter(pk=pk, is_active=True).first()
    if not u:
        return Response({"detail": "Introuvable ou désactivé."}, status=404)
    return Response({"code": _create_reset(u, hours=24), "email": u.email, "valid_hours": 24})


@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
def admin_invites(request):
    if request.method == "POST":
        try:
            uses = max(1, min(1000, int(request.data.get("max_uses", 1))))
            days = int(request.data.get("days", 14))
        except (TypeError, ValueError):
            return Response({"detail": "Paramètres invalides."}, status=400)
        inv = Invite.objects.create(code=new_code(), created_by=request.user, note=str(request.data.get("note", ""))[:120], max_uses=uses,
                                    expires_at=timezone.now() + timedelta(days=days) if days > 0 else None)
        return Response(inv.as_dict(), status=201)
    return Response({"invites": [i.as_dict() for i in Invite.objects.order_by("-created_at")[:200]]})


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def admin_invite(request, pk):
    Invite.objects.filter(pk=pk).update(revoked=True)
    return Response({"ok": True})
