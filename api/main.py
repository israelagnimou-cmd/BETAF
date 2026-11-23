from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Integer, JSON, String, Text, create_engine, delete, func, inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


load_dotenv(Path(__file__).with_name(".env"))

SESSION_TTL_SECONDS = 8 * 60 * 60
INITIAL_SETTINGS = {
    "font": "Arial",
    "city": "Abidjan",
    "watermark": True,
    "intensity": 12,
    "logo": "",
    "footer": "BETAF-N°R.C.C.M : CI-ABG-2024-B-117 - SIEGE SOCIAL : AGNIBILEKROU QUARTIER MAIRIE-NORD à 600 mètres DU MOULIN SANGARE | TEL : NUMERO DE LA STRUCTURE",
    "theme": "light",
    "urgencyWindowDays": 30,
}
INITIAL_DOCUMENT_TYPES = [
    "Attestation de propriété",
    "Attestation d’attribution villageoise",
    "Attestation de cession",
    "Attestation de vente",
    "Plan topographique",
    "Devis estimatif",
    "Rapport de suivi de chantier",
    "Procès-verbal d’implantation",
]
INITIAL_STATE = {
    "clients": [],
    "docs": [],
    "documentTypes": INITIAL_DOCUMENT_TYPES,
    "documentTypeTemplates": {},
    "archive": [],
    "settings": INITIAL_SETTINGS,
    "urgencyDismissals": [],
}
UserRole = Literal["admin", "manager"]


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'manager')", name="ck_users_role"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    fullname: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(String(256))
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class AppState(Base):
    __tablename__ = "app_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[dict] = mapped_column(JSON)


class ApiSession(Base):
    __tablename__ = "api_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[int] = mapped_column(BigInteger, index=True)


class AuditEntry(Base):
    __tablename__ = "audit_entries"

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)


class LoginInput(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)


class StateUpdate(BaseModel):
    version: int = Field(ge=0)
    data: dict


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    fullname: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=12, max_length=1024)
    role: UserRole = "manager"
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=254)


class UserProfileUpdate(BaseModel):
    fullname: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=254)


class UserAccountUpdate(BaseModel):
    role: UserRole | None = None
    is_active: bool | None = None
    restore_archived: bool = False


class PasswordChange(BaseModel):
    current_password: str | None = Field(default=None, max_length=1024)
    new_password: str = Field(min_length=12, max_length=1024)


class PasswordReset(BaseModel):
    temporary_password: str = Field(min_length=12, max_length=1024)


class BrowserImport(BaseModel):
    data: dict
    users: list[dict] = Field(default_factory=list)


class AuditInput(BaseModel):
    action: str = Field(min_length=1, max_length=100)
    details: str | None = Field(default=None, max_length=250)


def _is_empty_state(data: dict) -> bool:
    return (
        not any(data.get(key) for key in ("clients", "docs", "archive", "urgencyDismissals"))
        and data.get("documentTypes", []) in ([], INITIAL_DOCUMENT_TYPES)
        and not data.get("documentTypeTemplates")
        and data.get("settings", {}) in ({}, INITIAL_SETTINGS)
    )


def _password_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=2**14,
        r=8,
        p=1,
        dklen=64,
        maxmem=64 * 1024 * 1024,
    )
    return f"{salt}:{digest.hex()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, expected = stored_hash.split(":", 1)
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt.encode("utf-8"),
            n=2**14,
            r=8,
            p=1,
            dklen=64,
            maxmem=64 * 1024 * 1024,
        ).hex()
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _public_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "fullname": user.fullname,
        "role": user.role,
        "phone": user.phone,
        "email": user.email,
        "is_active": user.is_active,
        "is_archived": user.is_archived,
        "must_change_password": user.must_change_password,
    }


