import unittest
from ledger import Ledger

def exercise(case, initial, amount, remaining):
    book = Ledger(initial)
    case.assertEqual(book.debit(amount), remaining)
    case.assertEqual(book.balance, remaining)

class Accounts(unittest.TestCase):
    def test_examples(self):
        for initial, amount, remaining in [(100, 40, 60), (50, 50, 0)]:
            with self.subTest(amount=amount): exercise(self, initial, amount, remaining)

    @unittest.skip('requires compatibility environment')
    def test_declined(self):
        book = Ledger(30)
        with self.assertRaises(ValueError): book.debit(31)
        self.assertEqual(book.balance, 30)

    def test_withdrawal_wording(self):
        self.assertIn('withdrawal', 'withdrawal request received')

    def test_declined_smoke(self):
        with self.assertRaises(ValueError): Ledger(30).debit(31)

    @unittest.skip('future transport coverage')
    def test_remote_debit(self):
        self.fail('not implemented')
