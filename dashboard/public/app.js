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
const ARCH = { sync: 'Síncrona', async: 'Com fila' };
const MODE = { smoke: 'rápido', tcc: 'completo' };
const SCEN = { mixed: 'uso misto', baseline: 'uso comum', fanout: 'celebridades em ação', graph_read: 'olhando o viral' };
const ROUTES = [
  ['feed', 'Ler o feed'],
  ['propagation_tree', 'Ver como um post se espalhou'],
  ['posts_create', 'Pessoa comum publica'],
  ['share', 'Pessoa comum compartilha'],
  ['celebrity_post', 'Celebridade publica'],
  ['celebrity_share', 'Celebridade compartilha'],
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
  // A aba de execução ocupa exatamente a janela; só o terminal rola.
  document.body.classList.toggle('fit', tab === 'execucao');
  if (tab === 'execucao') scrollConsole();
  if (tab === 'comparacao') renderCompare();
}
window.addEventListener('hashchange', showTab);

// ================================================================ COMO FUNCIONA

async function renderOverview() {
  let ds = null;
  try { ds = await api('/api/dataset'); } catch { /* dataset ainda não gerado */ }
  const celebs = ds?.distribution?.celebrity_followers ?? [5000, 3500, 3000, 2750, 2600, 2500, 2428, 2375, 2333, 2300, 2272, 2250, 2230, 2214, 2200, 2187, 2176, 2166, 2157, 2150];
  const common = ds?.distribution?.common_followers ?? { min: 1, max: 30, mean: 7.553, median: 4 };
  const c = ds?.counts;
  const celebSum = celebs.reduce((a, b) => a + b, 0);
  if (c?.relacoes_seguir) $('#hero-title').textContent = `20 celebridades concentram ${fmtNum((celebSum / c.relacoes_seguir) * 100, 0)}% das conexões da rede.`;
  if (c?.usuarios) $('#ds-users').textContent = fmtInt(c.usuarios);
  $('#ds-median').textContent = fmtNum(common.median, 0);
  const facts = c
    ? [['pessoas', c.usuarios], ['conexões “segue”', c.relacoes_seguir], ['posts', c.posts_criados], ['compartilhamentos', c.compartilhamentos], ['posts já entregues nos feeds', c.entradas_feed], ['posts virais', ds.distribution.viral_posts]]
    : [];
  $('#ds-facts').replaceChildren(...facts.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: fmtInt(v) }))));
  if (!c) $('#ds-facts').append(h('div', {}, h('dt', { text: 'Gere a rede simulada (scripts/viral.sh dataset) para ver os números.' })));
  drawZipf(celebs, common);
  drawDiagrams();
  drawBudgets();
  drawMix();
}

