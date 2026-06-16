const POLL_MS = 5000;
const STATUS_LABEL = { running: '실행중', waiting: '대기', idle: '유휴', error: '오류' };
const fmt = (n) => n == null ? '–' : Intl.NumberFormat().format(n);
const fmtTokens = (n) => n == null ? '–' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
const fmtMs = (ms) => ms == null ? '–' : (ms/1000).toFixed(1)+'s';
const fmtUsd = (n) => n == null ? '–' : '$'+n.toFixed(2);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const MCP_STATUS = { connected: '🟢 사용 가능', needs_auth: '🟡 인증 필요', configured: '⚪ 설정됨' };
const MEM_TYPE = { user: '사용자', feedback: '피드백', project: '프로젝트', reference: '참고' };
const fmtKB = (n) => n == null ? '' : (n / 1024).toFixed(1) + ' KB';
const MEM_STYLE = {
  user:      { color: '#56b6ff', icon: '👤' },
  feedback:  { color: '#ffcc33', icon: '💬' },
  project:   { color: '#b06cff', icon: '📌' },
  reference: { color: '#3ddc84', icon: '🔗' },
  index:     { color: '#9aa3b8', icon: '🗂️' },
};
// 파일의 표시 유형(키): 알려진 type이면 그대로, MEMORY.md나 미상이면 'index'.
function memKind(f) {
  if (f.type && MEM_STYLE[f.type]) return f.type;
  return 'index';
}

async function getJson(url) { const r = await fetch(url); return r.json(); }

// Korean display translations (display layer only — source data is untouched).
// Missing entries fall back to the original text.
let TR = null;
async function ensureTR() {
  if (!TR) { try { TR = await getJson('/translations-ko.json'); } catch { TR = {}; } }
  return TR;
}

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
let currentSessionId = null;

