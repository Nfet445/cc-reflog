// Run with: claude plugin test cc-reflog
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import {
  branchAction,
  branchColor,
  branchesArgv,
  countDirty,
  fit,
  ICONS,
  commitStamp,
  graphArgv,
  maxBranches,
  limitFiles,
  maxCommits,
  maxFiles,
  paneColumns,
  parseBranches,
  layoutGraph,
  parseGraphLog,
  parseShow,
  parseTrack,
  splitRefs,
  pushArgv,
  parseWorktrees,
  trackLabel,
} from '../hooks/git.ts'

const MAIN = '/repo/app'
const FEATURE = '/repo/app-feature'

const WORKTREE_OUT = [
  `worktree ${MAIN}`,
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  `worktree ${FEATURE}`,
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature/login',
  'locked',
  '',
  'worktree /repo/app-detached',
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n')

const BRANCH_OUT = [
  `main\torigin/main\tbehind 2\t2 hours ago\t${MAIN}`,
  `feature/login\torigin/feature/login\tahead 3, behind 1\t1 day ago\t${FEATURE}`,
  'spike\t\t\t3 days ago\t',
  'old\torigin/old\tgone\t2 weeks ago\t',
].join('\n')

describe('git.ts parsers', () => {
  test('worktree list --porcelain', () => {
    const wts = parseWorktrees(WORKTREE_OUT)
    expect(wts.length).toBe(3)
    expect(wts[0]).toEqual(expect.objectContaining({ path: MAIN, branch: 'main', detached: false }))
    expect(wts[1]).toEqual(expect.objectContaining({ branch: 'feature/login', locked: true }))
    expect(wts[2]).toEqual(expect.objectContaining({ detached: true, prunable: true }))
    expect(wts[2].branch).toBeUndefined()
  })

  test('for-each-ref lines and tracking', () => {
    const bs = parseBranches(BRANCH_OUT)
    expect(bs.map(b => b.name)).toEqual(['main', 'feature/login', 'spike', 'old'])
    expect(bs[1]).toEqual(expect.objectContaining({ ahead: 3, behind: 1, worktree: FEATURE }))
    expect(bs[2].upstream).toBeUndefined()
    expect(bs[2].worktree).toBeUndefined()
    expect(parseTrack('gone').gone).toBe(true)
    expect(trackLabel(bs[0])).toBe('↓2')
    expect(trackLabel(bs[1])).toBe('↑3 ↓1')
    expect(trackLabel(bs[2])).toBe('')
    expect(trackLabel(bs[3])).toBe('gone')
    expect(trackLabel({ ahead: 0, behind: 0, gone: false, upstream: 'origin/x' })).toBe('✓')
  })

  test('branch actions depend on where the branch is checked out', () => {
    const snap = { root: `${MAIN}/`, worktrees: parseWorktrees(WORKTREE_OUT), branches: parseBranches(BRANCH_OUT) }
    expect(branchAction(snap, snap.branches[0])).toEqual({ kind: 'current' })
    expect(branchAction(snap, snap.branches[1])).toEqual({ kind: 'open', path: FEATURE })
    expect(branchAction(snap, snap.branches[2])).toEqual({ kind: 'switch' })
  })

  test('small helpers', () => {
    expect(countDirty(' M a.ts\n?? b.ts\n')).toBe(2)
    expect(countDirty('')).toBe(0)
    const log = ['M\tA X\tmmm\tMerge\t1700000000\tmain', 'X\tB\txxx\tside\t1699900000\t', 'A\tB\taaa\tmain work\t1699800000\t', 'B\t\tbbb\troot\t1699700000\t'].join('\n')
    const commits = parseGraphLog(log)
    expect(commits[0]).toEqual({ hash: 'M', parents: ['A', 'X'], commit: { sha: 'mmm', subject: 'Merge', time: 1700000000, refs: 'main' } })
    expect(commits[3]?.parents).toEqual([])
    // one row per commit; the merge opens a second lane with kitty's branch drawing symbols
    const rows = layoutGraph(commits)
    expect(rows).toHaveLength(4)
    expect(rows[0]?.cells.map(c => c.ch).join('')).toBe('\uf5fc\uf5d0\uf5d7 ')
    expect(rows[0]?.hash).toBe('M')
    const detail = parseShow('abc\tAnn <a@x.io>\t2026-10-06 12:00:00 +0300\nsubject\n\nbody\x01\n a.ts | 2 +-\n 1 file changed\n')
    expect(detail).toEqual({ hash: 'abc', author: 'Ann <a@x.io>', date: '2026-10-06 12:00:00 +0300', message: ['subject', '', 'body'], files: ['a.ts | 2 +-', '1 file changed'] })
    const noon = new Date(2026, 9, 6, 12, 0).getTime() / 1000
    const now = new Date(2026, 9, 6, 20, 0)
    expect(commitStamp(noon + 60 * 5, now)).toBe('12:05')
    expect(commitStamp(noon - 86400, now)).toBe('2026-10-05')
    expect(fit('feature/very-long-name', 8)).toBe('feature…')
    expect(fit('main', 8)).toBe('main')
    expect(paneColumns(undefined)).toBe(56)
    expect(paneColumns(500)).toBe(120)
    expect(branchesArgv(5)).toContain('--count=5')
    expect(graphArgv(0).some(x => x.startsWith('-n'))).toBe(false)
    expect(graphArgv(20)).toContain('-n20')
    expect(maxCommits(undefined)).toBe(50)
    expect(maxFiles(undefined)).toBe(10)
    const stat = ['a | 1', 'b | 1', 'c | 1', '3 files changed, 3 insertions(+)']
    expect(limitFiles(stat, 2)).toEqual(['a | 1', 'b | 1', '… 1 more', '3 files changed, 3 insertions(+)'])
    expect(limitFiles(stat, 0)).toEqual(stat)
    expect(limitFiles(stat, 3)).toEqual(stat)
    expect(branchesArgv(0).some(a => a.startsWith('--count'))).toBe(false)
    expect(maxBranches(undefined)).toBe(0)
    expect(branchColor('feature/login')).toBe(branchColor('feature/login'))
    expect(new Set(['main', 'feature/login', 'spike', 'old'].map(branchColor)).size).toBeGreaterThan(1)
    expect(ICONS.here).toBe('● ')
    expect(splitRefs('HEAD -> main, origin/main, origin/HEAD, tag: v1, feature/x', ['origin'])).toEqual({
      heads: ['HEAD -> main', 'feature/x'],
      remotes: ['origin/main', 'origin/HEAD'],
      tags: ['v1'],
    })
    expect(pushArgv('main', 'origin/main', 'origin')).toEqual(['git', 'push'])
    expect(pushArgv('topic', undefined, 'origin')).toEqual(['git', 'push', '--set-upstream', 'origin', 'topic'])
  })
})

// A fake git beneath the plugin: answers $.process.run by argv, records switches and /cd runs.
type Calls = { cd: string[]; switched: string[]; toasts: string[]; filled: string[]; ran: string[]; failIntegrate: boolean; dirty: boolean; logHash?: string }

function fakeGit(on: On, calls: Calls) {
  on('process.run', async ($, e) => {
    const argv = e.argv.join(' ')
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
    if (argv === 'git rev-parse --show-toplevel') return ok(`${MAIN}\n`)
    if (argv === 'git worktree list --porcelain') return ok(WORKTREE_OUT)
    if (argv === 'git remote') return ok('origin\n')
    if (argv.includes('refs/tags')) return ok('v1\t2026-10-01\n')
    if (argv.startsWith('git for-each-ref')) return ok(BRANCH_OUT)
    if (argv === 'git status --porcelain') return ok(calls.dirty && !e.init?.cwd ? ' M x.ts\n' : '')
    if (argv === 'git diff --name-only --diff-filter=U') return ok(calls.failIntegrate ? 'a.ts\n' : '')
    if (argv.startsWith('git log')) {
      if (argv.includes('--grep')) calls.ran.push(argv)
      return ok(`${calls.logHash ?? 'abc'}\t\tabc1234\tadd spike\t1700000000\tspike\n`)
    }
    if (argv.startsWith('git show')) return ok(`${calls.logHash ?? 'abc'}\tAnn <a@x.io>\t2026-10-06 12:00:00 +0300\nadd spike\n\nlong body\x01\n a.ts | 2 +-\n`)
    if (/^git (branch|tag|merge|rebase|cherry-pick|revert|reset|fetch|pull|push|worktree (add|remove|lock|unlock))( |$)/.test(argv) || argv.startsWith('git switch --detach')) {
      calls.ran.push(argv)
      const stops = calls.failIntegrate && /^git (merge|rebase|cherry-pick|revert) (?!--abort)/.test(argv)
      return { value: { exitCode: stops ? 1 : 0, stdout: '', stderr: stops ? 'CONFLICT in a.ts\n' : '' } }
    }
    if (argv.startsWith('git switch')) {
      calls.switched.push(e.argv[e.argv.length - 1])
      return ok('')
    }
    return { value: { exitCode: 1, stdout: '', stderr: `unexpected ${argv}` } }
  })
  // the display calls the engine serves: answered here, since a test draws no screen
  on('ui.open', () => ({ value: undefined }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.run', { command: 'cd' }, async ($, e) => {
    calls.cd.push(e.args)
    return { text: `moved to ${e.args}` }
  })
}

const PANE_PROPS = {
  title: 'git',
  isFocused: true,
  bodyColumns: 44,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

async function openSidebar($: Engine) {
  return $.command.run({
    command: 'reflog',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })
}

describe('the pane', () => {
  test('lists worktrees and branches, and a worktree click runs /cd', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: false }
    fakeGit(on, calls)
    const opened = await openSidebar($)
    expect(opened.text).toContain('3 worktrees, 4 branches')

    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })
    expect(await ui.find({ key: 'wt:1' })).toBeDefined()
    expect((await ui.find({ key: 'br:1' }))?.text).toContain('feature/login')
    expect(await ui.find({ type: 'Text', text: /↑3 ↓1/ })).toBeDefined()

    await ui.press({ key: 'wt:1' })
    expect(calls.cd).toEqual([FEATURE])
    await ui.unmount()
  })

  test('a branch click offers an action; switch runs only on a clean tree', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: true }
    fakeGit(on, calls)
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.press({ key: 'br:2' })
    await ui.redraw()
    expect((await ui.find({ key: 'cm:0' }))?.text).toContain('add spike')
    expect(await ui.find({ key: 'switch' })).toBeDefined()

    await ui.press({ key: 'switch' })
    expect(calls.switched).toEqual([])
    expect(calls.toasts.at(-1)).toContain('uncommitted changes')

    calls.dirty = false
    await ui.press({ key: 'switch' })
    expect(calls.switched).toEqual(['spike'])

    await ui.press({ key: 'br:1' })
    await ui.redraw()
    expect(await ui.find({ key: 'open' })).toBeDefined()
    await ui.press({ key: 'open' })
    expect(calls.cd).toEqual([FEATURE])
    await ui.unmount()
  })

  test('a commit click opens its details, a second click closes them', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: false }
    fakeGit(on, calls)
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.press({ key: 'cm:0' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /long body/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /a\.ts/ })).toBeDefined()

    await ui.press({ key: 'cm:0' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /long body/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a hash click puts the hash in the prompt', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: false }
    fakeGit(on, calls)
    on('prompt.fill', async (_$, e) => {
      calls.filled.push(e.text)
      return { isFilled: true }
    })
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.press({ key: 'cm:0' })
    await ui.redraw()
    await ui.press({ key: 'sha' })
    expect(calls.filled).toEqual(['abc'])
    await ui.unmount()
  })

  test('delete asks first; merge that stops asks the prompt to resolve the conflicts', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: true, dirty: false }
    fakeGit(on, calls)
    on('prompt.fill', async (_$, e) => {
      calls.filled.push(e.text)
      return { isFilled: true }
    })
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.press({ key: 'br:2' })
    await ui.redraw()
    expect(await ui.find({ key: 'do:delete:spike' })).toBeUndefined()
    await ui.press({ key: 'opsmore:branch' })
    await ui.redraw()
    await ui.press({ key: 'do:delete:spike' })
    await ui.redraw()
    expect(calls.ran).toEqual([])
    await ui.press({ key: 'no' })
    await ui.redraw()
    expect(calls.ran).toEqual([])

    await ui.press({ key: 'opsmore:branch' })

    await ui.redraw()

    await ui.press({ key: 'do:delete:spike' })
    await ui.redraw()
    await ui.press({ key: 'yes' })
    await ui.redraw()
    expect(calls.ran).toEqual(['git branch -d spike'])

    calls.ran.length = 0
    await ui.press({ key: 'opsmore:branch' })
    await ui.redraw()
    await ui.press({ key: 'do:merge:spike' })
    await ui.redraw()
    await ui.press({ key: 'yes' })
    await ui.redraw()
    expect(calls.ran).toEqual(['git merge --no-edit spike'])
    expect(calls.filled).toEqual(['merge spike stopped on conflicts in:\n- a.ts\nResolve them, then run `git merge --continue`.'])
    expect(calls.toasts.at(-1)).toContain('stopped on conflicts')
    await ui.unmount()
  })

  test('fetch and pull run at once, push asks first', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: false }
    fakeGit(on, calls)
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.press({ key: 'fetch' })
    await ui.press({ key: 'br:0' })
    await ui.redraw()
    await ui.press({ key: 'pull' })
    await ui.redraw()
    await ui.press({ key: 'push' })
    await ui.redraw()
    expect(calls.ran).toEqual(['git fetch --all', 'git pull --ff-only'])
    await ui.press({ key: 'yes' })
    expect(calls.ran).toEqual(['git fetch --all', 'git pull --ff-only', 'git push'])
    expect(calls.toasts.at(-1)).toBe('cc-reflog: push main done')
    await ui.unmount()
  })

  test('rename takes the new name from the input', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: false }
    fakeGit(on, calls)
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.press({ key: 'br:2' })
    await ui.redraw()
    await ui.press({ key: 'do:rename:spike' })
    await ui.redraw()
    await ui.input({ key: 'rename', text: 'probe' })
    expect(calls.ran).toEqual(['git branch -m spike probe'])
    await ui.unmount()
  })

  test('the popup of the checked-out commit hides checkout, cherry-pick, revert, merge and switch', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: false, logHash: '1'.repeat(40) }
    fakeGit(on, calls)
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.press({ key: 'cm:0' })
    await ui.redraw()
    expect(await ui.find({ key: 'cx:tag' })).toBeDefined()
    expect(await ui.find({ key: 'cx:checkout' })).toBeUndefined()
    expect(await ui.find({ key: 'cx:pick' })).toBeUndefined()
    await ui.press({ key: 'opsmore:commit' })
    await ui.redraw()
    expect(await ui.find({ key: 'cx:drop' })).toBeDefined()
    expect(await ui.find({ key: 'cx:revert' })).toBeUndefined()
    expect(await ui.find({ key: 'cx:merge' })).toBeUndefined()
    await ui.unmount()
  })

  test('a commit popup creates tags and branches, and asks before dropping or resetting', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: false }
    fakeGit(on, calls)
    on('prompt.fill', async (_$, e) => {
      calls.filled.push(e.text)
      return { isFilled: true }
    })
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.press({ key: 'cm:0' })
    await ui.redraw()
    await ui.press({ key: 'cx:tag' })
    await ui.redraw()
    await ui.input({ key: 'newname', text: 'v1' })
    await ui.redraw()
    await ui.press({ key: 'opsmore:commit' })
    await ui.redraw()
    await ui.press({ key: 'cx:revert' })
    await ui.redraw()
    await ui.press({ key: 'opsmore:commit' })
    await ui.redraw()
    await ui.press({ key: 'cx:reset' })
    await ui.redraw()
    expect(calls.ran).toEqual(['git tag v1 abc', 'git revert --no-edit abc'])
    await ui.press({ key: 'yes' })
    await ui.redraw()
    expect(calls.ran.at(-1)).toBe('git reset --hard abc')

    calls.ran.length = 0
    calls.failIntegrate = true
    await ui.press({ key: 'cx:pick' })
    await ui.redraw()
    expect(calls.ran).toEqual(['git cherry-pick abc'])
    expect(calls.filled.at(-1)).toContain('git cherry-pick --continue')
    await ui.unmount()
  })

  test('tags can be deleted after yes; worktrees are added, locked and removed', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: false }
    fakeGit(on, calls)
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.press({ key: 'tg:0' })
    await ui.redraw()
    await ui.press({ key: 'tdel' })
    await ui.redraw()
    await ui.press({ key: 'yes' })
    await ui.redraw()
    expect(calls.ran).toEqual(['git tag -d v1'])

    calls.ran.length = 0
    await ui.press({ key: 'wtadd' })
    await ui.redraw()
    await ui.input({ key: 'wtnew', text: 'feature/new' })
    await ui.redraw()
    await ui.press({ key: 'wtm:1' })
    await ui.redraw()
    await ui.press({ key: 'wtlock' })
    await ui.redraw()
    await ui.press({ key: 'wtdel' })
    await ui.redraw()
    await ui.press({ key: 'yes' })
    await ui.redraw()
    expect(calls.ran).toEqual([
      'git worktree add -b feature/new /repo/app-feature-new',
      'git worktree unlock /repo/app-feature',
      'git worktree remove /repo/app-feature',
    ])
    await ui.unmount()
  })

  test('the history filters by message and by one branch, and clear resets both', async ($, on) => {
    const calls: Calls = { cd: [], switched: [], toasts: [], filled: [], ran: [], failIntegrate: false, dirty: false }
    fakeGit(on, calls)
    await openSidebar($)
    const ui = await $.ui.mount({ plugin: 'reflog', surface: 'terminal', component: 'Pane', requestId: 'git', props: PANE_PROPS })

    await ui.input({ key: 'filterq', text: 'spike' })
    await ui.redraw()
    await ui.press({ key: 'br:2' })
    await ui.redraw()
    await ui.press({ key: 'scope' })
    await ui.redraw()
    expect(calls.ran.at(-1)).toContain('git log spike --topo-order -i -F --grep=spike')
    calls.ran.length = 0
    await ui.press({ key: 'clear' })
    await ui.redraw()
    expect(calls.ran).toEqual([])
    await ui.unmount()
  })
})
