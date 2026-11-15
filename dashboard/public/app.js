// Bancada de viralização: SPA sem dependências.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SVG = 'http://www.w3.org/2000/svg';

function h(tag, attrs = {}, ...kids) {
  const isSvg = ['svg', 'g', 'rect', 'text', 'path', 'line', 'circle', 'defs', 'marker', 'title', 'tspan'].includes(tag);
  const el = isSvg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } },
};

// ---------------------------------------------------------------- formatação (pt-BR)
const nf = (d) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtInt = (v) => (v == null ? '–' : nf(0).format(v));
const fmtNum = (v, d = 1) => (v == null ? '–' : nf(d).format(v));
const fmtPct = (v) => (v == null ? '–' : `${nf(v > 0 && v < 0.01 ? 2 : 1).format(v * 100)}%`);
function fmtMs(ms) {
  if (ms == null) return '–';
  if (ms < 1000) return `${nf(ms < 10 ? 1 : 0).format(ms)} ms`;
  return `${nf(ms < 10000 ? 2 : 1).format(ms / 1000)} s`;
}
function fmtDur(s) {
  if (s == null) return '–';
  s = Math.round(s);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
const fmtDate = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDateShort = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const ARCH = { sync: 'Síncrona', async: 'Assíncrona' };
const ROUTES = [
  ['feed', 'Feed'],
  ['propagation_tree', 'Árvore de propagação'],
  ['posts_create', 'Post comum'],
  ['share', 'Share comum'],
  ['celebrity_post', 'Post de celebridade'],
  ['celebrity_share', 'Share de celebridade'],
];

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

// ---------------------------------------------------------------- abas
const TABS = ['arquiteturas', 'execucao', 'comparacao'];
function showTab() {
  const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'arquiteturas';
  for (const t of TABS) {
    $(`#tab-${t}`).hidden = t !== tab;
    $(`.tabs a[data-tab="${t}"]`).setAttribute('aria-selected', String(t === tab));
  }
  if (tab === 'comparacao') renderCompare();
}
window.addEventListener('hashchange', showTab);

// ================================================================ ARQUITETURAS

async function renderOverview() {
  let ds = null;
  try { ds = await api('/api/dataset'); } catch { /* dataset ainda não gerado */ }
  const celebs = ds?.distribution?.celebrity_followers ?? [5000, 3500, 3000, 2750, 2600, 2500, 2428, 2375, 2333, 2300, 2272, 2250, 2230, 2214, 2200, 2187, 2176, 2166, 2157, 2150];
  const common = ds?.distribution?.common_followers ?? { min: 1, max: 30, mean: 7.553, median: 4 };
  const c = ds?.counts;
  const follows = c?.relacoes_seguir;
  const celebSum = celebs.reduce((a, b) => a + b, 0);
  if (follows) $('#hero-title').textContent = `20 celebridades concentram ${fmtNum((celebSum / follows) * 100, 0)}% das relações de seguir.`;
  $('#ds-median').textContent = fmtNum(common.median, 0);
  const facts = c
    ? [['usuários', c.usuarios], ['relações de seguir', c.relacoes_seguir], ['posts', c.posts_criados], ['compartilhamentos', c.compartilhamentos], ['entradas de feed', c.entradas_feed], ['posts virais', ds.distribution.viral_posts]]
    : [];
  $('#ds-facts').replaceChildren(...facts.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: fmtInt(v) }))));
  if (!c) $('#ds-facts').append(h('div', {}, h('dt', { text: 'Rode scripts/viral.sh dataset para ver as contagens do snapshot.' })));
  drawZipf(celebs, common);
  drawDiagrams();
  drawBudgets();
  drawMix();
}

function drawZipf(celebs, common) {
  const svg = $('#zipf-chart');
  const W = 620, H = 300, L = 44, B = 28, T = 16;
  const tailW = 120, barsW = W - L - tailW - 24;
  const max = 5000;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  for (const t of [0, 2500, 5000]) {
    svg.append(h('line', { class: 'axis', x1: L, x2: W, y1: y(t), y2: y(t) }));
    svg.append(h('text', { x: L - 8, y: y(t) + 4, 'text-anchor': 'end', text: fmtInt(t) }));
  }
  const bw = barsW / celebs.length;
  celebs.forEach((v, i) => {
    const x = L + i * bw + 2;
    svg.append(h('rect', { class: 'bar-celeb', x, y: y(v), width: bw - 4, height: y(0) - y(v), rx: 1.5 }, h('title', { text: `Celebridade rank ${i + 1}: ${fmtInt(v)} seguidores` })));
    if (i === 0 || i === celebs.length - 1) svg.append(h('text', { class: 'val', x: x + (bw - 4) / 2, y: y(v) - 6, 'text-anchor': 'middle', text: fmtInt(v) }));
  });
  svg.append(h('text', { x: L + 2, y: H - 8, text: 'rank 1' }));
  svg.append(h('text', { x: L + barsW - 2, y: H - 8, 'text-anchor': 'end', text: 'rank 20' }));
  // Cauda: 10.000 comuns. Na mesma escala, o máximo (30) mal aparece.
  const tx = L + barsW + 24;
  const hMax = Math.max(1.5, y(0) - y(common.max));
  svg.append(h('rect', { class: 'bar-common', x: tx, y: y(0) - hMax, width: tailW, height: hMax }, h('title', { text: `10.000 usuários comuns: ${common.min} a ${common.max} seguidores` })));
  svg.append(h('text', { class: 'tail', x: tx, y: y(0) - 44, text: '10.000 comuns' }));
  svg.append(h('text', { x: tx, y: y(0) - 28, text: `mediana ${fmtNum(common.median, 0)}, máximo ${common.max}` }));
  svg.append(h('text', { x: tx, y: y(0) - 12, text: 'seguidores cada' }));
}

