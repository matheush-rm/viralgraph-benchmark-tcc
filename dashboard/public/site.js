// Site público do TCC: narrativa por rolagem + modo apresentação. Requer d3 (global).
/* global d3 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const nf = (d) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtInt = (v) => nf(0).format(v);
const fmtNum = (v, d = 1) => nf(d).format(v);
const fmtSec = (s) => (s < 1 ? `${fmtInt(s * 1000)} ms` : `${fmtNum(s, s < 10 ? 1 : 0)} s`);

// Gerador pseudoaleatório com semente: mesma rede e mesma cascata a cada visita.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Executa `fn` uma vez, quando o elemento entra na tela.
function onView(el, fn, threshold = 0.35) {
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { threshold });
  io.observe(el);
}

// ================================================================ navegação
const slides = $$('.slide');
let current = 0;

function setupNav() {
  const dots = $('#dots');
  slides.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.title = s.dataset.title; b.setAttribute('aria-label', s.dataset.title);
    b.addEventListener('click', () => go(i));
    const li = document.createElement('li'); li.append(b); dots.append(li);
  });
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) setCurrent(slides.indexOf(e.target));
  }, { threshold: 0.5 });
  slides.forEach((s) => io.observe(s));

  const rev = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { e.target.classList.add('in'); rev.unobserve(e.target); }
  }, { threshold: 0.15 });
  $$('.reveal').forEach((el) => rev.observe(el));

  const onScroll = () => {
    const sc = document.body.classList.contains('present') ? $('#slides') : document.documentElement;
    const max = sc.scrollHeight - sc.clientHeight;
    $('#progress-bar').style.width = `${max > 0 ? (sc.scrollTop / max) * 100 : 0}%`;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  $('#slides').addEventListener('scroll', onScroll, { passive: true });
}

function setCurrent(i) {
  if (i < 0) return;
  current = i;
  $$('#dots button').forEach((b, k) => b.classList.toggle('on', k === i));
  const id = slides[i].id;
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${id}`));
  $('#hud-count').textContent = `${i + 1} / ${slides.length} · ${slides[i].dataset.title}`;
}
const go = (i) => slides[Math.max(0, Math.min(slides.length - 1, i))].scrollIntoView({ behavior: 'smooth' });

// ---------------------------------------------------------------- modo apresentação
function present(on) {
  document.body.classList.toggle('present', on);
  $('#hud').hidden = !on;
  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => {});
    slides[current].scrollIntoView();
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}
function setupPresent() {
  for (const b of [$('#btn-present'), $('#btn-present-2')]) b.addEventListener('click', () => present(true));
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('present')) present(false); });
  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('present')) return;
    if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(current + 1); }
    else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(current - 1); }
    else if (e.key === 'Escape') present(false);
  });
}

// ================================================================ capa: hub e ondas
function drawCover() {
  const svg = d3.select('#cover-graph');
  const r = rng(11), cx = 260, cy = 260;
  const leaves = [];
  [[16, 95], [24, 155], [32, 215]].forEach(([n, r0], ring) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.37 + r() * 0.15;
      const d = r0 + (r() - 0.5) * 22;
      leaves.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, ring });
    }
  });
  svg.append('g').selectAll('line').data(leaves).join('line')
    .attr('x1', cx).attr('y1', cy).attr('x2', (d) => d.x).attr('y2', (d) => d.y)
    .attr('stroke', '#d3d8de').attr('stroke-width', 0.8);
  const ripple = svg.append('g');
  const dots = svg.append('g').selectAll('circle').data(leaves).join('circle')
    .attr('cx', (d) => d.x).attr('cy', (d) => d.y).attr('r', (d) => [5, 4, 3.2][d.ring]).attr('fill', '#aab3bd');
  svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 58).attr('fill', 'var(--sync)').attr('opacity', 0.12);
  svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 40).attr('fill', 'var(--sync)');

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  const wave = () => {
    ripple.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 40).attr('fill', 'none')
      .attr('stroke', 'var(--sync)').attr('stroke-width', 2).attr('opacity', 0.6)
      .transition().duration(2600).ease(d3.easeCubicOut).attr('r', 240).attr('opacity', 0).remove();
    dots.transition().delay((d) => 280 + d.ring * 520).duration(260).attr('fill', 'var(--brand)')
      .transition().duration(900).attr('fill', '#aab3bd');
  };
  wave();
  setInterval(() => { if (!document.hidden) wave(); }, 3400);
}

// ================================================================ rede: Zipf
async function drawNetwork() {
  let ds = null;
  try { const res = await fetch('/api/dataset'); if (res.ok) ds = await res.json(); } catch { /* sem servidor */ }
  const celebs = ds?.distribution?.celebrity_followers ?? [5000, 3500, 3000, 2750, 2600, 2500, 2428, 2375, 2333, 2300, 2272, 2250, 2230, 2214, 2200, 2187, 2176, 2166, 2157, 2150];
  const common = ds?.distribution?.common_followers ?? { min: 1, max: 30, median: 4 };
  const c = ds?.counts;
  if (c?.usuarios) $('#net-users').textContent = fmtInt(c.usuarios);
  $('#net-median').textContent = fmtInt(common.median);
  if (c?.relacoes_seguir) $('#net-title').textContent = `20 pessoas têm ${fmtInt((d3.sum(celebs) / c.relacoes_seguir) * 100)}% de todos os seguidores`;
  const facts = c ? [['pessoas', c.usuarios], ['ligações “segue”', c.relacoes_seguir], ['posts', c.posts_criados], ['compartilhamentos', c.compartilhamentos], ['posts entregues em feeds', c.entradas_feed], ['posts virais', ds.distribution.viral_posts]] : [];
  $('#net-facts').replaceChildren(...facts.map(([k, v]) => {
    const d = document.createElement('div');
    d.innerHTML = `<dt>${k}</dt><dd>${fmtInt(v)}</dd>`;
    return d;
  }));

  const W = 600, H = 340, L = 46, B = 30, T = 18, tailW = 120;
  const svg = d3.select('#zipf');
  const x = d3.scaleBand().domain(d3.range(celebs.length)).range([L, W - tailW - 24]).padding(0.18);
  const y = d3.scaleLinear().domain([0, 5000]).range([H - B, T]);
  svg.append('g').selectAll('line').data([0, 2500, 5000]).join('line').attr('class', 'grid')
    .attr('x1', L).attr('x2', W).attr('y1', y).attr('y2', y);
  svg.append('g').selectAll('text').data([0, 2500, 5000]).join('text')
    .attr('x', L - 8).attr('y', (d) => y(d) + 4).attr('text-anchor', 'end').text(fmtInt);
  const bars = svg.append('g').selectAll('rect').data(celebs).join('rect').attr('class', 'celeb')
    .attr('x', (_, i) => x(i)).attr('width', x.bandwidth()).attr('y', y(0)).attr('height', 0).attr('rx', 1.5);
  bars.append('title').text((d, i) => `${i + 1}ª celebridade: ${fmtInt(d)} seguidores`);
  svg.append('text').attr('x', L).attr('y', H - 8).text('maior celebridade');
  svg.append('text').attr('x', W - tailW - 24).attr('y', H - 8).attr('text-anchor', 'end').text('20ª');
  const tx = W - tailW;
  svg.append('rect').attr('class', 'common').attr('x', tx).attr('width', tailW).attr('y', y(common.max)).attr('height', Math.max(2, y(0) - y(common.max)));
  svg.append('text').attr('class', 'tail-label').attr('x', tx).attr('y', y(0) - 46).text('10.000 pessoas comuns');
  svg.append('text').attr('x', tx).attr('y', y(0) - 30).text(`mediana ${fmtInt(common.median)} seguidores`);
  svg.append('text').attr('x', tx).attr('y', y(0) - 14).text(`máximo ${fmtInt(common.max)}`);
  const vals = svg.append('g');

  onView($('#zipf'), () => {
    bars.transition().delay((_, i) => i * 45).duration(700).ease(d3.easeCubicOut)
      .attr('y', (d) => y(d)).attr('height', (d) => y(0) - y(d))
      .on('end', (d, i) => {
        if (i === 0 || i === celebs.length - 1) vals.append('text').attr('class', 'val').attr('text-anchor', 'middle')
          .attr('x', x(i) + x.bandwidth() / 2).attr('y', y(d) - 6).text(fmtInt(d));
      });
  });
}

