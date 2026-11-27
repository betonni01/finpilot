import pytest
from django.core import mail
from rest_framework.test import APIClient

PWD = "Un mot de passe solide 42"


def reg(email, invite="", c=None):
    c = c or APIClient()
    return c.post("/api/auth/register/", {"email": email, "password": PWD, "invite": invite}, format="json")


def auth(r):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return c


@pytest.fixture
def invite_mode(settings):
    settings.FINPILOT_REGISTRATION = "invite"


@pytest.mark.django_db
class TestRegistration:
    def test_first_user_is_admin_without_invite(self, invite_mode):
        assert APIClient().get("/api/health/").data["first_user"] is True
        r = reg("admin@x.fr")
        assert r.status_code == 201 and r.data["is_staff"] is True
        assert APIClient().get("/api/health/").data["registration"] == "invite"

    def test_invite_required_and_consumed(self, invite_mode):
        admin = auth(reg("admin@x.fr"))
        assert reg("ami@x.fr").status_code == 400
        code = admin.post("/api/admin/invites/", {"max_uses": 1, "note": "Koffi"}, format="json").data["code"]
        assert reg("ami@x.fr", code.lower()).status_code == 201
        assert reg("autre@x.fr", code).status_code == 400  # usage unique

    def test_revoked_invite(self, invite_mode):
        admin = auth(reg("admin@x.fr"))
        inv = admin.post("/api/admin/invites/", {"max_uses": 5}, format="json").data
        admin.delete(f"/api/admin/invites/{inv['id']}/")
        assert reg("ami@x.fr", inv["code"]).status_code == 400

    def test_closed(self, settings):
        reg("admin@x.fr")
        settings.FINPILOT_REGISTRATION = "closed"
        assert reg("ami@x.fr").status_code == 400

    def test_me(self):
        c = auth(reg("a@x.fr"))
        d = c.get("/api/auth/me/").data
        assert d["email"] == "a@x.fr" and d["quota_bytes"] > 0 and d["usage_bytes"] == 0


@pytest.mark.django_db
class TestAdmin:
    def test_non_admin_forbidden(self):
        reg("admin@x.fr")
        user = auth(reg("ami@x.fr"))
        assert user.get("/api/admin/users/").status_code == 403

    def test_list_disable_and_cannot_read_data(self):
        admin = auth(reg("admin@x.fr"))
        r = reg("ami@x.fr")
        ami = auth(r)
        ami.post("/api/sync/push/", {"records": [{"table": "txs", "key": "1", "updated_at": 1, "payload": "chiffré"}]}, format="json")
        users = admin.get("/api/admin/users/").data["users"]
        row = next(u for u in users if u["email"] == "ami@x.fr")
        assert row["records"] == 1 and "payload" not in str(users)
        uid = row["id"]
        assert admin.patch(f"/api/admin/users/{uid}/", {"is_active": False}, format="json").status_code == 200
        assert ami.get("/api/sync/pull/").status_code == 401
        assert APIClient().post("/api/auth/token/", {"username": "ami@x.fr", "password": PWD}, format="json").status_code == 401

    def test_cannot_delete_self(self):
        admin = auth(reg("admin@x.fr"))
        me = admin.get("/api/admin/users/").data["users"][0]
        assert admin.delete(f"/api/admin/users/{me['id']}/").status_code == 400


@pytest.mark.django_db
class TestPasswordReset:
    def test_admin_code_flow(self):
        admin = auth(reg("admin@x.fr"))
        reg("ami@x.fr")
        uid = next(u["id"] for u in admin.get("/api/admin/users/").data["users"] if u["email"] == "ami@x.fr")
        code = admin.post(f"/api/admin/users/{uid}/reset-code/").data["code"]
        c = APIClient()
        assert c.post("/api/auth/password-reset/confirm/", {"email": "ami@x.fr", "code": "FAUX1234", "new_password": "Nouveau mot de passe 99"}, format="json").status_code == 400
        r = c.post("/api/auth/password-reset/confirm/", {"email": "ami@x.fr", "code": code, "new_password": "Nouveau mot de passe 99"}, format="json")
        assert r.status_code == 200 and "access" in r.data
        assert c.post("/api/auth/token/", {"username": "ami@x.fr", "password": "Nouveau mot de passe 99"}, format="json").status_code == 200
        # le code ne resert pas
        assert c.post("/api/auth/password-reset/confirm/", {"email": "ami@x.fr", "code": code, "new_password": "Encore un autre 77"}, format="json").status_code == 400

    def test_email_flow(self, settings):
        settings.EMAIL_HOST = "smtp.example"
        settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
        reg("a@x.fr")
        r = APIClient().post("/api/auth/password-reset/", {"email": "a@x.fr"}, format="json")
        assert r.data["email_enabled"] is True and len(mail.outbox) == 1
        code = mail.outbox[0].body.split("est : ")[1][:8]
        assert APIClient().post("/api/auth/password-reset/confirm/", {"email": "a@x.fr", "code": code, "new_password": "Nouveau mot de passe 99"}, format="json").status_code == 200

    def test_unknown_email_same_answer(self, settings):
        settings.EMAIL_HOST = "smtp.example"
        r = APIClient().post("/api/auth/password-reset/", {"email": "inconnu@x.fr"}, format="json")
        assert r.status_code == 200


@pytest.mark.django_db
def test_quota(settings):
    settings.FINPILOT_QUOTA_MB = 1
    c = auth(reg("a@x.fr"))
    big = "x" * 700_000
    assert c.post("/api/sync/push/", {"records": [{"table": "docs", "key": "1", "updated_at": 1, "payload": big}]}, format="json").status_code == 200
    r = c.post("/api/sync/push/", {"records": [{"table": "docs", "key": "2", "updated_at": 1, "payload": big}]}, format="json")
    assert r.status_code == 413
    # remplacer un document par une version plus petite reste possible
    assert c.post("/api/sync/push/", {"records": [{"table": "docs", "key": "1", "updated_at": 2, "deleted": True}]}, format="json").status_code == 200
    assert c.get("/api/auth/me/").data["usage_bytes"] == 0
