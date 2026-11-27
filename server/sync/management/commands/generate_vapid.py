"""Génère une paire de clés VAPID pour les notifications Web Push."""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


class Command(BaseCommand):
    help = "Affiche VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY à copier dans le fichier .env"

    def handle(self, *args, **opts):
        key = ec.generate_private_key(ec.SECP256R1())
        priv = key.private_numbers().private_value.to_bytes(32, "big")
        pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.stdout.write(f"VAPID_PUBLIC_KEY={b64url(pub)}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={b64url(priv)}")
