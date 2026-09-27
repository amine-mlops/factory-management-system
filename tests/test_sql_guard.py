import pytest

from backend import sql_engine
from backend.auth import load_principal

T = "tnt_plant_a_demo"


@pytest.fixture(scope="module")
def driver(client):
    return load_principal("usr_jlee", T)


@pytest.fixture(scope="module")
def owner(client):
    return load_principal("usr_owner", T)


@pytest.mark.parametrize("sql", [
    "DROP TABLE shipments",
    "SELECT * FROM shipments; DELETE FROM shipments",
    "SELECT 1; SELECT 2",
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM read_parquet('x.parquet')",
    "SELECT * FROM glob('*')",
    "PRAGMA table_info('users')",
    "SELECT * FROM users",
    "SELECT * FROM main.users",
    "SELECT * FROM quotations",
    "SELECT getenv('HOME')",
    "ATTACH 'x.db' AS x",
    "COPY shipments TO 'out.csv'",
    "INSERT INTO shipments SELECT * FROM shipments",
])
def test_rejected(driver, sql):
    with pytest.raises(sql_engine.SQLRejected):
        sql_engine.run(driver, sql)


def test_driver_select_is_rewritten(driver):
    out = sql_engine.run(driver, "SELECT * FROM shipments")
    assert "driver_id = 'usr_jlee'" in out["sql"] and "tenant_id = 'tnt_plant_a_demo'" in out["sql"]
    assert out["rows"] and {r["driver_id"] for r in out["rows"]} == {"usr_jlee"}
    assert {r["tenant_id"] for r in out["rows"]} == {T}  # BF-2201 (other tenant, same driver id) is excluded


def test_driver_telemetry_scoped_to_own_vehicles(driver):
    out = sql_engine.run(driver, "SELECT * FROM telemetry")
    assert out["rows"] == []  # TRK-88 belongs to another driver's shipment


def test_tenant_filter_always_present(owner):
    out = sql_engine.run(owner, "SELECT s.shipment_id, i.product_name FROM shipments s JOIN inventory i ON i.batch_id = s.batch_id")
    assert out["sql"].count("tenant_id = 'tnt_plant_a_demo'") == 2
    assert all(r["shipment_id"] != "BF-2201" for r in out["rows"])


def test_limit_added(owner):
    assert "LIMIT 200" in sql_engine.run(owner, "SELECT * FROM inventory")["sql"]
    assert "LIMIT 200" in sql_engine.run(owner, "SELECT * FROM inventory LIMIT 100000")["sql"]


def test_quoted_injection_is_escaped(owner):
    out = sql_engine.run(owner, "SELECT * FROM shipments WHERE customer = 'x'' OR 1=1 --'")
    assert out["rows"] == []
