/* ── State ── */
let state = {
  repo: '',
  currentBranch: '',
  branches: [],
  logLimit: 60,
};

/* ── DOM refs ── */
const $ = id => document.getElementById(id);
const repoInput   = $('repo-path');
const btnLoad     = $('btn-load');
const btnFetch    = $('btn-fetch');
const branchPill  = $('current-branch-pill');
const branchCount = $('branch-count');
const branchList  = $('branch-list');
const branchFilter= $('branch-filter');
const rebaseTarget= $('rebase-target');
const pushRemote  = $('push-remote');
const amendMsg    = $('amend-msg');
const forceLease  = $('force-lease');
const graphView   = $('graph-view');
const logBody     = $('log-body');
const statusView  = $('status-view');
const outputLog   = $('output-log');
const modal       = $('modal');
const modalTitle  = $('modal-title');
const modalBody   = $('modal-body');
const rebaseControls = $('rebase-controls');

/* ── API helpers ── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}
const get  = (path) => api('GET', path);
const post = (path, body) => api('POST', path, body);

/* ── Output log ── */
function logOutput(cmd, result) {
  const ts = new Date().toLocaleTimeString();
  const ok = result.ok !== false;
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-ts">${ts}</span> <span class="log-cmd">${cmd}</span>\n` +
    (result.output || result.error || result.diff || result.graph || '').replace(/</g,'&lt;');
  entry.querySelector('.log-cmd').className = `log-cmd ${ok ? 'log-ok' : 'log-err'}`;
  outputLog.prepend(entry);
}

/* ── Load repo ── */
async function loadRepo() {
  const repo = repoInput.value.trim();
  if (!repo) return;
  state.repo = repo;
  await Promise.all([refreshStatus(), refreshGraph(), refreshLog()]);
}

async function refreshStatus() {
  const data = await get(`/api/status?repo=${encodeURIComponent(state.repo)}`);
  if (data.error) { logOutput('status', { ok: false, error: data.error }); return; }

  state.currentBranch = data.status.current;
  branchPill.textContent = `⎇ ${data.status.current || 'detached HEAD'}`;

  // branches
  state.branches = data.branches.all || [];
  branchCount.textContent = state.branches.length;
  renderBranchList();

  // rebase-target select
  const locals = (data.branches.branches ? Object.keys(data.branches.branches) : []).filter(b => b !== data.status.current);
  rebaseTarget.innerHTML = locals.map(b => `<option value="${b}">${b}</option>`).join('');

  // push remote select
  const remotes = data.remotes.map(r => r.name);
  pushRemote.innerHTML = remotes.map(r => `<option value="${r}">${r}</option>`).join('');

  // status panel
  const s = data.status;
  const lines = [];
  lines.push(`Branch:  ${s.current}`);
  lines.push(`Ahead:   ${s.ahead}   Behind: ${s.behind}`);
  if (s.staged.length)    lines.push(`\nStaged (${s.staged.length}):\n` + s.staged.map(f => `  M  ${f.path}`).join('\n'));
  if (s.modified.length)  lines.push(`\nModified (${s.modified.length}):\n` + s.modified.map(f => `  ~  ${f.path}`).join('\n'));
  if (s.not_added.length) lines.push(`\nUntracked (${s.not_added.length}):\n` + s.not_added.map(f => `  ?  ${f}`).join('\n'));
  if (s.conflicted.length)lines.push(`\nConflicts (${s.conflicted.length}):\n` + s.conflicted.map(f => `  ! ${f}`).join('\n'));
  statusView.textContent = lines.join('\n');

  // show rebase-in-progress controls if needed
  const rebasing = s.conflicted.length > 0;
  rebaseControls.classList.toggle('hidden', !rebasing);
}

async function refreshGraph() {
  const data = await get(`/api/graph?repo=${encodeURIComponent(state.repo)}&limit=${state.logLimit}`);
  if (data.error) { graphView.textContent = data.error; return; }
  graphView.textContent = data.graph || '(empty)';
}

async function refreshLog() {
  const data = await get(`/api/log?repo=${encodeURIComponent(state.repo)}&limit=${state.logLimit}`);
  if (data.error) return;
  logBody.innerHTML = '';
  for (const c of data.commits) {
    const tr = document.createElement('tr');
    tr.dataset.hash = c.hash;
    tr.innerHTML = `
      <td class="hash-cell">${c.short}</td>
      <td class="subject-cell" title="${esc(c.subject)}">${esc(c.subject)}</td>
      <td class="author-cell">${esc(c.author)}</td>
      <td class="date-cell">${esc(c.date)}</td>
      <td>${renderRefs(c.refs)}</td>`;
    tr.addEventListener('click', () => showCommit(c.hash));
    logBody.appendChild(tr);
  }
}

