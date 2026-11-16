// Carga de viralização sobre o snapshot Zipf (code/dataset/generate.py).
//
//   MODE=smoke  30 s, 50 VUs constantes: valida rotas (falhas HTTP < 20%) e coleta de métricas.
//   MODE=tcc    rampa até VUS_MAX (padrão 600) em 3 min: coleta para a monografia.
//   MODE=warmup aquecimento só de leitura após o restore (fora da medição): uma passada pelas
//               árvores de todos os posts virais e pelos feeds de todos os usuários comuns.
//
// SCENARIO seleciona a mistura por iteração (padrão mixed):
//   baseline    80% feed de comum | 20% escrita de comuns (metade post, metade share)
//   fanout      80% celebridades (metade post, metade share; fan-out 2000+) | 20% feed de comum
//   graph_read  90% árvore de propagação de post viral (Zipf no ranking) | 10% feed de comum
//   mixed       70% leitura (metade feed, metade árvore) | 25% escrita de comuns |
//               5% celebridade (metade post, metade share)
//   organic     70% leitura (metade feed, metade árvore) | 30% escrita de comuns na razão 25:5
//               (share:post comum); sem nenhuma ação de celebridade. Executor ramping-vus.
//   viral_peak  cascata em fases (aquecimento, pico de centralidade, platô, resfriamento); a
//               mistura muda por fase conforme o tempo decorrido da carga. Executor ramping-vus.
//
// Env: BASE_URL, ARCH=sync|async, SCENARIO, DATASET (k6/dataset.json), RABBITMQ_METRICS_URL (opcional),
//      VUS_MAX, THINK_MIN_MS, THINK_MAX_MS, ZIPF_S, WARMUP_VUS.
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { scenario } from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

const MODE = (__ENV.MODE || 'smoke').toLowerCase();
const ARCH = (__ENV.ARCH || 'sync').toLowerCase();
const SCENARIO = (__ENV.SCENARIO || 'mixed').toLowerCase();
const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:19998').replace(/\/$/, '');
const QUEUE_URL = __ENV.RABBITMQ_METRICS_URL || '';
const VUS_MAX = parseInt(__ENV.VUS_MAX || '600', 10);
const THINK_MIN = parseInt(__ENV.THINK_MIN_MS || '50', 10);
const THINK_MAX = parseInt(__ENV.THINK_MAX_MS || '250', 10);
const ZIPF_S = parseFloat(__ENV.ZIPF_S || '1.1');
const WARMUP_VUS = parseInt(__ENV.WARMUP_VUS || '10', 10);
if (!['smoke', 'tcc', 'warmup'].includes(MODE)) throw new Error(`MODE inválido: ${MODE}`);
if (!['sync', 'async'].includes(ARCH)) throw new Error(`ARCH inválido: ${ARCH}`);
const SCENARIOS = ['baseline', 'fanout', 'graph_read', 'mixed', 'organic', 'viral_peak'];
if (!SCENARIOS.includes(SCENARIO)) throw new Error(`SCENARIO inválido: ${SCENARIO} (${SCENARIOS.join('|')})`);

// Sync confirma persistência (201); async confirma só a aceitação no broker (202).
const SHARE_OK = ARCH === 'sync' ? 201 : 202;

// Um SharedArray por coleção: o acesso a um elemento desserializa só aquele elemento.
// (Um único elemento com o dataset inteiro seria re-desserializado a cada acesso.)
const load = () => JSON.parse(open(__ENV.DATASET));
const commonUsers = new SharedArray('common_users', () => load().common_users);
const celebrities = new SharedArray('celebrities', () => load().celebrities);
const viralPosts = new SharedArray('viral_posts', () => load().viral_posts);

const shareDuplicates = new Counter('share_duplicates');
const serverErrors = new Counter('http_5xx');
const timeouts = new Counter('http_timeouts'); // status 0: timeout do k6 (30 s) ou conexão recusada
const actions = new Counter('actions');
const queueDepth = new Gauge('rabbitmq_queue_depth');
// Soma de todas as filas por amostra, como Trend: o summary-export expõe o max confiável (um
// Gauge guardaria só o último valor amostrado, não o pico). Ver scripts/viral.sh write_counts.
const queueTotal = new Trend('rabbitmq_queue_total');
const businessOk = new Rate('business_ok');