function drawZipf(celebs, common) {
  const svg = $('#zipf-chart');
  const W = 620, H = 300, L = 44, B = 28, T = 16;
  const tailW = 130, barsW = W - L - tailW - 24;
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
    svg.append(h('rect', { class: 'bar-celeb', x, y: y(v), width: bw - 4, height: y(0) - y(v), rx: 1.5 }, h('title', { text: `${i + 1}ª maior celebridade: ${fmtInt(v)} seguidores` })));
    if (i === 0 || i === celebs.length - 1) svg.append(h('text', { class: 'val', x: x + (bw - 4) / 2, y: y(v) - 6, 'text-anchor': 'middle', text: fmtInt(v) }));
  });
  svg.append(h('text', { x: L + 2, y: H - 8, text: 'maior celebridade' }));
  svg.append(h('text', { x: L + barsW - 2, y: H - 8, 'text-anchor': 'end', text: '20ª' }));
  // Cauda: 10.000 comuns. Na mesma escala, o máximo (30) mal aparece.
  const tx = L + barsW + 24;
  const hMax = Math.max(1.5, y(0) - y(common.max));
  svg.append(h('rect', { class: 'bar-common', x: tx, y: y(0) - hMax, width: tailW, height: hMax }, h('title', { text: `10.000 usuários comuns: de ${common.min} a ${common.max} seguidores` })));
  svg.append(h('text', { class: 'tail', x: tx, y: y(0) - 44, text: '10.000 pessoas comuns' }));
  svg.append(h('text', { x: tx, y: y(0) - 28, text: `metade tem até ${fmtNum(common.median, 0)} seguidores` }));
  svg.append(h('text', { x: tx, y: y(0) - 12, text: `ninguém passa de ${common.max}` }));
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
    node(10, 40, 152, 'Usuários simulados', 'k6, até 600 juntos', 'pedem e esperam'),
    node(180, 40, 154, 'Porta de entrada', 'nginx', 'divide entre 2 servidores'),
    node(360, 40, 200, 'Aplicação (2 cópias)', 'Laravel, PHP-FPM', 'processa um pedido por vez', true),
    node(640, 40, 310, 'Banco de dados', 'MySQL', 'grava o post e o feed de cada seguidor', true),
    edge('M162 76H178'), edge('M334 76H358'), edge('M560 76H638'),
    label(600, 64, 'grava tudo'),
    edge('M795 112V160H75V114', 'ret'),
    label(432, 152, 'Só responde “publicado” depois que todos os feeds foram gravados', 'strong'),
    label(432, 180, 'Uma celebridade com 5.000 seguidores significa 5.000 gravações antes da resposta'),
  );
  const a = $('#diagram-async');
  a.replaceChildren(markerDefs(),
    node(10, 56, 152, 'Usuários simulados', 'k6, até 600 juntos', 'pedem e esperam'),
    node(180, 56, 154, 'Porta de entrada', 'nginx', 'divide entre 2 servidores'),
    node(360, 56, 200, 'Aplicação (2 cópias)', 'Hyperf, Swoole', 'muitos pedidos em paralelo', true),
    node(640, 56, 310, 'Fila de pedidos', 'RabbitMQ', 'guarda o pedido até alguém processar', true),
    node(640, 180, 310, 'Processador da fila', 'worker Hyperf', 'pega até 50 pedidos e grava em lote', true),
    node(360, 180, 200, 'Banco de grafos', 'Neo4j', 'pessoas e posts ligados em rede', true),
    edge('M162 92H178'), edge('M334 92H358'), edge('M560 92H638'),
    label(600, 80, 'anota'),
    edge('M795 128V178'), label(805, 158, 'retira da fila', '', 'start'),
    edge('M640 216H562'), label(600, 206, 'grava'),
    edge('M460 128V178', 'read'), label(452, 158, 'leituras vão direto ao banco', '', 'end'),
    edge('M795 56V24H75V54', 'ret'),
    label(432, 18, 'Responde “recebido” assim que o pedido entra na fila; a entrega aos feeds vem depois', 'strong'),
    label(10, 284, 'Se o mesmo compartilhamento chegar duas vezes enquanto ainda está na fila, o processador descarta a repetição.', '', 'start'),
  );
}

function drawBudgets() {
  const parts = {
    sync: [['entrada', 0.1, 64], ['aplicação', 0.4, 640], ['banco MySQL', 1.0, 2296, true]],
    async: [['entrada', 0.1, 64], ['aplicação', 0.4, 640], ['processador', 0.3, 384], ['fila', 0.2, 512], ['banco Neo4j', 0.5, 1400, true]],
  };
  for (const [arch, list] of Object.entries(parts)) {
    const row = (name, idx, total, unit, fmt) => h('div', { class: 'budget-row' },
      h('span', { text: name }),
      h('div', { class: 'budget-bar', role: 'img', 'aria-label': `${name}: ${list.map((p) => `${p[0]} ${fmt(p[idx])}`).join(', ')}` },
        list.map((p) => h('span', { class: p[3] ? 'store' : '', style: `flex:${p[idx]} 1 0`, title: `${p[0]}: ${fmt(p[idx])}`, text: p[idx] / total < 0.06 ? '' : `${p[0]} ${fmt(p[idx])}` }))),
      h('span', { text: `${fmt(total)} ${unit}`.trim() }));
    $(`#budget-${arch}`).replaceChildren(
      row('Processador', 1, 1.5, 'CPU', (v) => fmtNum(v, 1)),
      row('Memória', 2, 3000, '', (v) => (v >= 1000 ? `${fmtNum(v / 1000, 1)} GB` : `${v} MB`)),
    );
  }
}

