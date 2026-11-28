"""Suivi chiffré, signatures et notifications. Le serveur ne reçoit jamais un montant en clair."""
import re

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import BoardClaim, BoardSignature, BoardWatch, Notice, SharedBoard

ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
SEAT_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
REF_RE = re.compile(r"^[A-Za-z0-9_|:-]{1,160}$")
DIGEST_RE = re.compile(r"^[a-f0-9]{64}$")
MAX_PAYLOAD = 150_000
OWNER_SEATS = {"organizer", "debtor", "creditor"}
KINDS = {"payment", "month", "repayment"}
ROLES = {"payer", "organizer", "debtor", "creditor"}
PATHS = {"/cotisations", "/dettes"}


def _payload_ok(raw) -> str | None:
    if not isinstance(raw, str) or not raw or len(raw) > MAX_PAYLOAD:
        return None
    if not re.fullmatch(r"[A-Za-z0-9+/=\s]+", raw):
        return None
    return raw.strip()


def _board(pk):
    if not ID_RE.match(pk):
        return None
    return SharedBoard.objects.filter(pk=pk).first()


def _as_sig(row: BoardSignature):
    return {
        "kind": row.kind, "ref": row.ref, "role": row.role,
        "email": row.signer.email, "digest": row.digest, "signed_at": row.signed_at,
    }


def _notice(user, board_id: str, title: str, body: str, path: str):
    Notice.objects.create(user=user, board_id=board_id, title=title[:120], body=body[:300], path=path)


def _audience(board: SharedBoard, exclude_id: int):
    ids = set(BoardWatch.objects.filter(board=board).values_list("user_id", flat=True))
    ids |= set(BoardClaim.objects.filter(board=board).values_list("user_id", flat=True))
    ids.discard(exclude_id)
    return ids


def _can_sign(user, board: SharedBoard, role: str, ref: str) -> bool:
    if role == "organizer":
        return user.id == board.owner_id and board.owner_seat == "organizer"
    if role in ("debtor", "creditor"):
        if user.id == board.owner_id and board.owner_seat == role:
            return True
        return BoardClaim.objects.filter(board=board, user=user, seat=role).exists()
    if role == "payer":
        seat = ref.split("|", 1)[0]
        if not seat or seat in ROLES:
            return False
        return BoardClaim.objects.filter(board=board, user=user, seat=seat).exists()
    return False


@api_view(["GET", "PUT", "DELETE"])
def share(request, pk):
    if not ID_RE.match(pk):
        return Response({"detail": "Lien de suivi invalide."}, status=400)
    if request.method == "GET":
        row = SharedBoard.objects.filter(pk=pk).first()
        if not row:
            return Response({"detail": "Ce suivi n'existe pas, ou il a été coupé."}, status=404)
        claim = BoardClaim.objects.filter(board=row, user=request.user).first()
        owner = row.owner_id == request.user.id
        claims = [{"seat": c.seat, "email": c.user.email} for c in row.claims.select_related("user")] if owner else []
        return Response({
            "payload": row.payload, "updated_at": row.updated_at, "owner": owner,
            "owner_seat": row.owner_seat, "my_seat": claim.seat if claim else None, "claims": claims,
        })
    if request.method == "DELETE":
        row = SharedBoard.objects.filter(pk=pk).first()
        if not row:
            return Response(status=204)
        if row.owner_id != request.user.id:
            return Response({"detail": "Seul l'organisateur peut couper ce suivi."}, status=403)
        Notice.objects.filter(board_id=pk).delete()
        row.delete()
        return Response(status=204)
    payload = _payload_ok(request.data.get("payload"))
    if payload is None:
        return Response({"detail": "Contenu de suivi invalide."}, status=400)
    seat = request.data.get("owner_seat")
    seat = seat if isinstance(seat, str) and seat in OWNER_SEATS else None
    row = SharedBoard.objects.filter(pk=pk).first()
    if row and row.owner_id != request.user.id:
        return Response({"detail": "Seul l'organisateur peut mettre à jour ce suivi."}, status=403)
    if row:
        row.payload = payload
        fields = ["payload", "updated_at"]
        if seat and seat != row.owner_seat and not row.signatures.exists():
            row.owner_seat = seat
            fields.append("owner_seat")
        row.save(update_fields=fields)
    else:
        row = SharedBoard.objects.create(id=pk, owner=request.user, payload=payload, owner_seat=seat or "organizer")
    return Response({"updated_at": row.updated_at})