const ROUTES = ['feed', 'propagation_tree', 'posts_create', 'share', 'celebrity_post', 'celebrity_share'];
const thresholds = MODE === 'warmup' ? {
  // Só para o resumo imprimir p50/p95/p99 por rota; o aquecimento não reprova.
  'http_req_duration{name:feed}': ['p(99)>=0'],
  'http_req_duration{name:propagation_tree}': ['p(99)>=0'],
  http_5xx: ['count>=0'],
  http_timeouts: ['count>=0'],
} : {
  // Smoke valida integridade do fluxo, não desempenho: 50 VUs com share de celebridade já saturam
  // (503 por timeout do Neo4j no async; deadlock 1213 do MySQL e timeout no sync). Reprova só se
  // 20% ou mais das requisições falharem (rota quebrada). No tcc, saturação é resultado, não erro.
  'http_req_failed{scenario:traffic}': MODE === 'smoke' ? ['rate<0.20'] : ['rate>=0'],
  http_5xx: ['count>=0'],
  http_timeouts: ['count>=0'],
  business_ok: ['rate>=0'],
};
// Thresholds sempre verdadeiros só para o resumo imprimir p50/p95/p99 e erro por rota.
for (const route of MODE === 'warmup' ? [] : ROUTES) {
  thresholds[`http_req_duration{name:${route}}`] = ['p(99)>=0'];
  thresholds[`http_req_failed{name:${route}}`] = ['rate>=0'];
}

// Durações das stages (em segundos) por MODE para os cenários com fases. Os limites cumulativos
// derivam destes arrays (sem duplicar números): ver phaseOf(). As stages do executor usam os
// mesmos valores, convertidos para string de duração.
const dur = s => `${s}s`;
// viral_peak: 5 fases — aquecimento, pico de centralidade, platô, queda rápida e sustentação (as
// duas últimas são o resfriamento). Pico fixo (50 smoke / 300 tcc), independente de VUS_MAX.
const VIRAL_PEAK_STAGES = {
  smoke: [{ d: 10, t: 10 }, { d: 15, t: 50 }, { d: 15, t: 50 }, { d: 2, t: 5 }, { d: 13, t: 5 }],
  tcc: [{ d: 60, t: 50 }, { d: 90, t: 300 }, { d: 150, t: 300 }, { d: 5, t: 5 }, { d: 55, t: 5 }],
};
// organic: rampa suave de usuários comuns; pico fixo (50 smoke / 300 tcc), independente de VUS_MAX.
const ORGANIC_STAGES = {
  smoke: [{ d: 20, t: 50 }, { d: 20, t: 50 }],
  tcc: [{ d: 60, t: 150 }, { d: 60, t: 300 }, { d: 150, t: 300 }, { d: 30, t: 0 }],
};
const toStages = defs => defs.map(({ d, t }) => ({ duration: dur(d), target: t }));

// Constrói o executor da carga em função de (MODE, SCENARIO). organic e viral_peak usam ramping-vus
// com rampa própria; os demais cenários mantêm constant-vus no smoke e a rampa padrão até VUS_MAX.
function buildTrafficScenario() {
  if (SCENARIO === 'organic') {
    return {
      executor: 'ramping-vus', exec: 'traffic', startVUs: 0, gracefulRampDown: '10s',
      stages: toStages(ORGANIC_STAGES[MODE] || ORGANIC_STAGES.smoke),
    };
  }
  if (SCENARIO === 'viral_peak') {
    return {
      executor: 'ramping-vus', exec: 'traffic', startVUs: 0, gracefulRampDown: '10s',
      stages: toStages(VIRAL_PEAK_STAGES[MODE] || VIRAL_PEAK_STAGES.smoke),
    };
  }
  return MODE === 'smoke'
    ? { executor: 'constant-vus', vus: 50, duration: '30s', exec: 'traffic' }
    : {
      executor: 'ramping-vus', exec: 'traffic', startVUs: 0, gracefulRampDown: '30s',
      // 3 min por cenário: 30 s até VUS_MAX/2, 30 s até VUS_MAX, 1m30 de patamar, 30 s de descida.
      stages: [
        { duration: '30s', target: Math.round(VUS_MAX / 2) },
        { duration: '30s', target: VUS_MAX },
        { duration: '1m30s', target: VUS_MAX },
        { duration: '30s', target: 0 },
      ],
    };
}
const trafficScenario = buildTrafficScenario();