function node(x, y, w, title, sub, res, key) {
  return h('g', { class: `node${key ? ' key' : ''}` },
    h('rect', { x, y, width: w, height: 72, rx: 6 }),
    h('text', { class: 'n-title', x: x + 12, y: y + 24, text: title }),
    sub ? h('text', { class: 'n-sub', x: x + 12, y: y + 42, text: sub }) : null,
    res ? h('text', { class: 'n-res', x: x + 12, y: y + 60, text: res }) : null);
}
const edge = (d, cls = '') => h('path', { class: `edge ${cls}`, d, 'marker-end': 'url(#arrow)' });
const label = (x, y, text, cls = '', anchor = 'middle') => h('text', { class: `e-label ${cls}`, x, y, 'text-anchor': anchor, text });
const markerDefs = () => h('defs', {}, h('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, h('path', { d: 'M0 0 10 5 0 10z' })));

function drawDiagrams() {
  const s = $('#diagram-sync');
  s.replaceChildren(markerDefs(),
    node(10, 40, 120, 'k6', 'VUs com espera', '50 a 600 VUs'),
    node(180, 40, 130, 'nginx', 'balanceia 2 APIs', '0,1 CPU, 64 MB'),
    node(360, 40, 200, 'Laravel ×2', 'PHP-FPM, um processo', '0,2 CPU, 320 MB cada', true),
    node(640, 40, 310, 'MySQL', 'share + fan-out em feed_items', '1,0 CPU, 2,3 GB (InnoDB)', true),
    edge('M130 76H178'), edge('M310 76H358'), edge('M560 76H638'),
    label(600, 64, 'transação'),
    edge('M795 112V160H70V114', 'ret'),
    label(432, 152, '201 só depois do COMMIT: post/share e todas as entradas de feed já gravadas', 'strong'),
    label(432, 180, 'Celebridade com 2.000 a 5.000 seguidores = INSERT IGNORE em lotes de 500 dentro da mesma requisição'),
  );
  const a = $('#diagram-async');
  a.replaceChildren(markerDefs(),
    node(10, 56, 120, 'k6', 'VUs com espera', '50 a 600 VUs'),
    node(180, 56, 130, 'nginx', 'balanceia 2 APIs', '0,1 CPU, 64 MB'),
    node(360, 56, 200, 'Hyperf ×2', 'Swoole, corrotinas', '0,2 CPU, 320 MB cada', true),
    node(640, 56, 310, 'RabbitMQ', 'filas posts, shares, distribution', '0,2 CPU, 512 MB', true),
    node(640, 180, 310, 'Worker Hyperf', 'corrotinas, prefetch 50, lotes', '0,3 CPU, 384 MB', true),
    node(360, 180, 200, 'Neo4j', 'UNWIND do lote numa transação', '0,5 CPU, 1,4 GB', true),
    edge('M130 92H178'), edge('M310 92H358'), edge('M560 92H638'),
    label(600, 80, 'publica'),
    edge('M795 128V178'), label(805, 158, 'consome', '', 'start'),
    edge('M640 216H562'), label(600, 206, 'grava'),
    edge('M460 128V178', 'read'), label(452, 158, 'leituras: feed e árvore', '', 'end'),
    edge('M795 56V24H70V54', 'ret'),
    label(432, 18, '202 assim que o broker confirma o evento: persistência e fan-out ainda não ocorreram', 'strong'),
    label(10, 284, 'POST /posts passa pela outbox (Task) e gera a fila distribution. Shares repetidos ainda na fila recebem 202 e o worker descarta.', '', 'start'),
  );
}

function drawBudgets() {
  const parts = {
    sync: [['nginx', 0.1, 64], ['API ×2', 0.4, 640], ['MySQL', 1.0, 2296, true]],
    async: [['nginx', 0.1, 64], ['API ×2', 0.4, 640], ['worker', 0.3, 384], ['RabbitMQ', 0.2, 512], ['Neo4j', 0.5, 1400, true]],
  };
  for (const [arch, list] of Object.entries(parts)) {
    const row = (name, idx, total, unit, fmt) => h('div', { class: 'budget-row' },
      h('span', { text: name }),
      h('div', { class: 'budget-bar', role: 'img', 'aria-label': `${name}: ${list.map((p) => `${p[0]} ${fmt(p[idx])}`).join(', ')}` },
        list.map((p) => h('span', { class: p[3] ? 'store' : '', style: `flex:${p[idx]} 1 0`, title: `${p[0]}: ${fmt(p[idx])}`, text: p[idx] / total < 0.06 ? '' : `${p[0]} ${fmt(p[idx])}` }))),
      h('span', { text: `${fmt(total)} ${unit}`.trim() }));
    $(`#budget-${arch}`).replaceChildren(
      row('CPU', 1, 1.5, 'CPU', (v) => fmtNum(v, 1)),
      row('Memória', 2, 3000, '', (v) => (v >= 1000 ? `${fmtNum(v / 1000, 1)} GB` : `${v} MB`)),
    );
  }
}

function drawMix() {
  const parts = [
    ['read', 35, 'Feed', 'GET /feed/:id'],
    ['read', 35, 'Árvore', 'GET /posts/:id/propagation-tree'],
    ['write', 12.5, 'Post', 'POST /posts de comum'],
    ['write', 12.5, 'Share', 'POST /posts/:id/share de comum'],
    ['celeb', 5, '', 'post (2,5%) e share (2,5%) de celebridade'],
  ];
  $('#mix-mixed').replaceChildren(...parts.map(([cls, pct, name, desc]) =>
    h('div', { class: cls, style: `flex:${pct} 1 0`, title: `${fmtNum(pct, pct % 1 ? 1 : 0)}%: ${desc}` },
      h('strong', { text: `${fmtNum(pct, pct % 1 ? 1 : 0)}%` }), name ? h('span', { text: name }) : null)));
}

// ================================================================ EXECUÇÃO

const form = $('#run-form');
let run = { status: 'idle' };
let phaseAt = {};
let tick = null;

function formParams() {
  const f = new FormData(form);
  return { arch: f.get('arch'), mode: f.get('mode'), scenario: f.get('scenario'), vus: Number(f.get('vus') || 600), restore: f.get('restore') === 'on' };
}

function commandsFor(p) {
  if (p.mode === 'tcc') return [`make viral-tcc VIRAL_ARCH=${p.arch} SCENARIO=${p.scenario} VUS_MAX=${p.vus}`];
  return [...(p.restore ? [`make viral-restore VIRAL_ARCH=${p.arch}`] : []), `make viral-load VIRAL_ARCH=${p.arch} MODE=smoke SCENARIO=${p.scenario}`];
}

function syncForm() {
  const p = formParams();
  for (const el of $$('[data-only]', form)) el.hidden = el.dataset.only !== p.mode;
  $('#cmd-preview').textContent = commandsFor(p).join('\n');
  store.set('form', p);
}

function restoreForm() {
  const p = store.get('form', null);
  if (!p) return;
  for (const [k, v] of Object.entries(p)) {
    const inputs = $$(`[name="${k}"]`, form);
    for (const i of inputs) {
      if (i.type === 'radio') i.checked = i.value === String(v);
      else if (i.type === 'checkbox') i.checked = Boolean(v);
      else i.value = v;
    }
  }
}

form.addEventListener('change', syncForm);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#form-error');
  err.hidden = true;
  $('#btn-run').disabled = true;
  try {
    clearConsole();
    const snap = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formParams()) });
    applyRun(snap);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    $('#btn-run').disabled = false;
  }
});

