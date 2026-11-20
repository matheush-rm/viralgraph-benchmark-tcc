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
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const tech = (text) => h('span', { class: 'tech', text });

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

// Vocabulário: nome acessível primeiro, termo técnico como apoio.
const ARCH = { sync: 'Síncrona', async: 'Orientada a eventos' };
const MODE = { smoke: 'rápido', tcc: 'completo' };
const KIND = { viral: 'viralização', user_lookup: 'busca de perfil' };
const SCEN = { mixed: 'uso misto', baseline: 'uso comum', fanout: 'celebridades em ação', graph_read: 'leitura do viral', organic: 'viralização orgânica', viral_peak: 'pico de viralização' };
const ROUTES = [
  ['feed', 'Ler o feed'],
  ['propagation_tree', 'Ver como um post se espalhou'],
  ['posts_create', 'Pessoa comum publica'],
  ['share', 'Pessoa comum compartilha'],
  ['celebrity_post', 'Celebridade publica'],
  ['celebrity_share', 'Celebridade compartilha'],
  ['user_lookup', 'Busca de perfil'],
];
// organic e viral_peak têm pico fixo (50 smoke / 300 tcc); o baseline de leitura sobe a
// 80 (smoke) ou 100→400→600 (tcc). Os demais cenários: 50 no smoke, VUS_MAX no tcc.
const FIXED_PEAK = { organic: 1, viral_peak: 1 };

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

// ---------------------------------------------------------------- abas
const TABS = ['execucao', 'comparacao'];
function showTab() {
  const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'execucao';
  for (const t of TABS) {
    $(`#tab-${t}`).hidden = t !== tab;
    $(`.tabs a[data-tab="${t}"]`)?.setAttribute('aria-selected', String(t === tab));
  }
  // A aba de execução ocupa exatamente a janela; só o terminal rola.
  document.body.classList.toggle('fit', tab === 'execucao');
  if (tab === 'execucao') scrollConsole();
  if (tab === 'comparacao') renderCompare();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showTab);

// ================================================================ RODAR UM TESTE

const form = $('#run-form');
let run = { status: 'idle' };
let phaseAt = {};
let tick = null;

function formParams() {
  const f = new FormData(form);
  return { kind: f.get('kind') || 'viral', arch: f.get('arch'), mode: f.get('mode'), scenario: f.get('scenario'), vus: Number(f.get('vus') || 600), restore: f.get('restore') === 'on' };
}

function commandsFor(p) {
  if (p.kind === 'user_lookup') {
    if (p.mode === 'tcc') return [`make baseline-tcc-${p.arch}`];
    return p.restore ? [`make baseline-smoke-${p.arch}`] : [`MODE=smoke bash scripts/viral.sh baseline ${p.arch}`];
  }
  if (FIXED_PEAK[p.scenario]) return [`make ${p.scenario === 'organic' ? 'viral-organic' : 'viral-peak'}-${p.arch} MODE=${p.mode}`];
  if (p.mode === 'tcc') return [`make viral-tcc VIRAL_ARCH=${p.arch} SCENARIO=${p.scenario} VUS_MAX=${p.vus}`];
  return [...(p.restore ? [`make viral-restore VIRAL_ARCH=${p.arch}`] : []), `make viral-load VIRAL_ARCH=${p.arch} MODE=smoke SCENARIO=${p.scenario}`];
}

function syncForm() {
  const p = formParams();
  const isBase = p.kind === 'user_lookup';
  const fixed = Boolean(FIXED_PEAK[p.scenario]);
  // Baseline: sem situação nem degrau; cenários de perfil fixo: sem VUs nem checkbox de restore.
  $('#f-scenario').hidden = isBase;
  $('#f-vus').hidden = isBase || fixed || p.mode !== 'tcc';
  $('#f-restore').hidden = fixed || p.mode !== 'smoke';
  $('#f-hint-restore').hidden = isBase || fixed || p.mode !== 'tcc';
  $('#f-hint-fixed').hidden = !fixed;
  $('#f-hint-baseline').hidden = !isBase;
  $('#cmd-preview').textContent = commandsFor(p).join('\n');
  store.set('form', p);
}

function restoreForm(p = store.get('form', null)) {
  if (!p) return;
  for (const [k, v] of Object.entries(p)) {
    for (const i of $$(`[name="${k}"]`, form)) {
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
    btn.textContent = 'Clique de novo para parar';
    abortArmed = setTimeout(() => { abortArmed = null; btn.textContent = 'Parar teste'; }, 4000);
    return;
  }
  clearTimeout(abortArmed); abortArmed = null;
  btn.disabled = true; btn.textContent = 'Parando…';
  try { await api('/api/abort', { method: 'POST' }); } catch (ex) { $('#form-error').textContent = ex.message; $('#form-error').hidden = false; }
});

