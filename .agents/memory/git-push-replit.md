---
name: Pushing to GitHub from a Replit workspace
description: Why gitPush fails with NO_REMOTE / UNAUTHENTICATED here, and which GitHub connection actually grants push access.
---

# Pushing to GitHub

## The remote is not called `origin`

`gitPush` auto-detects the remote by looking for `origin`. A Replit workspace's real
GitHub remote is named `subrepl-<id>`, and dozens of sibling `subrepl-*` remotes point
at the local workspace over ssh (they are not GitHub). So `gitPush` returns `NO_REMOTE`
out of the box.

Adding an `origin` alias to the same URL is not enough on its own — if the branch still
tracks `subrepl-<id>/main`, `gitPush` refuses with
`current branch already tracks <remote>; cannot publish`. The branch upstream must also
point at `origin/main`.

**Why:** the callback resolves both the remote *and* the tracking branch through `origin`.

**How to apply:** add `origin` with the same GitHub URL, then
`git branch --set-upstream-to=origin/main main`. If `git fetch origin` fails for
credentials, seed the tracking ref locally with
`git update-ref refs/remotes/origin/main refs/remotes/<subrepl-remote>/main` — the two
remotes are the same repository.

## The GitHub connector does not grant push access

Authorizing the GitHub **integration/connector** (the one from `searchIntegrations`)
gives API access through the connectors proxy. It does **not** give git push
credentials — `gitPush` still fails with `CLI_ERROR: UNAUTHENTICATED` afterwards.
Push access comes from the workspace **Git pane's** GitHub account link, which is a
separate, user-only UI action.

Raw `git push` / `git fetch` from a shell has no credentials at all and fails with
`Invalid username or token`; there is no credential helper configured.

**Why:** two independent GitHub auth surfaces exist — connectors (API) and the Git pane
(transport). They are not interchangeable.

**How to apply:** if a push is needed and `gitPush` returns `UNAUTHENTICATED`, stop
retrying and send the user to the Git pane rather than proposing the GitHub connector.

## Unrelated histories

A freshly created GitHub repo may hold a single placeholder `README.md` commit with no
common ancestor. Merging needs `--allow-unrelated-histories`; ask before force-pushing,
since that discards the remote commit.
