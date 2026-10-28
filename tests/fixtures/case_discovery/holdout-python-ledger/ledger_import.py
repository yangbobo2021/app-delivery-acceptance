import csv
import sqlite3
import sys


SCHEMA = "CREATE TABLE IF NOT EXISTS ledger (external_id TEXT PRIMARY KEY, amount INTEGER NOT NULL, updated_at TEXT NOT NULL)"


def load_csv(stream, connection):
    connection.execute(SCHEMA)
    changed = 0
    with connection:
        for row in csv.DictReader(stream):
            result = connection.execute(
                "INSERT INTO ledger VALUES (?, ?, ?) ON CONFLICT(external_id) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at WHERE excluded.updated_at > ledger.updated_at",
                (row["external_id"], int(row["amount"]), row["updated_at"]),
            )
            changed += result.rowcount
    return changed


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8", newline="") as stream, sqlite3.connect(sys.argv[2]) as connection:
        print(load_csv(stream, connection))