// ================================================================ cascata
const G = { nodes: [], links: [], followers: [] };
function buildGraph() {
  const r = rng(42), N = 260, HUBS = [1, 0.55, 0.4, 0.3];
  const followers = Array.from({ length: N }, () => []);
  const links = [];
  const pool = [];
  const follow = (a, b) => { if (a !== b && !followers[b].includes(a)) { followers[b].push(a); links.push({ source: a, target: b }); pool.push(b); } };
  const hubPick = () => { let u = r() * d3.sum(HUBS); for (let i = 0; i < HUBS.length; i++) { u -= HUBS[i]; if (u <= 0) return i; } return 0; };
  for (let i = HUBS.length; i < N; i++) {
    if (r() < 0.62) follow(i, hubPick());
    const k = 1 + (r() < 0.45 ? 1 : 0);
    for (let j = 0; j < k; j++) {
      const t = pool.length && r() < 0.6 ? pool[Math.floor(r() * pool.length)] : HUBS.length + Math.floor(r() * (i - HUBS.length + 1));
      follow(i, Math.min(t, i - 1));
    }
    pool.push(i);
  }
  const nodes = d3.range(N).map((i) => ({ id: i, deg: followers[i].length, hub: i < HUBS.length }));
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance((l) => (l.target.hub ? 70 : 22)).strength(0.35))
    .force('charge', d3.forceManyBody().strength((d) => (d.hub ? -260 : -26)))
    .force('center', d3.forceCenter(0, 0))
    .force('collide', d3.forceCollide((d) => nodeR(d) + 1.5))
    .randomSource(rng(7))
    .stop();
  for (let i = 0; i < 420; i++) sim.tick();
  const xs = d3.extent(nodes, (d) => d.x), ys = d3.extent(nodes, (d) => d.y);
  const W = 640, H = 520, m = 24;
  const s = Math.min((W - 2 * m) / (xs[1] - xs[0]), (H - 2 * m) / (ys[1] - ys[0]));
  for (const n of nodes) { n.x = m + (n.x - xs[0]) * s + ((W - 2 * m) - (xs[1] - xs[0]) * s) / 2; n.y = m + (n.y - ys[0]) * s + ((H - 2 * m) - (ys[1] - ys[0]) * s) / 2; }
  Object.assign(G, { nodes, links, followers });
}
const nodeR = (d) => (d.hub ? 7 + Math.sqrt(d.deg) * 0.9 : 2.4 + Math.sqrt(d.deg) * 0.7);

