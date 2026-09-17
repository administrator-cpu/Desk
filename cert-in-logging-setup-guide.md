# What To Do: CERT-In Logging & Retention Setup

**Companion to:** remote-access-platform-india-compliance-addendum.md
**Applies to:** Your existing India-hosted Windows VPS (signaling server)
**Cost:** ₹0 — uses infrastructure you already have

---

## 1. What you're actually required to do

CERT-In's 2022 Directions require you to:

1. **Log** connection/access events on your signaling server.
2. **Store** those logs on infrastructure physically located in India.
3. **Retain** them for at least 180 days.
4. **Produce them on request** if CERT-In ever asks (e.g., during an incident investigation).
5. **Delete or manage them responsibly** past retention — not required to auto-delete, but good practice so this doesn't quietly turn into an unmanaged, ever-growing liability.

You already satisfy #2, since your VPS is India-hosted. The rest is a small piece of application configuration, not new infrastructure.

---

## 2. What "logging" means here, concretely

Not your application database (MongoDB) and not your Redis room state — those are separate, already covered by your Backend Schema. This is a **separate, append-only record** of who connected, when, and what happened, written to plain text/JSON files on disk.

**What to log**, per event, at minimum:
- Timestamp
- Event type (room created, join attempt, accept/reject, session start/end)
- Source IP address (where available)
- Room code or session identifier (not sensitive on its own, but useful for correlating an incident)

**What NOT to log** (per your Backend Schema §7, which already gets this right): video, keystrokes, mouse coordinates, or any session content. Logging here is about *who connected when*, not *what they did on screen*.

---

## 3. The three things to set up

### 3.1 A dedicated log folder on the VPS
Pick a location, e.g. `C:\logs\signaling\`, separate from your application code. One file per day keeps things manageable (e.g. `2026-09-17.log`).

### 3.2 Your signaling server writes to it
Whatever backend framework you're running, you need it to write structured log lines (timestamp + event + relevant fields) to that folder as connection events happen — in addition to, or instead of, whatever console/debug output you already have. This is normal application logging, just pointed at a persistent file instead of only the terminal.

Any logging library for your stack works — the specific tool doesn't matter, what matters is:
- It writes to disk (not just console).
- It rotates daily (one file per day, not one giant growing file).
- It timestamps each entry.

### 3.3 Automatic cleanup after 180 days
Something needs to delete log files older than 180 days so this doesn't grow forever and doesn't become "we're retaining data past what we told CERT-In / our privacy policy says." Two ways to do this:

- **Built into the logging library** (most logging libraries that support daily rotation also support "delete after N days" as a config option — check whichever one you use).
- **A scheduled task on the VPS**, independent of the app: Windows Task Scheduler running a small script once a day that deletes any file in the log folder older than 180 days. This works no matter what logging tool you use, and is a reasonable fallback if your library doesn't support auto-cleanup.

---

## 4. Verification checklist

Before considering this "done," confirm:

- [ ] Log files are actually being written when you test a pairing (create room → join → accept) — check the folder after a test run.
- [ ] Each log entry has a timestamp, event type, and IP where applicable.
- [ ] Files roll over daily rather than one file growing indefinitely.
- [ ] A file older than 180 days actually gets deleted (test this by temporarily setting a short retention window, like 1 day, confirming deletion works, then setting it back to 180).
- [ ] The VPS's disk (not just billing address) is confirmed India-located — check your provider's dashboard for the actual data center region, not just the account country.
- [ ] Logs are NOT being written to your MongoDB or Redis — this should be a separate file-based system with no impact on request latency or database load.

---

## 5. What this does *not* cover yet

This addendum only covers the CERT-In logging/retention piece. Still open, from the earlier compliance addendum:

- The CERT-In classification question (ordinary service provider vs. VPN/VPS-style — changes whether 180-day or 5-year retention applies) — still needs a lawyer's opinion before Phase 4.
- DPDP Act items (privacy notice, consent, data export/delete endpoints) — separate work, tracked in the main addendum's Phase 4 steps.
- Incident reporting runbook (the 6-hour CERT-In reporting requirement) — you need logs *before* you can report from them, so this section was the prerequisite; the runbook itself is still a to-do.

---

## 6. One-line summary

Point your signaling server's logging at a dated folder on your existing India VPS, keep 180 days of it, auto-delete past that — no new services, no new spend, roughly an afternoon of setup.