const PHASES = ['restore', 'warmup', 'load', 'drain', 'done'];
const STATUS_TEXT = { running: 'Em andamento', success: 'Concluído', thresholds_failed: 'Concluído com muitas falhas', failed: 'Parou com erro', aborted: 'Interrompido', idle: 'Parado' };

// O que cada etapa significa, em linguagem simples, com o termo técnico como apoio.
const PHASE_INFO = {
  queued: { title: 'Iniciando o teste', desc: () => 'Preparando os comandos.', tech: 'make' },
  restore: {
    title: 'Restaurando o banco',
    desc: () => 'Volta à cópia limpa da rede e sobe os serviços.',
    tech: 'restauração do snapshot + docker compose up',
  },
  warmup: {
    title: 'Aquecendo',
    desc: () => 'Leituras iniciais, fora das medições.',
    tech: 'warmup do k6, só leituras',
  },
  load: {
    title: 'Aplicando carga',
    desc: (p) => (p.kind === 'user_lookup'
      ? `${p.mode === 'tcc' ? '100 → 600' : '80'} usuários virtuais consultando perfis.`
      : `Até ${p.mode === 'tcc' ? fmtInt(p.vus ?? 300) : 50} usuários virtuais lendo, publicando e compartilhando.`),
    tech: 'carga k6',
  },
  drain: {
    title: 'Drenando',
    desc: (p) => (p.arch === 'async'
      ? 'Carga encerrada; medindo o tempo para esvaziar a fila.'
      : 'Carga encerrada; aguardando as contagens estabilizarem.'),
    tech: 'drenagem + contagens.json',
  },
  done: {
    title: 'Resultado salvo',
    desc: () => 'Disponível em Execuções.',
    tech: (p) => (p.kind === 'user_lookup' ? 'summary.json + metricas.json' : 'summary.json + contagens.json'),
  },
};

// Por que uma etapa não se aplica a um tipo de teste (mostrada no título da etapa riscada).
const SKIP_WHY = {
  restore: 'pulada: o teste rápido continuou do banco atual',
  warmup: 'pulada: a leitura de perfil não precisa de aquecimento',
  drain: 'pulada: sem escritas, não há fila para esvaziar',
};
const skippedPhases = (p) => {
  const s = new Set();
  if (!p) return s;
  if (p.kind === 'user_lookup') { s.add('warmup'); s.add('drain'); }
  if (p.mode === 'smoke' && !p.restore) s.add('restore');
  return s;
};
const techOf = (info, p) => (typeof info?.tech === 'function' ? info.tech(p ?? {}) : info?.tech);

function applyRun(snap) {
  run = snap;
  phaseAt = snap.phaseAt ?? {};
  renderRun();
}

