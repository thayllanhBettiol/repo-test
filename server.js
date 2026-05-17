const express = require('express');
const { simpleGit } = require('simple-git');
const path = require('path');
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
    res.json({ status, branches, remotes });
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

// POST /api/rebase  { repo, onto }
app.post('/api/rebase', async (req, res) => {
  const { repo, onto } = req.body;
  if (!repo || !onto) return res.status(400).json({ error: 'repo and onto required' });
  try {
    const { stdout, stderr } = await safeExec('git', ['rebase', onto], repo);
    res.json({ ok: true, output: stdout + stderr });
  } catch (e) {
    res.status(500).json({ ok: false, output: e.stdout + e.stderr, error: e.message });
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

const PORT = process.env.PORT || 3434;
app.listen(PORT, () => {
  console.log(`Git Dashboard running at http://localhost:${PORT}`);
  console.log('Open the URL above, then enter the path to any git repository.');
});
