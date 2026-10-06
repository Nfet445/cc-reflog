# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

The repo holds one Claude Code "mod" (a plugin of function hooks that hot-reloads in a session): `cc-reflog/`, a lazygit-style pane listing the repo's worktrees and local branches. There is no package.json, build step or linter. User-facing behavior, options and install are documented in the root `README.md`.

## Commands

- Run tests: `claude plugin test cc-reflog` (from the repo root; the tests import `claude-code/testing`, so plain `node`/`vitest` will not run them)
- Validate the plugin (lists hooked events and `$` calls): `claude plugin validate cc-reflog`
- Try it live with hot reload: `claude --plugin-dir cc-reflog`, then `/reflog` (`/reflog stop` closes it)
- Debug loading: `claude --debug`, look for `hooks module reflog@… loaded` in `~/.claude/debug/latest`

## Architecture

- `cc-reflog/.claude-plugin/plugin.json` — manifest and `userConfig` schema (`columns`, `maxBranches`, `openOnStart`). Changing an option means updating this file, the header comment in `hooks/cc-reflog.tsx` and the README Options section.
- `cc-reflog/hooks/hooks.json` — registers `./cc-reflog.tsx` as the only module.
- `cc-reflog/hooks/git.ts` — pure git plumbing: argv constants/builders and output parsers (`parseWorktrees`, `parseBranches`, `parseLog`, `branchAction`, ...). It makes no engine calls, so it is unit-testable directly.
- `cc-reflog/hooks/cc-reflog.tsx` — the engine side: module-level state (`snap`, `selected`, `commits`, `isOpen`), the `Register` hooks (the `/reflog` command, `ui.press` on rows, `turn.complete` and `/cd` refresh), and pane rendering. All git runs through the injected `$.process.run` by argv with no shell.
- `cc-reflog/tests/cc-reflog.test.tsx` — answers `$.process.run` with a fake git, mounts the pane on the terminal surface and presses rows.

Keep this split: new git reads or parsing go in `git.ts`; anything touching the engine API goes in `cc-reflog.tsx`.

## Constraints

- The mod writes to the repository only through the buttons of a branch or commit popup: `git switch`, `branch -m`, `branch -d` (never `-D`), `merge`, `rebase`, and for a commit `tag`, `branch`, `switch --detach`, `cherry-pick`, `revert`, `rebase --onto` (drop) and `reset --hard`; also `tag -d` and `worktree add` / `remove` / `lock` / `unlock` (never `--force`; remove and tag delete ask "yes / no"). Everything but creating a tag or branch is refused while the current worktree has uncommitted changes; delete, merge, rebase, drop and reset ask "yes / no" first; a merge, rebase, cherry-pick, revert or drop that stops on conflicts is left in place and the mod puts a prompt in the input line (conflicted files, the `--continue` command) for the model to resolve; it never resolves or aborts it itself (a failure with no conflicts is aborted). The only network calls are the `fetch`, `pull` (`--ff-only`) and `push` buttons: fetch and pull run at once, push of the current branch asks "yes / no", never with `--force`, and all run with `GIT_TERMINAL_PROMPT=0` and a timeout. It never stashes or force-deletes; the only commits it makes are the ones cherry-pick and revert create.
- Requires Claude Code >= 2.1.287; types come from Anthropic's `claude-code` declarations (https://github.com/anthropics/claude-code/tree/main/mods).
