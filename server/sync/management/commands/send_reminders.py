"""Envoie les rappels arrivés à échéance par Web Push. À lancer en boucle (--loop) ou par cron."""
import json
import logging
import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from sync.models import PushSubscription, Reminder

log = logging.getLogger(__name__)


def send_one(sub: PushSubscription, payload: dict) -> bool:
    """Renvoie False si l'abonnement n'existe plus (à supprimer)."""
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(payload),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_SUBJECT},
            ttl=12 * 3600,
        )
        return True
    except WebPushException as e:
        code = getattr(getattr(e, "response", None), "status_code", None)
        if code in (404, 410):
            return False
        log.warning("Échec Web Push (%s) : %s", code, e)
        return True


def run_once(sender=send_one) -> int:
    now = timezone.now()
    due = Reminder.objects.filter(sent_at__isnull=True, fire_at__lte=now).select_related("user")[:500]
    count = 0
    for r in due:
        subs = list(PushSubscription.objects.filter(user=r.user))
        for s in subs:
            if not sender(s, {"title": r.title, "body": r.body, "tag": r.key, "url": "./#/engagements"}):
                s.delete()
        r.sent_at = now
        r.save(update_fields=["sent_at"])
        count += 1
    return count


class Command(BaseCommand):
    help = "Envoie les rappels FINPILOT dus"

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="tourne en continu")
        parser.add_argument("--interval", type=int, default=60)

    def handle(self, *args, **opts):
        if not settings.VAPID_PRIVATE_KEY:
            self.stderr.write("VAPID_PRIVATE_KEY absente : les notifications sont désactivées.")
            if not opts["loop"]:
                return
        while True:
            if settings.VAPID_PRIVATE_KEY:
                n = run_once()
                if n:
                    self.stdout.write(f"{n} rappel(s) envoyé(s)")
            if not opts["loop"]:
                break
            time.sleep(opts["interval"])