let cascadeTimers = [];
function drawCascade() {
  buildGraph();
  const svg = d3.select('#cascade');
  svg.append('g').selectAll('line').data(G.links).join('line').attr('class', 'edge')
    .attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
  svg.append('g').attr('class', 'pulses');
  svg.append('g').selectAll('circle').data(G.nodes).join('circle')
    .attr('class', (d) => `node${d.hub ? ' hub' : ''}`).attr('cx', (d) => d.x).attr('cy', (d) => d.y).attr('r', nodeR)
    .append('title').text((d) => `${d.deg} seguidores`);
  $$('[data-cascade]').forEach((b) => b.addEventListener('click', () => runCascade(b.dataset.cascade)));
  onView($('#cascade'), () => runCascade('hub'), 0.5);
}

let cascadeRun = 0;
function runCascade(kind) {
  cascadeTimers.forEach(clearTimeout); cascadeTimers = [];
  const r = rng(1000 + cascadeRun++);
  const svg = d3.select('#cascade');
  const nodeSel = svg.selectAll('circle.node').attr('class', (d) => `node${d.hub ? ' hub' : ''}`);
  const edgeSel = svg.selectAll('line.edge').classed('lit', false);
  const cands = G.nodes.filter((n) => !n.hub && n.deg >= 2 && n.deg <= 4);
  const start = kind === 'hub' ? G.nodes[0] : cands[Math.floor(r() * cands.length)];
  const P_SHARE = 0.16;
  const seen = new Set([start.id]);
  let frontier = [start.id], reach = 0, writes = 0;
  const steps = [];
  for (let g = 1; g <= 4 && frontier.length; g++) {
    const newly = [];
    for (const s of frontier) {
      writes += G.followers[s].length;
      for (const f of G.followers[s]) if (!seen.has(f)) { seen.add(f); newly.push(f); }
    }
    reach += newly.length;
    const sharers = newly.filter(() => r() < P_SHARE);
    steps.push({ g, from: new Set(frontier), newly: new Set(newly), sharers: new Set(sharers), reach, writes });
    frontier = sharers;
  }
  const set = (gen, rc, wr) => { $('#cc-gen').textContent = gen; $('#cc-reach').textContent = fmtInt(rc); $('#cc-writes').textContent = fmtInt(wr); };
  set(0, 0, 0);
  nodeSel.filter((d) => d.id === start.id).attr('class', (d) => `node${d.hub ? ' hub' : ''} origin`);
  pulse(start);
  steps.forEach((st, i) => {
    cascadeTimers.push(setTimeout(() => {
      edgeSel.filter((l) => st.from.has(l.target.id) && st.newly.has(l.source.id)).classed('lit', true);
      nodeSel.filter((d) => st.newly.has(d.id)).classed('seen', true);
      cascadeTimers.push(setTimeout(() => {
        nodeSel.filter((d) => st.sharers.has(d.id)).classed('share', true).each(pulse);
        set(st.g, st.reach, st.writes);
      }, 450));
    }, 700 + i * 1300));
  });
  if (!steps.length || !steps[0].newly.size) set(1, 0, 0);
}
function pulse(d) {
  d3.select('#cascade .pulses').append('circle').attr('class', 'pulse').attr('cx', d.x).attr('cy', d.y).attr('r', nodeR(d))
    .attr('opacity', 0.9).transition().duration(1100).attr('r', nodeR(d) + 26).attr('opacity', 0).remove();
}