function renderRun() {
  const active = run.status === 'running';
  $('#btn-run').disabled = active;
  $('#btn-abort').hidden = !active;
  if (!active) { $('#btn-abort').disabled = false; $('#btn-abort').textContent = 'Parar teste'; }
  for (const el of $$('input, select', form)) el.disabled = active;
  // Durante o teste, o formulário mostra o que está rodando, não a última escolha.
  if (active && run.params) { restoreForm(run.params); syncForm(); }

  const p = run.params;
  const info = PHASE_INFO[run.phase];
  const skip = skippedPhases(p);
  const visible = PHASES.filter((ph) => !skip.has(ph));

  // Cabeçalho
  const pill = $('#run-pill');
  pill.dataset.state = run.status;
  $('#run-pill-text').textContent = run.status === 'idle' ? 'Nenhum teste rodando'
    : active ? `${ARCH[p.arch]}: etapa ${Math.max(1, visible.indexOf(run.phase) + 1)} de ${visible.length}` : `Último teste: ${STATUS_TEXT[run.status]?.toLowerCase()}`;

  // Painel "agora"
  const now = $('#now');
  now.dataset.state = run.status;
  let lab = 'Pronto para começar', title = 'Escolha a configuração ao lado.', desc = '', techTxt = null;
  if (run.status !== 'idle') {
    lab = p.kind === 'user_lookup'
      ? `${STATUS_TEXT[run.status]} · ${ARCH[p.arch]} · busca de perfil · ${MODE[p.mode]}`
      : `${STATUS_TEXT[run.status]} · ${ARCH[p.arch]} · ${SCEN[p.scenario]} · ${MODE[p.mode]}${p.mode === 'tcc' && p.vus ? ` · ${fmtInt(p.vus)} usuários` : ''}`;
    if (active) { title = info?.title ?? 'Iniciando'; desc = info?.desc(p) ?? ''; techTxt = techOf(info, p); }
    else if (run.status === 'success') { title = 'Concluído'; desc = 'Resultado disponível em Execuções.'; }
    else if (run.status === 'thresholds_failed') {
      title = p.kind === 'user_lookup' ? 'Concluído fora do contrato' : 'Concluído com muitas falhas';
      desc = p.kind === 'user_lookup'
        ? 'Contrato: < 1% de falhas, p95 < 500 ms, sem erros de formato. Resultado salvo.'
        : '20% ou mais das ações falharam. Resultado salvo.';
      techTxt = 'threshold do k6 reprovado';
    }
    else if (run.status === 'aborted') { title = 'Interrompido'; desc = 'Parado manualmente; serviços continuam ligados.'; }
    else if (run.status === 'failed') { title = 'Erro'; desc = `Na etapa “${PHASE_INFO[run.phase]?.title.toLowerCase() ?? 'inicial'}”. Veja o terminal.`; }
  }
  $('#now-label').textContent = lab;
  $('#now-title').replaceChildren(title, techTxt ? tech(techTxt) : '');
  $('#now-desc').textContent = desc;

  // Etapas
  const ol = $('#phases');
  ol.dataset.status = run.status;
  const idx = visible.indexOf(run.phase);
  for (const li of $$('li', ol)) {
    const ph = li.dataset.phase, i = visible.indexOf(ph);
    li.className = '';
    li.title = techOf(PHASE_INFO[ph], p) ?? '';
    if (run.status === 'idle') continue;
    if (skip.has(ph)) { li.classList.add('skipped'); li.title = SKIP_WHY[ph]; continue; }
    if (i < idx || (run.status === 'success' && i <= idx)) li.classList.add('past');
    else if (i === idx) li.classList.add('active');
  }

  // Metadados
  const meta = $('#run-meta');
  meta.replaceChildren();
  if (run.status !== 'idle') {
    meta.append(h('span', { id: 'elapsed' }));
    if (run.resultDir) meta.append(h('span', { class: 'tech', title: 'pasta com os resultados', text: run.resultDir }));
    if (run.resultDir && !active) meta.append(h('a', { href: '#comparacao', onclick: () => { selection = [...new Set([run.resultDir, ...(selection ?? [])])]; saveSelection(); }, text: 'Abrir em Execuções' }));
    if (!active && run.code != null && run.status !== 'success') meta.append(h('span', { class: 'tech', text: `código de saída ${run.code}` }));
  }
  renderPhaseTimes();
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
    } else if (start) txt = `às ${new Date(start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    $('.ph-time', li).textContent = txt;
  }
  const el = $('#elapsed');
  if (el && run.startedAt) el.textContent = `Total: ${fmtDur((now - run.startedAt) / 1000)}`;
}

// Terminal
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
    if (!s.lines.length) consoleEl.append(h('span', { class: 'muted', text: 'As mensagens do teste aparecem aqui assim que ele começar.' }));
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

// ================================================================ RESULTADOS

let runs = [];
let selection = store.get('selection', null);
let runsLoaded = false;
const filters = { kind: '', arch: '', mode: '', scenario: '', vus: '', ...store.get('filters', {}) };
const saveSelection = () => store.set('selection', selection);
// Esconde a lista de testes só na tela (não apaga nada do disco); "Atualizar lista" a traz de volta.
let tableHidden = false;
function applyTableVisibility() {
  $('#runs-table').closest('.runs-scroll').hidden = tableHidden;
  $('#runs-hint').hidden = tableHidden;
}

async function loadRuns() {
  try { runs = await api('/api/runs'); } catch { runs = []; }
  runsLoaded = true;
  tableHidden = false; applyTableVisibility();
  if (selection == null) {
    // Padrão: último teste completo de cada versão, uso misto, pico viral.
    const pick = (a) => runs.find((r) => r.kind === 'viral' && r.arch === a && r.mode === 'tcc' && r.scenario === 'viral_peak' && r.counts)
      ?? runs.find((r) => r.kind === 'viral' && r.arch === a && r.mode === 'tcc' && r.counts);
    selection = [pick('sync'), pick('async')].filter(Boolean).map((r) => r.id);
  }
  selection = selection.filter((id) => runs.some((r) => r.id === id));
  const vusSel = $('[data-filter="vus"]');
  const levels = [...new Set(runs.map((r) => r.vus_max).filter(Boolean))].sort((a, b) => a - b);
  vusSel.replaceChildren(h('option', { value: '', text: 'Qualquer intensidade' }), ...levels.map((v) => h('option', { value: v, text: `${v} usuários` })));
  for (const sel of $$('[data-filter]')) sel.value = filters[sel.dataset.filter] ?? '';
  if (!$('#tab-comparacao').hidden) renderCompare();
}

for (const sel of $$('[data-filter]')) sel.addEventListener('change', () => { filters[sel.dataset.filter] = sel.value; store.set('filters', filters); renderRunsTable(); });
$('#btn-reload').addEventListener('click', () => { tableHidden = false; applyTableVisibility(); loadRuns(); });
// Esvazia a comparação e esconde a lista de testes (só na tela; nada é apagado do disco).
$('#btn-clear-sel').addEventListener('click', () => {
  selection = []; saveSelection();
  tableHidden = true; applyTableVisibility();
  renderCompare();
});

const usersOf = (r) => {
  if (r.kind === 'user_lookup') return r.mode === 'tcc' ? 600 : 80;
  if (FIXED_PEAK[r.scenario]) return r.mode === 'tcc' ? 300 : 50;
  return r.mode === 'tcc' ? r.vus_max : 50;
};
const runLabel = (r) => (r.kind === 'user_lookup'
  ? `${ARCH[r.arch]}, busca de perfil, ${MODE[r.mode]}`
  : `${ARCH[r.arch]}, ${SCEN[r.scenario] ?? 'sem situação'}, ${MODE[r.mode]}${r.mode === 'tcc' && r.vus_max ? `, ${r.vus_max} usuários` : ''}`);
const runLabelFull = (r) => `${runLabel(r)} (${fmtDateShort(r.started_at)})`;
// Rótulo curto para cartões, gráficos e tabela: versão + só o que difere entre os selecionados.
function shortLabel(r, sel = selectedRuns()) {
  const vary = (f) => new Set(sel.map(f)).size > 1;
  const parts = [ARCH[r.arch]];
  if (vary((x) => x.kind)) parts.push(KIND[r.kind] ?? r.kind);
  if (vary((x) => x.scenario)) parts.push(SCEN[r.scenario] ?? 'sem situação');
  if (vary((x) => x.mode)) parts.push(MODE[r.mode]);
  if (vary(usersOf)) parts.push(`${usersOf(r) ?? '?'} usuários`);
  const lbl = parts.join(', ');
  return sel.filter((x) => shortBase(x, sel) === shortBase(r, sel)).length > 1 ? `${lbl} (${fmtDateShort(r.started_at)})` : lbl;
}
function shortBase(r, sel) {
  const vary = (f) => new Set(sel.map(f)).size > 1;
  return [r.arch, vary((x) => x.kind) && r.kind, vary((x) => x.scenario) && r.scenario, vary((x) => x.mode) && r.mode, vary(usersOf) && usersOf(r)].join('|');
}
function commonContext(sel) {
  const same = (f) => new Set(sel.map(f)).size === 1;
  const r = sel[0], parts = [];
  if (same((x) => x.kind)) parts.push(r.kind === 'user_lookup' ? 'busca de perfil' : 'viralização');
  if (same((x) => x.scenario) && r.scenario) parts.push(SCEN[r.scenario] ?? '–');
  if (same((x) => x.mode)) parts.push(`teste ${MODE[r.mode]}`);
  if (same(usersOf)) parts.push(`${usersOf(r)} usuários simultâneos`);
  return parts.length ? `Em comum: ${parts.join(' · ')}.` : '';
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

const drainText = (d) => (!d ? '–' : d.completa ? fmtDur(d.segundos) : `não esvaziou em ${fmtDur(d.timeout_s)}`);

function renderRunsTable() {
  const tb = $('#runs-table tbody');
  const list = runs.filter((r) => (!filters.kind || r.kind === filters.kind) && (!filters.arch || r.arch === filters.arch) && (!filters.mode || r.mode === filters.mode)
    && (!filters.scenario || r.scenario === filters.scenario) && (!filters.vus || String(r.vus_max) === String(filters.vus)));
  tb.replaceChildren();
  if (!list.length) {
    tb.append(h('tr', {}, h('td', { colspan: 11, class: 'empty', text: runs.length ? 'Nenhuma execução com esses filtros.' : 'Nenhuma execução salva. Use a aba Executar.' })));
  }
  const colors = colorsFor(selectedRuns());
  for (const r of list) {
    const on = selection.includes(r.id);
    const m = r.metrics;
    const toggle = () => { selection = on ? selection.filter((x) => x !== r.id) : [...selection, r.id]; saveSelection(); renderCompare(); };
    tb.append(h('tr', { class: on ? 'sel' : '', title: r.id, onclick: (e) => { if (e.target.tagName !== 'INPUT') toggle(); } },
      h('td', {}, h('input', { type: 'checkbox', checked: on, 'aria-label': `Selecionar ${runLabelFull(r)}`, onchange: toggle })),
      h('td', { text: KIND[r.kind] ?? '–' }),
      h('td', {}, h('span', { class: 'tag' }, h('i', { class: 'swatch', style: `background:${on ? colors.get(r.id) : `var(--${r.arch})`}` }), ARCH[r.arch])),
      h('td', { text: MODE[r.mode] }), h('td', { text: SCEN[r.scenario] ?? '–' }), h('td', { class: 'num', text: usersOf(r) ?? '–' }),
      h('td', { text: fmtDate(r.started_at) }),
      h('td', { class: 'num', text: fmtNum(m?.rps, 1) }),
      h('td', { class: `num ${m?.fail_rate > 0.01 ? 'bad-txt' : ''}`, text: fmtPct(m?.fail_rate) }),
      h('td', { class: 'num', text: fmtMs(m?.latency?.p95) }),
      h('td', { class: 'num', text: drainText(r.counts?.drenagem) })));
  }
  $('#runs-hint').textContent = `${list.length} de ${runs.length} execuções · ${selection.length} selecionada(s) · clique na linha para comparar`;
}

const selectedRuns = () => (selection ?? []).map((id) => runs.find((r) => r.id === id)).filter(Boolean);

// Definições compartilhadas por cartões e exportação.
const drainVal = (r) => (r.counts?.drenagem?.completa ? r.counts.drenagem.segundos : null);
const CARDS = [
  { title: 'Vazão', explain: 'Requisições atendidas por segundo. Maior é melhor.', tech: 'req/s', get: (r) => r.metrics?.rps, fmt: (v) => fmtNum(v, 1) },
  { title: 'Taxa de falhas', explain: 'Erro ou mais de 30 s sem resposta. Menor é melhor.', tech: 'http_req_failed', get: (r) => r.metrics?.fail_rate, fmt: fmtPct, bad: true },
  {
    title: 'Erros de contrato', explain: 'Respostas fora do formato do perfil. Deve ser zero.', tech: 'contract_errors', fmt: fmtPct, bad: true,
    get: (r) => (r.kind === 'user_lookup' ? r.metrics?.contract_errors?.rate : null),
    note: (r) => (r.kind !== 'user_lookup' ? 'só na busca de perfil' : null),
  },
  { title: 'Latência p50', explain: 'Metade das requisições respondeu até aqui.', tech: 'p(50)', get: (r) => r.metrics?.latency?.p50, fmt: fmtMs },
  { title: 'Latência p95', explain: '95% responderam até aqui. Contrato da busca: < 500 ms.', tech: 'p(95)', get: (r) => r.metrics?.latency?.p95, fmt: fmtMs },
  { title: 'Latência p99', explain: '99% responderam até aqui.', tech: 'p(99)', get: (r) => r.metrics?.latency?.p99, fmt: fmtMs },
  {
    title: 'Tempo de drenagem', explain: 'Tempo para concluir o pendente após a carga.', tech: 'drenagem', get: drainVal, fmt: fmtDur,
    note: (r) => (r.kind === 'user_lookup' ? 'sem escritas' : !r.counts ? 'não medido' : r.counts.drenagem?.completa ? null : `não terminou em ${fmtDur(r.counts.drenagem?.timeout_s)}`),
  },
  {
    title: 'Pico da fila', explain: 'Máximo de mensagens aguardando processamento.', tech: 'RabbitMQ', get: (r) => r.metrics?.queue_peak, fmt: fmtInt,
    note: (r) => (r.kind === 'user_lookup' ? 'sem escritas' : r.arch === 'sync' ? 'sem fila' : null),
    detail: (r) => (r.metrics?.queues && Object.keys(r.metrics.queues).length ? `por fila: ${Object.entries(r.metrics.queues).map(([q, v]) => `${q} ${fmtInt(v.max)}`).join(', ')}` : null),
  },
];

function renderCompare() {
  if (!runsLoaded) return;
  renderRunsTable();
  const sel = selectedRuns();
  const body = $('#cmp-body');
  if (!sel.length) { body.hidden = true; return; }
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
      h('h4', { text: c.title }),
      h('span', { class: 'unit', text: c.explain }),
      h('div', { class: 'rows' }, sel.map((r) => {
        const v = c.get(r), note = c.note?.(r), detail = c.detail?.(r);
        return h('div', { class: 'row' },
          h('small', { title: runLabelFull(r), text: shortLabel(r, sel) }),
          v == null ? h('span', { class: 'na', text: '–' }) : h('b', { class: c.bad && v > 0.01 ? 'bad-txt' : '', text: c.fmt(v) }),
          h('span', { class: 'bar' }, h('i', { style: `width:${v == null || !max ? 0 : Math.max(1.5, (v / max) * 100)}%;background:${colors.get(r.id)}` })),
          v == null && note ? h('small', { class: 'note', text: note }) : null,
          detail ? h('small', { class: 'note', text: detail }) : null);
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
  const W = 960, L = 220, R = 70, barH = 14, gap = 3, groupGap = 22, top = 22;
  const groupH = Math.max(sel.length * (barH + gap) - gap, 30);
  // Só as ações medidas por pelo menos um dos selecionados (viral não mostra linha vazia do baseline).
  const routes = ROUTES.filter(([k]) => sel.some((r) => r.metrics?.routes?.[k]));
  if (!routes.length) { $(target).replaceChildren(h('p', { class: 'hint', text: 'Sem medições por ação nesta seleção.' })); return; }
  const H = top + routes.length * (groupH + groupGap);
  const vals = routes.flatMap(([k]) => sel.map((r) => get(r, k))).filter((v) => v != null);
  let max = niceMax(Math.max(...vals, kind === 'rate' ? 0.05 : 1));
  if (kind === 'rate') max = Math.min(1, max);
  const x = (v) => L + (W - L - R) * (v / max);
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': kind === 'rate' ? 'Falhas por ação' : 'Tempo de resposta por ação' });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(h('line', { class: 'grid', x1: x(v), x2: x(v), y1: top - 6, y2: H - groupGap + 4 }));
    svg.append(h('text', { x: x(v), y: 12, 'text-anchor': i === 0 ? 'start' : 'middle', text: fmt(v) }));
  }
  if (kind === 'ms' && max >= 30000) {
    svg.append(h('line', { class: 'limit', x1: x(30000), x2: x(30000), y1: top - 6, y2: H - groupGap + 4 }));
    svg.append(h('text', { class: 'limit-label', x: x(30000) + 4, y: H - groupGap + 2, text: 'teste desiste (30 s)' }));
  }
  // Contrato do baseline de leitura: p95 abaixo de 500 ms.
  if (kind === 'ms' && max >= 500 && sel.every((r) => r.kind === 'user_lookup')) {
    svg.append(h('line', { class: 'contract', x1: x(500), x2: x(500), y1: top - 6, y2: H - groupGap + 4 }));
    svg.append(h('text', { class: 'contract-label', x: x(500) + 4, y: top - 2, text: 'contrato (500 ms)' }));
  }
  routes.forEach(([k, name], gi) => {
    const gy = top + gi * (groupH + groupGap);
    svg.append(h('text', { class: 'route', x: 0, y: gy + groupH / 2, text: name }));
    svg.append(h('text', { class: 'route-tech', x: 0, y: gy + groupH / 2 + 15, text: k }));
    sel.forEach((r, i) => {
      const v = get(r, k), y = gy + i * (barH + gap);
      if (v == null) { svg.append(h('text', { class: 'val', x: L + 4, y: y + barH - 3, text: 'sem dados' })); return; }
      svg.append(h('rect', { class: 'bar', x: L, y, width: Math.max(1, x(v) - L), height: barH, rx: 2, fill: colors.get(r.id) }, h('title', { text: `${runLabelFull(r)}: ${name} ${fmt(v)}` })));
      svg.append(h('text', { class: 'val', x: x(v) + 6, y: y + barH - 3, text: fmt(v) }));
    });
  });
  $(target).replaceChildren(svg);
}

// Tabela "prometido × gravado". Linha: [rótulo, valor, observação, termo técnico]; grupo: [título, termo técnico].
function auditRows(r) {
  const c = r.counts, m = r.metrics;
  const ac = c?.aceitos, pf = c?.persistidos_fim_carga, pfin = c?.persistidos_final, d = c?.drenagem;
  const dedup = pfin?.shares_deduplicados ?? 0;
  let closing = '–';
  if (c && r.arch === 'async' && ac && pfin) {
    const expected = ac.shares - dedup;
    closing = expected === pfin.shares ? `sim: ${fmtInt(expected)} = ${fmtInt(pfin.shares)}` : `não: ${fmtInt(expected)} esperados, ${fmtInt(pfin.shares)} gravados`;
  } else if (c && r.arch === 'sync') closing = 'não se aplica';
  const diff = (a, b) => (a == null || b == null ? null : b - a);
  const signed = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${fmtInt(v)}`);
  const late = 'pedidos que o teste desistiu de esperar, mas o servidor terminou depois (inferido)';
  const dPosts = diff(ac?.posts, pfin?.posts), dShares = diff(ac?.shares, pfin?.shares);
  return [
    { group: 'Aceitos (resposta 2xx)', tech: 'k6' },
    ['Publicações', fmtInt(ac?.posts), null, 'posts'],
    ['Compartilhamentos', fmtInt(ac?.shares), null, 'shares, sem os 422'],
    { group: 'Gravados ao fim da carga', tech: 'persistidos' },
    ['Publicações', fmtInt(pf?.posts), null, 'posts'],
    ['Compartilhamentos', fmtInt(pf?.shares), null, 'shares'],
    ['Posts entregues nos feeds', fmtInt(pf?.feed_items), null, 'feed_items'],
    ['Tarefas de entrega ainda pendentes', fmtInt(c?.fim_carga?.tarefas_pendentes), null, 'outbox'],
    { group: 'Gravados após a drenagem', tech: 'persistidos' },
    ['Publicações', fmtInt(pfin?.posts), null, 'posts'],
    ['Compartilhamentos', fmtInt(pfin?.shares), null, 'shares'],
    ['Posts entregues nos feeds', fmtInt(pfin?.feed_items), null, 'feed_items'],
    ['Compartilhamentos repetidos descartados', r.arch === 'async' ? fmtInt(pfin?.shares_deduplicados) : '–', null, 'shares_deduplicados'],
    { group: 'Gravados − aceitos', tech: 'persistidos após drenagem − aceitos' },
    ['Publicações', signed(dPosts), r.arch === 'sync' && dPosts > 0 ? late : null, 'posts'],
    ['Compartilhamentos', signed(dShares), r.arch === 'async' && dedup ? `${fmtInt(dedup)} eram repetidos e foram descartados` : r.arch === 'sync' && dShares > 0 ? late : null, 'shares'],
    ['A conta fecha?', closing, r.arch === 'async' && c ? 'aceitos menos repetidos deve ser igual a gravados' : r.arch === 'sync' && c ? 'a versão síncrona recusa repetidos na hora' : null, 'aceitos − deduplicados = persistidos'],
    { group: 'Respostas com problema', tech: 'k6' },
    ['O teste desistiu de esperar (mais de 30 s)', fmtInt(m?.timeouts), null, 'http_timeouts'],
    ['Erro do servidor', fmtInt(m?.http_5xx), null, 'HTTP 5xx'],
    ['Compartilhamento repetido recusado', fmtInt(m?.share_duplicates), null, 'HTTP 422'],
    { group: 'Drenagem', tech: 'pendências' },
    ['Terminou?', !d ? '–' : d.completa ? 'sim' : 'não', null, 'drenagem.completa'],
    ['Quanto tempo levou', d?.completa ? fmtDur(d.segundos) : '–', null, 'drenagem.segundos'],
    ['Tempo máximo de espera', d ? fmtDur(d.timeout_s) : '–', null, 'DRAIN_TIMEOUT_S'],
    ['Pedidos que sobraram na fila', r.arch === 'async' && d ? fmtInt(d.filas_restantes) : '–', null, 'filas_restantes'],
  ];
}

