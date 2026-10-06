// Pure git plumbing for cc-reflog: the argv each read runs and the parsers
// for their output. No engine calls here, so tests/git.test.ts runs it as is.

export type Worktree = {
  path: string
  head: string
  /** short branch name; absent when detached or bare */
  branch?: string
  detached: boolean
  bare: boolean
  locked: boolean
  prunable: boolean
  /** changed paths from `git status --porcelain`; undefined when not read */
  dirty?: number
}

export type Branch = {
  name: string
  upstream?: string
  ahead: number
  behind: number
  /** the upstream was deleted on the remote */
  gone: boolean
  /** committer date, relative ("3 days ago") */
  date: string
  /** absolute path of the worktree that has it checked out, if any */
  worktree?: string
}

/** `time` is the commit time in unix seconds */
export type Commit = { sha: string; subject: string; time: number }

/** a commit as `git log` reports it, with the full hashes the lanes are traced by */
export type GraphCommit = { hash: string; parents: string[]; commit: Commit & { refs: string } }

/** One character of a lane drawing; `color` picks the lane's color. */
export type GraphCell = { ch: string; color: number }

/** one line of the history graph; a line with no commit only carries lanes through */
export type GraphRow = { cells: GraphCell[]; commit?: GraphCommit['commit']; hash?: string }

export type Tag = { name: string; date: string }

export type Snapshot = {
  /** toplevel of the worktree the session is in */
  root: string
  worktrees: Worktree[]
  branches: Branch[]
  tags: Tag[]
  /** names of the configured remotes */
  remotes: string[]
}

/** glyphs the tree draws */
export type Icons = {
  /** worktree row: the session is here / elsewhere */
  here: string
  other: string
  /** branch row: current / checked out in another worktree / plain */
  current: string
  elsewhere: string
  plain: string
}

export const ICONS: Icons = {
  here: '● ',
  other: '  ',
  current: '* ',
  elsewhere: '+ ',
  plain: '  ',
}

const BRANCH_COLORS = [
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
]

/** a color of its own for a branch: the same name always gets the same one */
export function branchColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return BRANCH_COLORS[h % BRANCH_COLORS.length]
}

export const TOPLEVEL = ['git', 'rev-parse', '--show-toplevel']
export const WORKTREES = ['git', 'worktree', 'list', '--porcelain']
export const STATUS = ['git', 'status', '--porcelain']

const SEP = '%09'

/** `max` of 0 lists every branch */
export function branchesArgv(max: number): string[] {
  const fields = [
    '%(refname:short)',
    '%(upstream:short)',
    '%(upstream:track,nobracket)',
    '%(committerdate:relative)',
    '%(worktreepath)',
  ]
  return [
    'git',
    'for-each-ref',
    '--sort=-committerdate',
    ...(max > 0 ? [`--count=${Math.floor(max)}`] : []),
    `--format=${fields.join(SEP)}`,
    'refs/heads',
  ]
}

/** which commits the history shows: one branch instead of all, and/or those whose message has `grep` */
export type GraphView = { branch?: string; grep?: string }

/** history of all local branches, newest first; `max` of 0 reads everything */
export function graphArgv(max: number, view: GraphView = {}): string[] {
  return [
    'git',
    'log',
    view.branch ?? '--branches',
    '--topo-order',
    ...(view.grep ? ['-i', '-F', `--grep=${view.grep}`] : []),
    ...(max > 0 ? [`-n${Math.floor(max)}`] : []),
    '--format=%H%x09%P%x09%h%x09%s%x09%ct%x09%D',
    '--',
  ]
}

/** one commit in full: header, message, then the changed files */
export function showArgv(hash: string): string[] {
  return ['git', 'show', '--stat', '--no-color', '--format=%H%x09%an <%ae>%x09%ai%n%B%x01', hash]
}

export const TAGS = ['git', 'for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:short)', 'refs/tags']
export const REMOTES = ['git', 'remote']
export const FETCH = ['git', 'fetch', '--all']
/** fast-forward only: a diverged branch is refused, never merged */
export const PULL = ['git', 'pull', '--ff-only']
/** never `--force`; a branch with no upstream is published to `remote` and tracks it */
export const pushArgv = (branch: string, upstream: string | undefined, remote: string) =>
  upstream ? ['git', 'push'] : ['git', 'push', '--set-upstream', remote, branch]
/** one failing network call must not hang the pane, nor ask for a password it cannot show */
export const NET_INIT = { env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 120000 }
export const tagDeleteArgv = (name: string) => ['git', 'tag', '-d', name]

export function parseTags(out: string): Tag[] {
  return out
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [name = '', date = ''] = line.split('\t')
      return { name, date }
    })
}