// ================================================================ arquiteturas: orçamento
function drawBudgets() {
  const parts = {
    sync: { cpu: [['entrada', 0.1], ['aplicação', 0.4], ['MySQL', 1.0, 1]], mem: [['entrada', 64], ['aplicação', 640], ['MySQL', 2296, 1]] },
    async: { cpu: [['entrada', 0.1], ['aplicação', 0.4], ['worker', 0.3], ['fila', 0.2], ['Neo4j', 0.5, 1]], mem: [['entrada', 64], ['aplicação', 640], ['worker', 384], ['fila', 512], ['Neo4j', 1400, 1]] },
  };
  const mb = (v) => (v >= 1000 ? `${fmtNum(v / 1000, 1)} GB` : `${v} MB`);
  for (const el of $$('.budget')) {
    const p = parts[el.dataset.arch];
    const row = (label, list, total, fmt) => `<div class="row"><span>${label}</span><div class="bars">${list.map(([n, v, db]) => `<span class="${db ? 'db' : ''}" style="flex:${v} 1 0" title="${n}: ${fmt(v)}">${v / total > 0.12 ? `${n} ${fmt(v)}` : ''}</span>`).join('')}</div><b>${fmt(total)}</b></div>`;
    el.innerHTML = row('Processador', p.cpu, 1.5, (v) => `${fmtNum(v, 1)}`) + row('Memória', p.mem, 3000, mb);
  }
}

