from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from sync.accounts import new_code
from sync.models import Invite


class Command(BaseCommand):
    help = "Crée un code d'invitation FINPILOT"

    def add_arguments(self, parser):
        parser.add_argument("--uses", type=int, default=1)
        parser.add_argument("--days", type=int, default=14)
        parser.add_argument("--note", default="")

    def handle(self, *args, **o):
        inv = Invite.objects.create(code=new_code(), note=o["note"], max_uses=o["uses"], expires_at=timezone.now() + timedelta(days=o["days"]) if o["days"] > 0 else None)
        self.stdout.write(f"Code d'invitation : {inv.code} ({o['uses']} utilisation(s), {o['days']} jour(s))")
