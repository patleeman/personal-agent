# personal-agent repo instructions

- This is personal software. Prefer correct full implementations over backwards-compatibility layers. I don't want to implement the fastest smallest improvement most of the time.

## Development

- For web UI work, prefer server-pushed updates (SSE + POST) over client polling when the backend can publish change events.

## TEST YOUR WORK

- For web UI work, after you complete a feature, make sure you actually inspect your work. Spin up the UI on a separate port and use agent-browser to inspect and interact with your changes. Make sure the work is complete, to spec, works without bugs, and looks good.

## UI Design Bans

- For personal-agent web UI work, avoid nested bordered containers/cards (`boxes inside boxes`) unless they are truly unavoidable.
- Avoid decorative pills/chips as a default treatment; use spacing, typography, and alignment for hierarchy instead.