// ================================================================ simulação ilustrativa
// Modelo de filas simplificado. Parâmetros escolhidos para ilustrar o comportamento (não medidos).
const SIM = { DT: 0.1, RAMP: 30, LOAD_END: 90, END: 180, RATE: 25, TIMEOUT: 30, W_SYNC: 5000, W_ASYNC: 9000, ACCEPT: 0.03, SPEED: 10 };
const SCN = { organic: { celeb: 0 }, peak: { celeb: 0.2 } };
let scn = 'peak';
let simTimer = null;
let charts = null;

function newState(seed) {
  const mk = () => ({ q: [], qh: 0, ap: 0, resp: [], fails: 0, arrivals: 0, work: 0, series: [] });
  return { t: 0, acc: 0, r: rng(seed), sync: mk(), async: mk() };
}
function requestWork(r) {
  if (r() < SCN[scn].celeb) return 1 + 2150 + r() * 2850;
  return 1 + Math.min(30, 1 + Math.floor(-Math.log(1 - r()) * 6));
}
const rateAt = (t) => (t < SIM.RAMP ? (SIM.RATE * t) / SIM.RAMP : t < SIM.LOAD_END ? SIM.RATE : 0);

function step(S) {
  const t = S.t, dt = SIM.DT;
  S.acc += rateAt(t) * dt;
  while (S.acc >= 1) {
    S.acc -= 1;
    const w = requestWork(S.r);
    S.sync.q.push({ t0: t, rem: w }); S.sync.arrivals++; S.sync.work += w;
    S.async.q.push({ t0: t, rem: w }); S.async.arrivals++; S.async.work += w;
    S.async.resp.push({ t, v: SIM.ACCEPT * (0.7 + S.r() * 0.6) });
  }
  // Síncrona: FIFO; quem passa de 30 s é abandonado pelo cliente, mas continua ocupando o banco.
  const s = S.sync;
  if (s.ap < s.qh) s.ap = s.qh;
  while (s.ap < s.q.length && t - s.q[s.ap].t0 > SIM.TIMEOUT) {
    const it = s.q[s.ap];
    if (!it.gone) { it.gone = true; s.fails++; s.resp.push({ t, v: SIM.TIMEOUT }); }
    s.ap++;
  }
  drain(s, SIM.W_SYNC * dt, (it) => { if (!it.gone) s.resp.push({ t, v: t - it.t0 + 0.02 }); });
  // Eventos: resposta já foi dada na chegada; o worker drena a fila em lotes.
  drain(S.async, SIM.W_ASYNC * dt, () => {});
  S.t = +(t + dt).toFixed(3);
}
function drain(a, budget, done) {
  while (budget > 0 && a.qh < a.q.length) {
    const it = a.q[a.qh];
    const use = Math.min(budget, it.rem);
    it.rem -= use; budget -= use; a.work -= use;
    if (it.rem <= 1e-9) { a.qh++; done(it); }
  }
  if (a.qh > 5000) { a.q = a.q.slice(a.qh); a.ap = Math.max(0, a.ap - a.qh); a.qh = 0; }
}
function p95(list, t) {
  const v = list.filter((x) => x.t > t - 5).map((x) => x.v).sort((a, b) => a - b);
  while (list.length && list[0].t < t - 6) list.shift();
  return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] : null;
}