// Duração da sonda de fila por (MODE, SCENARIO): deve cobrir toda a janela de carga e uma folga,
// para não encerrar antes do fim. organic smoke ~50s / tcc ~5m30; viral_peak smoke ~55s / tcc ~6m10.
function queueProbeDuration() {
  if (SCENARIO === 'organic') return MODE === 'smoke' ? '50s' : '5m30s';
  if (SCENARIO === 'viral_peak') return MODE === 'smoke' ? '55s' : '6m10s';
  return MODE === 'smoke' ? '40s' : '3m30s';
}

// Aquecimento: cada iteração lê um item fixo (árvores virais primeiro, depois feeds), sem repetição.
const WARMUP_ITERATIONS = viralPosts.length + commonUsers.length;
const scenarios = MODE === 'warmup'
  ? { warmup: { executor: 'shared-iterations', exec: 'warmup', vus: WARMUP_VUS,
      iterations: WARMUP_ITERATIONS, maxDuration: '30m' } }
  : { traffic: trafficScenario };
if (QUEUE_URL && MODE !== 'warmup') {
  for (const queue of ['posts', 'distribution', 'shares']) {
    thresholds[`rabbitmq_queue_depth{queue:${queue}}`] = ['value>=0'];
  }
  thresholds['rabbitmq_queue_total'] = ['max>=0'];
  scenarios.queue = {
    executor: 'constant-vus', exec: 'queueProbe', vus: 1,
    duration: queueProbeDuration(),
  };
}

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ['avg', 'min', 'p(50)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: false,
};

// Zipf sobre o ranking de posts virais (maior cascata primeiro): poucos posts concentram a leitura.
let viralCdf = null;
function zipfIndex(n) {
  if (!viralCdf) {
    const weights = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, ZIPF_S));
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    viralCdf = weights.map(w => (acc += w / total));
  }
  const r = Math.random();
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (viralCdf[mid] < r) lo = mid + 1; else hi = mid;
  }
  return lo;
}
const pick = list => list[Math.floor(Math.random() * list.length)];
const viralPost = () => viralPosts[zipfIndex(viralPosts.length)];

function call(method, path, body, name, expected) {
  const res = http.request(method, `${BASE}${path}`, body ? JSON.stringify(body) : null, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name },
    timeout: '30s',
    responseCallback: http.expectedStatuses(...expected),
  });
  if (res.status >= 500) serverErrors.add(1, { name });
  if (res.status === 0) timeouts.add(1, { name });
  return res;
}

function readFeed() {
  const res = call('GET', `/feed/${pick(commonUsers)}`, null, 'feed', [200]);
  businessOk.add(check(res, {
    'feed 200': r => r.status === 200,
    'feed envelope': r => r.status === 200 && Array.isArray(r.json('data')),
  }));
}

function readTree() {
  const post = viralPost();
  const res = call('GET', `/posts/${post.id}/propagation-tree`, null, 'propagation_tree', [200]);
  businessOk.add(check(res, {
    'tree 200': r => r.status === 200,
    'tree autor': r => r.status === 200 && r.json('autor_id') === post.author,
  }));
}

function createPost(author, name) {
  const res = call('POST', '/posts', { usuario_id: author, conteudo: `viral k6 ${__VU}-${__ITER}` }, name, [201]);
  businessOk.add(check(res, { [`${name} 201`]: r => r.status === 201 }));
}

