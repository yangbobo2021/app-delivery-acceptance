# Reservation receipts HTTP service

Node 22+. Install the frozen lock with npm ci. npm test uses Node's built-in test runner;
npm run smoke checks the server command entry without running business operations.

Within one server process, POST /reserve accepts a request_id and a positive integer quantity.
The first successful request deducts the quantity from stock and returns status 200 and a
nonempty receipt ID. Retrying the same request_id returns the same receipt and does not
deduct stock again. Different request IDs get independent receipts and deductions.
Insufficient stock returns 409 and does not change stock. GET /stock returns current stock.
Data is intentionally in memory; durability across process restarts is not promised.
Each test creates a new service listening on an ephemeral local port and closes it afterward.