function renderRefs(refs) {
  if (!refs) return '';
  return refs.split(',').map(r => {
    r = r.trim();
    if (!r) return '';
    let cls = 'ref-tag';
    if (r.includes('HEAD')) cls += ' head';
    else if (r.startsWith('refs/remotes/') || r.includes('origin/')) cls += ' remote';
    else if (r.startsWith('tag:')) cls += ' tag';
    const label = r.replace('refs/heads/','').replace('refs/remotes/','').replace('refs/tags/','tag: ');
    return `<span class="${cls}">${esc(label)}</span>`;
  }).join('');
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Branch list render ── */
function renderBranchList(filter = '') {
  branchList.innerHTML = '';
  const f = filter.toLowerCase();
  for (const b of state.branches) {
    if (f && !b.toLowerCase().includes(f)) continue;
    const li = document.createElement('li');
    const isRemote = b.startsWith('remotes/');
    const isCurrent = b === state.currentBranch || b === `* ${state.currentBranch}`;
    const label = b.replace(/^\*?\s*/, '').replace('remotes/','');
    if (isRemote) li.classList.add('remote');
    if (isCurrent) li.classList.add('current');
    const dot = document.createElement('span');
    dot.className = 'branch-dot';
    dot.style.background = isRemote ? '#388bfd' : isCurrent ? '#2ea043' : '#8b949e';
    li.appendChild(dot);
    li.appendChild(document.createTextNode(label));
    li.title = `Checkout ${label}`;
    li.addEventListener('click', () => checkout(label));
    branchList.appendChild(li);
  }
}

/* ── Commit detail modal ── */
async function showCommit(hash) {
  modalTitle.textContent = hash;
  modalBody.textContent = 'Loading…';
  modal.classList.remove('hidden');
  const data = await get(`/api/diff?repo=${encodeURIComponent(state.repo)}&ref=${hash}`);
  modalBody.textContent = data.diff || data.error;
}

/* ── Actions ── */
async function checkout(branch) {
  const data = await post('/api/checkout', { repo: state.repo, branch });
  logOutput(`checkout ${branch}`, data);
  if (data.ok) await loadRepo();
}

async function doRebase() {
  const onto = rebaseTarget.value;
  if (!onto) return;
  if (!confirm(`Rebase current branch onto "${onto}"?`)) return;
  const data = await post('/api/rebase', { repo: state.repo, onto });
  logOutput(`rebase onto ${onto}`, data);
  await loadRepo();
}

async function doAmend() {
  const message = amendMsg.value.trim();
  if (!confirm('Amend the last commit' + (message ? ' with new message?' : ' (keep message)?'))) return;
  const data = await post('/api/amend', { repo: state.repo, message: message || undefined });
  logOutput('commit --amend', data);
  amendMsg.value = '';
  await loadRepo();
}

async function doPush() {
  const remote = pushRemote.value || 'origin';
  const branch = state.currentBranch;
  const fwl = forceLease.checked;
  const label = fwl ? `push --force-with-lease ${remote} ${branch}` : `push ${remote} ${branch}`;
  if (fwl && !confirm(`Force-push with lease to ${remote}/${branch}?`)) return;
  const data = await post('/api/push', { repo: state.repo, remote, branch, forceWithLease: fwl });
  logOutput(label, data);
}

async function doFetch() {
  const data = await post('/api/fetch', { repo: state.repo });
  logOutput('fetch --all --prune', data);
  await loadRepo();
}

async function doRebaseContinue() {
  const data = await post('/api/rebase-continue', { repo: state.repo });
  logOutput('rebase --continue', data);
  await loadRepo();
}

async function doRebaseAbort() {
  if (!confirm('Abort the current rebase?')) return;
  const data = await post('/api/rebase-abort', { repo: state.repo });
  logOutput('rebase --abort', data);
  await loadRepo();
}

/* ── Tabs ── */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    const panel = document.getElementById(`tab-${btn.dataset.tab}`);
    if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
  });
});

/* ── Event wiring ── */
btnLoad.addEventListener('click', loadRepo);
repoInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadRepo(); });
btnFetch.addEventListener('click', doFetch);
branchFilter.addEventListener('input', e => renderBranchList(e.target.value));
$('btn-rebase').addEventListener('click', doRebase);
$('btn-amend').addEventListener('click', doAmend);
$('btn-push').addEventListener('click', doPush);
$('btn-rebase-continue').addEventListener('click', doRebaseContinue);
$('btn-rebase-abort').addEventListener('click', doRebaseAbort);
$('btn-clear-output').addEventListener('click', () => { outputLog.innerHTML = ''; });
$('modal-close').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

/* ── Auto-load from URL hash ── */
const savedRepo = sessionStorage.getItem('git-dashboard-repo');
if (savedRepo) {
  repoInput.value = savedRepo;
}
repoInput.addEventListener('change', () => sessionStorage.setItem('git-dashboard-repo', repoInput.value));