let abortArmed = null;
$('#btn-abort').addEventListener('click', async () => {
  const btn = $('#btn-abort');
  if (!abortArmed) {
    btn.textContent = 'Confirmar: abortar agora';
    abortArmed = setTimeout(() => { abortArmed = null; btn.textContent = 'Abortar experimento'; }, 4000);
    return;
  }
  clearTimeout(abortArmed); abortArmed = null;
  btn.disabled = true; btn.textContent = 'Abortando…';
  try { await api('/api/abort', { method: 'POST' }); } catch (ex) { $('#form-error').textContent = ex.message; $('#form-error').hidden = false; }
});

const PHASES = ['restore', 'warmup', 'load', 'drain', 'done'];
const STATUS_TEXT = { running: 'Rodando', success: 'Concluído', thresholds_failed: 'Concluído com thresholds do k6 reprovados', failed: 'Falhou', aborted: 'Abortado', idle: 'Ocioso' };

function applyRun(snap) {
  run = snap;
  phaseAt = snap.phaseAt ?? {};
  renderRun();
}

function renderRun() {
  const active = run.status === 'running';
  $('#btn-run').disabled = active;
  $('#btn-abort').hidden = !active;
  if (!active) { $('#btn-abort').disabled = false; $('#btn-abort').textContent = 'Abortar experimento'; }
  for (const el of $$('input, select', form)) el.disabled = active;

  // Pílula do cabeçalho
  const pill = $('#run-pill');
  pill.dataset.state = run.status;
  const p = run.params;
  const phaseName = { queued: 'iniciando', restore: 'restaurando snapshot', warmup: 'aquecimento', load: 'carga k6', drain: 'drenando filas', done: 'contagens gravadas' }[run.phase] ?? '';
  $('#run-pill-text').textContent = run.status === 'idle' ? 'Nenhum experimento rodando'
    : active ? `${ARCH[p.arch]} ${p.mode} ${p.scenario}: ${phaseName}` : `Último: ${STATUS_TEXT[run.status]?.toLowerCase()}`;

  // Fases
  const ol = $('#phases');
  ol.dataset.status = run.status;
  const idx = PHASES.indexOf(run.phase);
  const skipRestore = p && p.mode === 'smoke' && !p.restore;
  for (const li of $$('li', ol)) {
    const ph = li.dataset.phase, i = PHASES.indexOf(ph);
    li.className = '';
    if (run.status === 'idle') continue;
    if (ph === 'restore' && skipRestore) { li.classList.add('skipped'); continue; }
    if (i < idx || (run.status === 'success' && i <= idx)) li.classList.add('past');
    if (i === idx && !(run.status === 'success' && ph === 'done')) li.classList.add('active');
    if (run.status === 'success' && ph === 'done') li.classList.add('past');
  }
  renderPhaseTimes();

  // Metadados
  const meta = $('#run-meta');
  meta.replaceChildren();
  if (run.status !== 'idle') {
    meta.append(h('span', {}, h('strong', { text: STATUS_TEXT[run.status] ?? run.status }), run.code != null && run.status !== 'success' ? ` (código ${run.code})` : ''));
    meta.append(h('span', { text: `${ARCH[p.arch]}, ${p.mode}, ${p.scenario}${p.mode === 'tcc' ? `, ${p.vus} VUs` : ''}` }));
    meta.append(h('span', { id: 'elapsed' }));
    if (run.resultDir) {
      meta.append(h('span', { class: 'mono', text: run.resultDir }));
      if (!active) meta.append(h('a', { href: '#comparacao', onclick: () => { selection = [...new Set([run.resultDir, ...selection])]; saveSelection(); }, text: 'Abrir no comparador' }));
    }
    if (run.status === 'thresholds_failed') meta.append(h('span', { class: 'bad', text: 'O k6 reprovou um threshold (no smoke: 20% ou mais de falhas). contagens.json foi gravado.' }));
  }
  clearInterval(tick);
  if (active) tick = setInterval(renderPhaseTimes, 1000);
}