def _database_url() -> str:
    url = os.getenv("BETAF_DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("Définissez BETAF_DATABASE_URL avec une URL SQLite, MySQL ou PostgreSQL.")
    if not url.startswith(("sqlite:///", "mysql+pymysql://", "postgresql://", "postgresql+psycopg://")):
        raise RuntimeError("BETAF_DATABASE_URL doit utiliser sqlite:/// , mysql+pymysql:// ou postgresql://.")
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def _upgrade_schema(engine: Engine) -> None:
    Base.metadata.create_all(engine)
    user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
    column_definitions = {
        "phone": "VARCHAR(40) NULL",
        "email": "VARCHAR(254) NULL",
        "is_active": "BOOLEAN NOT NULL DEFAULT 1",
        "is_archived": "BOOLEAN NOT NULL DEFAULT 0",
        "must_change_password": "BOOLEAN NOT NULL DEFAULT 0",
    }
    with engine.begin() as connection:
        for name, definition in column_definitions.items():
            if name not in user_columns:
                connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {definition}"))
        connection.execute(
            text("UPDATE users SET role = 'manager', is_active = 0 WHERE role = 'viewer'")
        )


def create_app(
    *,
    engine: Engine | None = None,
    initial_admin: tuple[str, str, str] | None = None,
) -> FastAPI:
    if engine is None:
        database_url = _database_url()
        engine_options = {"pool_pre_ping": True, "pool_recycle": 1800}
        if database_url.startswith("sqlite:///"):
            engine_options["connect_args"] = {"check_same_thread": False}
        database_engine = create_engine(database_url, **engine_options)
    else:
        database_engine = engine
    make_session = sessionmaker(bind=database_engine, expire_on_commit=False)
    cors_origins = [
        origin.strip()
        for origin in os.getenv("BETAF_CORS_ORIGINS", "*").split(",")
        if origin.strip()
    ]

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        _upgrade_schema(database_engine)
        with make_session() as db:
            app_state = db.get(AppState, 1)
            if app_state is None:
                db.add(AppState(id=1, version=0, data=INITIAL_STATE))
            elif app_state.version == 0 and _is_empty_state(app_state.data):
                app_state.data = INITIAL_STATE
            if db.scalar(select(User.id).limit(1)) is None:
                admin_config = initial_admin
                if admin_config is None:
                    password = os.getenv("BETAF_ADMIN_PASSWORD", "")
                    if len(password) < 12:
                        raise RuntimeError(
                            "Définissez BETAF_ADMIN_PASSWORD avec au moins 12 caractères avant le démarrage."
                        )
                    admin_config = (
                        os.getenv("BETAF_ADMIN_USERNAME", "admin").strip(),
                        os.getenv("BETAF_ADMIN_FULLNAME", "Administrateur BETAF").strip(),
                        password,
                    )
                username, fullname, password = admin_config
                if not username or not fullname or len(password) < 12:
                    raise RuntimeError("Le compte administrateur initial est incomplet ou son mot de passe est trop court.")
                db.add(
                    User(
                        id="admin",
                        username=username,
                        fullname=fullname,
                        role="admin",
                        password_hash=_password_hash(password),
                    )
                )
            db.commit()
        yield
        if engine is None:
            database_engine.dispose()

    app = FastAPI(title="BETAF Studio API", version="1.0.0", lifespan=lifespan)
    app.state.session_factory = make_session
    app.state.database_engine = database_engine
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins or ["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

    def get_db():
        with make_session() as db:
            yield db

    def authenticated_user(
        authorization: Annotated[str | None, Header()] = None,
        db: Session = Depends(get_db),
    ) -> User:
        scheme, _, token = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(status_code=401, detail="Authentification requise")
        session_record = db.get(ApiSession, _token_digest(token))
        if session_record is None or session_record.expires_at <= int(time.time()):
            if session_record is not None:
                db.delete(session_record)
                db.commit()
            raise HTTPException(status_code=401, detail="Session expirée ou invalide")
        user = db.get(User, session_record.user_id)
        if user is None or not user.is_active or user.is_archived:
            db.delete(session_record)
            db.commit()
            raise HTTPException(status_code=401, detail="Compte utilisateur désactivé")
        session_record.expires_at = int(time.time()) + SESSION_TTL_SECONDS
        db.commit()
        return user

    def require_admin(user: User = Depends(authenticated_user)) -> User:
        if user.role != "admin" or user.must_change_password:
            raise HTTPException(status_code=403, detail="Droits insuffisants")
        return user

    def require_ready_user(user: User = Depends(authenticated_user)) -> User:
        if user.must_change_password:
            raise HTTPException(status_code=403, detail="Changez votre mot de passe avant de continuer")
        return user

    def add_audit(db: Session, user: User, action: str, details: str | None = None) -> None:
        db.add(AuditEntry(user_id=user.id, action=action, details=details))

    def revoke_sessions(db: Session, user_id: str) -> None:
        db.execute(delete(ApiSession).where(ApiSession.user_id == user_id))

    def record_state_changes(db: Session, user: User, before: dict, after: dict) -> None:
        for collection, singular in (("clients", "client"), ("docs", "document")):
            def index_records(records: object) -> dict[str, dict]:
                indexed: dict[str, dict] = {}
                if not isinstance(records, list):
                    return indexed
                occurrences: dict[str, int] = {}
                for record in records:
                    if not isinstance(record, dict):
                        continue
                    record_id = str(record.get("id") or hashlib.sha256(
                        json.dumps(record, sort_keys=True, ensure_ascii=False).encode("utf-8")
                    ).hexdigest()[:16])
                    occurrence = occurrences.get(record_id, 0)
                    occurrences[record_id] = occurrence + 1
                    indexed[f"{record_id}:{occurrence}"] = record
                return indexed

            old_records = index_records(before.get(collection))
            new_records = index_records(after.get(collection))
            for record_id in sorted(new_records.keys() - old_records.keys()):
                add_audit(db, user, f"{singular}-created", f"record={record_id}")
            for record_id in sorted(old_records.keys() - new_records.keys()):
                add_audit(db, user, f"{singular}-deleted", f"record={record_id}")
            for record_id in sorted(old_records.keys() & new_records.keys()):
                if old_records[record_id] != new_records[record_id]:
                    add_audit(db, user, f"{singular}-updated", f"record={record_id}")

        old_settings = before.get("settings") if isinstance(before.get("settings"), dict) else {}
        new_settings = after.get("settings") if isinstance(after.get("settings"), dict) else {}
        changed_settings = sorted(
            key for key in old_settings.keys() | new_settings.keys()
            if old_settings.get(key) != new_settings.get(key)
        )
        if changed_settings:
            add_audit(db, user, "settings-updated", f"fields={','.join(changed_settings)[:180]}")

        for collection, action in (
            ("documentTypes", "document-types-updated"),
            ("documentTypeTemplates", "document-templates-updated"),
            ("archive", "archive-updated"),
            ("urgencyDismissals", "urgency-updated"),
        ):
            before_value = before.get(collection, {}) if collection == "documentTypeTemplates" else before.get(collection)
            after_value = after.get(collection, {}) if collection == "documentTypeTemplates" else after.get(collection)
            if before_value != after_value:
                add_audit(db, user, action)

    def ensure_record_ids(data: dict) -> None:
        for collection in ("clients", "docs"):
            records = data.get(collection)
            if isinstance(records, list):
                for record in records:
                    if isinstance(record, dict) and not record.get("id"):
                        record["id"] = str(uuid.uuid4())

    def ensure_active_admin_remains(db: Session, target: User, next_role: str, next_active: bool, next_archived: bool) -> None:
        if (
            target.role == "admin"
            and target.is_active
            and not target.is_archived
            and (next_role != "admin" or not next_active or next_archived)
        ):
            admin_count = db.scalar(
                select(func.count(User.id)).where(
                    User.role == "admin",
                    User.is_active.is_(True),
                    User.is_archived.is_(False),
                )
            ) or 0
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Impossible de désactiver le dernier administrateur actif")

    @app.get("/api/health")
    def health():
        database = "SQLite" if database_engine.dialect.name == "sqlite" else "MySQL"
        return {"ok": True, "service": "BETAF Studio API", "database": database}

    @app.post("/api/login")
    def login(payload: LoginInput, db: Session = Depends(get_db)):
        user = db.scalar(select(User).where(User.username == payload.username.strip()))
        if (
            user is None
            or not user.is_active
            or user.is_archived
            or not _verify_password(payload.password, user.password_hash)
        ):
            raise HTTPException(status_code=401, detail="Identifiants invalides")
        token = secrets.token_urlsafe(48)
        db.add(
            ApiSession(
                token_hash=_token_digest(token),
                user_id=user.id,
                expires_at=int(time.time()) + SESSION_TTL_SECONDS,
            )
        )
        add_audit(db, user, "login")
        version = db.get(AppState, 1).version
        db.commit()
        return {"token": token, "user": _public_user(user), "version": version}

    @app.post("/api/logout")
    def logout(
        authorization: Annotated[str | None, Header()] = None,
        user: User = Depends(authenticated_user),
        db: Session = Depends(get_db),
    ):
        _, _, token = (authorization or "").partition(" ")
        db.delete(db.get(ApiSession, _token_digest(token)))
        add_audit(db, user, "logout")
        db.commit()
        return {"ok": True}

    @app.get("/api/me")
    def get_current_user(user: User = Depends(authenticated_user)):
        return {"user": _public_user(user)}

    @app.patch("/api/me")
    def update_current_user(
        payload: UserProfileUpdate,
        user: User = Depends(authenticated_user),
        db: Session = Depends(get_db),
    ):
        fullname = payload.fullname.strip()
        email = (payload.email or "").strip() or None
        phone = (payload.phone or "").strip() or None
        if not fullname:
            raise HTTPException(status_code=400, detail="Le nom complet est requis")
        if email and ("@" not in email or email.startswith("@") or email.endswith("@")):
            raise HTTPException(status_code=400, detail="Adresse e-mail invalide")
        changed = []
        for field, value in (("fullname", fullname), ("email", email), ("phone", phone)):
            if getattr(user, field) != value:
                setattr(user, field, value)
                changed.append(field)
        if changed:
            add_audit(db, user, "profile-updated", f"fields={','.join(changed)}")
            db.commit()
        return {"user": _public_user(user)}

    @app.put("/api/me/password")
    def change_current_password(
        payload: PasswordChange,
        authorization: Annotated[str | None, Header()] = None,
        user: User = Depends(authenticated_user),
        db: Session = Depends(get_db),
    ):
        if not user.must_change_password and (
            not payload.current_password
            or not _verify_password(payload.current_password, user.password_hash)
        ):
            raise HTTPException(status_code=400, detail="Mot de passe actuel invalide")
        user.password_hash = _password_hash(payload.new_password)
        user.must_change_password = False
        _, _, token = (authorization or "").partition(" ")
        current_hash = _token_digest(token)
        db.execute(
            delete(ApiSession).where(
                ApiSession.user_id == user.id,
                ApiSession.token_hash != current_hash,
            )
        )
        add_audit(db, user, "password-changed")
        db.commit()
        return {"user": _public_user(user)}

    @app.get("/api/state")
    def read_state(
        _: User = Depends(require_ready_user),
        db: Session = Depends(get_db),
    ):
        state = db.get(AppState, 1)
        return {"version": state.version, "data": state.data}

    @app.put("/api/state")
    def write_state(
        payload: StateUpdate,
        user: User = Depends(require_ready_user),
        db: Session = Depends(get_db),
    ):
        state = db.scalar(select(AppState).where(AppState.id == 1).with_for_update())
        if state.version != payload.version:
            current = {"version": state.version, "data": state.data}
            raise HTTPException(
                status_code=409,
                detail={"message": "Conflit de synchronisation", "state": current},
            )
        data = payload.data
        if user.role == "manager":
            old_settings = state.data.get("settings", {})
            new_settings = data.get("settings", {})
            if not isinstance(old_settings, dict) or not isinstance(new_settings, dict):
                raise HTTPException(status_code=400, detail="Paramètres invalides")
            old_org_settings = {key: value for key, value in old_settings.items() if key != "theme"}
            new_org_settings = {key: value for key, value in new_settings.items() if key != "theme"}
            if (
                data.get("documentTypes") != state.data.get("documentTypes")
                or data.get("documentTypeTemplates", {}) != state.data.get("documentTypeTemplates", {})
                or data.get("urgencyDismissals") != state.data.get("urgencyDismissals")
                or old_org_settings != new_org_settings
            ):
                raise HTTPException(status_code=403, detail="Droits insuffisants pour modifier les paramètres")
            data = {
                **data,
                "settings": {
                    **old_settings,
                    **({"theme": new_settings["theme"]} if "theme" in new_settings else {}),
                },
            }
        record_state_changes(db, user, state.data, data)
        ensure_record_ids(data)
        state.data = data
        state.version += 1
        if not db.new:
            add_audit(db, user, "state-updated", f"version={state.version}")
        db.commit()
        return {"ok": True, "version": state.version}

    @app.post("/api/migrate-browser")
    def migrate_browser_data(
        payload: BrowserImport,
        admin: User = Depends(require_admin),
        db: Session = Depends(get_db),
    ):
        state = db.scalar(select(AppState).where(AppState.id == 1).with_for_update())
        state_changes = db.scalar(
            select(AuditEntry.id)
            .where(
                AuditEntry.action.in_(
                    (
                        "state-updated",
                        "client-created",
                        "client-updated",
                        "client-deleted",
                        "document-created",
                        "document-updated",
                        "document-deleted",
                        "document-types-updated",
                        "settings-updated",
                        "archive-updated",
                        "urgency-updated",
                    )
                )
            )
            .limit(1)
        )
        previous_imports = db.scalars(
            select(AuditEntry).where(AuditEntry.action == "browser-data-imported")
        ).all()
        has_completed_import = any(
            entry.details != "clients=0;docs=0;users=0" for entry in previous_imports
        )
        if not _is_empty_state(state.data) or state_changes or has_completed_import:
            return {"imported": False, "reason": "server-already-initialized"}

        imported_users = 0
        for legacy in payload.users:
            username = str(legacy.get("username") or "").strip()
            fullname = str(legacy.get("fullname") or "").strip()
            password = legacy.get("password")
            if (
                not username
                or not fullname
                or not isinstance(password, str)
                or not password
                or db.scalar(select(User.id).where(User.username == username)) is not None
            ):
                continue
            legacy_role = legacy.get("role")
            is_legacy_viewer = legacy_role in {"viewer", "consultation"}
            role = legacy_role if legacy_role in {"admin", "manager"} else "manager"
            user_id = str(legacy.get("id") or f"legacy-{uuid.uuid4()}")
            if db.get(User, user_id) is not None:
                user_id = f"legacy-{uuid.uuid4()}"
            db.add(
                User(
                    id=user_id,
                    username=username,
                    fullname=fullname,
                    role=role,
                    password_hash=_password_hash(password),
                    phone=str(legacy.get("phone") or "").strip() or None,
                    email=str(legacy.get("email") or "").strip() or None,
                    is_active=not is_legacy_viewer,
                    is_archived=False,
                    must_change_password=True,
                )
            )
            add_audit(db, admin, "user-imported", f"user_id={user_id}")
            imported_users += 1

        if _is_empty_state(payload.data) and imported_users == 0:
            return {"imported": False, "reason": "nothing-to-import"}

        ensure_record_ids(payload.data)
        state.data = payload.data
        state.version += 1
        add_audit(
            db,
            admin,
            "browser-data-imported",
            f"clients={len(payload.data.get('clients', []))};docs={len(payload.data.get('docs', []))};users={imported_users}",
        )
        db.commit()
        return {"imported": True, "version": state.version, "users": imported_users}

    @app.get("/api/users")
    def list_users(
        _: User = Depends(require_admin),
        db: Session = Depends(get_db),
    ):
        users = db.scalars(select(User).order_by(User.fullname)).all()
        return {
            "users": [
                {**_public_user(user), "created_at": user.created_at.isoformat()}
                for user in users
            ]
        }

    @app.post("/api/users", status_code=201)
    def create_user(
        payload: UserCreate,
        admin: User = Depends(require_admin),
        db: Session = Depends(get_db),
    ):
        username = payload.username.strip()
        fullname = payload.fullname.strip()
        if not username or not fullname:
            raise HTTPException(status_code=400, detail="Nom complet et nom d’utilisateur requis")
        user = User(
            id=f"user-{uuid.uuid4()}",
            username=username,
            fullname=fullname,
            role=payload.role,
            password_hash=_password_hash(payload.password),
            phone=(payload.phone or "").strip() or None,
            email=(payload.email or "").strip() or None,
            must_change_password=True,
        )
        db.add(user)
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail="Ce nom utilisateur existe déjà") from exc
        add_audit(db, admin, "user-created", user.id)
        db.commit()
        return {"id": user.id}

    @app.patch("/api/users/{user_id}")
    def update_user_account(
        user_id: str,
        payload: UserAccountUpdate,
        admin: User = Depends(require_admin),
        db: Session = Depends(get_db),
    ):
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable")
        next_role = payload.role or user.role
        next_archived = False if payload.restore_archived else user.is_archived
        next_active = True if payload.restore_archived else (
            payload.is_active if payload.is_active is not None else user.is_active
        )
        if next_archived:
            next_active = False
        ensure_active_admin_remains(db, user, next_role, next_active, next_archived)
        if user.id == admin.id and (not next_active or next_archived or next_role != "admin"):
            raise HTTPException(status_code=400, detail="Vous ne pouvez pas désactiver votre propre compte administrateur")
        changed = (
            user.role != next_role
            or user.is_active != next_active
            or user.is_archived != next_archived
        )
        user.role = next_role
        user.is_active = next_active
        user.is_archived = next_archived
        if changed:
            if not user.is_active or user.is_archived:
                revoke_sessions(db, user.id)
            add_audit(
                db,
                admin,
                "user-account-updated",
                f"user_id={user.id};role={user.role};active={user.is_active};archived={user.is_archived}",
            )
            db.commit()
        return {"user": _public_user(user)}

    @app.put("/api/users/{user_id}/reset-password")
    def reset_user_password(
        user_id: str,
        payload: PasswordReset,
        admin: User = Depends(require_admin),
        db: Session = Depends(get_db),
    ):
        user = db.get(User, user_id)
        if user is None or user.is_archived:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable")
        if user.id == admin.id:
            raise HTTPException(status_code=400, detail="Utilisez votre profil pour changer votre propre mot de passe")
        user.password_hash = _password_hash(payload.temporary_password)
        user.must_change_password = True
        revoke_sessions(db, user.id)
        add_audit(db, admin, "password-reset", f"user_id={user.id}")
        db.commit()
        return {"ok": True}

    @app.delete("/api/users/{user_id}")
    def delete_user(
        user_id: str,
        admin: User = Depends(require_admin),
        db: Session = Depends(get_db),
    ):
        if user_id == "admin":
            raise HTTPException(status_code=403, detail="Action interdite")
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable")
        ensure_active_admin_remains(db, user, user.role, False, True)
        if user.id == admin.id:
            raise HTTPException(status_code=400, detail="Vous ne pouvez pas archiver votre propre compte")
        user.is_active = False
        user.is_archived = True
        revoke_sessions(db, user.id)
        add_audit(db, admin, "user-archived", f"user_id={user_id}")
        db.commit()
        return {"ok": True}

    @app.get("/api/audit")
    def list_audit(
        _: User = Depends(require_admin),
        db: Session = Depends(get_db),
    ):
        rows = db.execute(
            select(AuditEntry, User.username, User.fullname)
            .outerjoin(User, User.id == AuditEntry.user_id)
            .order_by(AuditEntry.id.desc())
            .limit(500)
        ).all()
        return {
            "entries": [
                {
                    "id": entry.id,
                    "user_id": entry.user_id,
                    "username": username or "Compte archivé",
                    "fullname": fullname or "Compte archivé",
                    "action": entry.action,
                    "created_at": entry.created_at.isoformat(),
                    "details": entry.details,
                }
                for entry, username, fullname in rows
            ]
        }

    @app.post("/api/audit", status_code=201)
    def record_user_action(
        payload: AuditInput,
        user: User = Depends(require_ready_user),
        db: Session = Depends(get_db),
    ):
        if payload.action not in {"document-printed", "data-exported"}:
            raise HTTPException(status_code=400, detail="Action non prise en charge")
        add_audit(db, user, payload.action, payload.details)
        db.commit()
        return {"ok": True}

    web_dist = Path(__file__).parent.parent / "dist"
    assets_dir = web_dist / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="web-assets")

    @app.get("/", include_in_schema=False)
    def web_index():
        index_file = web_dist / "index.html"
        if not index_file.is_file():
            raise HTTPException(status_code=404, detail="Interface web non compilée")
        return FileResponse(index_file)

    @app.get("/{full_path:path}", include_in_schema=False)
    def web_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Route introuvable")
        candidate = (web_dist / full_path).resolve()
        try:
            candidate.relative_to(web_dist.resolve())
        except ValueError:
            raise HTTPException(status_code=404, detail="Fichier introuvable")
        if candidate.is_file():
            return FileResponse(candidate)
        index_file = web_dist / "index.html"
        if index_file.is_file():
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="Interface web non compilée")

    return app


app = create_app()
