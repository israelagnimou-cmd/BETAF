from contextlib import contextmanager
import os

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

os.environ.setdefault(
    "BETAF_DATABASE_URL",
    "mysql+pymysql://test:test@localhost:3306/betaf_studio",
)

from api.main import create_app


@contextmanager
def make_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    app = create_app(
        engine=engine,
        initial_admin=("admin", "Administrateur BETAF", "test-password-123"),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/login",
            json={"username": "admin", "password": "test-password-123"},
        )
        assert response.status_code == 200
        client.headers.update({"Authorization": f"Bearer {response.json()['token']}"})
        yield client


def test_local_sqlite_database_configuration(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("BETAF_DATABASE_URL", "sqlite:///betaf-local.sqlite")
    app = create_app(
        initial_admin=("admin", "Administrateur BETAF", "local-test-password"),
    )

    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["database"] == "SQLite"

        login = client.post(
            "/api/login",
            json={"username": "admin", "password": "local-test-password"},
        )
        assert login.status_code == 200

    assert (tmp_path / "betaf-local.sqlite").exists()


def test_state_roundtrip_and_version_conflict():
    with make_client() as client:
        payload = {
            "clients": [{"id": "client-1"}],
            "docs": [],
            "settings": {},
            "documentTypeTemplates": {
                "Certificat de bornage": {"content": "<p>{{client.nom_complet}}</p>"}
            },
        }
        response = client.put("/api/state", json={"version": 0, "data": payload})
        assert response.status_code == 200
        assert response.json()["version"] == 1

        stored = client.get("/api/state")
        assert stored.status_code == 200
        assert stored.json() == {"version": 1, "data": payload}

        conflict = client.put("/api/state", json={"version": 0, "data": {}})
        assert conflict.status_code == 409
        assert conflict.json()["error"]["state"]["version"] == 1
        audit = client.get("/api/audit")
        assert audit.status_code == 200
        assert any(entry["action"] == "client-created" for entry in audit.json()["entries"])


def test_api_user_management_and_authentication():
    with make_client() as client:
        created = client.post(
            "/api/users",
            json={
                "username": "gestionnaire",
                "fullname": "Gestionnaire BETAF",
                "password": "mot-de-passe-solide",
                "role": "manager",
            },
        )
        assert created.status_code == 201
        user_id = created.json()["id"]

        users = client.get("/api/users")
        assert users.status_code == 200
        assert {user["username"] for user in users.json()["users"]} == {"admin", "gestionnaire"}
        assert all("password_hash" not in user for user in users.json()["users"])

        deleted = client.delete(f"/api/users/{user_id}")
        assert deleted.status_code == 200
        assert client.delete("/api/users/admin").status_code == 403
        archived = next(user for user in client.get("/api/users").json()["users"] if user["id"] == user_id)
        assert archived["is_archived"] is True
        assert archived["is_active"] is False


def test_profiles_password_reset_suspension_and_role_permissions():
    with make_client() as client:
        created = client.post(
            "/api/users",
            json={
                "username": "gestionnaire",
                "fullname": "Gestionnaire BETAF",
                "password": "mot-de-passe-provisoire",
                "role": "manager",
                "phone": "+22501020304",
                "email": "gestionnaire@example.test",
            },
        )
        user_id = created.json()["id"]
        login = client.post(
            "/api/login",
            json={"username": "gestionnaire", "password": "mot-de-passe-provisoire"},
        )
        manager_headers = {"Authorization": f"Bearer {login.json()['token']}"}

        assert login.json()["user"]["must_change_password"] is True
        assert client.get("/api/users", headers=manager_headers).status_code == 403
        assert client.get("/api/audit", headers=manager_headers).status_code == 403
        assert client.get("/api/state", headers=manager_headers).status_code == 403

        profile = client.patch(
            "/api/me",
            headers=manager_headers,
            json={"fullname": "Aminata Gestionnaire", "email": "aminata@example.test", "phone": "+22507000000"},
        )
        assert profile.status_code == 200
        assert profile.json()["user"]["phone"] == "+22507000000"

        changed = client.put(
            "/api/me/password",
            headers=manager_headers,
            json={"new_password": "NouveauMotDePasse-2026"},
        )
        assert changed.status_code == 200
        assert changed.json()["user"]["must_change_password"] is False
        assert client.get("/api/state", headers=manager_headers).status_code == 200

        forbidden_settings = client.put(
            "/api/state",
            headers=manager_headers,
            json={
                "version": 0,
                "data": {
                    "clients": [],
                    "docs": [],
                    "documentTypes": ["Modèle interdit"],
                    "archive": [],
                    "settings": {},
                    "urgencyDismissals": [],
                },
            },
        )
        assert forbidden_settings.status_code == 403
        current_state = client.get("/api/state", headers=manager_headers).json()
        forbidden_templates = client.put(
            "/api/state",
            headers=manager_headers,
            json={
                "version": current_state["version"],
                "data": {
                    **current_state["data"],
                    "documentTypeTemplates": {
                        "Type interdit": {"content": "<p>Modèle</p>"}
                    },
                },
            },
        )
        assert forbidden_templates.status_code == 403

        reset = client.put(
            f"/api/users/{user_id}/reset-password",
            json={"temporary_password": "TemporaireMotDePasse-2026"},
        )
        assert reset.status_code == 200
        assert client.get("/api/me", headers=manager_headers).status_code == 401
        assert client.post(
            "/api/login",
            json={"username": "gestionnaire", "password": "NouveauMotDePasse-2026"},
        ).status_code == 401
        temporary_login = client.post(
            "/api/login",
            json={"username": "gestionnaire", "password": "TemporaireMotDePasse-2026"},
        )
        assert temporary_login.status_code == 200
        assert temporary_login.json()["user"]["must_change_password"] is True

        suspended = client.patch(f"/api/users/{user_id}", json={"is_active": False})
        assert suspended.status_code == 200
        assert suspended.json()["user"]["is_active"] is False
        assert client.post(
            "/api/login",
            json={"username": "gestionnaire", "password": "TemporaireMotDePasse-2026"},
        ).status_code == 401

        actions = {entry["action"] for entry in client.get("/api/audit").json()["entries"]}
        assert {"user-created", "profile-updated", "password-changed", "password-reset", "user-account-updated"} <= actions


def test_browser_migration_imports_data_and_disables_legacy_viewers():
    with make_client() as client:
        response = client.post(
            "/api/migrate-browser",
            json={
                "data": {
                    "clients": [{"id": "client-1"}],
                    "docs": [{"title": "Plan topographique"}],
                    "documentTypes": [],
                    "archive": [],
                    "settings": {},
                    "urgencyDismissals": [],
                },
                "users": [
                    {
                        "id": "legacy-manager",
                        "username": "ancien-manager",
                        "fullname": "Ancien Gestionnaire",
                        "password": "legacy-manager-password",
                        "role": "manager",
                    },
                    {
                        "id": "legacy-viewer",
                        "username": "ancien-consultation",
                        "fullname": "Ancien Consultation",
                        "password": "legacy-viewer-password",
                        "role": "viewer",
                    },
                ],
            },
        )
        assert response.status_code == 200
        assert response.json() == {"imported": True, "version": 1, "users": 2}

        state = client.get("/api/state").json()
        assert state["data"]["docs"][0]["id"]
        users = {user["username"]: user for user in client.get("/api/users").json()["users"]}
        assert users["ancien-manager"]["is_active"] is True
        assert users["ancien-consultation"]["role"] == "manager"
        assert users["ancien-consultation"]["is_active"] is False
        assert client.post(
            "/api/login",
            json={"username": "ancien-consultation", "password": "legacy-viewer-password"},
        ).status_code == 401

        repeat = client.post("/api/migrate-browser", json={"data": {}, "users": []})
        assert repeat.json() == {"imported": False, "reason": "server-already-initialized"}


def test_empty_browser_migration_does_not_block_a_later_import():
    with make_client() as client:
        empty = {
            "clients": [],
            "docs": [],
            "documentTypes": [],
            "archive": [],
            "settings": {},
            "urgencyDismissals": [],
        }
        first = client.post("/api/migrate-browser", json={"data": empty, "users": []})
        assert first.json() == {"imported": False, "reason": "nothing-to-import"}

        later = client.post(
            "/api/migrate-browser",
            json={
                "data": {**empty, "clients": [{"id": "browser-client"}]},
                "users": [],
            },
        )
        assert later.status_code == 200
        assert later.json()["imported"] is True
        assert client.get("/api/state").json()["data"]["clients"][0]["id"] == "browser-client"


def test_authentication_is_required_for_state():
    with make_client() as client:
        client.headers.pop("Authorization")
        response = client.get("/api/state")
        assert response.status_code == 401
        assert response.json() == {"error": "Authentification requise"}
