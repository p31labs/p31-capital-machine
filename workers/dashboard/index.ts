import { Responder } from '../../shared/response';

const BACKEND = 'https://capital-machine.trimtab-signal.workers.dev';
const REFRESH_MS = 30_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Max-Age': '86400',
};

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>P31 Capital Machine — Dashboard</title>
<style>
  /* ─── Reset & Base ─── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:        #0a0e17;
    --bg-card:   #111827;
    --bg-panel:  #1a2332;
    --border:    #1e2d3d;
    --green:     #00e676;
    --yellow:    #ffd600;
    --red:       #ff1744;
    --cyan:      #00e5ff;
    --purple:    #b388ff;
    --text:      #e0e6ed;
    --muted:     #8899aa;
    --accent:    #00e676;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
  }
  a { color: var(--cyan); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ─── Layout ─── */
  .container { max-width: 1400px; margin: 0 auto; padding: 0 16px; }
  .grid { display: grid; gap: 16px; }
  .grid-2 { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  .grid-3 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .grid-4 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }

  /* ─── Header ─── */
  header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    padding: 20px 0;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: 0 2px 16px rgba(0,230,118,.06);
  }
  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo {
    width: 38px; height: 38px;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--green), var(--cyan));
    display: flex; align-items: center; justify-content: center;
    font-weight: 900; font-size: 16px; color: var(--bg);
    box-shadow: 0 0 20px rgba(0,230,118,.3);
  }
  h1 { font-size: 20px; font-weight: 700; letter-spacing: .3px; }
  .subtitle { font-size: 12px; color: var(--muted); }
  .header-right { display: flex; align-items: center; gap: 16px; }
  .live-time {
    font-family: 'SF Mono', 'Fira Code', monospace;
    color: var(--cyan);
    font-size: 13px;
  }
  .refresh-badge {
    font-size: 11px;
    background: rgba(0,230,118,.1);
    color: var(--green);
    border: 1px solid rgba(0,230,118,.2);
    border-radius: 20px;
    padding: 4px 10px;
  }

  /* ─── Sections ─── */
  main { padding: 24px 0 60px; }
  .section { margin-bottom: 24px; }
  .section-title {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: var(--muted);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title::before {
    content: '';
    display: inline-block;
    width: 3px; height: 14px;
    background: var(--accent);
    border-radius: 2px;
  }

  /* ─── Cards ─── */
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    transition: box-shadow .2s;
  }
  .card:hover { box-shadow: 0 4px 24px rgba(0,230,118,.06); }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .card-title { font-weight: 600; font-size: 14px; }
  .card-badge {
    font-size: 11px;
    border-radius: 20px;
    padding: 3px 10px;
    font-weight: 600;
  }
  .badge-healthy    { background: rgba(0,230,118,.12); color: var(--green); border: 1px solid rgba(0,230,118,.25); }
  .badge-degraded   { background: rgba(255,214,0,.12); color: var(--yellow); border: 1px solid rgba(255,214,0,.25); }
  .badge-unhealthy  { background: rgba(255,23,68,.12); color: var(--red); border: 1px solid rgba(255,23,68,.25); }
  .badge-pending    { background: rgba(0,229,255,.1); color: var(--cyan); border: 1px solid rgba(0,229,255,.25); }
  .badge-completed  { background: rgba(0,230,118,.1); color: var(--green); border: 1px solid rgba(0,230,118,.25); }
  .badge-failed     { background: rgba(255,23,68,.1); color: var(--red); border: 1px solid rgba(255,23,68,.25); }

  /* ─── Status Grid ─── */
  .status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .status-item {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .status-module { font-size: 12px; color: var(--muted); font-weight: 500; }
  .status-value { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .dot-green  { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .dot-yellow { background: var(--yellow); box-shadow: 0 0 8px var(--yellow); }
  .dot-red    { background: var(--red); box-shadow: 0 0 8px var(--red); }

  /* ─── Revenue Chart ─── */
  .chart-wrap { display: flex; align-items: flex-end; gap: 10px; height: 180px; padding-top: 10px; }
  .chart-bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 50px; }
  .chart-bar {
    width: 100%;
    border-radius: 6px 6px 0 0;
    background: linear-gradient(180deg, var(--green), rgba(0,230,118,.3));
    min-height: 4px;
    transition: height .6s ease;
    position: relative;
  }
  .chart-bar:hover::after {
    content: attr(data-value);
    position: absolute;
    top: -28px; left: 50%; transform: translateX(-50%);
    background: var(--bg-panel);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 6px;
    white-space: nowrap;
    z-index: 10;
  }
  .chart-label { font-size: 10px; color: var(--muted); text-align: center; word-break: break-word; }
  .chart-total {
    font-size: 22px;
    font-weight: 700;
    color: var(--green);
    margin-bottom: 4px;
  }
  .chart-period { font-size: 11px; color: var(--muted); }

  /* ─── Activity Feed ─── */
  .activity-list { display: flex; flex-direction: column; gap: 0; }
  .activity-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .activity-item:last-child { border-bottom: none; }
  .activity-icon {
    width: 30px; height: 30px;
    border-radius: 8px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }
  .activity-body { flex: 1; min-width: 0; }
  .activity-desc { font-size: 13px; }
  .activity-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }

  /* ─── Module Detail Cards ─── */
  .module-card { }
  .module-stat {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255,255,255,.04);
  }
  .module-stat:last-child { border-bottom: none; }
  .module-stat-label { font-size: 12px; color: var(--muted); }
  .module-stat-value { font-size: 13px; font-weight: 600; font-family: 'SF Mono', monospace; }

  /* ─── Trigger Section ─── */
  .trigger-section { }
  .trigger-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .trigger-btn {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: all .15s;
    font-family: inherit;
    font-size: 13px;
  }
  .trigger-btn:hover {
    border-color: var(--accent);
    background: rgba(0,230,118,.06);
    box-shadow: 0 0 16px rgba(0,230,118,.08);
  }
  .trigger-btn:active { transform: scale(.98); }
  .trigger-btn:disabled { opacity: .5; cursor: not-allowed; }
  .trigger-btn .btn-label { font-weight: 600; display: block; margin-bottom: 4px; }
  .trigger-btn .btn-target { font-size: 10px; color: var(--muted); font-family: monospace; }
  .trigger-row { display: flex; gap: 8px; margin-top: 8px; }
  .trigger-row select, .trigger-row input {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 12px;
    font-family: inherit;
  }
  .trigger-row select { flex: 1; }
  .trigger-row input { flex: 1; }

  /* ─── Action Form ─── */
  .action-form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .action-form select, .action-form input, .action-form button {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    font-family: inherit;
  }
  .action-form button {
    background: linear-gradient(135deg, var(--green), var(--cyan));
    color: var(--bg);
    border: none;
    font-weight: 700;
    cursor: pointer;
    padding: 8px 20px;
  }
  .action-form button:hover { box-shadow: 0 0 16px rgba(0,230,118,.3); }

  /* ─── Toast / Log ─── */
  .log-area {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    font-family: 'SF Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    max-height: 140px;
    overflow-y: auto;
    margin-top: 10px;
  }
  .log-entry { padding: 2px 0; }
  .log-entry.ok    { color: var(--green); }
  .log-entry.error { color: var(--red); }
  .log-entry.info  { color: var(--cyan); }

  /* ─── Footer ─── */
  footer {
    text-align: center;
    padding: 24px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--muted);
  }
  footer span { color: var(--accent); font-weight: 600; }

  /* ─── Loading / Error States ─── */
  .skeleton {
    background: linear-gradient(90deg, var(--bg-panel) 25%, rgba(255,255,255,.04) 50%, var(--bg-panel) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 6px;
    height: 20px;
  }
  @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  .loading-text { color: var(--muted); font-size: 12px; text-align: center; padding: 20px; }
  .error-text { color: var(--red); font-size: 12px; text-align: center; padding: 20px; }

  /* ─── Responsive ─── */
  @media (max-width: 640px) {
    h1 { font-size: 16px; }
    .header-right { width: 100%; justify-content: space-between; }
    .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
    .chart-bar-group { min-width: 36px; }
    .trigger-grid { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 400px) {
    .trigger-grid { grid-template-columns: 1fr; }
  }

  /* ─── Utility ─── */
  .mt-2 { margin-top: 8px; }
  .mt-4 { margin-top: 16px; }
  .mb-2 { margin-bottom: 8px; }
  .text-muted { color: var(--muted); }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; }
</style>
</head>
<body>

<header>
  <div class="container header-inner">
    <div class="brand">
      <div class="logo">P3</div>
      <div>
        <h1>P31 Capital Machine</h1>
        <div class="subtitle">10-Module Autonomous Revenue System</div>
      </div>
    </div>
    <div class="header-right">
      <span class="refresh-badge" id="refreshBadge">Auto-refresh: 30s</span>
      <span class="live-time" id="liveTime">--</span>
    </div>
  </div>
</header>

<main class="container">

  <!-- ─── Health Status ─── -->
  <div class="section">
    <div class="section-title">Module Health</div>
    <div class="status-grid" id="statusGrid">
      <div class="loading-text">Loading health data…</div>
    </div>
  </div>

  <!-- ─── Revenue + Summary ─── -->
  <div class="grid grid-2 section">
    <div class="card">
      <div class="card-header">
        <span class="card-title">Revenue Breakdown</span>
        <span class="card-badge badge-healthy" id="revPeriod">30d</span>
      </div>
      <div id="revenueSection">
        <div class="loading-text">Loading…</div>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">System Summary</span>
        <span class="card-badge badge-healthy" id="summaryBadge">Live</span>
      </div>
      <div id="summarySection">
        <div class="loading-text">Loading…</div>
      </div>
    </div>
  </div>

  <!-- ─── Module Cards ─── -->
  <div class="section">
    <div class="section-title">Module Details</div>
    <div class="grid grid-3" id="moduleCards">
      <div class="loading-text">Loading…</div>
    </div>
  </div>

  <!-- ─── Activity Feed ─── -->
  <div class="section">
    <div class="section-title">Recent Activity</div>
    <div class="card">
      <div id="activitySection">
        <div class="loading-text">Loading…</div>
      </div>
    </div>
  </div>

  <!-- ─── Manual Triggers ─── -->
  <div class="section trigger-section">
    <div class="section-title">Manual Triggers</div>
    <div class="card">
      <div class="mb-2 text-muted" style="font-size:12px;">POST to orchestrator actions endpoint with params.</div>
      <div class="action-form">
        <select id="actionModule">
          <option value="yield-vault">yield-vault</option>
          <option value="mev-arbitrage">mev-arbitrage</option>
          <option value="fundraising-agent">fundraising-agent</option>
          <option value="auto-compounder">auto-compounder</option>
          <option value="cashback-collector">cashback-collector</option>
          <option value="ip-licensing">ip-licensing</option>
          <option value="micro-savings">micro-savings</option>
          <option value="affiliate-fleet">affiliate-fleet</option>
          <option value="airdrop-harvester">airdrop-harvester</option>
          <option value="data-monetization">data-monetization</option>
        </select>
        <select id="actionType">
          <option value="scrape">scrape</option>
          <option value="scan">scan</option>
          <option value="collect">collect</option>
          <option value="arbitrage">arbitrage</option>
          <option value="compound">compound</option>
          <option value="harvest">harvest</option>
          <option value="rebalance">rebalance</option>
        </select>
        <input id="actionParams" placeholder='params JSON (optional)' value="{}" />
        <button id="btnDispatch">Dispatch Action</button>
      </div>
      <div class="trigger-grid mt-4">
        <button class="trigger-btn" data-action="scrape" data-module="fundraising-agent">
          <span class="btn-label">🕷 Scrape Leads</span>
          <span class="btn-target">fundraising-agent /scrape</span>
        </button>
        <button class="trigger-btn" data-action="scan" data-module="mev-arbitrage">
          <span class="btn-label">⚡ Scan MEV</span>
          <span class="btn-target">mev-arbitrage /scan</span>
        </button>
        <button class="trigger-btn" data-action="collect" data-module="yield-vault">
          <span class="btn-label">📈 Collect Yield</span>
          <span class="btn-target">yield-vault /collect</span>
        </button>
        <button class="trigger-btn" data-action="arbitrage" data-module="mev-arbitrage">
          <span class="btn-label">🔄 Execute Arb</span>
          <span class="btn-target">mev-arbitrage /execute</span>
        </button>
        <button class="trigger-btn" data-action="compound" data-module="auto-compounder">
          <span class="btn-label">🔁 Compound</span>
          <span class="btn-target">auto-compounder /compound</span>
        </button>
        <button class="trigger-btn" data-action="collect" data-module="cashback-collector">
          <span class="btn-label">💸 Claim Cashback</span>
          <span class="btn-target">cashback-collector /collect</span>
        </button>
        <button class="trigger-btn" data-action="scan" data-module="ip-licensing">
          <span class="btn-label">📜 Scan Licenses</span>
          <span class="btn-target">ip-licensing /scan</span>
        </button>
        <button class="trigger-btn" data-action="collect" data-module="micro-savings">
          <span class="btn-label">🏦 Round Up</span>
          <span class="btn-target">micro-savings /roundup</span>
        </button>
        <button class="trigger-btn" data-action="scan" data-module="affiliate-fleet">
          <span class="btn-label">🔗 Sync Affiliates</span>
          <span class="btn-target">affiliate-fleet /sync</span>
        </button>
        <button class="trigger-btn" data-action="harvest" data-module="airdrop-harvester">
          <span class="btn-label">🎁 Harvest Airdrop</span>
          <span class="btn-target">airdrop-harvester /harvest</span>
        </button>
        <button class="trigger-btn" data-action="scan" data-module="data-monetization">
          <span class="btn-label">📊 Fetch Analytics</span>
          <span class="btn-target">data-monetization /fetch</span>
        </button>
        <button class="trigger-btn" data-action="rebalance" data-module="yield-vault">
          <span class="btn-label">⚖ Rebalance</span>
          <span class="btn-target">yield-vault /rebalance</span>
        </button>
      </div>
      <div class="log-area" id="logArea"><div class="log-entry info">Ready — click a trigger or dispatch an action.</div></div>
    </div>
  </div>

</main>

<footer>
  <span>P31 Capital Machine</span> | Automated on Cloudflare
</footer>

<script>
(function() {
  'use strict';

  const API = '${BACKEND}';
  let refreshTimer = null;

  // ─── Utilities ───
  function usd(n) {
    const v = parseFloat(n) || 0;
    if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
    if (v >= 1_000) return '$' + (v / 1_000).toFixed(1) + 'K';
    return '$' + v.toFixed(2);
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function statusColor(s) {
    if (s === 'healthy') return 'green';
    if (s === 'degraded') return 'yellow';
    return 'red';
  }

  function badgeClass(s) {
    if (s === 'healthy') return 'badge-healthy';
    if (s === 'degraded') return 'badge-degraded';
    return 'badge-unhealthy';
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function log(msg, type = 'info') {
    const area = document.getElementById('logArea');
    if (!area) return;
    const div = document.createElement('div');
    div.className = 'log-entry ' + type;
    div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
  }

  // ─── Fetch helpers ───
  async function fetchJSON(url) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + res.statusText);
    return res.json();
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + res.statusText);
    return res.json();
  }

  // ─── Render Status Badges ───
  function renderStatus(data) {
    const modules = [
      { key: 'database', label: 'Database', dataKey: 'database' },
      { key: 'yield-vault', label: 'Yield Vault', dataKey: 'yieldVault' },
      { key: 'mev-arbitrage', label: 'MEV Arb', dataKey: 'mevArbitrage' },
      { key: 'fundraising-agent', label: 'Fundraising', dataKey: 'fundraising' },
      { key: 'auto-compounder', label: 'Auto Compound', dataKey: 'autoCompounder' },
      { key: 'cashback-collector', label: 'Cashback', dataKey: 'cashback' },
      { key: 'ip-licensing', label: 'IP Licensing', dataKey: 'ipLicensing' },
      { key: 'micro-savings', label: 'Micro Savings', dataKey: 'microSavings' },
      { key: 'affiliate-fleet', label: 'Affiliate', dataKey: 'affiliate' },
      { key: 'airdrop-harvester', label: 'Airdrop', dataKey: 'airdrop' },
    ];

    const modData = data.modules || {};
    const healthData = data.healthModules || {};

    const items = modules.map(m => {
      const mod = healthData[m.key] || modData[m.dataKey] || {};
      const status = mod.status || 'healthy';
      const color = statusColor(status);
      return \`
        <div class="status-item">
          <div class="status-module">\${m.label}</div>
          <div class="status-value">
            <span class="dot dot-\${color}"></span>
            <span style="text-transform:capitalize;">\${status}</span>
          </div>
          \${mod.details ? \`<div style="font-size:10px;color:var(--muted);margin-top:2px;">\${mod.details}</div>\` : ''}
        </div>
      \`;
    }).join('');

    setHtml('statusGrid', items);
  }

  // ─── Render Revenue ───
  function renderRevenue(data) {
    const period = data.period || '30d';
    const breakdown = data.breakdown || {};
    const entries = [
      { key: 'mevArbitrage', label: 'MEV Arb' },
      { key: 'cashback',      label: 'Cashback' },
      { key: 'royalties',     label: 'Royalties' },
      { key: 'affiliate',     label: 'Affiliate' },
      { key: 'airdrops',      label: 'Airdrops' },
    ];

    const values = entries.map(e => ({ ...e, value: parseFloat(breakdown[e.key]) || 0 }));
    const max = Math.max(...values.map(v => v.value), 1);
    const total = data.total || values.reduce((s, v) => s + v.value, 0);

    const bars = values.map(v => \`
      <div class="chart-bar-group">
        <div class="chart-bar" data-value="\${usd(v.value)}" style="height:\${Math.max((v.value / max) * 100, 2)}%;"></div>
        <span class="chart-label">\${v.label}</span>
      </div>
    \`).join('');

    setHtml('revenueSection', \`
      <div class="chart-total">\${usd(total)}</div>
      <div class="chart-period">Total revenue (\${period})</div>
      <div class="chart-wrap mt-4">\${bars}</div>
    \`);
    setHtml('revPeriod', period);
  }

  // ─── Render Summary ───
  function renderSummary(data) {
    const s = data.summary || {};
    const rows = [
      ['Total Revenue', usd(s.totalRevenue)],
      ['Active Campaigns', s.activeCampaigns ?? '—'],
      ['Total Leads', s.totalLeads ?? '—'],
      ['Total Deposits', usd(s.totalDeposits)],
      ['Staking Positions', s.activeStakingPositions ?? '—'],
      ['Total Royalties', usd(s.totalRoyalties)],
      ['Total Commissions', usd(s.totalCommissions)],
      ['Pending Airdrops', s.pendingAirdrops ?? '—'],
    ];

    const html = rows.map(([label, value]) => \`
      <div class="module-stat">
        <span class="module-stat-label">\${label}</span>
        <span class="module-stat-value">\${value}</span>
      </div>
    \`).join('');

    setHtml('summarySection', html);
  }

  // ─── Render Module Cards ───
  function renderModules(data) {
    const mods = data.modules || {};
    const moduleDefs = [
      { key: 'yieldVault', label: 'Yield Vault', icon: '📈',
        stats: [
          ['Deposits', usd(mods.yieldVault?.totalDeposits)],
          ['Depositors', mods.yieldVault?.activeDepositors ?? '—'],
        ]},
      { key: 'mevArbitrage', label: 'MEV Arb', icon: '⚡',
        stats: [
          ['Profit', usd(mods.mevArbitrage?.totalProfit)],
          ['Success Rate', (mods.mevArbitrage?.successRate ?? 0) + '%'],
          ['Attempts', mods.mevArbitrage?.totalAttempts ?? '—'],
        ]},
      { key: 'fundraising', label: 'Fundraising', icon: '📧',
        stats: [
          ['Active Campaigns', mods.fundraising?.active ?? '—'],
          ['Total Leads', mods.fundraising?.totalLeads ?? '—'],
          ['Contacted', mods.fundraising?.contacted ?? '—'],
        ]},
      { key: 'autoCompounder', label: 'Auto Co mpounder', icon: '🔁',
        stats: [
          ['Positions', mods.autoCompounder?.activePositions ?? '—'],
          ['Total Staked', usd(mods.autoCompounder?.totalStaked)],
        ]},
      { key: 'cashback', label: 'Cashback', icon: '💸',
        stats: [
          ['Claimed', usd(mods.cashback?.totalClaimed)],
          ['Transactions', mods.cashback?.totalTransactions ?? '—'],
        ]},
      { key: 'ipLicensing', label: 'IP Licensing', icon: '📜',
        stats: [
          ['Royalties', usd(mods.ipLicensing?.totalCollected)],
        ]},
      { key: 'microSavings', label: 'Micro Savings', icon: '🏦',
        stats: [
          ['Accounts', mods.microSavings?.activeAccounts ?? '—'],
          ['Total Saved', usd(mods.microSavings?.totalSaved)],
        ]},
      { key: 'affiliate', label: 'Affiliate', icon: '🔗',
        stats: [
          ['Commissions', usd(mods.affiliate?.totalCommissions)],
          ['Clicks', mods.affiliate?.totalClicks ?? '—'],
        ]},
      { key: 'airdrop', label: 'Airdrop', icon: '🎁',
        stats: [
          ['Pending', mods.airdrop?.pending ?? '—'],
          ['Proceeds', usd(mods.airdrop?.totalProceeds)],
        ]},
    ];

    const cards = moduleDefs.map(m => {
      const statRows = (m.stats || []).map(([l, v]) => \`
        <div class="module-stat">
          <span class="module-stat-label">\${l}</span>
          <span class="module-stat-value">\${v}</span>
        </div>
      \`).join('');
      return \`
        <div class="card module-card">
          <div class="card-header">
            <span class="card-title">\${m.icon} \${m.label}</span>
          </div>
          \${statRows}
        </div>
      \`;
    }).join('');

    setHtml('moduleCards', cards);
  }

  // ─── Render Activity ───
  function renderActivity(activities) {
    if (!activities || activities.length === 0) {
      setHtml('activitySection', '<div class="loading-text">No recent activity.</div>');
      return;
    }
    const icons = { arbitrage: '⚡', campaign: '📧', compound: '🔁', cashback: '💸', royalty: '📜' };
    const items = activities.slice(0, 5).map(a => {
      const src = (a.source || '').toLowerCase();
      const icon = icons[src] || '📋';
      return \`
        <div class="activity-item">
          <div class="activity-icon">\${icon}</div>
          <div class="activity-body">
            <div class="activity-desc">\${a.description || a.source || 'Activity'}</div>
            <div class="activity-meta">\${fmtDate(a.timestamp || a.created_at)}</div>
          </div>
        </div>
      \`;
    }).join('');
    setHtml('activitySection', \`<div class="activity-list">\${items}</div>\`);
  }

  // ─── Load all data ───
  async function loadAll() {
    const grid = document.getElementById('statusGrid');
    const rev = document.getElementById('revenueSection');
    const sum = document.getElementById('summarySection');
    const mods = document.getElementById('moduleCards');
    const act = document.getElementById('activitySection');

    try {
      const [healthRes, dashRes, revRes, actRes] = await Promise.allSettled([
        fetchJSON(API + '/health/deep'),
        fetchJSON(API + '/dashboard'),
        fetchJSON(API + '/dashboard/revenue?period=30d'),
        fetchJSON(API + '/dashboard/activity'),
      ]);

      // Health
      if (healthRes.status === 'fulfilled') {
        const h = healthRes.value;
        const modulesObj = h.modules || {};
        const statusEntries = Object.entries(modulesObj).map(([key, val]: [string, any]) => ({
          key, status: val.status || 'healthy', details: val.details || '', latencyMs: val.latencyMs || 0,
        }));
        renderStatus({ healthModules: modulesObj, modules: dashRes.status === 'fulfilled' ? (dashRes.value.modules || {}) : {} });
      } else {
        setHtml('statusGrid', '<div class="error-text">Failed to load health data. Retrying…</div>');
      }

      // Dashboard
      if (dashRes.status === 'fulfilled') {
        renderSummary(dashRes.value);
        renderModules(dashRes.value);
      } else {
        setHtml('summarySection', '<div class="error-text">Failed to load dashboard.</div>');
        setHtml('moduleCards', '<div class="error-text">Failed to load modules.</div>');
      }

      // Revenue
      if (revRes.status === 'fulfilled') {
        renderRevenue(revRes.value);
      } else {
        setHtml('revenueSection', '<div class="error-text">Failed to load revenue.</div>');
      }

      // Activity
      if (actRes.status === 'fulfilled') {
        renderActivity(actRes.value);
      } else {
        setHtml('activitySection', '<div class="error-text">Failed to load activity.</div>');
      }

      log('Dashboard refreshed', 'ok');
    } catch (err: any) {
      log('Error: ' + err.message, 'error');
    }
  }

  // ─── Dispatch action ───
  async function dispatchAction(action, module, params) {
    log('Dispatching ' + action + ' → ' + module + '…', 'info');
    try {
      const res = await postJSON(API + '/actions', { action, module, params });
      log('Dispatched: ' + res.action?.id?.slice(0, 8) + '… status=' + (res.action?.status || 'pending'), 'ok');
    } catch (err: any) {
      log('Failed: ' + err.message, 'error');
    }
  }

  // ─── Trigger button clicks ───
  document.querySelectorAll('.trigger-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const module = btn.dataset.module;
      if (!action || !module) return;
      dispatchAction(action, module, {});
    });
  });

  // ─── Dispatch form ───
  document.getElementById('btnDispatch').addEventListener('click', async () => {
    const module = document.getElementById('actionModule').value;
    const action = document.getElementById('actionType').value;
    const raw = document.getElementById('actionParams').value;
    let params = {};
    try { params = raw ? JSON.parse(raw) : {}; } catch { params = {}; }
    await dispatchAction(action, module, params);
  });

  // ─── Live clock ───
  function tick() {
    document.getElementById('liveTime').textContent = new Date().toLocaleString();
  }
  tick();
  setInterval(tick, 1000);

  // ─── Auto-refresh ───
  function scheduleRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadAll, REFRESH_MS);
  }

  document.getElementById('refreshBadge').textContent = 'Auto-refresh: 30s';
  loadAll();
  scheduleRefresh();

})();
</script>
</body>
</html>`;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...corsHeaders,
        },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};
