# Ledger import

Imports UTF-8 CSV rows into SQLite. A row has `external_id`, `amount` and `updated_at`.

Run tests with `python -m pytest` (pytest required). The command line entry is
`python -m ledger_import input.csv ledger.db`.
