const POLL_MS = 5000;
const STATUS_LABEL = { running: '실행중', waiting: '대기', idle: '유휴', error: '오류' };
const fmt = (n) => n == null ? '–' : Intl.NumberFormat().format(n);
const fmtTokens = (n) => n == null ? '–' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
const fmtMs = (ms) => ms == null ? '–' : (ms/1000).toFixed(1)+'s';
const fmtUsd = (n) => n == null ? '–' : '$'+n.toFixed(2);

async function getJson(url) { const r = await fetch(url); return r.json(); }

async function refreshOverview() {
  const o = await getJson('/api/overview');
  document.getElementById('kpi-sessions').textContent = fmt(o.totalSessions);
  document.getElementById('kpi-running').textContent = fmt(o.runningSessions);
  document.getElementById('kpi-turns').textContent = fmt(o.totalTurns);
  document.getElementById('kpi-input').textContent = fmtTokens(o.totalInputTokens);
  document.getElementById('kpi-output').textContent = fmtTokens(o.totalOutputTokens);
  document.getElementById('kpi-latency').textContent = fmtMs(o.avgResponseMs);
  document.getElementById('kpi-cost').textContent = fmtUsd(o.estimatedCostUsd);
}

let knownProjects = new Set();
async function refreshSessions() {
  const filter = document.getElementById('project-filter').value;
  const cards = await getJson('/api/sessions' + (filter ? '?project='+encodeURIComponent(filter) : ''));
  const all = filter ? null : cards;
  if (all) {
    for (const c of all) knownProjects.add(c.project);
    const sel = document.getElementById('project-filter');
    for (const proj of [...knownProjects].sort()) {
      if (![...sel.options].some(o => o.value === proj)) {
        const opt = document.createElement('option'); opt.value = proj; opt.textContent = proj; sel.appendChild(opt);
      }
    }
  }
  const container = document.getElementById('session-cards');
  container.innerHTML = '';
  for (const c of cards) {
    const div = document.createElement('div');
    div.className = 'card ' + c.status;
    div.innerHTML = `
      <div class="card-head"><span class="dot ${c.status}"></span><span class="card-title">${c.project}</span><span class="status-label ${c.status}">${STATUS_LABEL[c.status] || c.status}</span></div>
      <div class="card-stats">
        턴 ${fmt(c.turns)} · 토큰 ${fmtTokens(c.tokens.input + c.tokens.output)}<br>
        지연 ${fmtMs(c.avgResponseMs)} · ${fmtUsd(c.costUsd)}<br>
        <span style="opacity:.6">${c.sessionId.slice(0,8)}</span>
      </div>`;
    div.onclick = () => openModal(c.sessionId);
    container.appendChild(div);
  }
}

let toolChart = null;
async function openModal(id) {
  const d = await getJson('/api/sessions/' + encodeURIComponent(id));
  document.getElementById('modal-title').textContent = d.project;
  document.getElementById('modal-meta').textContent =
    `${d.model || 'unknown'} · 턴 ${fmt(d.turns)} · ${fmtUsd(d.costUsd)} · 상태 ${d.status}`;
  const counts = d.toolCounts || {};
  const labels = Object.keys(counts);
  const data = labels.map(k => counts[k]);
  if (toolChart) toolChart.destroy();
  toolChart = new Chart(document.getElementById('tool-chart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: '도구 호출', data, backgroundColor: '#7c5cff' }] },
    options: { plugins: { legend: { display:false } }, scales: { x: { ticks: { color:'#8b90a0' } }, y: { ticks: { color:'#8b90a0' } } } },
  });
  document.getElementById('modal').classList.remove('hidden');
}

async function renderMcp() {
  const rows = await getJson('/api/mcp');
  document.getElementById('mcp-table').innerHTML =
    '<tr><th>서버</th><th>설정됨</th><th>인증 필요</th></tr>' +
    rows.map(s => `<tr><td>${s.name}</td><td>${s.configured?'✓':'–'}</td><td>${s.needsAuth?'<span class="badge warn">필요</span>':'<span class="badge ok">OK</span>'}</td></tr>`).join('');
}
async function renderSkills() {
  const rows = await getJson('/api/skills');
  document.getElementById('skills-table').innerHTML =
    '<tr><th>플러그인</th><th>버전</th><th>활성</th></tr>' +
    rows.map(s => `<tr><td>${s.name}</td><td>${s.version||'–'}</td><td>${s.enabled?'<span class="badge ok">활성</span>':'–'}</td></tr>`).join('');
}
async function renderMemory() {
  const rows = await getJson('/api/memory');
  document.getElementById('memory-list').innerHTML =
    rows.map(r => `<h3>${r.project}</h3><div class="card-stats">${r.files.map(f => f.name).join(', ')}</div>`).join('') || '<p>메모리 없음</p>';
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.getElementById('panel-' + name).classList.add('active');
      if (name === 'mcp') renderMcp();
      if (name === 'skills') renderSkills();
      if (name === 'memory') renderMemory();
    };
  });
}

document.getElementById('modal-close').onclick = () => document.getElementById('modal').classList.add('hidden');
document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') e.currentTarget.classList.add('hidden'); };
document.getElementById('project-filter').onchange = refreshSessions;

setupTabs();
async function tick() { await refreshOverview(); await refreshSessions(); }
tick();
setInterval(tick, POLL_MS);