// Celebridade compartilha post viral alheio com origem = autor (nível 1): fan-out para os 2000+
// seguidores dela. Celebridades não seguem ninguém, então o feed delas é vazio: o post vem do pool
// global de posts virais do snapshot (sorteio uniforme, para espalhar os pares e adiar o
// esgotamento), não do feed. A API não exige o post no feed, só origem válida. Cada par
// (celebridade, post) só vale uma vez; repetições viram 422 (share_duplicates).
function celebrityShare() {
  const user = pick(celebrities);
  let post = pick(viralPosts);
  for (let i = 0; i < 5 && post.author === user; i++) post = pick(viralPosts);
  if (post.author === user) return;
  const res = call('POST', `/posts/${post.id}/share`, { usuario_id: user, origem_usuario_id: post.author },
    'celebrity_share', [SHARE_OK, 422]);
  if (res.status === 422) shareDuplicates.add(1, { name: 'celebrity_share' });
  businessOk.add(check(res, {
    [`celebrity_share ${SHARE_OK}|422`]: r => r.status === SHARE_OK || r.status === 422,
  }));
}

// Compartilhamento válido: usuário que tem o post viral no feed, com origem = quem o entregou
// (autor => nível 1; compartilhador => níveis seguintes da árvore). Repetições viram 422.
function share(name) {
  let post = viralPost();
  for (let i = 0; i < 5 && !post.receivers.length; i++) post = viralPost();
  if (!post.receivers.length) return;
  const [user, source] = pick(post.receivers);
  const res = call('POST', `/posts/${post.id}/share`, { usuario_id: user, origem_usuario_id: source },
    name, [SHARE_OK, 422]);
  if (res.status === 422) shareDuplicates.add(1, { name });
  businessOk.add(check(res, { [`${name} ${SHARE_OK}|422`]: r => r.status === SHARE_OK || r.status === 422 }));
}

const half = (a, b) => () => (Math.random() < 0.5 ? a() : b());
const commonWrite = half(() => createPost(pick(commonUsers), 'posts_create'), () => share('share'));
// Escrita orgânica de comuns na razão explícita 25:5 (share : post comum) dentro dos 30% de escrita
// do cenário organic. Nenhuma ação de celebridade é alcançável neste cenário.
const organicWrite = () => (Math.random() < (0.25 / 0.30)
  ? share('share')
  : createPost(pick(commonUsers), 'posts_create'));
// Celebridade publica: fan-out imediato para 2000+ seguidores (síncrono no Laravel; fila no Hyperf).
const celebrityPost = () => createPost(pick(celebrities), 'celebrity_post');
const celebrityAction = half(celebrityPost, celebrityShare);

// Cada cenário: [probabilidade acumulada, rótulo de actions{kind}, ação].
const MIXES = {
  baseline: [[0.80, 'read', readFeed], [1, 'common_write', commonWrite]],
  fanout: [[0.80, 'celebrity', celebrityAction], [1, 'read', readFeed]],
  graph_read: [[0.90, 'read', readTree], [1, 'read', readFeed]],
  mixed: [
    [0.70, 'read', half(readFeed, readTree)],
    [0.95, 'common_write', commonWrite],
    [1, 'celebrity', celebrityAction],
  ],
  // 70% leitura (metade feed, metade árvore) | 30% escrita de comuns na razão 25:5 (share:post).
  // Sem celebridade: o efeito manada do pico de centralidade fica isolado no viral_peak.
  organic: [
    [0.70, 'read', half(readFeed, readTree)],
    [1, 'common_write', organicWrite],
  ],
  // Mix base seguro (igual ao mixed) só para passar a validação do enum; a seleção real por fase
  // de viral_peak vem de VIRAL_PEAK_MIX em traffic(), derivada do tempo decorrido da carga.
  viral_peak: [
    [0.70, 'read', half(readFeed, readTree)],
    [0.95, 'common_write', commonWrite],
    [1, 'celebrity', celebrityAction],
  ],
};
const MIX = MIXES[SCENARIO];