/** a new worktree goes next to the main one, as `<repo>-<name>` */
export function worktreePath(mainPath: string, name: string): string {
  const parent = mainPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/')
  return `${parent}/${basename(mainPath)}-${name.replace(/\//g, '-')}`
}
/** an existing branch is checked out as it is, any other name is created */
export const worktreeAddArgv = (path: string, name: string, exists: boolean) =>
  exists ? ['git', 'worktree', 'add', path, name] : ['git', 'worktree', 'add', '-b', name, path]
/** no `--force`: git refuses a dirty or locked worktree */
export const worktreeRemoveArgv = (path: string) => ['git', 'worktree', 'remove', path]
export const worktreeLockArgv = (path: string, lock: boolean) => ['git', 'worktree', lock ? 'lock' : 'unlock', path]

export function switchArgv(branch: string): string[] {
  return ['git', 'switch', '--no-guess', branch]
}

/** `branch -d` only: git itself refuses an unmerged branch or one checked out in a worktree */
export const deleteArgv = (branch: string) => ['git', 'branch', '-d', branch]
export const renameArgv = (from: string, to: string) => ['git', 'branch', '-m', from, to]
export const mergeArgv = (branch: string) => ['git', 'merge', '--no-edit', branch]
export const rebaseArgv = (branch: string) => ['git', 'rebase', branch]
export const MERGE_ABORT = ['git', 'merge', '--abort']
export const REBASE_ABORT = ['git', 'rebase', '--abort']

/** what a branch popup can ask for; the last three first ask "yes / no" */
export type BranchOp = 'switch' | 'open' | 'rename' | 'delete' | 'merge' | 'rebase'
export type ConfirmedOp = Extract<BranchOp, 'delete' | 'merge' | 'rebase'>

export const tagArgv = (name: string, hash: string) => ['git', 'tag', name, hash]
export const newBranchArgv = (name: string, hash: string) => ['git', 'branch', name, hash]
export const detachArgv = (hash: string) => ['git', 'switch', '--detach', hash]
export const pickArgv = (hash: string) => ['git', 'cherry-pick', hash]
export const revertArgv = (hash: string) => ['git', 'revert', '--no-edit', hash]
/** drop = replay what follows the commit onto its parent */
export const dropArgv = (hash: string) => ['git', 'rebase', '--onto', `${hash}^`, hash]
export const resetArgv = (hash: string) => ['git', 'reset', '--hard', hash]
/** files git left unmerged by a stop on conflicts */
export const CONFLICTS = ['git', 'diff', '--name-only', '--diff-filter=U']
export const PICK_ABORT = ['git', 'cherry-pick', '--abort']
export const REVERT_ABORT = ['git', 'revert', '--abort']

/** what a commit popup can ask for; `tag` and `branch` take a name, the last four first ask "yes / no" */
export type CommitOp = 'tag' | 'branch' | 'checkout' | 'pick' | 'revert' | 'drop' | 'merge' | 'rebase' | 'reset'
export const CONFIRMED_COMMIT_OPS: CommitOp[] = ['drop', 'merge', 'rebase', 'reset']

/** A commit's `%D` decorations told apart: local refs (`HEAD -> main`), remote-tracking refs (`origin/main`) and tags. */
export function splitRefs(refs: string, remotes: string[]): { heads: string[]; remotes: string[]; tags: string[] } {
  const out = { heads: [] as string[], remotes: [] as string[], tags: [] as string[] }
  for (const ref of refs.split(', ').filter(Boolean)) {
    if (ref.startsWith('tag: ')) out.tags.push(ref.slice(5))
    else if (remotes.includes(ref.split('/')[0] ?? '')) out.remotes.push(ref)
    else out.heads.push(ref)
  }
  return out
}

const stripHeads = (ref: string) => ref.replace(/^refs\/heads\//, '')

/** Parses `git worktree list --porcelain`: blank-line separated records. */
export function parseWorktrees(out: string): Worktree[] {
  const list: Worktree[] = []
  for (const block of out.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(Boolean)
    const first = lines[0]
    if (!first?.startsWith('worktree ')) continue
    const wt: Worktree = {
      path: first.slice('worktree '.length),
      head: '',
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
    }
    for (const line of lines.slice(1)) {
      if (line.startsWith('HEAD ')) wt.head = line.slice(5)
      else if (line.startsWith('branch ')) wt.branch = stripHeads(line.slice(7))
      else if (line === 'detached') wt.detached = true
      else if (line === 'bare') wt.bare = true
      else if (line === 'locked' || line.startsWith('locked ')) wt.locked = true
      else if (line === 'prunable' || line.startsWith('prunable ')) wt.prunable = true
    }
    list.push(wt)
  }
  return list
}

/** Reads `ahead 2, behind 1` / `gone` / `` from %(upstream:track,nobracket). */
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone: track.trim() === 'gone',
  }
}

