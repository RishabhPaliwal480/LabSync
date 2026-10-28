# LabSync — Project notes for demo and viva

## Problem
Students may not know which lab resource is available, bookings can overlap, and maintenance reports can remain disconnected from the equipment's booking status.

## Core rule
A resource is bookable only when it is active, marked `AVAILABLE`, and has no unresolved issue. The booking endpoint also checks for an overlapping confirmed reservation for the same resource, date, and time range.

## Main entities
- `users`: account, email, PBKDF2 password hash, role
- `resources`: equipment metadata and operational status
- `bookings`: user, resource, date, start/end time, purpose, status
- `issues`: resource, reporter, description, severity, status

## Status values
- Resource: `AVAILABLE`, `MAINTENANCE`, `UNAVAILABLE`
- Booking: `CONFIRMED`, `CANCELLED`, `COMPLETED`
- Issue: `OPEN`, `IN_PROGRESS`, `RESOLVED`
- Severity: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`

## Viva explanation
“LabSync is a Java web application with a JSP-based view, Servlets as controllers, a session-aware authentication filter, and JDBC for persistent data access. It connects booking and maintenance states so an unresolved issue prevents new reservations. The browser interface also has an offline demo mode for quick evaluation.”

## Design reference
The UI adopts the reference video's visual language—deep teal gradients, warm paper-colored sections, restrained orange accents, and clean data cards—without copying its text or product identity.
