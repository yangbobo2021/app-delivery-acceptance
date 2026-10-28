package receipts

import (
    "encoding/json"
    "net/http"
    "sync"
)

type Receipt struct {
    ID string `json:"id"`
    EventID string `json:"event_id"`
}

type Receiver struct {
    mu sync.Mutex
    records map[string]Receipt
    Saves int
}

func NewReceiver() *Receiver { return &Receiver{records: map[string]Receipt{}} }

func (r *Receiver) Record(eventID string) Receipt {
    r.mu.Lock()
    defer r.mu.Unlock()
    if old, ok := r.records[eventID]; ok { return old }
    result := Receipt{ID: "rcpt-" + eventID, EventID: eventID}
    r.records[eventID] = result
    r.Saves++
    return result
}

func (r *Receiver) ServeHTTP(w http.ResponseWriter, req *http.Request) {
    if req.URL.Path == "/health" {
        w.Header().Set("X-Idempotency", "supported")
        w.WriteHeader(http.StatusNoContent)
        return
    }
    var event struct { EventID string `json:"event_id"` }
    if err := json.NewDecoder(req.Body).Decode(&event); err != nil || event.EventID == "" {
        http.Error(w, "invalid event", http.StatusBadRequest)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(r.Record(event.EventID))
}
