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

## Release flow

If the goal is to publish a downloadable installable macOS app on GitHub Releases, use the tag-driven release flow.

1. From the repo root, bump the version with `npm run release:patch`, `npm run release:minor`, or `npm run release:major`.
2. Push the commit and tag with `git push --follow-tags`.
3. The `Release` GitHub Actions workflow runs on pushed `v*` tags, builds the macOS desktop app, and creates the GitHub release with the generated `.dmg` and `.zip` artifacts.
4. Current packaging uses ad-hoc signing for macOS arm64 so releases open as unsigned apps instead of failing with the unbypassable “app is damaged” dialog. Full Apple signing/notarization is still not configured.

Important: pushing commits to `master` does not create a GitHub release by itself. The release workflow only runs when the version tag is pushed.

See `docs/release-cycle.md` for the fuller release notes.

## Docs are for agents

The docs folder is for agents to use and understand how personal-assistant works. Make sure to update it.

## Checkpoint when complete

Once you're done with your task, remember to /skill:checkpoint your work. In this repo we commit and push directly to main, no need to create branches.