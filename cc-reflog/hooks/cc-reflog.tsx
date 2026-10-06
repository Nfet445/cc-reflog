/**
 * cc-reflog — Claude Mod
 *
 * A small lazygit-style pane: every worktree of the repository the session is
 * in, and its local branches, as rows you can click (or Tab to and press
 * Enter). `/reflog` opens it; in the fullscreen layout (`/tui fullscreen`)
 * the engine docks it beside the transcript, floor to ceiling, otherwise it
 * sits above the prompt.
 *
 *   - a worktree row moves the session there, through the engine's own `/cd`
 *   - a branch row shows what can be done with it:
 *     `switch` (clean tree only) or `open worktree` when another worktree has it,
 *     `rename`, `delete`, `merge` and `rebase`; the commit popup offers the same
 *     for each other branch that points at the commit
 *
 * Git runs through `$.process.run` by argv (no shell); every read is in
 * ./git.ts. The only writes are the ones a branch's buttons ask for: `git switch`,
 * `branch -m`, `branch -d`, `merge` and `rebase` (a merge or rebase that stops is
 * left in place: the prompt asks the model to resolve the conflicts). Switch,
 * merge and rebase are refused while the current worktree has uncommitted changes; delete, merge and rebase ask "yes / no" first.
 * A commit popup adds `tag`, `branch`, `checkout` (detached), `cherry-pick`,
 * `revert`, `drop`, `merge`, `rebase` and `reset --hard`; drop, merge, rebase and
 * reset ask "yes / no", and all but tag and branch need a clean tree.
 * `fetch` (Branches) and, in the current branch's popup, `pull` (--ff-only) and
 * `push` (asks "yes / no", never --force) talk to the remote; remote refs in the
 * graph are drawn as {origin/main}.
 * Tags can be deleted, worktrees added, locked and removed (no --force); the
 * history can be filtered by message or limited to one branch, and loads more.
 *
 * Needs Claude Code >= 2.1.287.
 *
 * Options (pluginConfigs["reflog"].options):
 *   columns: number      width asked for the docked pane (default 56)
 *   maxBranches: number  most recent local branches listed, 0 lists all (default 0)
 *   maxCommits: number   commits drawn in the history graph, 0 draws all (default 50)
 *   maxFiles: number     changed files listed in a commit's popup, 0 lists all (default 10)
 *   openOnStart: boolean open the pane when the session starts (default true)
 */
import type { ProcessRunResult, Register } from 'claude-code'
import {
  STATUS,
  TOPLEVEL,
  WORKTREES,
  basename,
  commitStamp,
  branchAction,
  branchColor,
  branchesArgv,
  countDirty,
  currentWorktree,
  fit,
  ICONS,
  graphArgv,
  maxBranches,
  limitFiles,
  maxCommits,
  maxFiles,
  paneColumns,
  parseBranches,
  parseShow,
  layoutGraph,
  parseGraphLog,
  parseWorktrees,
  showArgv,
  deleteArgv,
  mergeArgv,
  rebaseArgv,
  TAGS,
  REMOTES,
  FETCH,
  PULL,
  NET_INIT,
  pushArgv,
  splitRefs,
  parseTags,
  tagDeleteArgv,
  worktreePath,
  worktreeAddArgv,
  worktreeRemoveArgv,
  worktreeLockArgv,
  tagArgv,
  newBranchArgv,
  detachArgv,
  pickArgv,
  revertArgv,
  dropArgv,
  resetArgv,
  PICK_ABORT,
  REVERT_ABORT,
  CONFIRMED_COMMIT_OPS,
  renameArgv,
  MERGE_ABORT,
  REBASE_ABORT,
  CONFLICTS,
  switchArgv,
  trackLabel,
} from './git.ts'
import type { Branch, BranchOp, CommitDetail, CommitOp, ConfirmedOp, GraphRow, Snapshot } from './git.ts'

const PANE = 'git'
// commit buttons that do nothing on the checked-out commit
const HEAD_HIDDEN = ['checkout', 'pick', 'revert', 'merge']
const LANE_COLORS = ['magenta', 'yellow', 'cyan', 'green', 'red', 'blue']
const COMMAND = 'reflog'
// worktrees whose `git status` is read on each refresh; the rest show no count
const MAX_STATUS_READS = 12

type Run = (argv: readonly string[], cwd?: string) => Promise<ProcessRunResult>

