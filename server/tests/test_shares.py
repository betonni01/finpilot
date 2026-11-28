import pytest
from rest_framework.test import APIClient

PWD = "Un mot de passe solide 42"
SID = "abcdefghijklmnopqrstuv"


def auth_user(email):
    c = APIClient()
    r = c.post("/api/auth/register/", {"email": email, "password": PWD, "invite": ""}, format="json")
    assert r.status_code == 201
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return c


@pytest.fixture
def open_reg(settings):
    settings.FINPILOT_REGISTRATION = "open"


@pytest.mark.django_db
def test_only_the_owner_can_publish_and_anyone_logged_in_can_read(open_reg):
    owner = auth_user("orga@x.fr")
    member = auth_user("membre@x.fr")
    stranger = APIClient()

    assert stranger.get(f"/api/shares/{SID}/").status_code == 401
    assert member.put(f"/api/shares/{SID}/", {"payload": "Y2lwaGVy"}, format="json").status_code == 200
    # le membre a créé le sien : l'organisateur ne peut pas l'écraser
    assert owner.put(f"/api/shares/{SID}/", {"payload": "YXV0cmU="}, format="json").status_code == 403

    own = "Zm9sbG93"
    assert owner.put("/api/shares/zzzzzzzzzzzzzzzz/", {"payload": own}, format="json").status_code == 200
    got = member.get("/api/shares/zzzzzzzzzzzzzzzz/")
    assert got.status_code == 200 and got.data["payload"] == own
    assert member.delete("/api/shares/zzzzzzzzzzzzzzzz/").status_code == 403
    assert owner.delete("/api/shares/zzzzzzzzzzzzzzzz/").status_code == 204
    assert member.get("/api/shares/zzzzzzzzzzzzzzzz/").status_code == 404


@pytest.mark.django_db
def test_rejects_a_short_id_and_a_huge_payload(open_reg):
    owner = auth_user("orga2@x.fr")
    assert owner.put("/api/shares/court/", {"payload": "YQ=="}, format="json").status_code == 400
    assert owner.put(f"/api/shares/{SID}/", {"payload": "A" * 150_001}, format="json").status_code == 400