function setupCharts() {
  const mk = (sel, yMax, fmtY, limit) => {
    const W = 560, H = 220, m = { l: 44, r: 12, t: 10, b: 24 };
    const svg = d3.select(sel);
    const x = d3.scaleLinear().domain([0, SIM.END]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, yMax]).range([H - m.b, m.t]);
    svg.append('rect').attr('class', 'load-zone').attr('x', x(0)).attr('width', x(SIM.LOAD_END) - x(0)).attr('y', m.t).attr('height', H - m.b - m.t);
    svg.append('text').attr('x', x(SIM.LOAD_END) - 6).attr('y', m.t + 12).attr('text-anchor', 'end').text('chegando pedidos');
    const gx = svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat((d) => `${d} s`));
    const gy = svg.append('g').attr('transform', `translate(${m.l},0)`);
    if (limit) {
      svg.append('line').attr('class', 'limit').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(limit)).attr('y2', y(limit));
      svg.append('text').attr('class', 'limit-label').attr('x', W - m.r).attr('y', y(limit) - 5).attr('text-anchor', 'end').text('pessoa desiste (30 s)');
    }
    const ps = svg.append('path').attr('class', 'line sync');
    const pa = svg.append('path').attr('class', 'line async');
    const cur = svg.append('line').attr('class', 'cursor').attr('y1', m.t).attr('y2', H - m.b).attr('opacity', 0);
    const axisY = () => gy.call(d3.axisLeft(y).ticks(4).tickFormat(fmtY));
    axisY();
    void gx;
    return {
      update(S, key) {
        const yM = d3.max([...S.sync.series, ...S.async.series], (d) => d[key]) ?? 0;
        if (!limit && yM > y.domain()[1]) { y.domain([0, d3.max([yM * 1.2, 10])]).nice(); axisY(); }
        const line = d3.line().defined((d) => d[key] != null).x((d) => x(d.t)).y((d) => y(Math.min(d[key], y.domain()[1])));
        ps.attr('d', line(S.sync.series)); pa.attr('d', line(S.async.series));
        cur.attr('x1', x(S.t)).attr('x2', x(S.t)).attr('opacity', S.t > 0 && S.t < SIM.END ? 1 : 0);
      },
      reset() { if (!limit) { y.domain([0, yMax]); axisY(); } ps.attr('d', null); pa.attr('d', null); },
    };
  };
  charts = { resp: mk('#ch-resp', 32, (d) => `${d} s`, 30), pend: mk('#ch-pend', 100, (d) => fmtInt(d)) };
}

function renderSim(S) {
  const pend = (a) => a.q.length - a.qh;
  for (const k of ['sync', 'async']) {
    const a = S[k];
    const last = [...a.series].reverse().find((d) => d.resp != null);
    const fp = a.arrivals ? (a.fails / a.arrivals) * 100 : 0;
    $(`#k-${k}-p95`).textContent = last?.resp == null ? '–' : fmtSec(last.resp);
    $(`#k-${k}-p95`).classList.toggle('bad', (last?.resp ?? 0) >= 10);
    $(`#k-${k}-fail`).textContent = `${fmtNum(fp, fp && fp < 1 ? 1 : 0)}%`;
    $(`#k-${k}-fail`).classList.toggle('bad', fp > 1);
    $(`#k-${k}-pend`).textContent = fmtInt(pend(a));
  }
  const ps = pend(S.sync), pa = pend(S.async);
  const meter = (id, v, hot) => { const el = $(id); el.style.width = `${Math.min(100, v * 100)}%`; el.classList.toggle('hot', !!hot); };
  meter('#m-sync-app', ps / 16, ps >= 16);
  meter('#m-sync-db', S.sync.work / SIM.W_SYNC, S.sync.work > SIM.W_SYNC);
  meter('#m-async-app', rateAt(S.t) / (SIM.RATE * 2));
  meter('#m-async-q', pa / 1500);
  meter('#m-async-db', Math.min(1, S.async.work / SIM.W_ASYNC));
  const ls = [...S.sync.series].reverse().find((d) => d.resp != null)?.resp ?? 0;
  const sf = S.sync.arrivals ? S.sync.fails / S.sync.arrivals : 0;
  const status = (id, cls, text) => { const el = $(id); el.className = `status ${cls}`; el.textContent = text; };
  const done = S.t >= SIM.END - 0.05;
  if (S.t === 0) { status('#st-sync', '', 'aguardando'); status('#st-async', '', 'aguardando'); }
  else {
    if (ls >= 25) status('#st-sync', 'bad', 'travou: pessoas desistem');
    else if (ls >= 3) status('#st-sync', 'warn', 'lenta');
    else if (sf > 0.01) status('#st-sync', 'bad', done ? 'terminou com erros' : 'se recuperando');
    else status('#st-sync', 'ok', done ? 'terminou' : 'tranquilo');
    if (pa > 50) status('#st-async', 'warn', S.t > SIM.LOAD_END ? 'esvaziando a fila' : 'guardando na fila');
    else status('#st-async', 'ok', done ? 'terminou' : 'tranquilo');
  }
  charts.resp.update(S, 'resp');
  charts.pend.update(S, 'pend');
}

