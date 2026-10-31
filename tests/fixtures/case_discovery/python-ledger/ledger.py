class Ledger:
    def __init__(self, balance): self.balance = balance
    def debit(self, amount):
        if amount > self.balance: raise ValueError('insufficient')
        self.balance -= amount
        return self.balance