function drawMix() {
  const parts = [
    ['read', 35, 'Ler o feed', 'GET /feed/:id'],
    ['read', 35, 'Ver como um post se espalhou', 'GET /posts/:id/propagation-tree'],
    ['write', 12.5, 'Publicar', 'POST /posts de pessoa comum'],
    ['write', 12.5, 'Compartilhar', 'POST /posts/:id/share de pessoa comum'],
    ['celeb', 5, '', 'celebridade publica (2,5%) ou compartilha (2,5%)'],
  ];
  $('#mix-mixed').replaceChildren(...parts.map(([cls, pct, name, desc]) =>
    h('div', { class: cls, style: `flex:${pct} 1 0`, title: `${fmtNum(pct, pct % 1 ? 1 : 0)}%: ${desc}` },
      h('strong', { text: `${fmtNum(pct, pct % 1 ? 1 : 0)}%` }), name ? h('span', { text: name }) : null)));
  $('#mix-mixed').after(h('p', { class: 'mix-legend', text: 'Azul: leituras. Cinza: publicações e compartilhamentos de pessoas comuns. Mostarda: celebridades (5%), a fatia pequena que gera o maior volume de gravações.' }));
}

// ================================================================ RODAR UM TESTE

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
    title: 'Preparando o banco de dados inicial',
    desc: () => 'Apagando o que testes anteriores gravaram e restaurando a cópia limpa da rede social. Em seguida os serviços são ligados e conferidos, um por um.',
    tech: 'restauração do snapshot + docker compose up',
  },
  warmup: {
    title: 'Aquecendo o sistema',
    desc: () => 'Algumas leituras para o sistema carregar o que usa com frequência. Este trecho não entra nos resultados.',
    tech: 'warmup do k6, só leituras',
  },
  load: {
    title: 'Simulando usuários acessando ao mesmo tempo',
    desc: (p) => `Até ${p.mode === 'tcc' ? fmtInt(p.vus) : 50} usuários virtuais leem feeds, publicam e compartilham sem parar. Cada resposta é cronometrada.`,
    tech: 'carga k6',
  },
  drain: {
    title: 'Aguardando o sistema terminar o que ficou na fila',
    desc: (p) => (p.arch === 'async'
      ? 'Os usuários pararam, mas ainda há pedidos na fila. O painel conta o que já foi gravado e mede quanto tempo o sistema leva para concluir o restante.'
      : 'Os usuários pararam. O painel conta o que foi gravado e espera os números ficarem estáveis, porque pedidos abandonados ainda podem terminar de gravar.'),
    tech: 'drenagem + contagens.json',
  },
  done: { title: 'Resultado salvo', desc: () => 'Os números já aparecem na aba Resultados.', tech: 'summary.json + contagens.json' },
};

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

  // Cabeçalho
  const pill = $('#run-pill');
  pill.dataset.state = run.status;
  $('#run-pill-text').textContent = run.status === 'idle' ? 'Nenhum teste rodando'
    : active ? `Rodando (${ARCH[p.arch].toLowerCase()}): etapa ${Math.max(1, PHASES.indexOf(run.phase) + 1)} de 5` : `Último teste: ${STATUS_TEXT[run.status]?.toLowerCase()}`;

  // Painel "agora"
  const now = $('#now');
  now.dataset.state = run.status;
  let lab = 'Pronto para começar', title = 'Escolha a versão e o tipo de teste ao lado.', desc = 'As etapas abaixo acendem conforme o teste avança.', techTxt = null;
  if (run.status !== 'idle') {
    lab = `${STATUS_TEXT[run.status]}: versão ${ARCH[p.arch].toLowerCase()}, teste ${MODE[p.mode]}, ${SCEN[p.scenario]}${p.mode === 'tcc' ? `, ${fmtInt(p.vus)} usuários` : ''}`;
    if (active) { title = info?.title ?? 'Iniciando'; desc = info?.desc(p) ?? ''; techTxt = info?.tech; }
    else if (run.status === 'success') { title = 'Teste concluído e resultado salvo'; desc = 'Os números já aparecem na aba Resultados.'; }
    else if (run.status === 'thresholds_failed') { title = 'Teste concluído, mas muitas ações falharam'; desc = 'No teste rápido, 20% ou mais das ações deram erro ou demoraram demais. Os números foram salvos mesmo assim e podem ser comparados.'; techTxt = 'threshold do k6 reprovado'; }
    else if (run.status === 'aborted') { title = 'Teste interrompido'; desc = 'O teste foi parado manualmente. Os serviços continuam ligados; o próximo teste completo volta à rede original.'; }
    else if (run.status === 'failed') { title = 'O teste parou com erro'; desc = `Isso aconteceu na etapa “${PHASE_INFO[run.phase]?.title.toLowerCase() ?? 'inicial'}”. As últimas linhas do registro técnico abaixo mostram o motivo.`; }
  }
  $('#now-label').textContent = lab;
  $('#now-title').replaceChildren(title, techTxt ? tech(techTxt) : '');
  $('#now-desc').textContent = desc;

  // Etapas
  const ol = $('#phases');
  ol.dataset.status = run.status;
  const idx = PHASES.indexOf(run.phase);
  const skipRestore = p && p.mode === 'smoke' && !p.restore;
  for (const li of $$('li', ol)) {
    const ph = li.dataset.phase, i = PHASES.indexOf(ph);
    li.className = '';
    li.title = PHASE_INFO[ph].tech;
    if (run.status === 'idle') continue;
    if (ph === 'restore' && skipRestore) { li.classList.add('skipped'); li.title = 'pulada: o teste rápido continuou do banco atual'; continue; }
    if (i < idx || (run.status === 'success' && i <= idx)) li.classList.add('past');
    else if (i === idx) li.classList.add('active');
  }

  // Metadados
  const meta = $('#run-meta');
  meta.replaceChildren();
  if (run.status !== 'idle') {
    meta.append(h('span', { id: 'elapsed' }));
    if (run.resultDir) meta.append(h('span', { class: 'tech', title: 'pasta com os resultados', text: run.resultDir }));
    if (run.resultDir && !active) meta.append(h('a', { href: '#comparacao', onclick: () => { selection = [...new Set([run.resultDir, ...(selection ?? [])])]; saveSelection(); }, text: 'Ver nos resultados' }));
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
  if (el && run.startedAt) el.textContent = `Tempo total: ${fmtDur((now - run.startedAt) / 1000)}`;
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
const filters = store.get('filters', { arch: '', mode: '', scenario: '', vus: '' });
const saveSelection = () => store.set('selection', selection);

async function loadRuns() {
  try { runs = await api('/api/runs'); } catch { runs = []; }
  runsLoaded = true;
  if (selection == null) {
    // Padrão: último teste completo de cada versão, uso misto, pico viral.
    const pick = (a) => runs.find((r) => r.arch === a && r.mode === 'tcc' && r.scenario === 'mixed' && r.vus_max === 600 && r.counts);
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
$('#btn-reload').addEventListener('click', loadRuns);

const usersOf = (r) => (r.mode === 'tcc' ? r.vus_max : 50);
const runLabel = (r) => `${ARCH[r.arch]}, ${SCEN[r.scenario] ?? 'sem situação'}, ${MODE[r.mode]}${r.mode === 'tcc' && r.vus_max ? `, ${r.vus_max} usuários` : ''}`;
const runLabelFull = (r) => `${runLabel(r)} (${fmtDateShort(r.started_at)})`;
// Rótulo curto para cartões, gráficos e tabela: versão + só o que difere entre os selecionados.
function shortLabel(r, sel = selectedRuns()) {
  const vary = (f) => new Set(sel.map(f)).size > 1;
  const parts = [ARCH[r.arch]];
  if (vary((x) => x.scenario)) parts.push(SCEN[r.scenario] ?? 'sem situação');
  if (vary((x) => x.mode)) parts.push(MODE[r.mode]);
  if (vary(usersOf)) parts.push(`${usersOf(r) ?? '?'} usuários`);
  const lbl = parts.join(', ');
  return sel.filter((x) => shortBase(x, sel) === shortBase(r, sel)).length > 1 ? `${lbl} (${fmtDateShort(r.started_at)})` : lbl;
}
function shortBase(r, sel) {
  const vary = (f) => new Set(sel.map(f)).size > 1;
  return [r.arch, vary((x) => x.scenario) && r.scenario, vary((x) => x.mode) && r.mode, vary(usersOf) && usersOf(r)].join('|');
}
function commonContext(sel) {
  const same = (f) => new Set(sel.map(f)).size === 1;
  const r = sel[0], parts = [];
  if (same((x) => x.scenario)) parts.push(`situação “${SCEN[r.scenario] ?? '–'}”`);
  if (same((x) => x.mode)) parts.push(`teste ${MODE[r.mode]}`);
  if (same(usersOf)) parts.push(`${usersOf(r)} usuários simultâneos`);
  return parts.length ? `Todos os testes selecionados: ${parts.join(', ')}.` : '';
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
  const list = runs.filter((r) => (!filters.arch || r.arch === filters.arch) && (!filters.mode || r.mode === filters.mode)
    && (!filters.scenario || r.scenario === filters.scenario) && (!filters.vus || String(r.vus_max) === String(filters.vus)));
  tb.replaceChildren();
  if (!list.length) {
    tb.append(h('tr', {}, h('td', { colspan: 10, class: 'empty', text: runs.length ? 'Nenhum teste com esses filtros.' : 'Ainda não há testes salvos. Rode o primeiro na aba “Rodar um teste”.' })));
  }
  const colors = colorsFor(selectedRuns());
  for (const r of list) {
    const on = selection.includes(r.id);
    const m = r.metrics;
    const toggle = () => { selection = on ? selection.filter((x) => x !== r.id) : [...selection, r.id]; saveSelection(); renderCompare(); };
    tb.append(h('tr', { class: on ? 'sel' : '', title: r.id, onclick: (e) => { if (e.target.tagName !== 'INPUT') toggle(); } },
      h('td', {}, h('input', { type: 'checkbox', checked: on, 'aria-label': `Selecionar ${runLabelFull(r)}`, onchange: toggle })),
      h('td', {}, h('span', { class: 'tag' }, h('i', { class: 'swatch', style: `background:${on ? colors.get(r.id) : `var(--${r.arch})`}` }), ARCH[r.arch])),
      h('td', { text: MODE[r.mode] }), h('td', { text: SCEN[r.scenario] ?? '–' }), h('td', { class: 'num', text: usersOf(r) ?? '–' }),
      h('td', { text: fmtDate(r.started_at) }),
      h('td', { class: 'num', text: fmtNum(m?.rps, 1) }),
      h('td', { class: `num ${m?.fail_rate > 0.01 ? 'bad-txt' : ''}`, text: fmtPct(m?.fail_rate) }),
      h('td', { class: 'num', text: fmtMs(m?.latency?.p95) }),
      h('td', { class: 'num', text: drainText(r.counts?.drenagem) })));
  }
  $('#runs-hint').textContent = `Mostrando ${list.length} de ${runs.length} testes, ${selection.length} marcado(s). Clique numa linha para incluir ou tirar da comparação.`;
}

const selectedRuns = () => (selection ?? []).map((id) => runs.find((r) => r.id === id)).filter(Boolean);

// Definições compartilhadas por cartões e exportação.
const drainVal = (r) => (r.counts?.drenagem?.completa ? r.counts.drenagem.segundos : null);
const CARDS = [
  { title: 'Pedidos atendidos por segundo', explain: 'Quanto trabalho o sistema dá conta. Mais é melhor.', tech: 'vazão, req/s', get: (r) => r.metrics?.rps, fmt: (v) => fmtNum(v, 1) },
  { title: 'Pedidos que falharam', explain: 'Deram erro ou passaram de 30 s sem resposta. Menos é melhor.', tech: 'taxa de falha HTTP', get: (r) => r.metrics?.fail_rate, fmt: fmtPct, bad: true },
  { title: 'Tempo de resposta típico', explain: 'Metade dos pedidos foi respondida em até esse tempo.', tech: 'latência p50', get: (r) => r.metrics?.latency?.p50, fmt: fmtMs },
  { title: 'Tempo de resposta para 95% dos usuários', explain: 'Só 5% dos pedidos demoraram mais do que isso.', tech: 'latência p95', get: (r) => r.metrics?.latency?.p95, fmt: fmtMs },
  { title: 'Tempo de resposta dos mais lentos', explain: '99% dos pedidos foram respondidos até aqui.', tech: 'latência p99', get: (r) => r.metrics?.latency?.p99, fmt: fmtMs },
  {
    title: 'Tempo para concluir o que ficou pendente', explain: 'Depois que os usuários param, quanto o sistema ainda leva para terminar de gravar o que aceitou.', tech: 'drenagem', get: drainVal, fmt: fmtDur,
    note: (r) => (!r.counts ? 'não medido' : r.counts.drenagem?.completa ? null : `não terminou em ${fmtDur(r.counts.drenagem?.timeout_s)}`),
  },
  {
    title: 'Maior fila de espera', explain: 'Quantos pedidos chegaram a esperar na fila ao mesmo tempo.', tech: 'pico de mensagens no RabbitMQ', get: (r) => r.metrics?.queue_peak, fmt: fmtInt,
    note: (r) => (r.arch === 'sync' ? 'não usa fila' : null),
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
      })),
      h('span', { class: 'card-tech' }, tech(c.tech)));
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
  const H = top + ROUTES.length * (groupH + groupGap);
  const vals = ROUTES.flatMap(([k]) => sel.map((r) => get(r, k))).filter((v) => v != null);
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
  ROUTES.forEach(([k, name], gi) => {
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
    { group: 'Pedidos aceitos (o sistema respondeu “ok”)', tech: 'respostas 2xx no k6' },
    ['Publicações', fmtInt(ac?.posts), null, 'posts'],
    ['Compartilhamentos', fmtInt(ac?.shares), null, 'shares, sem os 422'],
    { group: 'Gravados no banco quando os usuários pararam', tech: 'persistidos ao fim da carga' },
    ['Publicações', fmtInt(pf?.posts), null, 'posts'],
    ['Compartilhamentos', fmtInt(pf?.shares), null, 'shares'],
    ['Posts entregues nos feeds', fmtInt(pf?.feed_items), null, 'feed_items'],
    ['Tarefas de entrega ainda pendentes', fmtInt(c?.fim_carga?.tarefas_pendentes), null, 'outbox'],
    { group: 'Gravados no banco depois que tudo foi concluído', tech: 'persistidos após drenagem' },
    ['Publicações', fmtInt(pfin?.posts), null, 'posts'],
    ['Compartilhamentos', fmtInt(pfin?.shares), null, 'shares'],
    ['Posts entregues nos feeds', fmtInt(pfin?.feed_items), null, 'feed_items'],
    ['Compartilhamentos repetidos descartados', r.arch === 'async' ? fmtInt(pfin?.shares_deduplicados) : '–', null, 'shares_deduplicados'],
    { group: 'Diferença entre gravados e aceitos', tech: 'persistidos após drenagem − aceitos' },
    ['Publicações', signed(dPosts), r.arch === 'sync' && dPosts > 0 ? late : null, 'posts'],
    ['Compartilhamentos', signed(dShares), r.arch === 'async' && dedup ? `${fmtInt(dedup)} eram repetidos e foram descartados` : r.arch === 'sync' && dShares > 0 ? late : null, 'shares'],
    ['A conta fecha?', closing, r.arch === 'async' && c ? 'aceitos menos repetidos deve ser igual a gravados' : r.arch === 'sync' && c ? 'a versão síncrona recusa repetidos na hora' : null, 'aceitos − deduplicados = persistidos'],
    { group: 'Respostas com problema', tech: 'k6' },
    ['O teste desistiu de esperar (mais de 30 s)', fmtInt(m?.timeouts), null, 'http_timeouts'],
    ['Erro do servidor', fmtInt(m?.http_5xx), null, 'HTTP 5xx'],
    ['Compartilhamento repetido recusado', fmtInt(m?.share_duplicates), null, 'HTTP 422'],
    { group: 'Conclusão do trabalho pendente', tech: 'drenagem' },
    ['Terminou?', !d ? '–' : d.completa ? 'sim' : 'não', null, 'drenagem.completa'],
    ['Quanto tempo levou', d?.completa ? fmtDur(d.segundos) : '–', null, 'drenagem.segundos'],
    ['Tempo máximo de espera', d ? fmtDur(d.timeout_s) : '–', null, 'DRAIN_TIMEOUT_S'],
    ['Pedidos que sobraram na fila', r.arch === 'async' && d ? fmtInt(d.filas_restantes) : '–', null, 'filas_restantes'],
  ];
}

function renderAudit(sel, colors) {
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
renderOverview();
showTab();
connect();
loadRuns();
