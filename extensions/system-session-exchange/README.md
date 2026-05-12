# Session Exchange

Session Exchange adds import/export affordances for conversation session files.

Right-click a thread in the sidebar and choose **Export Session** to copy its JSONL session file into the app exports directory. Use the import button beside the Threads header to paste a `.jsonl` session file path and import it back into the durable sessions store.

If the imported session ID already exists, the importer rewrites the session header to a new ID so it does not clobber existing history.
