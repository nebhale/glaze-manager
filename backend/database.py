import os
from pathlib import Path

from sqlalchemy import MetaData, Table, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.schema import CreateTable


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


def allow_unassigned_manufacturer(engine):
    # Older SQLite versions require a table rebuild to relax a NOT NULL constraint.
    with engine.connect() as conn:

        def needs_rebuild():
            return (
                conn.exec_driver_sql(
                    """SELECT 1 FROM pragma_table_info('glazes')
                   WHERE name = 'manufacturer_id' AND "notnull" = 1"""
                ).scalar()
                == 1
            )

        if not needs_rebuild():
            return
        conn.commit()
        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        try:
            conn.exec_driver_sql("BEGIN IMMEDIATE")
            if needs_rebuild():
                table = Table("glazes", MetaData(), autoload_with=conn)
                table.c.manufacturer_id.nullable = True
                table.name = "glazes_rebuild"
                conn.execute(CreateTable(table))
                definitions = (
                    conn.exec_driver_sql(
                        """SELECT sql FROM sqlite_schema WHERE tbl_name = 'glazes'
                       AND type IN ('index', 'trigger') AND sql IS NOT NULL"""
                    )
                    .scalars()
                    .all()
                )
                conn.exec_driver_sql("INSERT INTO glazes_rebuild SELECT * FROM glazes")
                conn.exec_driver_sql("DROP TABLE glazes")
                conn.exec_driver_sql("ALTER TABLE glazes_rebuild RENAME TO glazes")
                for definition in definitions:
                    conn.exec_driver_sql(definition)
                if conn.exec_driver_sql("PRAGMA foreign_key_check").first():
                    raise ValueError("Invalid foreign key while upgrading glazes")
            conn.commit()
        finally:
            conn.rollback()
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