// Título e introdução da seção final mudam conforme a seleção: viral compara "prometido × gravado";
// baseline compara o estado do banco antes e depois da carga (leitura pura não pode alterar nada).
const AUDIT_VIRAL = {
  title: 'Aceitos × gravados',
  tech: 'consistência eventual',
  lede: 'Na arquitetura orientada a eventos, uma requisição aceita ainda pode não estar gravada. A tabela compara requisições aceitas com registros no banco ao fim da carga e após a drenagem.',
  footnote: 'Vazão e falhas contam só as ações dos usuários simulados; a latência geral da orientada a eventos inclui uma verificação de fila por segundo. Sob sobrecarga, ela recusa consultas acima de 10 s, enquanto a síncrona espera até o limite de 30 s do k6.',
};
const AUDIT_BASELINE = {
  title: 'Banco intacto?',
  tech: 'somente leitura',
  lede: 'Carga somente leitura: os contadores do banco devem ser idênticos antes e depois.',
  footnote: 'Toda resposta é conferida contra o formato do perfil; o k6 desiste após 30 s.',
};
const STATE_LABELS = {
  usuarios: 'Pessoas', feeds: 'Feeds', relacoes_seguir: 'Conexões “segue”', posts_criados: 'Posts',
  compartilhamentos: 'Compartilhamentos', entradas_feed: 'Posts entregues nos feeds',
  inserts_logicos: 'Gravações lógicas', compartilhamentos_deduplicados: 'Compartilhamentos repetidos descartados',
};

