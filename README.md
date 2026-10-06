# cc-reflog

A lazygit-style side pane for Claude Code: the worktrees of the repository the session is in, its local branches, tags and a commit graph, all as rows you can click. Branch and commit popups hold the everyday git actions, so you rarely leave the session to run them.

```
app
[ fetch ] [ pull ] [ push ]
Worktrees (3)                    add
● app  main                    ~2
  app-feature  feature/login   locked
  app-spike  spike
Branches (4)
* main                         ↓2
+ feature/login              ↑3 ↓1
+ spike
  old                          gone
Tags (1)
  v1  2026-10-01
History
  ╭──────────────────────────╮
  │ Filter the git tree      │
  ╰──────────────────────────╯
  ● add spike        (HEAD -> ..){origin}
  ● fix graph
  load 50 more
```

Run `/reflog` to open it (or read git again if it is open) and `/reflog stop` to close it.

## Install

```
/plugin marketplace add Nfet445/cc-reflog
/plugin install reflog@cc-reflog
```

or from a shell: `claude plugin marketplace add Nfet445/cc-reflog` and `claude plugin install reflog@cc-reflog`. Requires Claude Code 2.1.287 or newer.

## Where it draws

In the **fullscreen layout** the engine docks the pane beside the transcript, floor to ceiling. That layout needs a terminal at least 110 columns wide; turn it on with `/tui fullscreen` (the session restarts and resumes) or `CLAUDE_CODE_NO_FLICKER=1`. On the classic layout the same pane sits above the prompt, with the same rows and actions.

The pane width is a request: `columns` (default 56) sets it when the pane opens, and a width you drag the dock to wins.

Mouse clicks land in the fullscreen layout. Everywhere else, focus the pane (ctrl+x tab), move with Tab and press with Enter. Esc hands the keyboard back to the prompt and leaves the pane open.

## What a click does

Buttons come in two styles: `primary` for actions, `secondary` for `more` / `less`. `more` in a popup reveals the rarer or riskier buttons; pressing anything else folds them again.

### Top row

| Button | Action |
|---|---|
| `fetch` | `git fetch --all`; shown when the repository has a remote |
| `pull` | `git pull --ff-only` on the current branch; shown when it has an upstream, a diverged branch is refused |
| `push` | asks `yes / no`, then pushes the current branch; a branch with no upstream gets `--set-upstream` to the first remote. Never `--force` |

`fetch` and `pull` run at once. All three run with `GIT_TERMINAL_PROMPT=0` and a timeout.

### Worktrees

| Row | Click or Enter |
|---|---|
| worktree | moves the session there with the engine's own `/cd` (the `●` row is where you are) |
| `add` | asks for a branch name and runs `git worktree add` into `<repo>-<name>` next to the main worktree (`-b` when the branch does not exist) |
| `…` | `lock` / `unlock`, and `remove` after `yes` (no `--force`; git refuses a dirty or locked one; not offered for the current worktree) |

### Branches

A branch row opens a popup under it with its upstream and age.

| Button | Action |
|---|---|
| `switch` (`s`) | `git switch <branch>` in the current worktree, only when that worktree has no uncommitted changes |
| `open worktree` (`o`) | instead of `switch`, when another worktree has the branch checked out (`+`): `/cd` there |
| `rename` | asks for a new name, then `git branch -m` |
| `more` → `delete` | after `yes`, `git branch -d` (git itself refuses an unmerged branch or one checked out elsewhere) |
| `more` → `merge` / `rebase` | after `yes`, merges the branch into, or rebases, the current branch; refused on a dirty tree |
| `history of this branch` | draws only that branch's commits; the button then reads `show all history` |

The current branch's popup reads `checked out here` instead of the buttons above.

### Tags

Each tag is listed with its date. Click one for `delete` (after `yes`, `git tag -d`).

### History

The graph is laid out by the mod itself, drawn with kitty's box characters. A row's refs are shortened to fit: `(HEAD -> ..)` for branches, `{origin}` for remotes, `[v1]` for tags; the full lists are in the commit popup. `(branches)` are magenta, `{remotes}` red, `[tags]` green.

