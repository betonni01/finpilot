"""
Le serveur ne voit jamais les données financières en clair : chaque enregistrement arrive
chiffré par l'application (AES-256-GCM, clé connue des seuls appareils de l'utilisateur).
Il ne connaît que le nom de table, l'identifiant, la date de modification et le contenu chiffré.
"""
from django.conf import settings
from django.db import models


class Vault(models.Model):
    """Clé de données enveloppée par la phrase secrète (dérivation PBKDF2 côté client)."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="vault")
    kdf_salt = models.CharField(max_length=64, blank=True)
    kdf_iter = models.PositiveIntegerField(default=600_000)
    wrapped_key = models.TextField(blank=True)
    seq = models.BigIntegerField(default=0)  # compteur de versions propre à l'utilisateur
    usage_bytes = models.BigIntegerField(default=0)  # volume chiffré stocké (quota)
    updated_at = models.DateTimeField(auto_now=True)


class SyncRecord(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="records")
    table = models.CharField(max_length=40)
    key = models.CharField(max_length=128)
    seq = models.BigIntegerField(db_index=True)
    updated_at = models.BigIntegerField(help_text="horodatage client en millisecondes")
    deleted = models.BooleanField(default=False)
    payload = models.TextField(blank=True)
    device = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "table", "key"], name="uniq_user_table_key")]
        indexes = [models.Index(fields=["user", "seq"])]

    def as_dict(self):
        return {"table": self.table, "key": self.key, "seq": self.seq, "updated_at": self.updated_at, "deleted": self.deleted, "payload": self.payload, "device": self.device}


class PushSubscription(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.URLField(max_length=1000, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    device = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Reminder(models.Model):
    """Rappel programmé par l'application. Le texte est choisi côté client (générique par défaut)."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reminders")
    device = models.CharField(max_length=64, blank=True)
    key = models.CharField(max_length=200)
    fire_at = models.DateTimeField(db_index=True)
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=500, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "key"], name="uniq_reminder")]


class Invite(models.Model):
    """Code d'invitation à créer un compte (mode d'inscription « invite »)."""
    code = models.CharField(max_length=32, unique=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="invites")
    note = models.CharField(max_length=120, blank=True)
    max_uses = models.PositiveIntegerField(default=1)
    uses = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def is_valid(self):
        from django.utils import timezone
        return not self.revoked and self.uses < self.max_uses and (self.expires_at is None or self.expires_at > timezone.now())

    def as_dict(self):
        return {"id": self.id, "code": self.code, "note": self.note, "max_uses": self.max_uses, "uses": self.uses, "expires_at": self.expires_at, "revoked": self.revoked, "valid": self.is_valid(), "created_at": self.created_at}


class PasswordReset(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="password_resets")
    code_hash = models.CharField(max_length=200)
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)
    attempts = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