let snap: Snapshot | undefined
let error: string | undefined
let selected: string | undefined
// merge topology of all branches, newest first, read on each refresh
let graph: GraphRow[] = []
// the commit whose details are open under the graph
let shown: CommitDetail | undefined
let commitLimit = 50
// how many more commits `load more` adds: the configured size, 0 when the history is unlimited
let commitStep = 50
// the history view: commits whose message has `filter`, and/or those of one branch only
let filter = ''
let scope: string | undefined
let fileLimit = 10
// a delete, merge or rebase waiting for "yes", and the popup (`b` branch, `c` commit) that asked
let pending: { op: ConfirmedOp; name: string } | undefined
// a branch being renamed, in the popup that asked
let renaming: { name: string } | undefined
// a commit action waiting for "yes", or for the name of the tag or branch to create
let commitAsk: { op: CommitOp; hash: string } | undefined
let naming: { op: 'tag' | 'branch'; hash: string } | undefined
// the open tag popup, and whether it waits for "yes" to delete
let selectedTag: string | undefined
let tagAsk = false
// the current branch's push waiting for "yes"
let pushAsk = false
// whether the popups show their rarer buttons (`more` toggles it, any other press folds it)
let moreOps = false
// the worktree whose menu is open (index), whether its removal waits for "yes", and the "add" input
let wtMenu: number | undefined
let wtAsk = false
let addingWt = false
let isOpen = false

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

async function readSnapshot(run: Run, branchLimit: number): Promise<void> {
  const top = await run(TOPLEVEL)
  if (top.exitCode !== 0) {
    snap = undefined
    error = firstLine(top.stderr) || 'not a git repository'
    return
  }
  const [wts, refs, log, tagOut, remoteOut] = await Promise.all([
    run(WORKTREES),
    run(branchesArgv(branchLimit)),
    run(graphArgv(commitLimit, { branch: scope, grep: filter || undefined })).catch(() => undefined),
    run(TAGS).catch(() => undefined),
    run(REMOTES).catch(() => undefined),
  ])
  const worktrees = wts.exitCode === 0 ? parseWorktrees(wts.stdout) : []
  await Promise.all(
    worktrees
      .filter(wt => !wt.bare && !wt.prunable)
      .slice(0, MAX_STATUS_READS)
      .map(async wt => {
        const st = await run(STATUS, wt.path).catch(() => undefined)
        if (st?.exitCode === 0) wt.dirty = countDirty(st.stdout)
      }),
  )
  snap = {
    root: top.stdout.trim(),
    worktrees,
    branches: refs.exitCode === 0 ? parseBranches(refs.stdout) : [],
    tags: tagOut?.exitCode === 0 ? parseTags(tagOut.stdout) : [],
    remotes: remoteOut?.exitCode === 0 ? remoteOut.stdout.split('\n').filter(Boolean) : [],
  }
  error = refs.exitCode === 0 ? undefined : firstLine(refs.stderr)
  // a text filter leaves commits whose parents are not in the list, so they are drawn flat
  graph = log?.exitCode === 0 ? layoutGraph(parseGraphLog(log.stdout).map(c => (filter ? { ...c, parents: [] } : c))) : []
  if (selected && !snap.branches.some(b => b.name === selected)) selected = undefined
  if (scope && !snap.branches.some(b => b.name === scope)) scope = undefined
  if (selectedTag && !snap.tags.some(t => t.name === selectedTag)) selectedTag = undefined
  if (shown && !graph.some(row => row.hash === shown?.hash)) shown = undefined
}

