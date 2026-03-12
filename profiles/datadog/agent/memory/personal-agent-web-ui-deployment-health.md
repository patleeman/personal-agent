---
id: personal-agent-web-ui-deployment-health
title: "Personal-agent web UI deployment health"
summary: "Known local deployment caveat: pa update can false-positive when an unmanaged process already owns port 3741 and launchd status alone is misleading."
type: "project"
status: "active"
tags:
  - "personal-agent"
  - "web-ui"
  - "deployment"
  - "health-check"
  - "launchd"
updated: 2026-03-12
---

# Personal-agent web UI deployment health

Known local deployment caveat: `pa update` can false-positive when an unmanaged process already owns port `3741` and launchd status alone is misleading.

## Current failure mode

- The managed web UI service can fail to bind `3741` with `EADDRINUSE` while an older unmanaged process continues serving traffic.
- The current update health check treats any `200` response from `http://127.0.0.1:3741/api/status` as success, so the wrong process can satisfy rollout validation.
- Launchd status alone is not a reliable proxy for health when the service is stuck in `spawn scheduled` with a non-zero last exit.

## Operator guidance

- When `pa update` appears to succeed but the app was not actually replaced, verify which process owns `3741` instead of trusting the health check alone.
- Distinguish the managed slot-based deployment under `~/.local/state/personal-agent/web/slots/...` from ad hoc repo-root `node packages/web/dist-server/index.js` processes.
- If an unmanaged listener owns the port, stop it and rerun `pa update` or `pa ui service restart`.

## Product guidance

- Deployment validation should confirm the managed instance took over the port, not merely that some responder exists on `3741`.
- Service-status reporting should avoid treating `spawn scheduled` as healthy when the service failed to start.
