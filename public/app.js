const POLL_MS = 5000;
const STATUS_LABEL = { running: '실행중', waiting: '대기', idle: '유휴', error: '오류' };
const fmt = (n) => n == null ? '–' : Intl.NumberFormat().format(n);
const fmtTokens = (n) => n == null ? '–' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
const fmtMs = (ms) => ms == null ? '–' : (ms/1000).toFixed(1)+'s';
const fmtUsd = (n) => n == null ? '–' : '$'+n.toFixed(2);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const MCP_STATUS = { connected: '🟢 사용 가능', needs_auth: '🟡 인증 필요', configured: '⚪ 설정됨' };
const MEM_TYPE = { user: '사용자', feedback: '피드백', project: '프로젝트', reference: '참고' };

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
  const connected = rows.filter(s => s.status === 'connected').length;
  const needsAuth = rows.filter(s => s.status === 'needs_auth').length;
  const intro = `<p class="tab-intro"><b>MCP (Model Context Protocol)</b> — Claude가 Slack·Notion·GitHub 같은 외부 도구/서비스에 연결되는 표준입니다. `
    + `<b>🟢 사용 가능 ${connected}개</b> · <b>🟡 인증 필요 ${needsAuth}개</b> — "인증 필요"는 설치는 됐지만 로그인해야 쓸 수 있는 상태입니다.</p>`;
  const table = '<table class="data-table"><tr><th>서버</th><th>상태</th></tr>'
    + rows.map(s => `<tr><td>${esc(s.name)}</td><td>${MCP_STATUS[s.status] || esc(s.status)}</td></tr>`).join('')
    + '</table>';
  document.getElementById('panel-mcp').innerHTML = intro + table;
}
async function renderSkills() {
  const rows = await getJson('/api/skills');
  const intro = `<p class="tab-intro">설치된 플러그인과 각 플러그인이 제공하는 <b>스킬</b>입니다. 스킬은 Claude가 특정 작업을 수행하는 방법을 담은 모듈로, 아래 설명이 그 용도입니다.</p>`;
  const blocks = rows.map(p => {
    const head = `<div class="src-head"><b>${esc(p.name)}</b> <small>v${esc(p.version || '?')}</small> `
      + `${p.enabled ? '<span class="badge ok">활성</span>' : '<span class="badge">비활성</span>'} <small>· 스킬 ${p.skills.length}개</small></div>`;
    const list = p.skills.length
      ? '<ul class="desc-list">' + p.skills.map(s =>
          `<li><span class="item-name">${esc(s.name)}</span>${s.description ? ` — <span class="item-desc">${esc(s.description)}</span>` : ''}</li>`).join('') + '</ul>'
      : '<div class="desc-list muted">제공 스킬 메타데이터 없음</div>';
    return `<div class="src-block">${head}${list}</div>`;
  }).join('');
  document.getElementById('panel-skills').innerHTML = intro + (blocks || '<p>플러그인 없음</p>');
}
async function renderMemory() {
  const rows = await getJson('/api/memory');
  const intro = `<p class="tab-intro">프로젝트별 <b>장기 메모리</b>입니다. Claude가 세션을 넘어 기억하는 사실로, 유형은 사용자·피드백·프로젝트·참고로 나뉩니다.</p>`;
  const blocks = rows.map(r => {
    const items = r.files.map(f => {
      const badge = f.type ? `<span class="badge">${esc(MEM_TYPE[f.type] || f.type)}</span> ` : '';
      return `<li>${badge}<span class="item-name">${esc(f.name)}</span>${f.description ? ` — <span class="item-desc">${esc(f.description)}</span>` : ''}</li>`;
    }).join('');
    return `<div class="src-block"><div class="src-head"><b>${esc(r.project)}</b> <small>· ${r.files.length}개</small></div><ul class="desc-list">${items}</ul></div>`;
  }).join('');
  document.getElementById('panel-memory').innerHTML = intro + (blocks || '<p>메모리 없음</p>');
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
