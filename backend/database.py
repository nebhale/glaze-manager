import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(data_dir: Path):
    data_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{data_dir / 'glaze.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=30000")

    return engine


def data_directory():
    return Path(os.environ.get("GLAZE_DATA_DIR", "data")).resolve()


def session_factory(engine):
    return sessionmaker(bind=engine, expire_on_commit=False)