function resetDeleteUI() {
  const box = document.getElementById('modal-actions');
  box.innerHTML = '<button id="session-delete" class="btn-danger">세션 삭제</button>';
  document.getElementById('session-delete').onclick = confirmDeleteUI;
}
function confirmDeleteUI() {
  const box = document.getElementById('modal-actions');
  box.innerHTML =
    '<span class="confirm-text">정말 삭제할까요? 휴지통으로 이동합니다.</span>'
    + '<button id="del-cancel" class="btn-ghost">취소</button>'
    + '<button id="del-confirm" class="btn-danger">휴지통으로 이동</button>';
  document.getElementById('del-cancel').onclick = resetDeleteUI;
  document.getElementById('del-confirm').onclick = doDelete;
}
async function doDelete() {
  const box = document.getElementById('modal-actions');
  try {
    const r = await fetch('/api/sessions/' + encodeURIComponent(currentSessionId), { method: 'DELETE' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      box.innerHTML = `<span class="error-text">삭제 실패: ${esc(e.error || r.status)}</span>`;
      return;
    }
    document.getElementById('modal').classList.add('hidden');
    refreshSessions();
  } catch (err) {
    box.innerHTML = `<span class="error-text">삭제 실패: ${esc(err.message)}</span>`;
  }
}
async function openModal(id) {
  const d = await getJson('/api/sessions/' + encodeURIComponent(id));
  currentSessionId = id;
  resetDeleteUI();
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
  const [rows, tr] = [await getJson('/api/mcp'), await ensureTR()];
  const mcpTr = tr.mcp || {};
  const connected = rows.filter(s => s.status === 'connected').length;
  const needsAuth = rows.filter(s => s.status === 'needs_auth').length;
  const intro = `<p class="tab-intro"><b>MCP (Model Context Protocol)</b> — Claude가 Slack·Notion·GitHub 같은 외부 도구/서비스에 연결되는 표준입니다. `
    + `<b>🟢 사용 가능 ${connected}개</b> · <b>🟡 인증 필요 ${needsAuth}개</b> — "인증 필요"는 설치는 됐지만 로그인해야 쓸 수 있는 상태입니다.</p>`;
  const table = '<table class="data-table"><tr><th>서버</th><th>상태</th><th>설명</th></tr>'
    + rows.map(s => `<tr><td>${esc(s.name)}</td><td>${MCP_STATUS[s.status] || esc(s.status)}</td><td class="item-desc">${esc(mcpTr[s.name] || '')}</td></tr>`).join('')
    + '</table>';
  document.getElementById('panel-mcp').innerHTML = intro + table;
}
async function renderSkills() {
  const [rows, tr] = [await getJson('/api/skills'), await ensureTR()];
  const skillTr = tr.skills || {};
  const intro = `<p class="tab-intro">설치된 플러그인과 각 플러그인이 제공하는 <b>스킬</b>입니다. 스킬은 Claude가 특정 작업을 수행하는 방법을 담은 모듈로, 아래 설명이 그 용도입니다.</p>`;
  const blocks = rows.map(p => {
    const head = `<div class="src-head"><b>${esc(p.name)}</b> <small>v${esc(p.version || '?')}</small> `
      + `${p.enabled ? '<span class="badge ok">활성</span>' : '<span class="badge">비활성</span>'} <small>· 스킬 ${p.skills.length}개</small></div>`;
    const list = p.skills.length
      ? '<ul class="desc-list">' + p.skills.map(s => {
          const desc = skillTr[s.name] || s.description;
          return `<li><span class="item-name">${esc(s.name)}</span>${desc ? ` — <span class="item-desc">${esc(desc)}</span>` : ''}</li>`;
        }).join('') + '</ul>'
      : '<div class="desc-list muted">제공 스킬 메타데이터 없음</div>';
    return `<div class="src-block">${head}${list}</div>`;
  }).join('');
  document.getElementById('panel-skills').innerHTML = intro + (blocks || '<p>플러그인 없음</p>');
}
async function renderMemory() {
  const [rows, tr] = [await getJson('/api/memory'), await ensureTR()];
  const memTr = tr.memoryByFile || {};
  const intro = `<p class="tab-intro">프로젝트별 <b>장기 메모리</b>입니다. Claude가 세션을 넘어 기억하는 사실로, 유형은 사용자·피드백·프로젝트·참고로 나뉩니다.</p>`;

  // 전체 유형별 개수 집계
  const counts = {};
  for (const r of rows) for (const f of r.files) {
    const k = memKind(f);
    counts[k] = (counts[k] || 0) + 1;
  }
  const order = ['user', 'feedback', 'project', 'reference', 'index'];
  const sumItems = order.filter(k => counts[k]).map(k => {
    const st = MEM_STYLE[k];
    const label = k === 'index' ? '색인' : (MEM_TYPE[k] || k);
    return `<span class="mem-sum" style="--c:${st.color}">${st.icon} ${label} ${counts[k]}</span>`;
  }).join('');
  const summary = sumItems ? `<div class="mem-summary">${sumItems}</div>` : '';

  const blocks = rows.map(r => {
    const cards = r.files.map(f => {
      const k = memKind(f);
      const st = MEM_STYLE[k];
      const label = k === 'index' ? '색인' : (MEM_TYPE[f.type] || f.type);
      const desc = memTr[f.name] || f.description || '';
      const size = fmtKB(f.size);
      return `<div class="mem-card" data-project="${esc(r.project)}" data-name="${esc(f.name)}" style="--c:${st.color}">
        <div class="mem-card-head">
          <span class="mem-ic">${st.icon}</span>
          <span class="mem-name">${esc(f.name)}</span>
          <span class="mem-type">${esc(label)}</span>
        </div>
        ${desc ? `<div class="mem-desc">${esc(desc)}</div>` : ''}
        ${size ? `<div class="mem-size">${esc(size)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="src-block">
      <div class="src-head"><b>📁 ${esc(r.project)}</b> <small>· ${r.files.length}개</small></div>
      <div class="mem-grid">${cards}</div>
    </div>`;
  }).join('');

  document.getElementById('panel-memory').innerHTML = intro + summary + (blocks || '<p>메모리 없음</p>');
  document.querySelectorAll('#panel-memory .mem-card').forEach(card => {
    card.onclick = () => openMemoryModal(card.dataset.project, card.dataset.name);
  });
}
let currentMemory = null;

function resetMemDeleteUI() {
  const box = document.getElementById('mem-modal-actions');
  box.innerHTML = '<button id="mem-delete" class="btn-danger">메모리 삭제</button>';
  document.getElementById('mem-delete').onclick = confirmMemDeleteUI;
}
function confirmMemDeleteUI() {
  const box = document.getElementById('mem-modal-actions');
  box.innerHTML =
    '<span class="confirm-text">정말 삭제할까요? 휴지통으로 이동합니다.</span>'
    + '<button id="mem-del-cancel" class="btn-ghost">취소</button>'
    + '<button id="mem-del-confirm" class="btn-danger">휴지통으로 이동</button>';
  document.getElementById('mem-del-cancel').onclick = resetMemDeleteUI;
  document.getElementById('mem-del-confirm').onclick = doMemDelete;
}
async function doMemDelete() {
  const box = document.getElementById('mem-modal-actions');
  try {
    const r = await fetch('/api/memory/file?project=' + encodeURIComponent(currentMemory.project) + '&name=' + encodeURIComponent(currentMemory.name), { method: 'DELETE' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      box.innerHTML = `<span class="error-text">삭제 실패: ${esc(e.error || r.status)}</span>`;
      return;
    }
    document.getElementById('mem-modal').classList.add('hidden');
    renderMemory();
  } catch (err) {
    box.innerHTML = `<span class="error-text">삭제 실패: ${esc(err.message)}</span>`;
  }
}
async function openMemoryModal(project, name) {
  document.getElementById('mem-modal-title').textContent = name;
  document.getElementById('mem-modal-meta').textContent = '프로젝트: ' + project;
  currentMemory = { project, name };
  resetMemDeleteUI();
  const pre = document.getElementById('mem-content');
  pre.textContent = '불러오는 중…';
  document.getElementById('mem-modal').classList.remove('hidden');
  try {
    const r = await fetch('/api/memory/file?project=' + encodeURIComponent(project) + '&name=' + encodeURIComponent(name));
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      pre.textContent = '불러오기 실패: ' + (e.error || r.status);
      return;
    }
    const d = await r.json();
    pre.textContent = d.content;
  } catch (err) {
    pre.textContent = '불러오기 실패: ' + err.message;
  }
}

async function renderInstall() {
  const d = await getJson('/api/install');
  const cc = d.claudeCode || {};
  const up = cc.update;
  let updateLine;
  if (!up) updateLine = '<span class="badge ok">이상 없음</span>';
  else if (up.outcome === 'failed' || up.status === 'install_failed')
    updateLine = `<span class="badge err">업데이트 실패</span> ${esc(up.versionFrom || '?')} → ${esc(up.versionTo || '?')} <small>(${esc(up.errorCode || '')})</small>`;
  else updateLine = `<span class="badge ok">${esc(up.outcome || up.status || '완료')}</span> ${esc(up.versionTo || '')}`;

  const ccBlock = `<div class="src-block">
    <div class="src-head"><b>Claude Code</b> <span class="badge">v${esc(cc.version || '?')}</span></div>
    <div class="kv"><span>설치 방식</span><b>${esc(cc.installMethod || '–')}</b></div>
    <div class="kv"><span>누적 실행</span><b>${esc(cc.numStartups != null ? cc.numStartups + '회' : '–')}</b></div>
    <div class="kv"><span>최초 실행</span><b>${esc((cc.firstStartTime || '').slice(0, 10) || '–')}</b></div>
    <div class="kv"><span>업데이트</span><span>${updateLine}</span></div>
  </div>`;

  const plugins = (d.plugins || []).map(p =>
    `<tr><td>${esc(p.name)}</td><td>${esc(p.version || '–')}</td>`
    + `<td>${p.enabled ? '<span class="badge ok">활성</span>' : '<span class="badge">비활성</span>'}</td>`
    + `<td>${esc((p.installedAt || '').slice(0, 10) || '–')}</td><td>${esc((p.lastUpdated || '').slice(0, 10) || '–')}</td></tr>`).join('');

  const markets = (d.marketplaces || []).map(m =>
    `<tr><td>${esc(m.name)}</td><td class="item-desc">${esc(m.source || '–')}</td><td>${esc((m.lastUpdated || '').slice(0, 10) || '–')}</td></tr>`).join('');

  document.getElementById('panel-install').innerHTML =
    `<p class="tab-intro">Claude Code 본체와 설치된 <b>플러그인·마켓플레이스</b>의 설치/버전 상태입니다.</p>`
    + ccBlock
    + `<div class="src-block"><div class="src-head"><b>설치된 플러그인</b> <small>· ${(d.plugins || []).length}개</small></div>`
    + `<table class="data-table"><tr><th>플러그인</th><th>버전</th><th>활성</th><th>설치</th><th>갱신</th></tr>${plugins}</table></div>`
    + `<div class="src-block"><div class="src-head"><b>마켓플레이스</b> <small>· ${(d.marketplaces || []).length}개</small></div>`
    + `<table class="data-table"><tr><th>이름</th><th>출처</th><th>갱신</th></tr>${markets}</table></div>`;
}

async function initHeader() {
  try {
    const d = await getJson('/api/install');
    const cc = d.claudeCode || {};
    const chip = document.getElementById('cc-chip');
    const failed = cc.update && (cc.update.outcome === 'failed' || cc.update.status === 'install_failed');
    chip.textContent = `Claude Code v${cc.version || '?'}` + (failed ? ` · 업데이트 대기(${cc.update.versionTo})` : '');
    chip.className = failed ? 'chip warn' : 'chip';
  } catch { /* leave default */ }
}

function setupTabs() {
  document.querySelectorAll('.nav-item').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.getElementById('panel-' + name).classList.add('active');
      if (name === 'mcp') renderMcp();
      if (name === 'skills') renderSkills();
      if (name === 'memory') renderMemory();
      if (name === 'install') renderInstall();
    };
  });
}

document.getElementById('modal-close').onclick = () => document.getElementById('modal').classList.add('hidden');
document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') e.currentTarget.classList.add('hidden'); };
document.getElementById('mem-modal-close').onclick = () => document.getElementById('mem-modal').classList.add('hidden');
document.getElementById('mem-modal').onclick = (e) => { if (e.target.id === 'mem-modal') e.currentTarget.classList.add('hidden'); };
document.getElementById('project-filter').onchange = refreshSessions;

setupTabs();
initHeader();
async function tick() { await refreshOverview(); await refreshSessions(); }
tick();
setInterval(tick, POLL_MS);
