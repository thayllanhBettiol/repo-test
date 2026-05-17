const express = require('express');
const { simpleGit } = require('simple-git');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getGit(repoPath) {
  return simpleGit(repoPath);
}

async function safeExec(cmd, args, cwd) {
  return execFileAsync(cmd, args, { cwd, timeout: 15000 });
}

// GET /api/status?repo=<path>
app.get('/api/status', async (req, res) => {
  const repo = req.query.repo;
  if (!repo) return res.status(400).json({ error: 'repo path required' });
  try {
    const git = getGit(repo);
    const [status, branches, remotes] = await Promise.all([
      git.status(),
      git.branch(['-a', '--sort=-committerdate']),
      git.getRemotes(true),
    ]);
    const rebaseMergeDir = path.join(repo, '.git', 'rebase-merge');
    const rebaseApplyDir = path.join(repo, '.git', 'rebase-apply');
    const rebaseInProgress = fs.existsSync(rebaseMergeDir) || fs.existsSync(rebaseApplyDir);
    let rebaseStep = null, rebaseTotal = null;
    if (rebaseInProgress) {
      try { rebaseStep = parseInt(fs.readFileSync(path.join(rebaseMergeDir, 'msgnum'), 'utf8').trim()); } catch {}
      try { rebaseTotal = parseInt(fs.readFileSync(path.join(rebaseMergeDir, 'end'), 'utf8').trim()); } catch {}
    }
    res.json({ status, branches, remotes, rebaseInProgress, rebaseStep, rebaseTotal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/log?repo=<path>&branch=<branch>&limit=<n>
app.get('/api/log', async (req, res) => {
  const { repo, branch, limit = 50 } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo path required' });
  try {
    const git = getGit(repo);
    const args = [
      '--pretty=format:%H|%h|%P|%an|%ae|%ar|%s|%D',
      '--decorate=full',
      `-n${limit}`,
    ];
    if (branch) args.push(branch);
    const raw = await git.raw(['log', ...args]);
    const commits = raw.trim().split('\n').filter(Boolean).map(line => {
      const [hash, short, parents, author, email, date, subject, refs] = line.split('|');
      return { hash, short, parents: parents ? parents.split(' ').filter(Boolean) : [], author, email, date, subject, refs };
    });
    res.json({ commits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/graph?repo=<path>&limit=<n>
app.get('/api/graph', async (req, res) => {
  const { repo, limit = 80 } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo path required' });
  try {
    const { stdout } = await safeExec('git', [
      'log', '--oneline', '--graph', '--decorate', '--all', `-n${limit}`
    ], repo);
    res.json({ graph: stdout });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/checkout  { repo, branch }
app.post('/api/checkout', async (req, res) => {
  const { repo, branch } = req.body;
  if (!repo || !branch) return res.status(400).json({ error: 'repo and branch required' });
  try {
    const git = getGit(repo);
    await git.checkout(branch);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/rebase-commits?repo=<>&base=<branch>
app.get('/api/rebase-commits', async (req, res) => {
  const { repo, base } = req.query;
  if (!repo || !base) return res.status(400).json({ error: 'repo and base required' });
  try {
    const { stdout } = await safeExec('git', [
      'log', '--format=%H\t%s', '--reverse', `${base}..HEAD`
    ], repo);
    const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
      const tab = line.indexOf('\t');
      return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
    res.json({ commits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/rebase-interactive { repo, onto, todo: [{action, hash, subject, newMessage?}] }
app.post('/api/rebase-interactive', async (req, res) => {
  const { repo, onto, todo } = req.body;
  if (!repo || !onto || !Array.isArray(todo)) return res.status(400).json({ error: 'repo, onto, todo required' });

  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-rebase-'));
  try {
    // Build and write the todo file (oldest commit first, as git expects)
    const todoLines = todo.map(e => `${e.action} ${e.hash} ${e.subject}`);
    const todoPath = path.join(sessionDir, 'todo');
    fs.writeFileSync(todoPath, todoLines.join('\n') + '\n');

    // Build editor message queue: only reword and squash trigger GIT_EDITOR calls.
    // For squash with no custom message we skip the file so git auto-combines.
    const editorEntries = todo.filter(e => e.action === 'reword' || e.action === 'squash');
    editorEntries.forEach((e, i) => {
      const msg = e.newMessage?.trim();
      if (e.action === 'squash' && !msg) return;
      fs.writeFileSync(path.join(sessionDir, `editor_msg_${i}`), (msg || e.subject).trim() + '\n');
    });
    fs.writeFileSync(path.join(sessionDir, 'editor_idx'), '0');

    // seq-editor.sh: replaces git's generated todo with ours
    const seqEditorPath = path.join(sessionDir, 'seq-editor.sh');
    fs.writeFileSync(seqEditorPath, `#!/bin/sh\ncp "${todoPath}" "$1"\n`);
    fs.chmodSync(seqEditorPath, '755');

    // editor.sh: injects the next queued message on each GIT_EDITOR call
    const editorPath = path.join(sessionDir, 'editor.sh');
    fs.writeFileSync(editorPath, `#!/bin/sh
DIR="${sessionDir}"
IDX_FILE="$DIR/editor_idx"
IDX=$(cat "$IDX_FILE" 2>/dev/null)
IDX=\${IDX:-0}
MSG_FILE="$DIR/editor_msg_$IDX"
if [ -f "$MSG_FILE" ]; then
  cat "$MSG_FILE" > "$1"
fi
printf '%s' "$((IDX + 1))" > "$IDX_FILE"
`);
    fs.chmodSync(editorPath, '755');

    const env = {
      ...process.env,
      GIT_SEQUENCE_EDITOR: seqEditorPath,
      GIT_EDITOR: editorPath,
    };

    const { stdout, stderr } = await execFileAsync('git', ['rebase', '-i', onto], {
      cwd: repo, env, timeout: 60000,
    });
    res.json({ ok: true, output: stdout + stderr });
  } catch (e) {
    const rebaseMergeDir = path.join(repo, '.git', 'rebase-merge');
    const inProgress = fs.existsSync(rebaseMergeDir) ||
                       fs.existsSync(path.join(repo, '.git', 'rebase-apply'));
    res.json({
      ok: false,
      inProgress,
      output: (e.stdout || '') + (e.stderr || ''),
      error: e.message,
    });
  } finally {
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
  }
});

// POST /api/rebase-abort  { repo }
app.post('/api/rebase-abort', async (req, res) => {
  const { repo } = req.body;
  try {
    const { stdout, stderr } = await safeExec('git', ['rebase', '--abort'], repo);
    res.json({ ok: true, output: stdout + stderr });
  } catch (e) {
    res.status(500).json({ ok: false, output: e.stdout + e.stderr, error: e.message });
  }
});

// POST /api/rebase-continue  { repo }
app.post('/api/rebase-continue', async (req, res) => {
  const { repo } = req.body;
  try {
    const { stdout, stderr } = await safeExec('git', ['rebase', '--continue'], repo);
    res.json({ ok: true, output: stdout + stderr });
  } catch (e) {
    res.status(500).json({ ok: false, output: e.stdout + e.stderr, error: e.message });
  }
});

// POST /api/amend  { repo, message? }
app.post('/api/amend', async (req, res) => {
  const { repo, message } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const args = ['commit', '--amend'];
    if (message) args.push('-m', message);
    else args.push('--no-edit');
    const { stdout, stderr } = await safeExec('git', args, repo);
    res.json({ ok: true, output: stdout + stderr });
  } catch (e) {
    res.status(500).json({ ok: false, output: e.stdout + e.stderr, error: e.message });
  }
});

// POST /api/push  { repo, remote?, branch?, forceWithLease? }
app.post('/api/push', async (req, res) => {
  const { repo, remote = 'origin', branch, forceWithLease = false } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const args = ['push', remote];
    if (branch) args.push(branch);
    if (forceWithLease) args.push('--force-with-lease');
    const { stdout, stderr } = await safeExec('git', args, repo);
    res.json({ ok: true, output: stdout + stderr });
  } catch (e) {
    res.status(500).json({ ok: false, output: e.stdout + e.stderr, error: e.message });
  }
});

// POST /api/fetch  { repo, remote? }
app.post('/api/fetch', async (req, res) => {
  const { repo, remote = '--all' } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const { stdout, stderr } = await safeExec('git', ['fetch', remote, '--prune'], repo);
    res.json({ ok: true, output: stdout + stderr });
  } catch (e) {
    res.status(500).json({ ok: false, output: e.stdout + e.stderr, error: e.message });
  }
});

// GET /api/diff?repo=<path>&ref=<ref>
app.get('/api/diff', async (req, res) => {
  const { repo, ref = 'HEAD' } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const { stdout } = await safeExec('git', ['show', '--stat', ref], repo);
    res.json({ diff: stdout });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3434;
  app.listen(PORT, () => {
    console.log(`Git Dashboard running at http://localhost:${PORT}`);
    console.log('Open the URL above, then enter the path to any git repository.');
  });
}

module.exports = app;