// Mix por fase do viral_peak, rotulado em actions{kind} para rastreabilidade no output.log:
//   warmup          aquecimento: comuns + leitura, sem celebridade;
//   peak_celebrity  pico de centralidade / efeito manada: celebridade + share/leitura de árvore;
//   plateau         platô de saturação: escrita+leitura alta com peso de celebridade (tipo mixed);
//   cooldown        resfriamento: só leitura leve (feed/árvore).
// cascade é usado como rótulo das ações de propagação dentro do pico (share/leitura de árvore).
const VIRAL_PEAK_MIX = {
  warmup: [
    [0.70, 'warmup', half(readFeed, readTree)],
    [1, 'warmup', organicWrite],
  ],
  peak: [
    [0.50, 'peak_celebrity', celebrityAction],
    [0.80, 'cascade', () => share('share')],
    [1, 'cascade', half(readTree, readFeed)],
  ],
  plateau: [
    [0.60, 'plateau', half(readFeed, readTree)],
    [0.85, 'plateau', commonWrite],
    [1, 'plateau', celebrityAction],
  ],
  cooldown: [
    [1, 'cooldown', half(readFeed, readTree)],
  ],
};

// Limites cumulativos (em segundos) das stages do MODE corrente, para mapear o tempo decorrido da
// carga à fase. Derivados das durações de VIRAL_PEAK_STAGES, sem duplicar os números.
const VIRAL_PEAK_DURS = (VIRAL_PEAK_STAGES[MODE] || VIRAL_PEAK_STAGES.smoke).map(s => s.d);
const VIRAL_PEAK_BOUNDS = VIRAL_PEAK_DURS.reduce((acc, d) => {
  acc.push((acc.length ? acc[acc.length - 1] : 0) + d);
  return acc;
}, []);
// Fase de cada uma das 5 stages: [aquecimento, pico, platô, resfriamento, resfriamento].
const VIRAL_PEAK_PHASES = ['warmup', 'peak', 'plateau', 'cooldown', 'cooldown'];

function viralPeakMix() {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  let idx = VIRAL_PEAK_BOUNDS.findIndex(b => elapsed < b);
  if (idx < 0) idx = VIRAL_PEAK_PHASES.length - 1; // após o fim previsto: última fase (resfriamento).
  return VIRAL_PEAK_MIX[VIRAL_PEAK_PHASES[idx]];
}

export function traffic() {
  const mix = SCENARIO === 'viral_peak' ? viralPeakMix() : MIX;
  const r = Math.random();
  const [, kind, action] = mix.find(([p]) => r < p) || mix[mix.length - 1];
  action();
  actions.add(1, { kind });
  sleep((THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)) / 1000);
}

// Só GET: aquece page cache/buffer pool e workers sem alterar o estado restaurado do snapshot.
export function warmup() {
  const i = scenario.iterationInTest;
  if (i < viralPosts.length) {
    call('GET', `/posts/${viralPosts[i].id}/propagation-tree`, null, 'propagation_tree', [200]);
  } else {
    call('GET', `/feed/${commonUsers[i - viralPosts.length]}`, null, 'feed', [200]);
  }
}

// Lê o endpoint Prometheus do RabbitMQ e publica, a cada amostra de 1 s: a profundidade de cada
// fila (rabbitmq_queue_depth{queue}) e a soma de todas as filas (rabbitmq_queue_total, Trend). O
// summary-export expõe o max desse Trend como pico de fila observado pelo k6; scripts/viral.sh o
// combina com o pico medido durante a drenagem (pico_fila = max(k6, drenagem)).
export function queueProbe() {
  const res = http.get(QUEUE_URL, { tags: { name: 'rabbitmq_probe' }, timeout: '5s' });
  if (res.status === 200 && res.body) {
    let total = 0;
    for (const line of res.body.split('\n')) {
      const m = /^rabbitmq_queue_messages\{([^}]*)\}\s+([0-9.eE+-]+)/.exec(line);
      if (!m) continue;
      const value = parseFloat(m[2]);
      const queue = /queue="([^"]+)"/.exec(m[1]);
      if (queue) queueDepth.add(value, { queue: queue[1] });
      total += value;
    }
    queueTotal.add(total);
  }
  sleep(1);
}
