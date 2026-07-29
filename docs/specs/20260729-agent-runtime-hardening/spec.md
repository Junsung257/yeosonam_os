# Agent Runtime Hardening Spec

Date: 2026-07-29

## Problem

The agent control plane reports old request-scoped work as live because several
streaming paths close the HTTP response before persisting terminal task and trace
state. Approval requests can also be created without an expiry, while the cleanup
cron only expires rows with an explicit `expires_at`.

The approval API can mark a frozen task `resumed` even though no versioned,
persisted run state exists to resume the original execution.

## Required Behavior

- A request-scoped task is terminal before its response stream is closed.
- V1 fallback does not leave the V2 wrapper task running.
- Unsupported Jarvis V2 dispatch does not create a task or trace.
- Every new approval receives a seven-day expiry unless a caller supplies one.
- High-risk handoff closes the current HTTP trace while leaving the task frozen
  until rejection or expiry.
- Existing daily agent housekeeping expires:
  - pending approvals past explicit expiry;
  - legacy pending approvals older than seven days with no expiry;
  - frozen tasks attached to expired approvals;
  - request-scoped active tasks stale for more than 24 hours;
  - active tasks past explicit task expiry;
  - trace spans left open for more than 24 hours.
- The unused approval-decision endpoint is removed until a durable resume engine
  and an atomic decision contract exist. The observation-only approval ledger
  remains available.
- The admin office remains a read-only evidence surface.
- Authenticated operators can run housekeeping without invoking agent actions,
  GSC, or external-channel jobs.

## Safety Boundaries

- No new autonomous agent loop, agent runtime, queue, or cron schedule.
- No money, booking, customer, publishing, credential, or tenant mutation.
- No service-role credential reaches the browser.
- Housekeeping updates only agent execution metadata and uses status guards so it
  is idempotent under repeated cron delivery.

## Out Of Scope

- Building the first multi-agent executor.
- Resuming model execution after human approval.
- Adding approval buttons to the admin office.
- Cleaning unrelated Supabase advisor findings or unrelated Vercel cron failures.
