import json
from pathlib import Path
import tempfile
import unittest

from parcel import InsufficientStock, reserve


class Reservations(unittest.TestCase):
    def test_updates_requested_stock_only(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'inventory.json'
            path.write_text(json.dumps({'book': 10, 'lamp': 4}))
            self.assertEqual(reserve(path, 'book', 3), 7)
            self.assertEqual(json.loads(path.read_text()), {'book': 7, 'lamp': 4})

    def test_rejects_without_writing(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'inventory.json'
            path.write_text('{"book": 2, "lamp": 4}\n')
            before = path.read_bytes()
            with self.assertRaises(InsufficientStock):
                reserve(path, 'book', 3)
            self.assertEqual(path.read_bytes(), before)