export const register: Register = (on, options) => {
  const columns = paneColumns(options.columns)
  const branchLimit = maxBranches(options.maxBranches)
  commitLimit = maxCommits(options.maxCommits)
  commitStep = commitLimit
  fileLimit = maxFiles(options.maxFiles)
  const openOnStart = options.openOnStart !== false

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command
      .register({
        name: COMMAND,
        description: 'Worktrees and branches in a side pane; click one to go there (stop closes)',
        argumentHint: '[stop|refresh]',
        immediate: true,
      })
      .catch(err => $.ui.log(`cc-reflog: /${COMMAND} not registered: ${err}`))
    $.ui.log(`cc-reflog loaded: /${COMMAND} opens the pane`, { to: 'debug' })
    if (openOnStart) {
      await readSnapshot((argv, cwd) => $.process.run(argv, { cwd }), branchLimit).catch(err => {
        error = String(err)
      })
      isOpen = true
      // unasked, the engine keeps it undrawn below 144 columns until the person opens it
      await $.ui.open({ id: PANE, title: 'git', columns }).catch(err => {
        isOpen = false
        $.ui.log(`cc-reflog: pane not opened: ${err}`)
      })
    }
    return r
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'stop' || arg === 'close') {
      await $.ui.close({ id: PANE }).catch(() => undefined)
      isOpen = false
      return { text: 'cc-reflog closed' }
    }
    await readSnapshot((argv, cwd) => $.process.run(argv, { cwd }), branchLimit).catch(err => {
      error = String(err)
    })
    isOpen = true
    await $.ui.open({ id: PANE, title: 'git', focus: true, columns })
    $.ui.invalidate('ui.render')
    const hint = e.presentation.isFullscreen
      ? 'click a row, or Tab and Enter'
      : 'drawn above the prompt; /tui fullscreen docks it beside the transcript'
    const found = snap ? `${snap.worktrees.length} worktrees, ${snap.branches.length} branches` : error
    return { text: `${found} · ${hint} · /${COMMAND} stop closes` }
  })

  // the session moved (a row of ours, or the person's own /cd): read the new worktree
  on('command.run', { command: 'cd' }, async ($, e, next) => {
    const r = await next(e)
    if (!isOpen) return r
    await readSnapshot((argv, cwd) => $.process.run(argv, { cwd }), branchLimit).catch(err => {
      error = String(err)
    })
    $.ui.invalidate('ui.render')
    return r
  })

  // Claude may have made a branch or a worktree during the turn
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!isOpen || e.agentId) return r
    await readSnapshot((argv, cwd) => $.process.run(argv, { cwd }), branchLimit).catch(err => {
      error = String(err)
    })
    $.ui.invalidate('ui.render')
    return r
  })

  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE) return next(e)
    const r = await next(e)
    isOpen = false
    return r
  })

  on('ui.press', async ($, e, next) => {
    if (e.plugin !== $.plugin.name || e.requestId !== PANE) return next(e)
    const r = await next(e)
    const key = e.element
    const s = snap
    const asked = pending
    const askedCommit = commitAsk
    const askedTag = tagAsk
    const askedPush = pushAsk
    const askedWt = wtAsk
    const wasMore = moreOps
    moreOps = false
    pending = undefined
    renaming = undefined
    commitAsk = undefined
    naming = undefined
    tagAsk = false
    pushAsk = false
    wtAsk = false
    addingWt = false
    const reread = () =>
      readSnapshot((argv, cwd) => $.process.run(argv, { cwd }), branchLimit).catch(err => {
        error = String(err)
      })
    const clean = async (what: string) => {
      const st = await $.process.run(STATUS)
      if (st.exitCode === 0 && countDirty(st.stdout) === 0) return true
      $.ui.toast(`cc-reflog: uncommitted changes here; commit or stash before ${what}`)
      return false
    }
    // a stop on conflicts stays as it is and the prompt asks the model to resolve it; a
    // failure that left no conflicts is aborted
    const stopped = async (what: string, cont: string, abort: readonly string[] | undefined, out: ProcessRunResult) => {
      const res = await $.process.run(CONFLICTS)
      const files = res.exitCode === 0 ? res.stdout.split('\n').filter(Boolean) : []
      if (files.length === 0) {
        if (abort) await $.process.run(abort).catch(() => undefined)
        $.ui.toast(`cc-reflog: ${what} failed${abort ? ' and was aborted' : ''}: ${firstLine(out.stderr) || firstLine(out.stdout)}`)
        return
      }
      const text = `${what} stopped on conflicts in:\n${files.map(f => `- ${f}`).join('\n')}\nResolve them, then run \`${cont}\`.`
      const put = await $.prompt.fill({ text, mode: 'insert' })
      $.ui.toast(
        put.isFilled
          ? `cc-reflog: ${what} stopped on conflicts; the prompt asks to resolve them`
          : `cc-reflog: ${what} stopped on conflicts in ${files.length} file(s); resolve them, then ${cont}`,
      )
    }
    // merge or rebase
    const integrate = async (op: 'merge' | 'rebase', name: string) => {
      if (!(await clean(`${op === 'merge' ? 'merging' : 'rebasing onto'} ${name}`))) return
      const out = await $.process.run(op === 'merge' ? mergeArgv(name) : rebaseArgv(name))
      if (out.exitCode === 0) $.ui.toast(`cc-reflog: ${op === 'merge' ? 'merged' : 'rebased onto'} ${name}`)
      else await stopped(`${op} ${name}`, `git ${op} --continue`, op === 'merge' ? MERGE_ABORT : REBASE_ABORT, out)
      await reread()
    }
    // a commit action on the current branch
    const applyCommit = async (op: CommitOp, hash: string) => {
      const short = hash.slice(0, 7)
      if (op === 'merge' || op === 'rebase') return integrate(op, hash)
      if (!(await clean(`${op} ${short}`))) return
      const [argv, abort, cont] = {
        checkout: [detachArgv(hash)],
        pick: [pickArgv(hash), PICK_ABORT, 'git cherry-pick --continue'],
        revert: [revertArgv(hash), REVERT_ABORT, 'git revert --continue'],
        drop: [dropArgv(hash), REBASE_ABORT, 'git rebase --continue'],
        reset: [resetArgv(hash)],
      }[op as 'checkout' | 'pick' | 'revert' | 'drop' | 'reset']
      const out = await $.process.run(argv)
      if (out.exitCode === 0) $.ui.toast(`cc-reflog: ${op} ${short} done`)
      else if (cont) await stopped(`${op} ${short}`, cont as string, abort, out)
      else $.ui.toast(`cc-reflog: ${op} failed: ${firstLine(out.stderr) || firstLine(out.stdout)}`)
      await reread()
    }
    const apply = async (op: BranchOp, name: string) => {
      if (op === 'open') {
        const path = s?.branches.find(b => b.name === name)?.worktree
        if (path) {
          await $.command.run({ command: 'cd', args: path }).catch(err => $.ui.toast(`cc-reflog: /cd failed: ${err}`))
        }
      } else if (op === 'switch') {
        if (!(await clean(`switching to ${name}`))) return
        const sw = await $.process.run(switchArgv(name))
        if (sw.exitCode === 0) $.ui.toast(`cc-reflog: switched to ${name}`)
        else $.ui.toast(`cc-reflog: ${firstLine(sw.stderr) || 'git switch failed'}`)
        await reread()
      } else if (op === 'delete') {
        const out = await $.process.run(deleteArgv(name))
        if (out.exitCode === 0) $.ui.toast(`cc-reflog: ${firstLine(out.stdout) || `deleted ${name}`}`)
        else $.ui.toast(`cc-reflog: ${firstLine(out.stderr) || 'git branch -d failed'}`)
        await reread()
      } else if (op === 'merge' || op === 'rebase') await integrate(op, name)
    }

    // fetch, pull and push talk to the remote; each reports git's own answer
    const sync = async (what: string, argv: readonly string[]) => {
      $.ui.toast(`cc-reflog: ${what}…`)
      const out = await $.process.run(argv, NET_INIT).catch(err => ({ exitCode: 1, stdout: '', stderr: String(err) }))
      const said = firstLine(out.stderr) || firstLine(out.stdout)
      $.ui.toast(`cc-reflog: ${what} ${out.exitCode === 0 ? 'done' : `failed: ${said}`}`)
      await reread()
    }

    if (key === 'fetch') {
      await sync('fetch', FETCH)
    } else if (key === 'pull') {
      await sync('pull', PULL)
    } else if (key === 'push') {
      pushAsk = true
    } else if (key === 'yes' && askedPush) {
      const b = s?.branches.find(x => x.name === currentWorktree(s)?.branch)
      const remote = s?.remotes[0] ?? ''
      if (b && (b.upstream || remote)) await sync(`push ${b.name}`, pushArgv(b.name, b.upstream, remote))
      else $.ui.toast('cc-reflog: no remote to push to')
    } else if (s && key.startsWith('wt:')) {
      const wt = s.worktrees[Number(key.slice(3))]
      if (wt && wt.path === currentWorktree(s)?.path) $.ui.toast('cc-reflog: already in this worktree')
      else if (wt) {
        await $.command
          .run({ command: 'cd', args: wt.path })
          .catch(err => $.ui.toast(`cc-reflog: /cd failed: ${err}`))
      }
    } else if (s && key.startsWith('br:')) {
      const branch = s.branches[Number(key.slice(3))]
      if (branch) selected = selected === branch.name ? undefined : branch.name
    } else if (shown && key === 'sha') {
      const hash = shown.hash
      const put = await $.prompt.fill({ text: hash, mode: 'insert' })
      $.ui.toast(put.isFilled ? `cc-reflog: ${hash} put in the prompt` : 'cc-reflog: no prompt to put the hash in')
    } else if (key.startsWith('cm:')) {
      const hash = graph[Number(key.slice(3))]?.hash
      if (!hash || shown?.hash === hash) shown = undefined
      else {
        const out = await $.process.run(showArgv(hash))
        if (out.exitCode === 0) shown = parseShow(out.stdout)
        else $.ui.toast(`cc-reflog: ${firstLine(out.stderr) || 'git show failed'}`)
      }
    } else if (selected && (key === 'open' || key === 'switch')) {
      await apply(key, selected)
    } else if (key.startsWith('do:')) {
      const [, op = '', ...rest] = key.split(':')
      const name = rest.join(':')
      if (op === 'rename') renaming = { name }
      else if (op === 'delete' || op === 'merge' || op === 'rebase') pending = { op, name }
    } else if (key.startsWith('opsmore')) {
      moreOps = !wasMore
    } else if (key === 'more') {
      commitLimit += commitStep
      await reread()
    } else if (key === 'clear') {
      filter = ''
      scope = undefined
      await reread()
    } else if (key === 'scope' && selected) {
      scope = scope === selected ? undefined : selected
      await reread()
    } else if (s && key.startsWith('tg:')) {
      const name = s.tags[Number(key.slice(3))]?.name
      selectedTag = selectedTag === name ? undefined : name
    } else if (key === 'tdel' && selectedTag) tagAsk = true
    else if (key === 'yes' && askedTag && selectedTag) {
      const out = await $.process.run(tagDeleteArgv(selectedTag))
      $.ui.toast(`cc-reflog: ${out.exitCode === 0 ? firstLine(out.stdout) || 'tag deleted' : firstLine(out.stderr) || 'git tag -d failed'}`)
      await reread()
    } else if (key === 'wtadd') addingWt = true
    else if (key.startsWith('wtm:')) {
      const i = Number(key.slice(4))
      wtMenu = wtMenu === i ? undefined : i
    } else if (s && wtMenu !== undefined && (key === 'wtlock' || key === 'wtdel' || (key === 'yes' && askedWt))) {
      const wt = s.worktrees[wtMenu]
      if (wt && key === 'wtdel') wtAsk = true
      else if (wt) {
        const out = await $.process.run(key === 'wtlock' ? worktreeLockArgv(wt.path, !wt.locked) : worktreeRemoveArgv(wt.path))
        if (out.exitCode === 0) {
          $.ui.toast(`cc-reflog: ${key === 'wtlock' ? (wt.locked ? 'unlocked' : 'locked') : 'removed'} ${basename(wt.path)}`)
          if (key === 'yes') wtMenu = undefined
        } else $.ui.toast(`cc-reflog: ${firstLine(out.stderr) || 'git worktree failed'}`)
        await reread()
      }
    } else if (shown && key.startsWith('cx:')) {
      const op = key.slice(3) as CommitOp
      if (op === 'tag' || op === 'branch') naming = { op, hash: shown.hash }
      else if (CONFIRMED_COMMIT_OPS.includes(op)) commitAsk = { op, hash: shown.hash }
      else await applyCommit(op, shown.hash)
    } else if (key === 'yes' && asked) {
      await apply(asked.op, asked.name)
    } else if (key === 'yes' && askedCommit) {
      await applyCommit(askedCommit.op, askedCommit.hash)
    }
    $.ui.invalidate('ui.render')
    return r
  })

  on('ui.input', async ($, e, next) => {
    if (e.plugin !== $.plugin.name || e.requestId !== PANE || e.kind !== 'submit') return next(e)
    if (!['rename', 'newname', 'filterq', 'wtnew'].includes(e.element)) return next(e)
    const r = await next(e)
    const reread = () =>
      readSnapshot((argv, cwd) => $.process.run(argv, { cwd }), branchLimit).catch(err => {
        error = String(err)
      })
    if (e.element === 'filterq') {
      filter = e.value.trim()
      await reread()
      $.ui.invalidate('ui.render')
      return r
    }
    if (e.element === 'wtnew') {
      addingWt = false
      const name = e.value.trim()
      const main = snap?.worktrees[0]?.path
      if (name && main) {
        const out = await $.process.run(
          worktreeAddArgv(worktreePath(main, name), name, snap?.branches.some(b => b.name === name) ?? false),
        )
        $.ui.toast(`cc-reflog: ${out.exitCode === 0 ? `worktree ${name} added` : firstLine(out.stderr) || 'git worktree add failed'}`)
        await reread()
      }
      $.ui.invalidate('ui.render')
      return r
    }
    const from = e.element === 'rename' ? renaming?.name : undefined
    const create = e.element === 'newname' ? naming : undefined
    renaming = undefined
    naming = undefined
    const to = e.value.trim()
    if (create && to) {
      const out = await $.process.run((create.op === 'tag' ? tagArgv : newBranchArgv)(to, create.hash))
      if (out.exitCode === 0) $.ui.toast(`cc-reflog: ${create.op} ${to} created`)
      else $.ui.toast(`cc-reflog: ${firstLine(out.stderr) || `git ${create.op} failed`}`)
      await readSnapshot((argv, cwd) => $.process.run(argv, { cwd }), branchLimit).catch(err => {
        error = String(err)
      })
    } else if (from && to && to !== from) {
      const out = await $.process.run(renameArgv(from, to))
      if (out.exitCode === 0) {
        $.ui.toast(`cc-reflog: renamed ${from} to ${to}`)
        if (selected === from) selected = to
      } else $.ui.toast(`cc-reflog: ${firstLine(out.stderr) || 'git branch -m failed'}`)
      await readSnapshot((argv, cwd) => $.process.run(argv, { cwd }), branchLimit).catch(err => {
        error = String(err)
      })
    }
    $.ui.invalidate('ui.render')
    return r
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns - 1)
    const noop = () => {}
    if (!snap) {
      return (
        <Box flexDirection="column">
          <Text color="red">{fit(error ?? 'reading the repository…', width)}</Text>
        </Box>
      )
    }

    const s = snap
    const here = currentWorktree(s)
    const current = s.branches.find(b => b.name === here?.branch)
    const chosen = selected ? s.branches.find(b => b.name === selected) : undefined
    // lanes are padded to one width so the hashes line up in a column
    const laneWidth = Math.max(0, ...graph.map(row => row.cells.length))
    const now = new Date()
    const stampWidth = Math.max(0, ...graph.map(row => (row.commit ? commitStamp(row.commit.time, now).length : 0)))
    const shaWidth = Math.max(0, ...graph.map(row => row.commit?.sha.length ?? 0))
    // the buttons of a branch popup; `switch` and `open` keep their own keys, the hotkeys of the pane
    const ops = (b: Branch) => {
      const act = branchAction(s, b)
      if (act.kind === 'current') return null
      if (pending?.name === b.name) {
        return (
          <Box key="ops" flexDirection="row" columnGap={1}>
            <Text color="yellow">{`${pending.op} ${b.name}?`}</Text>
            <Button key="yes" label="yes" variant="primary" onPress={noop} />
            <Button key="no" label="no" variant="primary" onPress={noop} />
          </Box>
        )
      }
      if (renaming?.name === b.name) {
        return <Input key="rename" label="name " value={b.name} submitLabel="rename" autoFocus onSubmit={noop} />
      }
      const go = act.kind === 'switch' ? 'switch' : 'open'
      const goLabel = go === 'switch' ? 'switch' : 'open worktree'
      return (
        <Box key="ops" flexDirection="row" columnGap={1}>
          <Button key={go} label={goLabel} hotkey={go === 'switch' ? 's' : 'o'} variant="primary" onPress={noop} />
          <Button key={`do:rename:${b.name}`} label="rename" variant="primary" onPress={noop} />
          <Button key="opsmore:branch" label={moreOps ? 'less' : 'more'} variant="secondary" onPress={noop} />
          {moreOps
            ? (['delete', 'merge', 'rebase'] as const).map(op => (
                <Button key={`do:${op}:${b.name}`} label={op} variant="primary" onPress={noop} />
              ))
            : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>{fit(basename(s.worktrees[0]?.path ?? s.root), width)}</Text>
        {error ? <Text color="red">{fit(error, width)}</Text> : null}
        {pushAsk ? (
          <Box key="push-ask" flexDirection="row" columnGap={1}>
            <Text color="yellow">{`push to ${current?.upstream ?? s.remotes[0] ?? '?'}?`}</Text>
            <Button key="yes" label="yes" variant="primary" onPress={noop} />
            <Button key="no" label="no" variant="primary" onPress={noop} />
          </Box>
        ) : (
          <Box key="sync" flexDirection="row" columnGap={1}>
            {s.remotes.length > 0 ? <Button key="fetch" label="fetch" variant="primary" onPress={noop} /> : null}
            {current?.upstream ? <Button key="pull" label="pull" variant="primary" onPress={noop} /> : null}
            {current && (current.upstream || s.remotes.length > 0) ? <Button key="push" label="push" variant="primary" onPress={noop} /> : null}
          </Box>
        )}

        <Box key="wt-head" flexDirection="row" columnGap={1}>
          <Text bold color="cyan">{`Worktrees (${s.worktrees.length})`}</Text>
          {addingWt ? null : <Button key="wtadd" label="add" variant="primary" onPress={noop} />}
        </Box>
        {addingWt ? <Input key="wtnew" label="branch " value="" submitLabel="add" autoFocus onSubmit={noop} /> : null}
        {s.worktrees.map((wt, i) => {
          const isHere = wt === here
          const name = wt.branch ?? (wt.bare ? '(bare)' : `(${wt.head.slice(0, 7)})`)
          const dirty = wt.dirty ? ` ~${wt.dirty}` : ''
          const flags = `${wt.locked ? ' locked' : ''}${wt.prunable ? ' prunable' : ''}`
          return (
            <Box key={`wt-row:${i}`} flexDirection="column">
              <Box key="row" flexDirection="row">
                <Text>{'  '}</Text>
                <Text color="green">{isHere ? ICONS.here : ICONS.other}</Text>
                <Button
                  key={`wt:${i}`}
                  plain
                  dimColor={!isHere}
                  label={`${basename(wt.path)}  ${name}`}
                  onPress={noop}
                />
                {dirty ? <Text color="yellow">{dirty}</Text> : null}
                {flags ? <Text color="red">{flags}</Text> : null}
                {i > 0 ? <Button key={`wtm:${i}`} plain dimColor={wtMenu !== i} label=" …" onPress={noop} /> : null}
              </Box>
              {wtMenu === i ? (
                <Box key="wt-detail" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                  <Text dimColor>{fit(wt.path, width - 4)}</Text>
                  {wtAsk ? (
                    <Box key="wt-ask" flexDirection="row" columnGap={1}>
                      <Text color="yellow">remove?</Text>
                      <Button key="yes" label="yes" variant="primary" onPress={noop} />
                      <Button key="no" label="no" variant="primary" onPress={noop} />
                    </Box>
                  ) : (
                    <Box key="wt-ops" flexDirection="row" columnGap={1}>
                      <Button key="wtlock" label={wt.locked ? 'unlock' : 'lock'} variant="primary" onPress={noop} />
                      {isHere ? null : <Button key="wtdel" label="remove" variant="primary" onPress={noop} />}
                    </Box>
                  )}
                </Box>
              ) : null}
            </Box>
          )
        })}

        <Box key="br-head" flexDirection="row">
          <Text bold color="cyan">{`Branches (${s.branches.length})`}</Text>
        </Box>
        {s.branches.map((b, i) => {
          const isHere = here?.branch === b.name
          const marker = isHere ? ICONS.current : b.worktree ? ICONS.elsewhere : ICONS.plain
          const track = trackLabel(b)
          return (
            <Box key={`br-row:${i}`} flexDirection="column">
              <Box key="row" flexDirection="row">
                <Text>{'  '}</Text>
                <Text color={isHere ? 'green' : 'blue'}>{marker}</Text>
                <Text color={branchColor(b.name)}>● </Text>
                <Button
                  key={`br:${i}`}
                  plain
                  dimColor={!isHere && selected !== b.name}
                  label={b.name}
                  onPress={noop}
                />
                {track ? <Text color={b.gone ? 'red' : 'magenta'}>{` ${track}`}</Text> : null}
              </Box>
              {chosen === b ? (
                <Box key="detail" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                  <Text bold>{fit(b.name, width - 4)}</Text>
                  <Text dimColor>{fit(`${b.upstream ?? 'no upstream'} · ${b.date}`, width - 4)}</Text>
                  {ops(b) ?? <Text dimColor>checked out here</Text>}
                  <Button key="scope" label={scope === b.name ? 'show all history' : 'history of this branch'} variant="primary" onPress={noop} />
                </Box>
              ) : null}
            </Box>
          )
        })}

        {s.tags.length > 0 ? (
          <Box key="tg-head" flexDirection="row">
            <Text bold color="cyan">{`Tags (${s.tags.length})`}</Text>
          </Box>
        ) : null}
        {s.tags.map((t, i) => (
          <Box key={`tg-row:${i}`} flexDirection="column">
            <Box key="row" flexDirection="row">
              <Text>{'  '}</Text>
              <Text color="green">◆ </Text>
              <Button key={`tg:${i}`} plain dimColor={selectedTag !== t.name} label={t.name} onPress={noop} />
              <Text dimColor>{` ${t.date}`}</Text>
            </Box>
            {selectedTag === t.name ? (
              <Box key="tg-detail" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                {tagAsk ? (
                  <Box key="tg-ask" flexDirection="row" columnGap={1}>
                    <Text color="yellow">delete?</Text>
                    <Button key="yes" label="yes" variant="primary" onPress={noop} />
                    <Button key="no" label="no" variant="primary" onPress={noop} />
                  </Box>
                ) : (
                  <Button key="tdel" label="delete" variant="primary" onPress={noop} />
                )}
              </Box>
            ) : null}
          </Box>
        ))}

        <Box key="graph-head" flexDirection="row" columnGap={1}>
          <Text bold color="cyan">History</Text>
          {scope ? <Text color={branchColor(scope)}>{fit(`@${scope}`, 16)}</Text> : null}
          {filter || scope ? <Button key="clear" label="clear" variant="primary" onPress={noop} /> : null}
        </Box>
        <Box key="filter-box" flexDirection="row" borderStyle="round" borderDimColor paddingX={1}>
          <Input key="filterq" placeholder="Filter the git tree" value={filter} submitLabel="apply" onSubmit={noop} />
        </Box>
        {graph.map((row, i) => {
          const { heads, remotes, tags } = splitRefs(row.commit?.refs ?? '', s.remotes)
          // the ref labels share what the fixed columns leave, less a minimum for the subject
          let left = width - (2 + stampWidth + 1 + shaWidth + 1 + laneWidth) - 1 - 8
          const label = (text: string) => {
            const out = left > 1 && text ? fit(text, left) : ''
            left -= out.length
            return out
          }
          // the row keeps short labels (`HEAD -> ..`, the remote's name); the popup has the full names
          const refs = label(heads.length ? ` (${heads.map(h => (h.startsWith('HEAD -> ') ? 'HEAD -> ..' : h)).join(', ')})` : '')
          const far = label(remotes.length ? ` {${[...new Set(remotes.map(r => r.split('/')[0]))].join(', ')}}` : '')
          const tagged = label(tags.length ? ` [${tags.join(', ')}]` : '')
          // the subject takes the rest; the columns never shrink
          const room = width - (2 + stampWidth + 1 + shaWidth + 1 + laneWidth + refs.length + far.length + tagged.length) - 1
          return (
          <Box key={`g:${i}`} flexDirection="column">
            <Box key="row" flexDirection="row">
              <Box key="cols" flexDirection="row" flexShrink={0}>
                <Text>{'  '}</Text>
                <Text>{`${(row.commit ? commitStamp(row.commit.time, now) : '').padEnd(stampWidth)} `}</Text>
                <Text color="yellow">{`${(row.commit?.sha ?? '').padEnd(shaWidth)} `}</Text>
                {row.cells.map((cell, j) => (
                  <Text key={`g:${i}:${j}`} color={LANE_COLORS[cell.color % LANE_COLORS.length]}>
                    {cell.ch}
                  </Text>
                ))}
                <Text>{' '.repeat(laneWidth - row.cells.length)}</Text>
                {refs ? <Text color="magenta">{refs}</Text> : null}
                {far ? <Text color="red">{far}</Text> : null}
                {tagged ? <Text color="green">{tagged}</Text> : null}
              </Box>
              {row.commit ? (
                <Button key={`cm:${i}`} plain dimColor={shown?.hash !== row.hash} label={` ${fit(row.commit.subject, Math.max(8, room))}`} onPress={noop} />
              ) : null}
            </Box>
            {shown && shown.hash === row.hash ? (
              <Box key="commit" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                <Button key="sha" plain label={shown.hash} onPress={noop} />
                {heads.length ? <Text color="magenta" wrap="wrap">{`(${heads.join(', ')})`}</Text> : null}
                {remotes.length ? <Text color="red" wrap="wrap">{`{${remotes.join(', ')}}`}</Text> : null}
                {tags.length ? <Text color="green" wrap="wrap">{`[${tags.join(', ')}]`}</Text> : null}
                <Text wrap="truncate-end">
                  <Text color="green">{shown.author.replace(/\s*<.*>$/, '')}</Text>
                  <Text color="cyan">{` ${shown.author.match(/<.*>$/)?.[0] ?? ''}`}</Text>
                  <Text dimColor>{` · ${shown.date}`}</Text>
                </Text>
                {shown.message.map((line, k) => (
                  <Text key={`cm-msg:${k}`} wrap="wrap">{line}</Text>
                ))}
                {limitFiles(shown.files, fileLimit).map((line, k) => (
                  <Text key={`cm-file:${k}`} dimColor>{fit(line, width - 4)}</Text>
                ))}
                {commitAsk?.hash === row.hash ? (
                  <Box key="cx-ask" flexDirection="row" columnGap={1}>
                    <Text color="yellow">{commitAsk.op === 'reset' ? 'reset --hard?' : `${commitAsk.op}?`}</Text>
                    <Button key="yes" label="yes" variant="primary" onPress={noop} />
                    <Button key="no" label="no" variant="primary" onPress={noop} />
                  </Box>
                ) : naming?.hash === row.hash ? (
                  <Input key="newname" label={`${naming.op} `} value="" submitLabel="create" autoFocus onSubmit={noop} />
                ) : (
                  <Box key="cx" flexDirection="column">
                    {(moreOps
                      ? [['tag', 'branch', 'checkout', 'pick', 'more'], ['revert', 'drop', 'merge', 'rebase', 'reset']]
                      : [['tag', 'branch', 'checkout', 'pick', 'more']]
                    )
                      .map(line => (row.hash === here?.head ? line.filter(op => !HEAD_HIDDEN.includes(op)) : line))
                      .filter(line => line.length > 0)
                      .map(line => (
                      <Box key={`cx-row:${line[0]}`} flexDirection="row" columnGap={1}>
                        {line.map(op =>
                          op === 'more' ? (
                            <Button key="opsmore:commit" label={moreOps ? 'less' : 'more'} variant="secondary" onPress={noop} />
                          ) : (
                            <Button key={`cx:${op}`} label={op === 'pick' ? 'cherry-pick' : op === 'reset' ? 'reset --hard' : op} variant="primary" onPress={noop} />
                          ),
                        )}
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ) : null}
          </Box>
          )
        })}

        {commitStep > 0 && graph.filter(row => row.commit).length >= commitLimit ? (
          <Box key="more-row" flexDirection="row">
            <Text>{'  '}</Text>
            <Button key="more" label={`load ${commitStep} more`} variant="primary" onPress={noop} />
          </Box>
        ) : null}
      </Box>
    )
  })
}
