import csv
import io


def test_duplicate_column_name_is_preserved():
    row = next(csv.reader(io.StringIO("external_id,external_id\n")))
    assert row == ["external_id", "external_id"]