function renderState(sel, colors) {
  const keys = [...new Set(sel.flatMap((r) => Object.keys(r.state?.antes ?? {})))];
  const head = h('thead', {}, h('tr', {}, h('th', { text: 'O que foi contado' }), sel.map((r) => h('th', { class: 'num', title: r.id }, h('span', { class: 'tag' }, h('i', { class: 'swatch', style: `background:${colors.get(r.id)}` }), shortLabel(r, sel))))));
  const tb = h('tbody');
  tb.append(h('tr', { class: 'group' }, h('th', { colspan: sel.length + 1 }, 'Contadores do banco ', tech('/metricas, antes → depois da carga'))));
  for (const k of keys) {
    tb.append(h('tr', {}, h('th', { title: k }, STATE_LABELS[k] ?? k, ' ', tech(k)), sel.map((r) => {
      const a = r.state?.antes?.[k], d = r.state?.depois?.[k];
      return h('td', { class: `num ${a !== d ? 'bad-txt' : ''}`, text: `${fmtInt(a)} → ${fmtInt(d)}` });
    })));
  }
  tb.append(h('tr', {}, h('th', {}, 'Ficou idêntico? ', tech('antes = depois')), sel.map((r) => {
    const same = r.state && keys.every((k) => r.state.antes?.[k] === r.state.depois?.[k]);
    return h('td', { class: 'num' }, h('span', { class: same ? 'good-txt' : 'bad-txt', text: same ? 'sim' : 'não' }));
  })));
  $('#audit').replaceChildren(head, tb);
}

