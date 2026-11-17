# Cylinder Ops requirements and architecture

An LPG agency needs one record of each customer connection, booking, cylinder movement, delivery and payment. Staff work within authorized branches. Customers see their own accounts. Drivers see only their own assignments. Provider and payment connectivity requires a separately validated contract.

## Runtime

Next.js serves the staff, customer and driver workspaces and the versioned API. Domain services own commands, authorization and transaction boundaries. Mongoose persists data in a replica set. A separate worker leases durable outbox records and commits results with the lease token. No request waits for a messaging provider.

## Booking and custody

Pending validation → confirmed → allocated → ready for dispatch → out for delivery → delivered → closed. Pending bookings can be rejected. Bookings can be held before allocation. Cancelling an allocated or ready booking releases its reservation. Dispatch consumes the reservation and moves filled units into driver custody. Completion moves units out of custody and records empty returns and proof. Failure returns filled units to warehouse stock only when the driver confirms physical return. Failed bookings can be confirmed for another attempt.

## Data and API

Business identifiers are UUIDs. Tenant collections index agency and branch plus their natural lookup keys. A booking request key is unique per agency, branch and actor. Balances are unique by agency, branch, warehouse and product. The booking, booking event, any stock movement, invoice and outbox event commit together for each applicable command. Integer paise preserve monetary values. See the model definitions for the implemented indexes and the OpenAPI document for transport.

## External dependencies

Winquly requires documented authentication, signing, event formats, template policy, message identifiers and idempotency guarantees. The adapter boundary accepts an approved contract implementation. No LPG oil marketing company API or online gateway is configured. Manual cash and verified UPI recording use server-side balances. Agency policies, safety contacts, taxes and retention require review by the deploying agency.
