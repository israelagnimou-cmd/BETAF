import json
import sqlite3

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from api.main import (
    AppState,
    AuditEntry,
    Base,
    INITIAL_STATE,
    User,
    _password_hash,
    _verify_password,
)
from api.migrate_sqlite import migrate


def create_legacy_database(path):
    with sqlite3.connect(path) as db:
        db.executescript(
            """
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE users (
              id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, fullname TEXT NOT NULL,
              role TEXT NOT NULL, password TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE audit (
              id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, action TEXT NOT NULL,
              created_at TEXT NOT NULL, details TEXT
            );
            """
        )
        data = {"clients": [{"id": "client-1"}], "docs": [], "settings": {}}
        db.executemany(
            "INSERT INTO meta(key, value) VALUES(?, ?)",
            [("version", "4"), ("data", json.dumps(data))],
        )
        db.execute(
            "INSERT INTO users VALUES(?, ?, ?, ?, ?, ?)",
            (
                "admin",
                "admin",
                "Administrateur BETAF",
                "admin",
                _password_hash("legacy-admin-password"),
                "2026-01-01T00:00:00+00:00",
            ),
        )
        db.execute(
            "INSERT INTO users VALUES(?, ?, ?, ?, ?, ?)",
            (
                "viewer-1",
                "ancien-consultation",
                "Ancien Consultation",
                "viewer",
                _password_hash("legacy-viewer-password"),
                "2026-01-01T00:00:00+00:00",
            ),
        )
        db.execute(
            "INSERT INTO audit VALUES(?, ?, ?, ?, ?)",
            (7, "admin", "login", "2026-01-01T00:00:00+00:00", None),
        )


def test_migration_preserves_data_users_and_audit(tmp_path):
    source = tmp_path / "betaf.sqlite"
    create_legacy_database(source)
    engine = create_engine("sqlite://")

    counts = migrate(source, engine)

    assert counts == {"users": 2, "audit": 1}
    with Session(engine) as db:
        state = db.get(AppState, 1)
        assert state.version == 4
        assert state.data["clients"][0]["id"] == "client-1"
        user = db.get(User, "admin")
        assert _verify_password("legacy-admin-password", user.password_hash)
        viewer = db.get(User, "viewer-1")
        assert viewer.role == "manager"
        assert viewer.is_active is False
        assert db.get(AuditEntry, 7).action == "login"


def test_migration_will_not_overwrite_populated_target(tmp_path):
    source = tmp_path / "betaf.sqlite"
    create_legacy_database(source)
    engine = create_engine("sqlite://")
    migrate(source, engine)

    with pytest.raises(RuntimeError, match="contient déjà des données"):
        migrate(source, engine)


def test_migration_accepts_a_fresh_api_database_with_default_document_types(tmp_path):
    source = tmp_path / "betaf.sqlite"
    create_legacy_database(source)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(AppState(id=1, version=0, data=dict(INITIAL_STATE)))
        db.commit()

    counts = migrate(source, engine)

    assert counts == {"users": 2, "audit": 1}
    with Session(engine) as db:
        assert db.get(AppState, 1).data["clients"][0]["id"] == "client-1"