function renderPhaseTimes() {
  const now = run.endedAt ?? Date.now();
  for (const li of $$('#phases li')) {
    const ph = li.dataset.phase, start = phaseAt[ph];
    let txt = '';
    if (start && ph !== 'done') {
      const next = PHASES.slice(PHASES.indexOf(ph) + 1).map((x) => phaseAt[x]).find(Boolean);
      txt = fmtDur(((next ?? now) - start) / 1000);
    } else if (start) txt = new Date(start).toLocaleTimeString('pt-BR');
    $('.ph-time', li).textContent = txt;
  }
  const el = $('#elapsed');
  if (el && run.startedAt) el.textContent = `duração ${fmtDur((now - run.startedAt) / 1000)}`;
}

// Console
const consoleEl = $('#console');
const MAX_DOM_LINES = 4000;
const PROGRESS = /^(running \(|\s*(traffic|queue|default|warmup)\s+(\[|[✓✗↓]))|^\s*\S+\s+\[\s*\d+%\s*\]/;
let hideProgress = $('#opt-progress').checked;
let follow = $('#opt-follow').checked;
let lastProgress = null;

function clearConsole() { consoleEl.replaceChildren(); lastProgress = null; }

function lineClass(e) {
  if (e.s === 'cmd') return 'l-cmd';
  if (/\b(erro|error|ERRO|failed|panic|Traceback)\b|✗/.test(e.l)) return 'l-bad';
  if (e.l.startsWith('[viral]')) return 'l-viral';
  if (PROGRESS.test(e.l)) return 'l-prog';
  return e.s === 'err' ? 'l-err' : '';
}

function appendLine(e) {
  if (consoleEl.firstChild?.classList?.contains('muted')) consoleEl.replaceChildren();
  const isProg = PROGRESS.test(e.l);
  const text = `${e.l}\n`;
  if (isProg && hideProgress) {
    // Mantém só a última linha de progresso, atualizada no lugar.
    if (lastProgress && lastProgress === consoleEl.lastChild) { lastProgress.textContent = text; scrollConsole(); return; }
    lastProgress = h('span', { class: 'l-prog', text });
    consoleEl.append(lastProgress);
  } else {
    consoleEl.append(h('span', { class: lineClass(e), text }));
  }
  while (consoleEl.childNodes.length > MAX_DOM_LINES) consoleEl.firstChild.remove();
  scrollConsole();
}
function scrollConsole() { if (follow) consoleEl.scrollTop = consoleEl.scrollHeight; }

$('#opt-progress').addEventListener('change', (e) => { hideProgress = e.target.checked; reloadStatus(); });
$('#opt-follow').addEventListener('change', (e) => { follow = e.target.checked; scrollConsole(); });

async function reloadStatus() {
  try {
    const s = await api('/api/status');
    clearConsole();
    if (!s.lines.length) consoleEl.append(h('span', { class: 'muted', text: 'Os logs aparecem aqui quando um experimento começa.' }));
    for (const l of s.lines) appendLine(l);
    applyRun(s);
  } catch { /* servidor fora do ar: o EventSource reconecta */ }
}

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('hello', () => reloadStatus());
  es.addEventListener('start', (e) => { clearConsole(); applyRun(JSON.parse(e.data)); });
  es.addEventListener('log', (e) => appendLine(JSON.parse(e.data)));
  es.addEventListener('phase', (e) => { const d = JSON.parse(e.data); run.phase = d.phase; phaseAt[d.phase] = d.at; renderRun(); });
  es.addEventListener('meta', (e) => { Object.assign(run, JSON.parse(e.data)); renderRun(); });
  es.addEventListener('end', async (e) => { applyRun(JSON.parse(e.data)); await loadRuns(); });
  es.onerror = () => { $('#run-pill-text').textContent = 'Sem conexão com o servidor do painel'; };
}

// ================================================================ COMPARAÇÃO

let runs = [];
let selection = store.get('selection', null);
let runsLoaded = false;
const filters = store.get('filters', { arch: '', mode: '', scenario: '', vus: '' });
const saveSelection = () => store.set('selection', selection);

async function loadRuns() {
  try { runs = await api('/api/runs'); } catch { runs = []; }
  runsLoaded = true;
  if (selection == null) {
    // Padrão: última sync e última async no estresse viral do cenário mixed.
    const pick = (a) => runs.find((r) => r.arch === a && r.mode === 'tcc' && r.scenario === 'mixed' && r.vus_max === 600 && r.counts);
    selection = [pick('sync'), pick('async')].filter(Boolean).map((r) => r.id);
  }
  selection = selection.filter((id) => runs.some((r) => r.id === id));
  const vusSel = $('[data-filter="vus"]');
  const levels = [...new Set(runs.map((r) => r.vus_max).filter(Boolean))].sort((a, b) => a - b);
  vusSel.replaceChildren(h('option', { value: '', text: 'Todos os degraus' }), ...levels.map((v) => h('option', { value: v, text: `${v} VUs` })));
  for (const sel of $$('[data-filter]')) sel.value = filters[sel.dataset.filter] ?? '';
  if (!$('#tab-comparacao').hidden) renderCompare();
}

for (const sel of $$('[data-filter]')) sel.addEventListener('change', () => { filters[sel.dataset.filter] = sel.value; store.set('filters', filters); renderRunsTable(); });
$('#btn-reload').addEventListener('click', loadRuns);

const runLabel = (r) => `${ARCH[r.arch]} ${r.scenario ?? 's/ cenário'} ${r.mode}${r.vus_max && r.mode === 'tcc' ? ` ${r.vus_max} VUs` : ''}`;
const runLabelFull = (r) => `${runLabel(r)} (${fmtDateShort(r.started_at)})`;
// Rótulo curto para cartões, gráficos e auditoria: arquitetura + só o que difere entre as selecionadas.
function shortLabel(r, sel = selectedRuns()) {
  const vary = (f) => new Set(sel.map(f)).size > 1;
  const parts = [ARCH[r.arch]];
  if (vary((x) => x.scenario)) parts.push(r.scenario ?? 's/ cenário');
  if (vary((x) => x.mode)) parts.push(r.mode);
  if (vary((x) => x.vus_max)) parts.push(r.vus_max ? `${r.vus_max} VUs` : '50 VUs');
  const label = parts.join(' ');
  return sel.filter((x) => shortBase(x, sel) === shortBase(r, sel)).length > 1 ? `${label} (${fmtDateShort(r.started_at)})` : label;
}
function shortBase(r, sel) {
  const vary = (f) => new Set(sel.map(f)).size > 1;
  return [r.arch, vary((x) => x.scenario) && r.scenario, vary((x) => x.mode) && r.mode, vary((x) => x.vus_max) && r.vus_max].join('|');
}
// Contexto comum às selecionadas (mostrado uma vez acima dos cartões).
function commonContext(sel) {
  const same = (f) => new Set(sel.map(f)).size === 1;
  const r = sel[0], parts = [];
  if (same((x) => x.scenario)) parts.push(`cenário ${r.scenario ?? '–'}`);
  if (same((x) => x.mode)) parts.push(`modo ${r.mode}`);
  if (same((x) => x.vus_max) && r.vus_max) parts.push(`${r.vus_max} VUs`);
  return parts.length ? `Todas com ${parts.join(', ')}.` : '';
}

function colorsFor(list) {
  const n = { sync: 0, async: 0 };
  const m = new Map();
  for (const r of list) {
    const i = n[r.arch]++ % 3;
    m.set(r.id, `var(--${r.arch}${i ? `-${i + 1}` : ''})`);
  }
  return m;
}

function renderRunsTable() {
  const tb = $('#runs-table tbody');
  const list = runs.filter((r) => (!filters.arch || r.arch === filters.arch) && (!filters.mode || r.mode === filters.mode)
    && (!filters.scenario || r.scenario === filters.scenario) && (!filters.vus || String(r.vus_max) === String(filters.vus)));
  tb.replaceChildren();
  if (!list.length) {
    tb.append(h('tr', {}, h('td', { colspan: 10, class: 'empty', text: runs.length ? 'Nenhuma execução com esses filtros.' : 'Nenhuma execução em code/k6/results. Rode um experimento na aba Execução.' })));
  }
  const colors = colorsFor(selectedRuns());
  for (const r of list) {
    const on = selection.includes(r.id);
    const m = r.metrics, d = r.counts?.drenagem;
    const toggle = () => { selection = on ? selection.filter((x) => x !== r.id) : [...selection, r.id]; saveSelection(); renderCompare(); };
    tb.append(h('tr', { class: on ? 'sel' : '', onclick: (e) => { if (e.target.tagName !== 'INPUT') toggle(); } },
      h('td', {}, h('input', { type: 'checkbox', checked: on, 'aria-label': `Selecionar ${runLabelFull(r)}`, onchange: toggle })),
      h('td', {}, h('span', { class: 'tag' }, h('i', { class: 'swatch', style: `background:${on ? colors.get(r.id) : `var(--${r.arch})`}` }), ARCH[r.arch])),
      h('td', { text: r.mode }), h('td', { text: r.scenario ?? '–' }), h('td', { class: 'num', text: r.vus_max ?? (r.mode === 'smoke' ? 50 : '–') }),
      h('td', { text: fmtDate(r.started_at) }),
      h('td', { class: 'num', text: fmtNum(m?.rps, 1) }),
      h('td', { class: `num ${m?.fail_rate > 0.01 ? 'bad-txt' : ''}`, text: fmtPct(m?.fail_rate) }),
      h('td', { class: 'num', text: fmtMs(m?.latency?.p95) }),
      h('td', { class: 'num', text: !d ? '–' : d.completa ? fmtDur(d.segundos) : `incompleta (${fmtDur(d.timeout_s)})` })));
  }
  $('#runs-hint').textContent = `${list.length} de ${runs.length} execuções (warmup omitido). ${selection.length} selecionada(s). Clique numa linha para incluir ou remover da comparação.`;
}

const selectedRuns = () => (selection ?? []).map((id) => runs.find((r) => r.id === id)).filter(Boolean);

// Definições compartilhadas por cartões e exportação.
const drainVal = (r) => (r.counts?.drenagem?.completa ? r.counts.drenagem.segundos : null);
const CARDS = [
  { title: 'Vazão', unit: 'req/s no cenário de tráfego', get: (r) => r.metrics?.rps, fmt: (v) => fmtNum(v, 1), csv: (v) => fmtNum(v, 2) },
  { title: 'Taxa de falha HTTP', unit: 'timeouts do k6, 5xx e 4xx inesperados', get: (r) => r.metrics?.fail_rate, fmt: fmtPct, bad: true },
  { title: 'Latência p50', unit: 'todas as rotas', get: (r) => r.metrics?.latency?.p50, fmt: fmtMs },
  { title: 'Latência p95', unit: 'todas as rotas', get: (r) => r.metrics?.latency?.p95, fmt: fmtMs },
  { title: 'Latência p99', unit: 'todas as rotas', get: (r) => r.metrics?.latency?.p99, fmt: fmtMs },
  {
    title: 'Tempo de drenagem', unit: 'do fim da carga até filas e contagens estáveis', get: drainVal, fmt: fmtDur,
    note: (r) => (!r.counts ? 'sem contagens.json' : r.counts.drenagem?.completa ? null : `incompleta após ${fmtDur(r.counts.drenagem?.timeout_s)}`),
  },
  {
    title: 'Pico de mensagens no RabbitMQ', unit: 'maior fila, amostrada a cada 1 s', get: (r) => r.metrics?.queue_peak, fmt: fmtInt,
    note: (r) => (r.arch === 'sync' ? 'sem fila' : null),
    detail: (r) => (r.metrics?.queues && Object.keys(r.metrics.queues).length ? Object.entries(r.metrics.queues).map(([q, v]) => `${q} ${fmtInt(v.max)}`).join(', ') : null),
  },
];

function renderCompare() {
  if (!runsLoaded) return;
  renderRunsTable();
  const sel = selectedRuns();
  const body = $('#cmp-body');
  if (!sel.length) {
    body.hidden = true;
    return;
  }
  body.hidden = false;
  const colors = colorsFor(sel);
  $('#legend').replaceChildren(...sel.map((r) => h('span', { title: r.id }, h('i', { style: `background:${colors.get(r.id)}` }), runLabelFull(r))));
  $('#cmp-context').textContent = commonContext(sel);
  renderCards(sel, colors);
  renderRouteChart('#chart-latency', sel, colors, (r, k) => r.metrics?.routes?.[k]?.[latMetric()], fmtMs, 'ms');
  renderRouteChart('#chart-fail', sel, colors, (r, k) => r.metrics?.routes?.[k]?.fail_rate, fmtPct, 'rate');
  renderAudit(sel, colors);
}

function renderCards(sel, colors) {
  $('#cards').replaceChildren(...CARDS.map((c) => {
    const vals = sel.map((r) => c.get(r)).filter((v) => v != null);
    const max = Math.max(...vals, 0);
    return h('div', { class: 'card' },
      h('h4', { text: c.title }), h('span', { class: 'unit', text: c.unit }),
      h('div', { class: 'rows' }, sel.map((r) => {
        const v = c.get(r), note = c.note?.(r), detail = c.detail?.(r);
        return h('div', { class: 'row' },
          h('small', { title: runLabelFull(r), text: shortLabel(r, sel) }),
          v == null ? h('span', { class: 'na', text: note ?? '–' }) : h('b', { class: c.bad && v > 0.01 ? 'bad-txt' : '', text: c.fmt(v) }),
          h('span', { class: 'bar' }, h('i', { style: `width:${v == null || !max ? 0 : Math.max(1.5, (v / max) * 100)}%;background:${colors.get(r.id)}` })),
          detail ? h('small', { style: 'grid-column:1/-1', text: detail }) : null);
      })));
  }));
}

const latMetric = () => $('input[name="latm"]:checked').value;
$('#lat-metric').addEventListener('change', () => { const sel = selectedRuns(); renderRouteChart('#chart-latency', sel, colorsFor(sel), (r, k) => r.metrics?.routes?.[k]?.[latMetric()], fmtMs, 'ms'); });

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function renderRouteChart(target, sel, colors, get, fmt, kind) {
  const W = 960, L = 190, R = 70, barH = 14, gap = 3, groupGap = 18, top = 22;
  const groupH = sel.length * (barH + gap) - gap;
  const H = top + ROUTES.length * (groupH + groupGap);
  const vals = ROUTES.flatMap(([k]) => sel.map((r) => get(r, k))).filter((v) => v != null);
  let max = niceMax(Math.max(...vals, kind === 'rate' ? 0.05 : 1));
  if (kind === 'rate') max = Math.min(1, max);
  const x = (v) => L + (W - L - R) * (v / max);
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': target === '#chart-fail' ? 'Taxa de falha por rota' : 'Latência por rota' });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(h('line', { class: 'grid', x1: x(v), x2: x(v), y1: top - 6, y2: H - groupGap + 4 }));
    svg.append(h('text', { x: x(v), y: 12, 'text-anchor': i === 0 ? 'start' : 'middle', text: fmt(v) }));
  }
  if (kind === 'ms' && max >= 30000) {
    svg.append(h('line', { class: 'limit', x1: x(30000), x2: x(30000), y1: top - 6, y2: H - groupGap + 4 }));
    svg.append(h('text', { class: 'limit-label', x: x(30000) + 4, y: H - groupGap + 2, text: 'timeout do k6' }));
  }
  ROUTES.forEach(([k, name], gi) => {
    const gy = top + gi * (groupH + groupGap);
    svg.append(h('text', { class: 'route', x: 0, y: gy + groupH / 2 + 4, text: name }));
    sel.forEach((r, i) => {
      const v = get(r, k), y = gy + i * (barH + gap);
      if (v == null) { svg.append(h('text', { class: 'val', x: L + 4, y: y + barH - 3, text: 'sem dados' })); return; }
      svg.append(h('rect', { class: 'bar', x: L, y, width: Math.max(1, x(v) - L), height: barH, rx: 2, fill: colors.get(r.id) }, h('title', { text: `${runLabelFull(r)}: ${name} ${fmt(v)}` })));
      svg.append(h('text', { class: 'val', x: x(v) + 6, y: y + barH - 3, text: fmt(v) }));
    });
  });
  $(target).replaceChildren(svg);
}

