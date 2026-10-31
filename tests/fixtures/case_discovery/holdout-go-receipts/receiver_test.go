package receipts

import "testing"

func TestDistinctNotifications(t *testing.T) {
    receiver := NewReceiver()
    first := receiver.Record("one")
    second := receiver.Record("two")
    if first.ID == second.ID { t.Fatal("different events shared a receipt") }
    if receiver.Saves != 2 { t.Fatalf("saves=%d", receiver.Saves) }
}
