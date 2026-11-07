from fastapi.testclient import TestClient
from sqlalchemy import MetaData

from backend import models as m
from backend.app import create_app
from backend.database import Base, make_engine


def test_existing_inventory_accepts_unassigned_glazes(tmp_path):
    engine = make_engine(tmp_path)
    old_schema = MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(old_schema)
    old_schema.tables["glazes"].c.manufacturer_id.nullable = False
    old_schema.create_all(engine)
    with engine.begin() as conn:
        conn.execute(m.Manufacturer.__table__.insert().values(id="maker", name="Studio"))
        conn.execute(
            m.Glaze.__table__.insert().values(id="blue", manufacturer_id="maker", name="Blue")
        )
        conn.execute(m.Container.__table__.insert().values(id="jar", number=1, glaze_id="blue"))
    engine.dispose()

    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/api/v1/device/jars/1").json()["manufacturer_name"] == "Studio"
        result = client.post("/api/v1/glazes", json={"name": "Red"})
        assert result.status_code == 201
        assert result.json()["manufacturer_id"] is None
        assert client.patch(
            "/api/v1/glazes/blue",
            json={"expected": {"manufacturer_id": "maker"}, "changes": {"manufacturer_id": None}},
        ).is_success
        assert client.get("/api/v1/device/jars/1").json()["manufacturer_name"] is None
        refs = client.get("/api/v1/glaze-options").json()
        assert {g["glaze_name"] for g in refs} == {"Blue", "Red"}
        assert all(g["manufacturer_name"] is None for g in refs)
        assert (
            client.post(
                "/api/v1/glazes", json={"name": "Bad", "manufacturer_id": "missing"}
            ).status_code
            == 404
        )
