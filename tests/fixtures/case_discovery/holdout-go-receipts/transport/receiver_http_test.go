package transport_test

import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
    receipts "example.org/receipts"
)

func deliver(t *testing.T, receiver *receipts.Receiver, event string) receipts.Receipt {
    t.Helper()
    request := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(`{"event_id":"` + event + `"}`))
    response := httptest.NewRecorder()
    receiver.ServeHTTP(response, request)
    if response.Code != http.StatusOK { t.Fatalf("status=%d", response.Code) }
    var result receipts.Receipt
    if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil { t.Fatal(err) }
    return result
}

func TestNetworkReplay(t *testing.T) {
    receiver := receipts.NewReceiver()
    first := deliver(t, receiver, "payment-17")
    second := deliver(t, receiver, "payment-17")
    if first != second { t.Fatalf("receipts differ: %#v %#v", first, second) }
    if receiver.Saves != 1 { t.Fatalf("saves=%d", receiver.Saves) }
}

func TestIdempotencyCapabilityHeader(t *testing.T) {
    response := httptest.NewRecorder()
    receipts.NewReceiver().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
    if response.Header().Get("X-Idempotency") != "supported" { t.Fatal("missing header") }
}

func TestNotificationPayloadIsAccepted(t *testing.T) {
    receiver := receipts.NewReceiver()
    deliver(t, receiver, "payment-17")
}
