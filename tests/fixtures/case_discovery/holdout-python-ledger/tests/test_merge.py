import pytest


@pytest.mark.parametrize("incoming_time,amount,expected", [
    ("2026-01-03T00:00:00Z", 250, 250),
    ("2026-01-01T00:00:00Z", 50, 100),
    ("2026-01-02T00:00:00Z", 999, 100),
])
def test_merge_order(db, feed, incoming_time, amount, expected):
    feed(("A", 100, "2026-01-02T00:00:00Z"))
    feed(("A", amount, incoming_time))
    assert db.execute("SELECT amount FROM ledger WHERE external_id='A'").fetchone() == (expected,)
    assert db.execute("SELECT count(*) FROM ledger").fetchone() == (1,)


def test_repeating_batch_has_no_writes(db, feed):
    batch = (("A", 100, "2026-01-02T00:00:00Z"), ("B", 200, "2026-01-02T00:00:00Z"))
    assert feed(*batch) == 2
    assert feed(*batch) == 0
    assert db.execute("SELECT external_id, amount FROM ledger ORDER BY external_id").fetchall() == [("A", 100), ("B", 200)]


def test_new_record_can_be_loaded(db, feed):
    assert feed(("A", 100, "2026-01-02T00:00:00Z")) == 1
    assert db.execute("SELECT external_id, amount FROM ledger").fetchall() == [("A", 100)]


def test_merge_returns_a_count(db, feed):
    feed(("A", 100, "2026-01-02T00:00:00Z"))
    result = feed(("A", 250, "2026-01-03T00:00:00Z"))
    assert isinstance(result, int)