/** Parses the tab-separated lines `branchesArgv` prints. */
export function parseBranches(out: string): Branch[] {
  const list: Branch[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [name, upstream = '', track = '', date = '', worktree = ''] = line.split('\t')
    if (!name) continue
    list.push({
      name,
      upstream: upstream || undefined,
      ...parseTrack(track),
      date,
      worktree: worktree || undefined,
    })
  }
  return list
}

/** Local `HH:MM` for a commit made today, `YYYY-MM-DD` for any other day. */
export function commitStamp(time: number, now = new Date()): string {
  const d = new Date(time * 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
  const today = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
  return day === today ? `${two(d.getHours())}:${two(d.getMinutes())}` : day
}

export type CommitDetail = { hash: string; author: string; date: string; message: string[]; files: string[] }

/** Parses `showArgv` output: a tab-separated header line, the message, a \x01 mark, then the stat. */
export function parseShow(out: string): CommitDetail {
  const [head = '', stat = ''] = out.split('\x01')
  const [first = '', ...rest] = head.split('\n')
  const [hash = '', author = '', date = ''] = first.split('\t')
  return {
    hash,
    author,
    date,
    message: rest.join('\n').trim().split('\n'),
    files: stat.split('\n').map(l => l.trim()).filter(Boolean),
  }
}

export function parseGraphLog(out: string): GraphCommit[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash = '', parents = '', sha = '', subject = '', time = '', refs = ''] = line.split('\t')
      return { hash, parents: parents.split(' ').filter(Boolean), commit: { sha, subject, time: Number(time), refs } }
    })
}

type Lane = { hash: string; color: number }

// kitty's branch drawing symbols, as lazygit uses them (U+F5D0 to U+F60D)
const PUA_HORIZONTAL = '\uf5d0'
const PUA_VERTICAL = '\uf5d1'
// dot symbols by the edges its lines touch (up, down, left, right): [commit, merge]
const PUA_DOTS: Record<string, [string, string]> = {
  '': ['\uf5ef', '\uf5ee'],
  r: ['\uf5f1', '\uf5f0'],
  l: ['\uf5f3', '\uf5f2'],
  lr: ['\uf5f5', '\uf5f4'],
  d: ['\uf5f7', '\uf5f6'],
  u: ['\uf5f9', '\uf5f8'],
  ud: ['\uf5fb', '\uf5fa'],
  dr: ['\uf5fd', '\uf5fc'],
  dl: ['\uf5ff', '\uf5fe'],
  ur: ['\uf601', '\uf600'],
  ul: ['\uf603', '\uf602'],
  udr: ['\uf605', '\uf604'],
  udl: ['\uf607', '\uf606'],
  dlr: ['\uf609', '\uf608'],
  ulr: ['\uf60b', '\uf60a'],
  udlr: ['\uf60d', '\uf60c'],
}

const firstFree = (lanes: (Lane | undefined)[]) => {
  const at = lanes.findIndex(l => !l)
  return at < 0 ? lanes.length : at
}

/**
 * Lays commits out in lanes, one row per commit: the dot sits in its lane, a vertical
 * line carries the other lanes, and a horizontal line with a corner joins a lane that
 * starts or ends at this commit.
 * A lane is two characters wide. Cells are kitty's branch drawing symbols, which the
 * terminal draws edge to edge, so lanes stay joined without extra rows.
 */
