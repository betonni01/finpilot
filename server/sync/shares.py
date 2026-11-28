"""Suivi d'une tontine en lecture seule. Le contenu arrive déjà chiffré par l'application."""
import re

from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import SharedBoard

ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
MAX_PAYLOAD = 150_000


def _payload_ok(raw) -> str | None:
    if not isinstance(raw, str) or not raw or len(raw) > MAX_PAYLOAD:
        return None
    if not re.fullmatch(r"[A-Za-z0-9+/=\s]+", raw):
        return None
    return raw.strip()


@api_view(["GET", "PUT", "DELETE"])
def share(request, pk):
    if not ID_RE.match(pk):
        return Response({"detail": "Lien de suivi invalide."}, status=400)
    if request.method == "GET":
        row = SharedBoard.objects.filter(pk=pk).first()
        if not row:
            return Response({"detail": "Ce suivi n'existe pas, ou il a été coupé."}, status=404)
        return Response({"payload": row.payload, "updated_at": row.updated_at})
    if request.method == "DELETE":
        row = SharedBoard.objects.filter(pk=pk).first()
        if not row:
            return Response(status=204)
        if row.owner_id != request.user.id:
            return Response({"detail": "Seul l'organisateur peut couper ce suivi."}, status=403)
        row.delete()
        return Response(status=204)
    payload = _payload_ok(request.data.get("payload"))
    if payload is None:
        return Response({"detail": "Contenu de suivi invalide."}, status=400)
    row = SharedBoard.objects.filter(pk=pk).first()
    if row and row.owner_id != request.user.id:
        return Response({"detail": "Seul l'organisateur peut mettre à jour ce suivi."}, status=403)
    if row:
        row.payload = payload
        row.save(update_fields=["payload", "updated_at"])
    else:
        row = SharedBoard.objects.create(id=pk, owner=request.user, payload=payload)
    return Response({"updated_at": row.updated_at})
