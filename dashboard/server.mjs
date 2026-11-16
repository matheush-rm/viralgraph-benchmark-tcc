#!/usr/bin/env node
// Painel local de experimentos de viralização e do baseline de leitura de perfil.
// Serve a SPA (dashboard/public), lê code/k6/results/viral-* e baseline-* e dispara
// Makefile/scripts/viral.sh com logs via Server-Sent Events.
// Não altera backends/, scripts/ nem code/k6/.
//
//   node dashboard/server.mjs            (PORT=8765, HOST=127.0.0.1)

import http from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(HERE, 'public');
const RESULTS = path.join(ROOT, 'code', 'k6', 'results');
const MANIFEST = path.join(ROOT, 'code', 'dataset', 'out', 'manifest.json');
const RUN_LOGS = path.join(HERE, 'runs');
const PORT = Number(process.env.PORT || 8765);
// Só loopback: o servidor executa comandos no host.
const HOST = process.env.HOST || '127.0.0.1';

const ARCHS = ['sync', 'async'];
const MODES = ['smoke', 'tcc'];
// kind: viral (escrita em cascata) | user_lookup (leitura de perfil, baseline de controle).
const KINDS = ['viral', 'user_lookup'];
const SCENARIOS = ['mixed', 'baseline', 'fanout', 'graph_read', 'organic', 'viral_peak'];
// organic e viral_peak têm pico de VUs fixo pelo cenário (50/300) e targets próprios no Makefile,
// que já encadeiam restore: VUS_MAX e o checkbox de restore não se aplicam a eles.
const FIXED_PROFILE = ['organic', 'viral_peak'];
const ROUTES = ['feed', 'propagation_tree', 'posts_create', 'share', 'celebrity_post', 'celebrity_share', 'user_lookup'];

// ---------------------------------------------------------------- leitura dos resultados

const DIR_VIRAL = /^viral-(sync|async)-(smoke|tcc)(?:-(baseline|fanout|graph_read|mixed|organic|viral_peak))?(?:-vus(\d+))?-(\d{8}T\d{6}Z)$/;
const DIR_BASELINE = /^baseline-(sync|async)-(smoke|tcc)-(\d{8}T\d{6}Z)$/;

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

function trend(m) {
  if (!m) return null;
  return { p50: m['p(50)'] ?? m.med ?? null, p95: m['p(95)'] ?? null, p99: m['p(99)'] ?? null, avg: m.avg ?? null, max: m.max ?? null };
}

// Rate do k6 no --summary-export: passes = amostras "true" (falhas, em http_req_failed), fails = "false".
function rate(m) {
  if (!m) return null;
  return { rate: m.value ?? null, failed: m.passes ?? 0, total: (m.passes ?? 0) + (m.fails ?? 0) };
}

function summarize(summary) {
  const M = summary?.metrics ?? {};
  const traffic = rate(M['http_req_failed{scenario:traffic}']) ?? rate(M.http_req_failed);
  const reqs = M.http_reqs;
  const durationS = reqs?.rate ? reqs.count / reqs.rate : null;
  const routes = {};
  for (const r of ROUTES) {
    const d = trend(M[`http_req_duration{name:${r}}`]);
    const f = rate(M[`http_req_failed{name:${r}}`]);
    if (d || f) routes[r] = { ...d, fail_rate: f?.rate ?? null, failed: f?.failed ?? null, count: f?.total ?? null };
  }
  const queues = {};
  for (const [k, v] of Object.entries(M)) {
    const q = /^rabbitmq_queue_depth\{queue:([^}]+)\}$/.exec(k);
    if (q) queues[q[1]] = { max: v.max ?? null, last: v.value ?? null };
  }
  const queueMaxes = Object.values(queues).map((q) => q.max).filter((x) => x != null);
  return {
    duration_s: durationS,
    requests: traffic?.total ?? reqs?.count ?? null,
    rps: traffic?.total && durationS ? traffic.total / durationS : reqs?.rate ?? null,
    fail_rate: traffic?.rate ?? null,
    failed: traffic?.failed ?? null,
    // Só o baseline de leitura mede conformidade de formato (rate==0 é o contrato).
    contract_errors: rate(M.contract_errors),
    latency: trend(M.http_req_duration),
    timeouts: M.http_timeouts?.count ?? 0,
    http_5xx: M.http_5xx?.count ?? 0,
    share_duplicates: M.share_duplicates?.count ?? 0,
    routes,
    queues,
    queue_peak: queueMaxes.length ? Math.max(...queueMaxes) : null,
  };
}