function renderAudit(sel, colors) {
  const allBaseline = sel.every((r) => r.kind === 'user_lookup');
  const txt = allBaseline ? AUDIT_BASELINE : AUDIT_VIRAL;
  $('#audit-title').replaceChildren(txt.title, ' ', h('span', { class: 'tech', text: txt.tech }));
  $('#audit-lede').textContent = txt.lede;
  $('#cmp-footnote').textContent = txt.footnote;
  if (allBaseline) return renderState(sel, colors);
  const t = $('#audit');
  const perRun = sel.map(auditRows);
  const head = h('thead', {}, h('tr', {}, h('th', { text: 'O que foi contado' }), sel.map((r) => h('th', { class: 'num', title: r.id }, h('span', { class: 'tag' }, h('i', { class: 'swatch', style: `background:${colors.get(r.id)}` }), shortLabel(r, sel))))));
  const tb = h('tbody');
  perRun[0].forEach((row, i) => {
    if (row.group) { tb.append(h('tr', { class: 'group' }, h('th', { colspan: sel.length + 1 }, row.group, ' ', tech(row.tech)))); return; }
    tb.append(h('tr', {}, h('th', { title: row[3] }, row[0], ' ', tech(row[3])), perRun.map((rows) => {
      const [, v, sub] = rows[i];
      const cls = /^não:/.test(v) ? 'bad-txt' : /^sim:/.test(v) ? 'good-txt' : '';
      return h('td', { class: 'num' }, h('span', { class: cls, text: v }), sub ? h('span', { class: 'sub', text: sub }) : null);
    })));
  });
  if (sel.some((r) => !r.counts)) tb.append(h('tr', {}, h('td', { colspan: sel.length + 1, class: 'hint', text: 'Testes antigos, feitos antes desta contagem existir, aparecem com traço.' })));
  t.replaceChildren(head, tb);
}