export function layoutGraph(list: GraphCommit[]): GraphRow[] {
  const rows: GraphRow[] = []
  let lanes: (Lane | undefined)[] = []
  let nextColor = 0
  const bars = (active: (Lane | undefined)[]) => {
    const cells: GraphCell[] = []
    active.forEach((l, c) => {
      cells[2 * c] = { ch: l ? PUA_VERTICAL : ' ', color: l?.color ?? 0 }
      cells[2 * c + 1] = { ch: ' ', color: 0 }
    })
    return cells
  }
  list.forEach(c => {
    const at = lanes.findIndex(l => l?.hash === c.hash)
    const col = at < 0 ? firstFree(lanes) : at
    const own = lanes[col] ?? { hash: c.hash, color: nextColor++ }
    const before = [...lanes]
    before[col] = own
    // lanes that were waiting for this commit end in it
    const converging = before.flatMap((l, j) => (l?.hash === c.hash && j !== col ? [j] : []))
    const after = [...before]
    for (const j of converging) after[j] = undefined
    after[col] = undefined
    const links: { to: number; kind: 'up' | 'tee' | 'new'; color: number }[] = converging.map(j => ({
      to: j,
      kind: 'up',
      color: before[j]!.color,
    }))
    c.parents.forEach((p, k) => {
      const known = after.findIndex(l => l?.hash === p)
      // a first parent already waited for in another lane is left to join this lane on its own
      // row, so a lane keeps its place and color as git draws it
      if (known >= 0 && k > 0) links.push({ to: known, kind: 'tee', color: after[known]!.color })
      else if (k === 0) after[col] = { hash: p, color: own.color }
      else {
        const to = firstFree(after)
        after[to] = { hash: p, color: nextColor++ }
        links.push({ to, kind: 'new', color: after[to]!.color })
      }
    })
    const width = Math.max(before.length, after.length)
    const cells = bars(Array.from({ length: width }, (_, j) => (j === col || converging.includes(j) ? undefined : before[j])))
    for (const { to, kind, color } of links) {
      const [lo, hi] = to < col ? [to, col] : [col, to]
      // the line runs over the lanes it crosses, so it has no gaps
      for (let x = 2 * lo + 1; x < 2 * hi; x++) cells[x] = { ch: PUA_HORIZONTAL, color }
      const right = to > col
      const corner = {
        up: right ? '\uf5d9' : '\uf5d8',
        tee: right ? '\uf5df' : '\uf5dc',
        new: right ? '\uf5d7' : '\uf5d6',
      }[kind]
      cells[2 * to] = { ch: corner, color }
    }
    const edges =
      (at >= 0 ? 'u' : '') +
      (after[col] ? 'd' : '') +
      (links.some(l => l.to < col) ? 'l' : '') +
      (links.some(l => l.to > col) ? 'r' : '')
    cells[2 * col] = { ch: PUA_DOTS[edges]![c.parents.length > 1 ? 1 : 0]!, color: own.color }
    for (let x = 0; x < 2 * width; x++) cells[x] ??= { ch: ' ', color: 0 }
    rows.push({ cells, commit: c.commit, hash: c.hash })
    lanes = after
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop()
  })
  return rows
}

/** Lines of `git status --porcelain`: how many paths changed. */
export function countDirty(out: string): number {
  return out.split('\n').filter(line => line.trim() !== '').length
}

export function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** Cuts `text` to `width` cells with an ellipsis; never below 1. */
export function fit(text: string, width: number): string {
  const w = Math.max(1, Math.floor(width))
  const chars = Array.from(text)
  if (chars.length <= w) return text
  return chars.slice(0, Math.max(0, w - 1)).join('') + '…'
}

export function trackLabel(b: Pick<Branch, 'ahead' | 'behind' | 'gone' | 'upstream'>): string {
  if (b.gone) return 'gone'
  if (!b.upstream) return ''
  const parts: string[] = []
  if (b.ahead) parts.push(`↑${b.ahead}`)
  if (b.behind) parts.push(`↓${b.behind}`)
  return parts.join(' ') || '✓'
}

/** Paths compare equal across a trailing slash (git and the session disagree). */
export function samePath(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '')
}

export function currentWorktree(snap: Snapshot): Worktree | undefined {
  return snap.worktrees.find(wt => samePath(wt.path, snap.root))
}

/** What pressing a branch row can offer next. */
export type BranchAction =
  | { kind: 'current' }
  | { kind: 'open'; path: string }
  | { kind: 'switch' }

export function branchAction(snap: Snapshot, branch: Branch): BranchAction {
  if (branch.worktree && samePath(branch.worktree, snap.root)) return { kind: 'current' }
  if (branch.worktree) return { kind: 'open', path: branch.worktree }
  return { kind: 'switch' }
}

/** A pane width the options can ask for, clamped to something drawable. */
export function paneColumns(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 56
  return Math.min(120, Math.max(28, n))
}

export function maxCommits(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 50
  return Math.max(0, n)
}

export function maxFiles(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 10
  return Math.max(0, n)
}

/** Keeps the first `max` file lines of a `--stat` (0 keeps all), a "… N more" line, and the totals line. */
export function limitFiles(lines: string[], max: number): string[] {
  const totals = /^\d+ files? changed/.test(lines.at(-1) ?? '') ? lines.slice(-1) : []
  const files = lines.slice(0, lines.length - totals.length)
  if (max <= 0 || files.length <= max) return lines
  return [...files.slice(0, max), `… ${files.length - max} more`, ...totals]
}

export function maxBranches(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  return Math.max(0, n)
}