async function listRuns() {
  let names = [];
  try { names = await fs.readdir(RESULTS); } catch { return []; }
  const runs = [];
  for (const name of names) {
    const mv = DIR_VIRAL.exec(name);
    const mb = mv ? null : DIR_BASELINE.exec(name);
    if (!mv && !mb) continue;
    // baseline (user_lookup): sem contagens de escrita; metricas-antes/depois provam leitura pura.
    const kind = mb ? 'user_lookup' : 'viral';
    const dir = path.join(RESULTS, name);
    const [summary, counts, antes, depois] = await Promise.all([
      readJson(path.join(dir, 'summary.json')),
      readJson(path.join(dir, 'contagens.json')),
      mb ? readJson(path.join(dir, 'metricas-antes.json')) : null,
      mb ? readJson(path.join(dir, 'metricas.json')) : null,
    ]);
    if (!summary && !counts && !antes) continue;
    const ts = mv ? mv[5] : mb[3];
    runs.push({
      id: name,
      kind,
      arch: mv ? mv[1] : mb[1],
      mode: mv ? mv[2] : mb[2],
      scenario: mv ? mv[3] ?? counts?.cenario ?? null : null,
      vus_max: mv?.[4] ? Number(mv[4]) : counts?.vus_max ?? null,
      started_at: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}Z`,
      metrics: summary ? summarize(summary) : null,
      counts: counts ?? null,
      state: antes && depois ? { antes, depois } : null,
    });
  }
  runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return runs;
}

// ---------------------------------------------------------------- execução

const PHASES = ['restore', 'warmup', 'load', 'drain', 'done'];
let current = null; // { id, params, steps, child, phase, status, lines, clients, startedAt, endedAt, resultDir, code }
const clients = new Set();
const MAX_LINES = 5000;

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

function snapshot() {
  if (!current) return { status: 'idle' };
  const { child, logFile, lines, aborting, pgid, ...rest } = current;
  return { ...rest, line_count: lines.length };
}

function setPhase(phase) {
  if (!current || current.phase === phase) return;
  if (PHASES.indexOf(phase) < PHASES.indexOf(current.phase)) return;
  current.phase = phase;
  current.phaseAt[phase] = Date.now();
  broadcast('phase', { phase, at: current.phaseAt[phase] });
}

// Fases inferidas pelas mensagens de log de scripts/viral.sh.
function detectPhase(line) {
  if (/\[viral\] \w+: (recriando volume|volume restaurado|pronto em)/.test(line) || /Container .* (Creat|Start|Healthy|Removed|Stopp)/.test(line)) {
    if (current.phase === 'queued') setPhase('restore');
  }
  if (/k6 \w+ MODE=warmup/.test(line)) setPhase('warmup');
  const load = /\[viral\] k6 \w+ MODE=(smoke|tcc) SCENARIO=\S+ VUS_MAX=\d+ -> (\S+)/.exec(line)
    ?? /\[viral\] k6 \w+ MODE=(smoke|tcc) baseline_user_lookup -> (\S+)/.exec(line);
  if (load) { setPhase('load'); current.resultDir = path.basename(load[2]); broadcast('meta', { resultDir: current.resultDir }); }
  if (/\[viral\] (contagens ao fim da carga|drenagem \d+s)/.test(line)) setPhase('drain');
  if (/\[viral\] contagens: \{/.test(line)) setPhase('done');
  // k6 sinaliza thresholds reprovados com esta mensagem; distingue "muitas falhas" de erro real.
  if (/thresholds on metrics .* have been crossed/.test(line)) current.thresholdsCrossed = true;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

function pushLine(raw, stream) {
  const line = raw.replace(ANSI, '').replace(/\s+$/, '');
  if (!line) return;
  const entry = { t: Date.now(), s: stream, l: line };
  current.lines.push(entry);
  if (current.lines.length > MAX_LINES) current.lines.splice(0, current.lines.length - MAX_LINES);
  current.logFile?.write(`${line}\n`);
  detectPhase(line);
  broadcast('log', entry);
}

// Cada passo é [cmd, args, envExtra]. make cobre quase tudo; o baseline sem restore chama o
// script direto porque não há target "baseline sem restore" no Makefile.
function buildSteps({ kind, arch, mode, scenario, vus, restore }) {
  const make = (target, vars = {}) => ['make', [target, ...Object.entries(vars).map(([k, v]) => `${k}=${v}`)], {}];
  if (kind === 'user_lookup') {
    if (mode === 'tcc') return [make(`baseline-tcc-${arch}`)];
    if (restore) return [make(`baseline-smoke-${arch}`)];
    return [['bash', ['scripts/viral.sh', 'baseline', arch], { MODE: 'smoke' }]];
  }
  if (FIXED_PROFILE.includes(scenario)) {
    const target = scenario === 'organic' ? `viral-organic-${arch}` : `viral-peak-${arch}`;
    return [make(target, { MODE: mode })];
  }
  if (mode === 'tcc') return [make('viral-tcc', { VIRAL_ARCH: arch, SCENARIO: scenario, VUS_MAX: vus })];
  const steps = [];
  if (restore) steps.push(make('viral-restore', { VIRAL_ARCH: arch }));
  steps.push(make('viral-load', { VIRAL_ARCH: arch, MODE: 'smoke', SCENARIO: scenario }));
  return steps;
}

function runSteps(steps, i = 0) {
  if (!current) return;
  if (current.aborting || i >= steps.length) return finish(current.aborting ? 'aborted' : 'success', 0);
  const [cmd, args, envAdd] = steps[i];
  current.step = i;
  pushLine(`$ ${cmd} ${args.join(' ')}`, 'cmd');
  // detached: novo grupo de processos, para que o abort alcance make -> bash -> k6/docker.
  const child = spawn(cmd, args, { cwd: ROOT, detached: true, env: { ...process.env, FORCE_COLOR: '0', ...(envAdd ?? {}) } });
  current.child = child;
  current.pgid = child.pid;
  for (const [stream, name] of [[child.stdout, 'out'], [child.stderr, 'err']]) {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const parts = buf.split(/\r\n|\n|\r/);
      buf = parts.pop();
      for (const p of parts) pushLine(p, name);
    });
    stream.on('end', () => { if (buf) pushLine(buf, name); buf = ''; });
  }
  child.on('error', (err) => { pushLine(`erro ao iniciar ${cmd}: ${err.message}`, 'err'); finish('failed', -1); });
  // 'exit' e não 'close': um neto em segundo plano pode manter os pipes abertos após o fim do make.
  child.on('exit', (code, signal) => {
    if (!current || current.child !== child) return;
    current.child = null;
    if (current.aborting) return finish('aborted', code ?? signal);
    // viral.sh load devolve o código do k6 (thresholds reprovados) só depois de gravar contagens.json.
    // No viral, a fase já é 'done' quando o código chega; no baseline (sem drain/done) a pista é a
    // mensagem de thresholds do k6. Ambos distinguem reprovação de contrato de erro real.
    if (code !== 0) return finish(current.phase === 'done' || current.thresholdsCrossed ? 'thresholds_failed' : 'failed', code);
    runSteps(steps, i + 1);
  });
}

function finish(status, code) {
  if (!current || current.endedAt) return;
  current.status = status;
  current.code = code;
  current.endedAt = Date.now();
  if (status === 'success') setPhase('done');
  pushLine(`[painel] fim: ${status}${code != null ? ` (código ${code})` : ''}`, 'cmd');
  current.logFile?.end();
  current.logFile = null;
  broadcast('end', snapshot());
}

function startRun(params) {
  const id = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  if (!existsSync(RUN_LOGS)) mkdirSync(RUN_LOGS, { recursive: true });
  const steps = buildSteps(params);
  current = {
    id, params, status: 'running', phase: 'queued', phaseAt: {}, step: 0,
    commands: steps.map(([c, a]) => `${c} ${a.join(' ')}`),
    startedAt: Date.now(), endedAt: null, resultDir: null, code: null,
    lines: [], logFile: createWriteStream(path.join(RUN_LOGS, `${id}-${params.kind}-${params.arch}-${params.mode}${params.scenario ? `-${params.scenario}` : ''}.log`)),
  };
  broadcast('start', snapshot());
  runSteps(steps);
}

function abortRun() {
  if (!current || current.endedAt || current.aborting) return false;
  current.aborting = true;
  pushLine('[painel] abortando: SIGINT ao grupo de processos', 'cmd');
  // O grupo inteiro (make -> bash -> k6/docker) recebe o sinal; escalona enquanto restar processo.
  const run = current, pgid = run.pgid;
  const alive = () => { try { process.kill(-pgid, 0); return true; } catch { return false; } };
  const kill = (sig) => { try { process.kill(-pgid, sig); } catch { /* grupo já terminou */ } };
  kill('SIGINT');
  setTimeout(() => {
    if (!alive()) return;
    if (current === run) pushLine('[painel] processos ainda ativos após 10 s: SIGTERM', 'cmd');
    kill('SIGTERM');
    setTimeout(() => { if (alive()) { if (current === run) pushLine('[painel] SIGKILL', 'cmd'); kill('SIGKILL'); } }, 10000);
  }, 10000);
  if (!current.child) finish('aborted', null);
  return true;
}

// ---------------------------------------------------------------- HTTP

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 1e5) throw new Error('corpo grande demais'); }
  return data ? JSON.parse(data) : {};
}

function validate(b) {
  const kind = b.kind ?? 'viral';
  if (!KINDS.includes(kind)) return `kind deve ser um de: ${KINDS.join(', ')}`;
  const arch = b.arch, mode = b.mode;
  if (!ARCHS.includes(arch)) return 'arch deve ser sync ou async';
  if (!MODES.includes(mode)) return 'mode deve ser smoke ou tcc';
  // Baseline de leitura: sem situação nem degrau configurável (80 VUs smoke; 100→400→600 tcc).
  if (kind === 'user_lookup') return { kind, arch, mode, scenario: null, vus: null, restore: Boolean(b.restore) };
  const scenario = b.scenario ?? 'mixed';
  if (!SCENARIOS.includes(scenario)) return `scenario deve ser um de: ${SCENARIOS.join(', ')}`;
  // organic/viral_peak: pico fixo e restore sempre encadeado pelo target dedicado.
  if (FIXED_PROFILE.includes(scenario)) return { kind, arch, mode, scenario, vus: null, restore: true };
  const vus = b.vus == null ? 600 : Number(b.vus);
  if (!Number.isInteger(vus) || vus < 1 || vus > 5000) return 'vus deve ser inteiro entre 1 e 5000';
  return { kind, arch, mode, scenario, vus, restore: Boolean(b.restore) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/api/runs') return send(res, 200, await listRuns());
    if (req.method === 'GET' && p === '/api/dataset') return send(res, 200, await readJson(MANIFEST));
    if (req.method === 'GET' && p === '/api/status') return send(res, 200, { ...snapshot(), lines: current?.lines.slice(-1500) ?? [] });
    const logMatch = /^\/api\/runs\/([^/]+)\/log$/.exec(p);
    if (req.method === 'GET' && logMatch) {
      if (!DIR_VIRAL.test(logMatch[1]) && !DIR_BASELINE.test(logMatch[1])) return send(res, 400, { error: 'id inválido' });
      try { return send(res, 200, await fs.readFile(path.join(RESULTS, logMatch[1], 'output.log'), 'utf8'), 'text/plain; charset=utf-8'); }
      catch { return send(res, 404, { error: 'output.log ausente' }); }
    }
    if (req.method === 'GET' && p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (req.method === 'POST' && p === '/api/run') {
      if (current && !current.endedAt) return send(res, 409, { error: 'Já existe um experimento em execução. Aguarde o fim ou aborte-o.', run: snapshot() });
      const v = validate(await readBody(req));
      if (typeof v === 'string') return send(res, 400, { error: v });
      startRun(v);
      return send(res, 202, snapshot());
    }
    if (req.method === 'POST' && p === '/api/abort') {
      return abortRun() ? send(res, 202, snapshot()) : send(res, 409, { error: 'Nenhum experimento em execução.' });
    }
    if (req.method === 'GET') {
      const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
      if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'proibido' });
      try { return send(res, 200, await fs.readFile(file), MIME[path.extname(file)] ?? 'application/octet-stream'); }
      catch { return send(res, 404, { error: 'não encontrado' }); }
    }
    send(res, 405, { error: 'método não suportado' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

const shutdown = () => { if (current?.child) abortRun(); setTimeout(() => process.exit(0), current?.child ? 1500 : 0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => console.log(`painel em http://${HOST}:${PORT}  (resultados: ${path.relative(ROOT, RESULTS)})`));
