from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from sync.management.commands.send_reminders import run_once
from sync.models import PushSubscription, Reminder, SyncRecord

PWD = "Un mot de passe solide 42"


def client_for(email="beto@example.com"):
    c = APIClient()
    r = c.post("/api/auth/register/", {"email": email, "password": PWD}, format="json")
    assert r.status_code == 201, r.data
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return c


def rec(key, ts, payload="chiffré", table="txs", deleted=False):
    return {"table": table, "key": key, "updated_at": ts, "payload": payload, "deleted": deleted}


@pytest.mark.django_db
class TestAuth:
    def test_register_login_refresh(self):
        client_for()
        c = APIClient()
        r = c.post("/api/auth/token/", {"username": "beto@example.com", "password": PWD}, format="json")
        assert r.status_code == 200
        r2 = c.post("/api/auth/token/refresh/", {"refresh": r.data["refresh"]}, format="json")
        assert r2.status_code == 200 and "access" in r2.data
        # rotation : l'ancien jeton de rafraîchissement est révoqué
        r3 = c.post("/api/auth/token/refresh/", {"refresh": r.data["refresh"]}, format="json")
        assert r3.status_code == 401

    def test_weak_password_and_duplicate(self):
        c = APIClient()
        assert c.post("/api/auth/register/", {"email": "a@b.fr", "password": "123"}, format="json").status_code == 400
        client_for("a@b.fr")
        assert c.post("/api/auth/register/", {"email": "a@b.fr", "password": PWD}, format="json").status_code == 400

    def test_requires_auth(self):
        assert APIClient().get("/api/sync/pull/").status_code == 401


@pytest.mark.django_db
class TestSync:
    def test_keyinfo_set_once(self):
        c = client_for()
        assert c.get("/api/sync/keyinfo/").data["has_key"] is False
        assert c.put("/api/sync/keyinfo/", {"salt": "s", "iter": 600000, "wrapped": "w"}, format="json").status_code == 200
        assert c.put("/api/sync/keyinfo/", {"salt": "s2", "iter": 600000, "wrapped": "w2"}, format="json").status_code == 409
        assert c.get("/api/sync/keyinfo/").data["wrapped"] == "w"

    def test_push_pull_incremental(self):
        c = client_for()
        r = c.post("/api/sync/push/", {"device": "A", "records": [rec("1", 100), rec("2", 100)]}, format="json")
        assert len(r.data["accepted"]) == 2 and r.data["server_seq"] == 2
        p = c.get("/api/sync/pull/?since=0").data
        assert [x["key"] for x in p["records"]] == ["1", "2"] and p["last_seq"] == 2
        c.post("/api/sync/push/", {"device": "B", "records": [rec("1", 200, "v2")]}, format="json")
        p2 = c.get("/api/sync/pull/?since=2").data
        assert [(x["key"], x["payload"], x["device"]) for x in p2["records"]] == [("1", "v2", "B")]

    def test_last_writer_wins_conflict(self):
        c = client_for()
        c.post("/api/sync/push/", {"records": [rec("1", 500, "récent")]}, format="json")
        r = c.post("/api/sync/push/", {"records": [rec("1", 400, "ancien")]}, format="json")
        assert r.data["accepted"] == [] and r.data["conflicts"][0]["payload"] == "récent"

    def test_tombstone(self):
        c = client_for()
        c.post("/api/sync/push/", {"records": [rec("1", 1)]}, format="json")
        c.post("/api/sync/push/", {"records": [rec("1", 2, deleted=True)]}, format="json")
        x = c.get("/api/sync/pull/?since=1").data["records"][0]
        assert x["deleted"] is True and x["payload"] == ""

    def test_isolation_between_users(self):
        a, b = client_for("a@x.fr"), client_for("b@x.fr")
        a.post("/api/sync/push/", {"records": [rec("1", 1, "secret A")]}, format="json")
        assert b.get("/api/sync/pull/?since=0").data["records"] == []

    def test_invalid_table_rejected(self):
        c = client_for()
        assert c.post("/api/sync/push/", {"records": [rec("1", 1, table="../x")]}, format="json").status_code == 400

    def test_failed_batch_rolls_back(self):
        c = client_for()
        r = c.post("/api/sync/push/", {"records": [rec("ok", 1, "gardé"), rec("bad", 1, table="../x")]}, format="json")
        assert r.status_code == 400
        assert SyncRecord.objects.count() == 0
        again = c.post("/api/sync/push/", {"records": [rec("ok", 1, "gardé")]}, format="json")
        assert again.status_code == 200
        assert [x["seq"] for x in c.get("/api/sync/pull/?since=0").data["records"]] == [1]

    def test_pagination(self):
        c = client_for()
        for i in range(3):
            c.post("/api/sync/push/", {"records": [rec(str(j), 1) for j in range(i * 400, i * 400 + 400)]}, format="json")
        p = c.get("/api/sync/pull/?since=0").data
        assert p["has_more"] is True and len(p["records"]) == 500
        p2 = c.get(f"/api/sync/pull/?since={p['last_seq']}").data
        assert p2["has_more"] is True
        p3 = c.get(f"/api/sync/pull/?since={p2['last_seq']}").data
        assert p3["has_more"] is False and p3["last_seq"] == 1200

    def test_delete_account(self):
        c = client_for()
        c.post("/api/sync/push/", {"records": [rec("1", 1)]}, format="json")
        assert c.delete("/api/auth/account/", {"password": "faux"}, format="json").status_code == 400
        assert c.delete("/api/auth/account/", {"password": PWD}, format="json").status_code == 204
        assert SyncRecord.objects.count() == 0


@pytest.mark.django_db
class TestPush:
    def test_reminders_replace_and_send(self):
        c = client_for()
        c.post("/api/push/subscribe/", {"subscription": {"endpoint": "https://push.example/abc", "keys": {"p256dh": "k", "auth": "a"}}}, format="json")
        soon = (timezone.now() + timedelta(seconds=1)).isoformat()
        later = (timezone.now() + timedelta(days=2)).isoformat()
        r = c.post("/api/push/reminders/", {"reminders": [{"key": "loyer|2026-12-05", "fire_at": soon, "title": "Échéance"}, {"key": "x", "fire_at": later, "title": "Plus tard"}]}, format="json")
        assert r.data["scheduled"] == 2
        r = c.post("/api/push/reminders/", {"reminders": [{"key": "loyer|2026-12-05", "fire_at": soon, "title": "Échéance"}]}, format="json")
        assert Reminder.objects.count() == 1
        Reminder.objects.update(fire_at=timezone.now() - timedelta(seconds=1))
        sent = []
        assert run_once(lambda s, p: sent.append(p) or True) == 1
        assert sent[0]["title"] == "Échéance"
        assert run_once(lambda s, p: True) == 0  # déjà envoyé

    def test_expired_subscription_removed(self):
        c = client_for()
        c.post("/api/push/subscribe/", {"subscription": {"endpoint": "https://push.example/old", "keys": {"p256dh": "k", "auth": "a"}}}, format="json")
        c.post("/api/push/reminders/", {"reminders": [{"key": "k", "fire_at": (timezone.now() + timedelta(seconds=1)).isoformat(), "title": "t"}]}, format="json")
        Reminder.objects.update(fire_at=timezone.now() - timedelta(seconds=1))
        run_once(lambda s, p: False)
        assert PushSubscription.objects.count() == 0