@api_view(["GET", "POST"])
def signatures(request, pk):
    row = _board(pk)
    if not ID_RE.match(pk):
        return Response({"detail": "Lien de suivi invalide."}, status=400)
    if not row:
        return Response({"detail": "Ce suivi n'existe pas, ou il a été coupé."}, status=404)
    if request.method == "GET":
        qs = row.signatures.select_related("signer").order_by("signed_at")
        return Response({"signatures": [_as_sig(s) for s in qs]})
    kind, role, ref, digest = (request.data.get(k) for k in ("kind", "role", "ref", "digest"))
    if kind not in KINDS or role not in ROLES or not isinstance(ref, str) or not REF_RE.match(ref) or not isinstance(digest, str) or not DIGEST_RE.match(digest):
        return Response({"detail": "Signature invalide."}, status=400)
    if kind == "month" and role != "organizer":
        return Response({"detail": "Seul l'organisateur signe le mois."}, status=400)
    if kind == "payment" and role not in ("payer", "organizer"):
        return Response({"detail": "Signature invalide."}, status=400)
    if kind == "repayment" and role not in ("debtor", "creditor"):
        return Response({"detail": "Signature invalide."}, status=400)
    if not _can_sign(request.user, row, role, ref):
        return Response({"detail": "Tu ne peux pas signer à cette place."}, status=403)
    existing = BoardSignature.objects.filter(board=row, ref=ref, role=role).first()
    if existing and existing.signer_id != request.user.id:
        return Response({"detail": "Cette place est déjà signée par quelqu'un d'autre."}, status=403)
    if existing:
        existing.digest = digest
        existing.kind = kind
        existing.save(update_fields=["digest", "kind", "signed_at"])
        saved = existing
    else:
        saved = BoardSignature.objects.create(board=row, kind=kind, ref=ref, role=role, signer=request.user, digest=digest)
    path = "/dettes" if row.owner_seat in ("debtor", "creditor") else "/cotisations"
    if request.user.id != row.owner_id:
        _notice(row.owner, row.id, "Signature reçue", "Une personne a signé. Ouvre le suivi pour valider à ton tour.", path)
    elif kind == "month":
        users = get_user_model().objects.filter(id__in=_audience(row, row.owner_id))
        for u in users:
            _notice(u, row.id, "Mois signé", "L'organisateur a signé le mois. Ouvre le suivi pour voir la validation.", path)
    return Response(_as_sig(saved))


@api_view(["POST", "DELETE"])
def claim(request, pk):
    row = _board(pk)
    if not ID_RE.match(pk):
        return Response({"detail": "Lien de suivi invalide."}, status=400)
    if not row:
        return Response({"detail": "Ce suivi n'existe pas, ou il a été coupé."}, status=404)
    seat = request.data.get("seat")
    if not isinstance(seat, str) or not SEAT_RE.match(seat) or seat in ("organizer", "payer"):
        return Response({"detail": "Place invalide."}, status=400)
    if request.method == "DELETE":
        q = BoardClaim.objects.filter(board=row, seat=seat)
        if row.owner_id != request.user.id:
            q = q.filter(user=request.user)
        q.delete()
        return Response(status=204)
    if seat == row.owner_seat:
        return Response({"detail": "Cette place est déjà tenue."}, status=403)
    taken = BoardClaim.objects.filter(board=row, seat=seat).exclude(user=request.user).first()
    if taken:
        return Response({"detail": "Cette place est déjà prise."}, status=403)
    BoardClaim.objects.update_or_create(board=row, user=request.user, defaults={"seat": seat})
    BoardWatch.objects.get_or_create(board=row, user=request.user)
    return Response({"seat": seat})


@api_view(["POST"])
def watch(request, pk):
    row = _board(pk)
    if not ID_RE.match(pk):
        return Response({"detail": "Lien de suivi invalide."}, status=400)
    if not row:
        return Response({"detail": "Ce suivi n'existe pas, ou il a été coupé."}, status=404)
    BoardWatch.objects.get_or_create(board=row, user=request.user)
    return Response(status=204)


@api_view(["POST"])
def notify(request, pk):
    row = _board(pk)
    if not ID_RE.match(pk):
        return Response({"detail": "Lien de suivi invalide."}, status=400)
    if not row:
        return Response({"detail": "Ce suivi n'existe pas, ou il a été coupé."}, status=404)
    if row.owner_id != request.user.id:
        return Response({"detail": "Seul l'organisateur peut prévenir les autres."}, status=403)
    title, body, path = (request.data.get(k) for k in ("title", "body", "path"))
    if not isinstance(title, str) or not isinstance(body, str) or path not in PATHS:
        return Response({"detail": "Message invalide."}, status=400)
    title, body = title.strip(), body.strip()
    if not title or not body or len(title) > 120 or len(body) > 300 or re.search(r"\d", title + body):
        return Response({"detail": "Le message ne doit contenir ni montant ni chiffre."}, status=400)
    users = get_user_model().objects.filter(id__in=_audience(row, row.owner_id))
    for u in users:
        _notice(u, row.id, title, body, path)
    return Response({"sent": users.count()})


@api_view(["GET"])
def notices(request):
    rows = Notice.objects.filter(user=request.user).order_by("-created_at")[:40]
    return Response({"notices": [{
        "id": n.id, "board_id": n.board_id, "title": n.title, "body": n.body,
        "path": n.path, "created_at": n.created_at, "read_at": n.read_at,
    } for n in rows]})


@api_view(["POST"])
def notice_read(request, pk):
    n = Notice.objects.filter(pk=pk, user=request.user).first()
    if not n:
        return Response(status=404)
    if not n.read_at:
        n.read_at = timezone.now()
        n.save(update_fields=["read_at"])
    return Response(status=204)