// Auditoria: linhas reaproveitadas na exportação.
function auditRows(r) {
  const c = r.counts, m = r.metrics;
  const ac = c?.aceitos, pf = c?.persistidos_fim_carga, pfin = c?.persistidos_final, d = c?.drenagem;
  const dedup = pfin?.shares_deduplicados ?? 0;
  let closing = null;
  if (c && r.arch === 'async' && ac && pfin) {
    const expected = ac.shares - dedup;
    closing = expected === pfin.shares ? `fecha: ${fmtInt(expected)} = ${fmtInt(pfin.shares)}` : `não fecha: ${fmtInt(expected)} esperados, ${fmtInt(pfin.shares)} persistidos`;
  } else if (c && r.arch === 'sync') closing = 'não se aplica (422 na transação)';
  const diff = (a, b) => (a == null || b == null ? null : b - a);
  const signed = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${fmtInt(v)}`);
  return [
    ['Aceitos (2xx no k6)'],
    ['Posts', fmtInt(ac?.posts)],
    ['Shares (sem 422)', fmtInt(ac?.shares)],
    ['Persistidos ao fim da carga'],
    ['Posts', fmtInt(pf?.posts)],
    ['Shares', fmtInt(pf?.shares)],
    ['Entradas de feed', fmtInt(pf?.feed_items)],
    ['Tarefas na outbox', fmtInt(c?.fim_carga?.tarefas_pendentes)],
    ['Persistidos após drenagem'],
    ['Posts', fmtInt(pfin?.posts)],
    ['Shares', fmtInt(pfin?.shares)],
    ['Entradas de feed', fmtInt(pfin?.feed_items)],
    ['Shares deduplicados pelo worker', r.arch === 'async' ? fmtInt(pfin?.shares_deduplicados) : '–'],
    ['Persistidos após drenagem menos aceitos'],
    ['Posts', signed(diff(ac?.posts, pfin?.posts)), r.arch === 'sync' && diff(ac?.posts, pfin?.posts) > 0 ? 'requisições abandonadas pelo k6 e concluídas depois (inferido)' : null],
    ['Shares', signed(diff(ac?.shares, pfin?.shares)), r.arch === 'async' && dedup ? `${fmtInt(dedup)} descartados como duplicata` : r.arch === 'sync' && diff(ac?.shares, pfin?.shares) > 0 ? 'requisições abandonadas pelo k6 e concluídas depois (inferido)' : null],
    ['Aceitos − deduplicados = persistidos', closing ?? '–'],
    ['Respostas'],
    ['Timeouts do k6 (30 s)', fmtInt(m?.timeouts)],
    ['Respostas 5xx', fmtInt(m?.http_5xx)],
    ['Shares duplicados (422)', fmtInt(m?.share_duplicates)],
    ['Drenagem'],
    ['Completa', !d ? '–' : d.completa ? 'sim' : 'não'],
    ['Tempo', d?.completa ? fmtDur(d.segundos) : '–'],
    ['Limite de espera', d ? fmtDur(d.timeout_s) : '–'],
    ['Mensagens restantes nas filas', r.arch === 'async' && d ? fmtInt(d.filas_restantes) : '–'],
  ];
}

function renderAudit(sel, colors) {
  const t = $('#audit');
  const perRun = sel.map(auditRows);
  const head = h('thead', {}, h('tr', {}, h('th', { text: 'Quantidade' }), sel.map((r) => h('th', { class: 'num', title: r.id }, h('span', { class: 'tag' }, h('i', { class: 'swatch', style: `background:${colors.get(r.id)}` }), shortLabel(r, sel))))));
  const tb = h('tbody');
  perRun[0].forEach((row, i) => {
    if (row.length === 1) { tb.append(h('tr', { class: 'group' }, h('th', { colspan: sel.length + 1, text: row[0] }))); return; }
    tb.append(h('tr', {}, h('th', { text: row[0] }), perRun.map((rows, j) => {
      const [, v, sub] = rows[i];
      const cls = /^não fecha/.test(v) ? 'bad-txt' : /^fecha/.test(v) ? 'good-txt' : '';
      return h('td', { class: 'num' }, h('span', { class: cls, text: v }), sub ? h('span', { class: 'sub', text: sub }) : null);
    })));
  });
  if (sel.some((r) => !r.counts)) tb.append(h('tr', {}, h('td', { colspan: sel.length + 1, class: 'hint', text: 'Execuções antigas sem contagens.json aparecem com traço.' })));
  t.replaceChildren(head, tb);
}

// ---------------------------------------------------------------- exportação
function exportTable() {
  const sel = selectedRuns();
  const rows = [];
  rows.push(['Métrica', ...sel.map(runLabelFull)]);
  rows.push(['Vazão (req/s)', ...sel.map((r) => fmtNum(r.metrics?.rps, 2))]);
  rows.push(['Taxa de falha HTTP', ...sel.map((r) => fmtPct(r.metrics?.fail_rate))]);
  for (const p of ['p50', 'p95', 'p99']) rows.push([`Latência ${p} geral`, ...sel.map((r) => fmtMs(r.metrics?.latency?.[p]))]);
  rows.push(['Tempo de drenagem', ...sel.map((r) => (r.counts?.drenagem ? (r.counts.drenagem.completa ? fmtDur(r.counts.drenagem.segundos) : `incompleta (${fmtDur(r.counts.drenagem.timeout_s)})`) : '–'))]);
  rows.push(['Pico de mensagens no RabbitMQ', ...sel.map((r) => (r.arch === 'sync' ? 'sem fila' : fmtInt(r.metrics?.queue_peak)))]);
  for (const [k, name] of ROUTES) {
    for (const p of ['p50', 'p95', 'p99']) rows.push([`${name} (${k}) ${p}`, ...sel.map((r) => fmtMs(r.metrics?.routes?.[k]?.[p]))]);
    rows.push([`${name} (${k}) falha`, ...sel.map((r) => fmtPct(r.metrics?.routes?.[k]?.fail_rate))]);
  }
  const audits = sel.map(auditRows);
  let group = '';
  audits[0].forEach((row, i) => {
    if (row.length === 1) { group = row[0]; return; }
    rows.push([`${group}: ${row[0]}`, ...audits.map((a) => a[i][1])]);
  });
  return { rows, ids: sel.map((r) => r.id) };
}

const flash = (msg) => { const t = $('#toast'); t.textContent = msg; clearTimeout(flash.t); flash.t = setTimeout(() => { t.textContent = ''; }, 3000); };

$('#btn-md').addEventListener('click', async () => {
  const { rows, ids } = exportTable();
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const md = [
    `| ${rows[0].map(esc).join(' | ')} |`,
    `| ${rows[0].map((_, i) => (i ? '---:' : '---')).join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`),
    '',
    `Fonte: ${ids.map((id) => `\`code/k6/results/${id}\``).join(', ')}.`,
  ].join('\n');
  try { await navigator.clipboard.writeText(md); flash('Markdown copiado'); } catch { download('comparacao.md', md, 'text/markdown'); flash('Markdown baixado'); }
});

$('#btn-csv').addEventListener('click', () => {
  const { rows } = exportTable();
  // Separador ";" e vírgula decimal: abre direto no Excel/LibreOffice em pt-BR.
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  download('comparacao.csv', `﻿${rows.map((r) => r.map(q).join(';')).join('\r\n')}`, 'text/csv');
  flash('CSV baixado');
});

function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- início
restoreForm();
syncForm();
renderOverview();
showTab();
connect();
loadRuns();
