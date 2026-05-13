# Knowledge base sync

The knowledge base can be backed by any git repository that `git clone` can read.

The repository setting accepts SSH remotes, HTTPS remotes, and local repository paths. Local paths are useful when the remote is already configured with the right authentication, because PA clones from that path into its managed runtime mirror instead of guessing a GitHub URL or credential mode.

PA stores the managed mirror under the runtime state directory and syncs it in the background. Git operations are bounded so a stuck credential prompt or unreachable remote records an error instead of leaving the Knowledge page permanently loading.
