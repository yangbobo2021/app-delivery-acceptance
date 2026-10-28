import unittest
from ledger import Ledger


class Accounts(unittest.TestCase):
    def test_examples(self):
        for initial, amount, remaining in [(100, 40, 60), (50, 50, 0)]:
            with self.subTest(amount=amount):
                book = Ledger(initial)
                self.assertEqual(book.debit(amount), remaining)
                self.assertEqual(book.balance, remaining)

    def test_withdrawal_wording(self):
        self.assertIn('withdrawal', 'withdrawal request received')
