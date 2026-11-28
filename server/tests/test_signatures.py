import uuid

import pytest
from rest_framework.test import APIClient

PWD = "Un mot de passe solide 42"
DIGEST = "ab" * 32


def auth_user(email):
    c = APIClient()
    r = c.post("/api/auth/register/", {"email": email, "password": PWD, "invite": ""}, format="json")
    assert r.status_code == 201, r.data
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return c


def mail():
    return f"s{uuid.uuid4().hex[:10]}@x.fr"


def sid():
    return uuid.uuid4().hex


@pytest.fixture
def open_reg(settings):
    settings.FINPILOT_REGISTRATION = "open"


@pytest.mark.django_db
def test_payer_and_organizer_sign_and_a_notice_has_no_amount(open_reg):
    owner = auth_user(mail())
    member = auth_user(mail())
    board = sid()
    assert owner.put(f"/api/shares/{board}/", {"payload": "Y2lwaGVy", "owner_seat": "organizer"}, format="json").status_code == 200

    ref = "participant-un|2026-11-01"
    assert member.post(f"/api/shares/{board}/signatures/", {"kind": "payment", "ref": ref, "role": "payer", "digest": DIGEST}, format="json").status_code == 403
    assert member.post(f"/api/shares/{board}/claim/", {"seat": "participant-un"}, format="json").status_code == 200
    assert member.post(f"/api/shares/{board}/claim/", {"seat": "participant-un"}, format="json").status_code == 200
    other = auth_user(mail())
    assert other.post(f"/api/shares/{board}/claim/", {"seat": "participant-un"}, format="json").status_code == 403

    signed = member.post(f"/api/shares/{board}/signatures/", {"kind": "payment", "ref": ref, "role": "payer", "digest": DIGEST}, format="json")
    assert signed.status_code == 200 and signed.data["role"] == "payer"
    assert member.post(f"/api/shares/{board}/signatures/", {"kind": "payment", "ref": ref, "role": "organizer", "digest": DIGEST}, format="json").status_code == 403
    assert owner.post(f"/api/shares/{board}/signatures/", {"kind": "month", "ref": "2026-11-01", "role": "payer", "digest": DIGEST}, format="json").status_code == 400
    closed = owner.post(f"/api/shares/{board}/signatures/", {"kind": "month", "ref": "2026-11-01", "role": "organizer", "digest": DIGEST}, format="json")
    assert closed.status_code == 200

    owner_notes = owner.get("/api/notices/").data["notices"]
    assert any(n["title"] == "Signature reçue" and not any(ch.isdigit() for ch in n["body"]) for n in owner_notes)
    member_notes = member.get("/api/notices/").data["notices"]
    assert any(n["title"] == "Mois signé" for n in member_notes)
    assert owner.post(f"/api/shares/{board}/notify/", {"title": "Versement 12", "body": "Regarde", "path": "/cotisations"}, format="json").status_code == 400
    sent = owner.post(f"/api/shares/{board}/notify/", {"title": "Tontine à vérifier", "body": "Un versement a été enregistré. Ouvre le suivi pour le signer.", "path": "/cotisations"}, format="json")
    assert sent.status_code == 200 and sent.data["sent"] == 1
    again = member.get("/api/notices/").data["notices"]
    note = next(n for n in again if n["title"] == "Tontine à vérifier")
    assert member.post(f"/api/notices/{note['id']}/read/").status_code == 204
    assert owner.get(f"/api/shares/{board}/").data["claims"][0]["seat"] == "participant-un"
    assert member.get(f"/api/shares/{board}/").data["claims"] == []
    assert owner.delete(f"/api/shares/{board}/claim/", {"seat": "participant-un"}, format="json").status_code == 204


@pytest.mark.django_db
def test_both_sides_of_a_debt_can_sign(open_reg):
    owner = auth_user(mail())
    other = auth_user(mail())
    board = sid()
    assert owner.put(f"/api/shares/{board}/", {"payload": "ZGVwdGU=", "owner_seat": "debtor"}, format="json").status_code == 200
    assert other.post(f"/api/shares/{board}/watch/", {}, format="json").status_code == 204
    assert other.post(f"/api/shares/{board}/claim/", {"seat": "debtor"}, format="json").status_code == 403
    assert other.post(f"/api/shares/{board}/claim/", {"seat": "creditor"}, format="json").status_code == 200
    ref = uuid.uuid4().hex
    assert owner.post(f"/api/shares/{board}/signatures/", {"kind": "repayment", "ref": ref, "role": "debtor", "digest": DIGEST}, format="json").status_code == 200
    assert other.post(f"/api/shares/{board}/signatures/", {"kind": "repayment", "ref": ref, "role": "creditor", "digest": DIGEST}, format="json").status_code == 200
    assert other.post(f"/api/shares/{board}/signatures/", {"kind": "repayment", "ref": ref, "role": "debtor", "digest": DIGEST}, format="json").status_code == 403
    got = other.get(f"/api/shares/{board}/signatures/")
    assert got.status_code == 200 and len(got.data["signatures"]) == 2
    assert other.post(f"/api/shares/{board}/notify/", {"title": "Dette à vérifier", "body": "Un remboursement a été enregistré.", "path": "/dettes"}, format="json").status_code == 403