| Row | Click or Enter |
|---|---|
| commit | opens a popup under the row: full hash, author, date, message (wrapped), refs and changed files (up to `maxFiles`); click again to close |
| hash | puts the full hash into the prompt at the cursor |
| `tag` / `branch` | ask for a name: `git tag <name>` / `git branch <name> <hash>` |
| `checkout` | `git switch --detach <hash>` |
| `cherry-pick` | `git cherry-pick <hash>` |
| `more` → `revert` | `git revert --no-edit <hash>` |
| `more` → `drop` | after `yes`, `git rebase --onto <hash>^ <hash>` |
| `more` → `merge` / `rebase` | after `yes`, merges the commit into, or rebases the current branch onto, the commit |
| `more` → `reset --hard` | after `yes`, `git reset --hard <hash>` |
| filter field | a rounded box under History, always shown (placeholder `Filter the git tree`): type text and press Enter to keep the commits whose message has it (case-insensitive, literal), drawn flat; an empty field shows all; `clear` (shown while a filter or branch scope is set) resets both |
| `load N more` | under the graph while it is full: reads N more commits (N is `maxCommits`) |

On the checked-out commit (`HEAD`) the buttons that would do nothing are hidden: `checkout`, `cherry-pick`, `revert` and `merge`.

### Safety rules

- Everything except creating a tag or a branch is refused while the current worktree has uncommitted changes.
- `delete`, `merge`, `rebase`, `drop`, `reset --hard`, `push`, worktree `remove` and tag `delete` ask `yes / no` first.
- A merge, rebase, cherry-pick, revert or drop that stops on conflicts is left in place. The mod puts a prompt in the input line with the conflicted files and the `--continue` command, so the model can resolve it; the mod never resolves or aborts it itself. A failure with no conflicts is aborted.
- It never uses `--force` or `branch -D`, never stashes, and the only commits it makes are the ones `cherry-pick` and `revert` create.

## Staying current

The pane reads git when it opens, after every `/cd`, after each of Claude's turns (so a branch or worktree Claude just created shows up) and on `/reflog`.

Markers: `●` the worktree the session is in, `*` its branch, `+` a branch checked out in another worktree, `~N` uncommitted paths, `↑` / `↓` ahead / behind its upstream, `gone` when the upstream branch was deleted.

## What it runs

Only git, by argv (no shell), through `$.process.run`.

- Reads: `rev-parse --show-toplevel`, `worktree list --porcelain`, `remote`, `for-each-ref` (branches and tags), `status --porcelain` in each worktree (the first 12), `log --branches --topo-order -n<maxCommits>`, `show` for a commit popup.
- Writes, only from buttons: `switch`, `switch --detach`, `branch`, `branch -m`, `branch -d`, `tag`, `tag -d`, `merge`, `rebase`, `rebase --onto`, `cherry-pick`, `revert`, `reset --hard`, `worktree add` / `remove` / `lock` / `unlock`.
- Network, only from buttons: `fetch --all`, `pull --ff-only`, `push`.

## Options

```
  columns: number      width asked for the docked pane, 28-120 (default 56)
  maxBranches: number  local branches listed, most recently committed first, 0 lists all (default 0)
  maxCommits: number   commits drawn in the history graph, newest first, 0 draws all (default 50)
  maxFiles: number     changed files listed in a commit's popup, 0 lists all (default 10)
  openOnStart: boolean open the pane when a session starts (default true)
```

Declared in `cc-reflog/.claude-plugin/plugin.json` (`userConfig`). Set them in `/config`, in user settings (`~/.claude/settings.json`, never project settings), with `--settings <file>` or in managed settings, under the plugin's id (`reflog@cc-reflog` when installed from the marketplace, plain `reflog` with `--plugin-dir`):

```json
{ "pluginConfigs": { "reflog": { "options": { "columns": 56 } } } }
```

A pane opened on its own at session start stays hidden below 144 columns until you run `/reflog`.

## Develop

There is no build step. From the repository root:

```sh
claude --plugin-dir cc-reflog     # try it live; edits hot-reload, then /reflog
claude plugin test cc-reflog      # the tests
claude plugin validate cc-reflog  # lists every hooked event and every `$` call
```

A pane that is already open does not redraw on `/reload-plugins`; run `/reflog stop` and `/reflog`.

If `/reflog` is missing from the typeahead, the mod did not load: run `claude --debug` and look for `hooks module reflog@… loaded` in `~/.claude/debug/latest`.

The tests answer `$.process.run` with a fake git, mount the pane on the terminal surface and press its rows.

Layout of the code:

- `cc-reflog/hooks/git.ts` — pure git plumbing: argv builders and output parsers, no engine calls.
- `cc-reflog/hooks/cc-reflog.tsx` — the engine side: state, the `/reflog` command, `ui.press` handling and rendering.
- `cc-reflog/tests/cc-reflog.test.tsx` — the tests above.

**Requirements.** Claude Code 2.1.287+. Typed against Anthropic's declarations: https://github.com/anthropics/claude-code/tree/main/mods
