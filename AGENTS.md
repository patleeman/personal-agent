# personal-agent repo instructions

This is personal software, built for Patrick by Patrick.

## Development

- Prefer correct full implementations over backwards-compatibility layers. I don't want to implement the fastest smallest improvement most of the time.
- For web UI work, prefer server-pushed updates (SSE + POST) over client polling when the backend can publish change events.
- I often work on multiple features at the same time. Check other active runs and coordinate your work if you start seeing unintended changes to files you're editing.

## Always validate your work!

- After you complete a feature, make sure you actually inspect your work. 
- If you're working in the web-ui, ppin up the UI on a separate port and use the agent-browser CLI tool to inspect and interact with your changes. Read the agent-browser skill for more information.
- Make sure the work is complete, to spec, works without bugs, and looks good.

## UI Design Bans

- For personal-agent web UI work, avoid nested bordered containers/cards (`boxes inside boxes`) unless they are truly unavoidable.
- Avoid decorative pills/chips as a default treatment; use spacing, typography, and alignment for hierarchy instead.
- Ensure consistency across pages, don't design in isolation!
- If you modify anything in the web ui, you MUST perform a visual check before signing off on the work! Make sure there is no jank and the output looks good.

## Docs are for agents

The docs folder is for agents to use and understand how personal-assistant works. Make sure to update it.

## Checkpoint when complete

Once you're done with your task, remember to /skill:checkpoint your work. In this repo we commit and push directly to main, no need to create branches.