// ---------------------------------------------------------------- exportação
function exportTable() {
  const sel = selectedRuns();
  const rows = [];
  rows.push(['Métrica', ...sel.map(runLabelFull)]);
  rows.push(['Pedidos atendidos por segundo (vazão, req/s)', ...sel.map((r) => fmtNum(r.metrics?.rps, 2))]);
  rows.push(['Pedidos que falharam (taxa de falha HTTP)', ...sel.map((r) => fmtPct(r.metrics?.fail_rate))]);
  rows.push(['Tempo de resposta típico (p50)', ...sel.map((r) => fmtMs(r.metrics?.latency?.p50))]);
  rows.push(['Tempo de resposta para 95% (p95)', ...sel.map((r) => fmtMs(r.metrics?.latency?.p95))]);
  rows.push(['Tempo de resposta dos mais lentos (p99)', ...sel.map((r) => fmtMs(r.metrics?.latency?.p99))]);
  rows.push(['Tempo para concluir o pendente (drenagem)', ...sel.map((r) => drainText(r.counts?.drenagem))]);
  rows.push(['Maior fila de espera (pico RabbitMQ)', ...sel.map((r) => (r.arch === 'sync' ? 'não usa fila' : fmtInt(r.metrics?.queue_peak)))]);
  for (const [k, name] of ROUTES) {
    for (const p of ['p50', 'p95', 'p99']) rows.push([`${name} (${k}), ${p}`, ...sel.map((r) => fmtMs(r.metrics?.routes?.[k]?.[p]))]);
    rows.push([`${name} (${k}), falhas`, ...sel.map((r) => fmtPct(r.metrics?.routes?.[k]?.fail_rate))]);
  }
  const audits = sel.map(auditRows);
  let group = '';
  audits[0].forEach((row, i) => {
    if (row.group) { group = row.group; return; }
    rows.push([`${group}: ${row[0]} (${row[3]})`, ...audits.map((a) => a[i][1])]);
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
  try { await navigator.clipboard.writeText(md); flash('Tabela copiada'); } catch { download('comparacao.md', md, 'text/markdown'); flash('Tabela baixada'); }
});

$('#btn-csv').addEventListener('click', () => {
  const { rows } = exportTable();
  // Separador ";" e vírgula decimal: abre direto no Excel/LibreOffice em pt-BR.
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  download('comparacao.csv', `\ufeff${rows.map((r) => r.map(q).join(';')).join('\r\n')}`, 'text/csv');
  flash('Planilha baixada');
});

function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- início
restoreForm();
syncForm();
showTab();
connect();
loadRuns();
