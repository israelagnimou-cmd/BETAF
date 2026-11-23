from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.main import AppState, AuditEntry, Base, User, _database_url, _is_empty_state


def migrate(source: Path, engine: Engine, *, replace_state: bool = False) -> dict[str, int]:
    if not source.is_file():
        raise FileNotFoundError(f"Base SQLite introuvable : {source}")

    Base.metadata.create_all(engine)
    with sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True) as legacy:
        legacy.row_factory = sqlite3.Row
        tables = {
            row["name"]
            for row in legacy.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        required_tables = {"meta", "users", "audit"}
        missing_tables = required_tables - tables
        if missing_tables:
            raise RuntimeError(f"Tables manquantes dans la base source : {', '.join(sorted(missing_tables))}")

        metadata = {row["key"]: row["value"] for row in legacy.execute("SELECT key, value FROM meta")}
        version = int(metadata.get("version") or 0)
        data = json.loads(metadata.get("data") or "{}")
        legacy_users = legacy.execute(
            "SELECT id, username, fullname, role, password, created_at FROM users"
        ).fetchall()
        legacy_audit = legacy.execute(
            "SELECT id, user_id, action, created_at, details FROM audit ORDER BY id"
        ).fetchall()

    if not isinstance(data, dict):
        raise ValueError("L’état SQLite doit être un objet JSON.")

    counts = {"users": 0, "audit": 0}
    with Session(engine) as db, db.begin():
        current_state = db.get(AppState, 1)
        if current_state is None:
            db.add(AppState(id=1, version=version, data=data))
        else:
            existing_is_empty = current_state.version == 0 and _is_empty_state(current_state.data)
            if existing_is_empty or replace_state:
                current_state.version = version
                current_state.data = data
            else:
                raise RuntimeError(
                    "La base MySQL contient déjà des données. Utilisez --replace-state uniquement "
                    "si vous souhaitez explicitement remplacer cet état par celui de SQLite."
                )

        for row in legacy_users:
            user = db.get(User, row["id"])
            username_user = db.scalar(select(User).where(User.username == row["username"]))
            if user is not None and user.username != row["username"]:
                raise RuntimeError(f"Conflit d’identifiant pour le compte {row['username']}.")
            if username_user is not None and username_user.id != row["id"]:
                raise RuntimeError(f"Le nom d’utilisateur {row['username']} existe déjà dans MySQL.")
            role = "manager" if row["role"] == "viewer" else row["role"]
            is_active = row["role"] != "viewer"
            if user is None:
                user = User(
                    id=row["id"],
                    username=row["username"],
                    fullname=row["fullname"],
                    role=role,
                    password_hash=row["password"],
                    is_active=is_active,
                )
                db.add(user)
                counts["users"] += 1
            else:
                user.fullname = row["fullname"]
                user.role = role
                user.password_hash = row["password"]
                user.is_active = is_active
            if row["created_at"]:
                user.created_at = datetime.fromisoformat(row["created_at"])

        for row in legacy_audit:
            if db.get(AuditEntry, row["id"]) is not None:
                continue
            created_at = datetime.fromisoformat(row["created_at"]) if row["created_at"] else datetime.now(timezone.utc)
            db.add(
                AuditEntry(
                    id=row["id"],
                    user_id=row["user_id"],
                    action=row["action"],
                    created_at=created_at,
                    details=row["details"],
                )
            )
            counts["audit"] += 1
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Transfère les données BETAF de SQLite vers MySQL.")
    parser.add_argument(
        "source",
        nargs="?",
        type=Path,
        default=Path(__file__).parent.parent / "server" / "data" / "betaf.sqlite",
        help="Fichier SQLite source (par défaut : server/data/betaf.sqlite).",
    )
    parser.add_argument(
        "--replace-state",
        action="store_true",
        help="Remplace explicitement l’état déjà présent dans MySQL.",
    )
    args = parser.parse_args()
    engine = create_engine(_database_url(), pool_pre_ping=True, pool_recycle=1800)
    try:
        counts = migrate(args.source, engine, replace_state=args.replace_state)
    finally:
        engine.dispose()
    print(
        f"Migration terminée : état BETAF transféré, "
        f"{counts['users']} compte(s) ajouté(s), {counts['audit']} entrée(s) d’audit ajoutée(s)."
    )


if __name__ == "__main__":
    main()
