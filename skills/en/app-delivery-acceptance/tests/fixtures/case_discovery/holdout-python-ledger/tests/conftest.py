import io
import sqlite3
import pytest
from ledger_import import SCHEMA, load_csv


@pytest.fixture
def db():
    connection = sqlite3.connect(":memory:")
    connection.execute(SCHEMA)
    yield connection
    connection.close()


@pytest.fixture
def feed(db):
    def apply(*rows):
        data = "external_id,amount,updated_at\n" + "\n".join(",".join(map(str, row)) for row in rows) + "\n"
        return load_csv(io.StringIO(data), db)
    return apply