function runSim() {
  simTimer?.stop();
  charts.resp.reset(); charts.pend.reset();
  const S = newState(99);
  let nextSample = 0;
  renderSim(S);
  $('#sim-play').textContent = '↺ Reiniciar';
  simTimer = d3.timer((elapsed) => {
    const target = Math.min(SIM.END, (elapsed / 1000) * SIM.SPEED);
    while (S.t < target) {
      step(S);
      if (S.t >= nextSample) {
        for (const k of ['sync', 'async']) S[k].series.push({ t: S.t, resp: p95(S[k].resp, S.t), pend: S[k].q.length - S[k].qh });
        nextSample += 1;
      }
    }
    renderSim(S);
    if (S.t >= SIM.END) simTimer.stop();
  });
}

function setupSim() {
  setupCharts();
  $('#sim-play').addEventListener('click', runSim);
  $$('[data-scn]').forEach((b) => b.addEventListener('click', () => {
    scn = b.dataset.scn;
    $$('[data-scn]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    runSim();
  }));
  onView($('#pico .sim-grid'), runSim, 0.4);
}

// ================================================================ resultados (tabela do artigo)
const RESULTS = [
  {
    id: 'lookup', name: 'Busca de perfil', n: 4,
    desc: 'Pessoas só abrindo perfis, sem postar nada. É o caso mais simples.',
    read: 'Aqui o síncrono atende mais pedidos por segundo. Abrir um perfil é leve, então não compensa usar fila.',
    sync: { rps: [56.2, 27.1], p95: [4.0943, 3.9658], fail: [0, 0], q: null, dr: null },
    async: { rps: [36.5, 3.5], p95: [4.3495, 0.3326], fail: [0, 0], q: null, dr: null },
  },
  {
    id: 'organic', name: 'Viralização orgânica', n: 4,
    desc: 'Pessoas comuns postando e compartilhando, sem celebridades.',
    read: 'Os dois funcionam bem. Cada post vai para poucos feeds, então o síncrono dá conta sozinho. O com fila também vai bem, mas acumula um pouco de trabalho para depois.',
    sync: { rps: [37.0, 2.0], p95: [2.1473, 0.062], fail: [0.05, 0.06], q: [0, 0], dr: [5, 0] },
    async: { rps: [20.9, 5.7], p95: [3.584, 1.0668], fail: [0, 0], q: [301, 93], dr: [43, 21] },
  },
  {
    id: 'peak', name: 'Pico de viralização', n: 3,
    desc: '20 celebridades postam e o conteúdo viraliza em ondas.',
    read: 'O síncrono trava: atende poucos pedidos e as pessoas esperam quase 30 s. O com fila responde em ~3 s sem erros, mas leva uns 6 minutos para entregar tudo nos feeds.',
    sync: { rps: [5.2, 0.5], p95: [29.7477, 0.4376], fail: [6.84, 1.69], q: [0, 0], dr: [57, 1] },
    async: { rps: [21.4, 2.3], p95: [3.1396, 0.6115], fail: [0, 0], q: [618, 39], dr: [386, 16] },
  },
];
// Domínio fixo por métrica em todos os cenários: a troca de aba mostra a inversão real.
const METRICS = [
  { k: 'rps', title: 'Pedidos atendidos', unit: 'por segundo · maior é melhor', max: 85, fmt: (v) => fmtNum(v, 1) },
  { k: 'p95', title: 'Tempo de espera', unit: 'segundos · menor é melhor', max: 32, fmt: (v) => fmtNum(v, 1) },
  { k: 'fail', title: 'Pedidos com erro', unit: '% · menor é melhor', max: 9, fmt: (v) => fmtNum(v, 2) },
  { k: 'q', title: 'Trabalho na fila', unit: 'no pior momento', max: 680, fmt: (v) => fmtInt(v) },
  { k: 'dr', title: 'Tempo para terminar', unit: 'segundos após o fim dos pedidos', max: 420, fmt: (v) => fmtInt(v) },
];
let resIdx = 2;

function setupResults() {
  const tabs = $('#res-tabs');
  RESULTS.forEach((r, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.role = 'tab'; b.textContent = r.name;
    b.addEventListener('click', () => { resIdx = i; renderResults(); });
    tabs.append(b);
  });
  const box = $('#res-charts');
  for (const m of METRICS) {
    const div = document.createElement('div');
    div.className = 'metric';
    div.innerHTML = `<h4>${m.title} <small>${m.unit}</small></h4><svg viewBox="0 0 300 78" data-k="${m.k}"></svg>`;
    box.append(div);
    const svg = d3.select(div).select('svg');
    const x = d3.scaleLinear().domain([0, m.max]).range([78, 250]);
    ['sync', 'async'].forEach((a, i) => {
      const g = svg.append('g').attr('class', `r-${a}`).attr('transform', `translate(0,${8 + i * 34})`);
      g.append('text').attr('class', 'lbl').attr('x', 0).attr('y', 15).text(a === 'sync' ? 'Síncrono' : 'Com fila');
      g.append('rect').attr('class', `mbar ${a}`).attr('x', x(0)).attr('y', 2).attr('height', 20).attr('width', 0).attr('rx', 2);
      g.append('line').attr('class', 'err');
      g.append('text').attr('class', 'val').attr('y', 16);
    });
    m.x = x; m.svg = svg;
  }
  renderResults();
}

function renderResults() {
  const R = RESULTS[resIdx];
  $$('#res-tabs button').forEach((b, i) => b.setAttribute('aria-selected', String(i === resIdx)));
  $('#res-desc').textContent = R.desc;
  $('#res-read').textContent = R.read;
  $('#res-n').textContent = `${R.n} rodadas por arquitetura.`;
  for (const m of METRICS) {
    ['sync', 'async'].forEach((a) => {
      const g = m.svg.select(`.r-${a}`);
      const v = R[a][m.k];
      const x = m.x;
      const t = d3.transition().duration(650).ease(d3.easeCubicInOut);
      if (!v) {
        g.select('rect').transition(t).attr('width', 0);
        g.select('line').attr('opacity', 0);
        g.select('.val').attr('class', 'val na').attr('x', x(0) + 4).text('não se aplica');
        return;
      }
      const [mean, sd] = v;
      const lo = Math.max(0, mean - sd), hi = Math.min(m.max, mean + sd);
      g.select('rect').transition(t).attr('width', Math.max(1.5, x(mean) - x(0)));
      g.select('line').attr('opacity', sd ? 1 : 0).transition(t).attr('x1', x(lo)).attr('x2', x(hi)).attr('y1', 12).attr('y2', 12);
      const label = m.k === 'q' && a === 'sync' ? 'sem fila' : `${m.fmt(mean)}${sd ? ` ± ${m.fmt(sd)}` : ''}`;
      g.select('.val').attr('class', 'val').transition(t).attr('x', Math.max(x(mean), x(hi)) + 6).text(label);
    });
  }
}

// ================================================================ início
setupNav();
setupPresent();
drawCover();
drawNetwork();
drawCascade();
drawBudgets();
setupSim();
setupResults();
