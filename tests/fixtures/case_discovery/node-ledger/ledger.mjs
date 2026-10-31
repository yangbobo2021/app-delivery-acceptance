export class Ledger {
  constructor(balance) { this.balance=balance; }
  withdraw(amount) {
    if(amount > this.balance) throw new Error('insufficient');
    this.balance-=amount;
    return this.balance;
  }
}
