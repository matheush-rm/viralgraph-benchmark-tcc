// Baseline (controle): busca de perfil de usuário por ID sob alta concorrência.
//
//   MODE=smoke  rampa rápida até 80 VUs em ~40 s: validação local de contrato.
//   MODE=tcc    rampa progressiva 100 -> 400 -> 600 VUs em ~5 min: coleta oficial
//               e verificação de estabilidade de memória (plataformas por degrau).
//
// Uma única rota: GET /usuarios/{id} (contrato em code/docs/openapi.yaml, schema Usuario).
// Distribuição de acesso Pareto 80/20 sobre os 10.020 usuários determinísticos do
// dataset seed 42 (code/dataset/generate.py): 80% das requisições consultam o hot set
// (500 usuários: 20 celebridades + 480 primeiros usuários comuns, em ordem de criação)
// e 20% sorteiam uniformemente entre todos os 10.020.
//
// Env: BASE_URL, MODE, DATASET (k6/dataset.json), HOT_SET, THINK_MIN_MS, THINK_MAX_MS.
// Think time padrão 0: pressão de leitura sustentada (modelo fechado em velocidade máxima).
// Remote write para o Prometheus segue viral.js: ativado pelo runner quando :9090 responde.
import http from 'k6/http';
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate } from 'k6/metrics';

const MODE = (__ENV.MODE || 'smoke').toLowerCase();
const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:19998').replace(/\/$/, '');
const HOT_SET = parseInt(__ENV.HOT_SET || '500', 10);
const THINK_MIN = parseInt(__ENV.THINK_MIN_MS || '0', 10);
const THINK_MAX = parseInt(__ENV.THINK_MAX_MS || '0', 10);
if (!['smoke', 'tcc'].includes(MODE)) throw new Error(`MODE inválido: ${MODE}`);
if (!(HOT_SET > 0)) throw new Error(`HOT_SET inválido: ${HOT_SET}`);

// Um SharedArray por coleção: o acesso a um elemento desserializa só aquele elemento.
// hot/all são construídos a partir da mesma carga do dataset (ordem de criação: celebridades
// primeiro, depois os comuns; o hot set cobre exatamente as posições 1..HOT_SET).
const load = () => JSON.parse(open(__ENV.DATASET));
const hotUsers = new SharedArray('hot_users', () => {
  const data = load();
  return data.celebrities.concat(data.common_users.slice(0, Math.max(0, HOT_SET - data.celebrities.length)));
});
const allUsers = new SharedArray('all_users', () => {
  const data = load();
  return data.celebrities.concat(data.common_users);
});

const contractErrors = new Rate('contract_errors');
const serverErrors = new Counter('http_5xx');
const timeouts = new Counter('http_timeouts'); // status 0: timeout do k6 (30 s) ou conexão recusada
const lookups = new Counter('user_lookups'); // tags set=hot|cold para conferir o Pareto 80/20

// Thresholds do cenário (iguais em smoke e tcc). Os auxiliares sempre verdadeiros
// existem para o resumo imprimir p50/p95/p99 e taxa de erro por rota.
const thresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  contract_errors: ['rate==0'],
  http_5xx: ['count>=0'],
  http_timeouts: ['count>=0'],
  user_lookups: ['count>=0'],
  'http_req_duration{name:user_lookup}': ['p(99)>=0'],
  'http_req_failed{name:user_lookup}': ['rate>=0'],
};

const trafficScenario = MODE === 'smoke'
  ? {
    executor: 'ramping-vus', exec: 'traffic', startVUs: 0, gracefulRampDown: '5s',
    stages: [
      { duration: '10s', target: 80 },
      { duration: '25s', target: 80 },
      { duration: '5s', target: 0 },
    ],
  }
  : {
    executor: 'ramping-vus', exec: 'traffic', startVUs: 0, gracefulRampDown: '30s',
    stages: [
      { duration: '20s', target: 100 },
      { duration: '40s', target: 100 },
      { duration: '30s', target: 400 },
      { duration: '60s', target: 400 },
      { duration: '30s', target: 600 },
      { duration: '90s', target: 600 },
      { duration: '30s', target: 0 },
    ],
  };

export const options = {
  scenarios: { traffic: trafficScenario },
  thresholds,
  summaryTrendStats: ['avg', 'min', 'p(50)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: false,
};

const pick = list => list[Math.floor(Math.random() * list.length)];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Limites medidos em pontos de código Unicode, conforme o contrato.
function isTextInRange(value, min, max) {
  return typeof value === 'string'
    && /\S/.test(value)
    && Array.from(value).length >= min
    && Array.from(value).length <= max;
}

// Schema Usuario (openapi.yaml): id UUID, nome 1..32, apelido 1..100, nascimento AAAA-MM-DD.
// Todos obrigatórios; null, ausência ou tipo errado são erro de contrato.
function contractOk(res, id) {
  if (res.status !== 200) return false;
  let body;
  try { body = res.json(); } catch (error) { return false; }
  return body != null
    && body.id === id
    && UUID_RE.test(body.id)
    && isTextInRange(body.nome, 1, 32)
    && isTextInRange(body.apelido, 1, 100)
    && typeof body.nascimento === 'string'
    && DATE_RE.test(body.nascimento);
}

export function traffic() {
  const hot = Math.random() < 0.8;
  const id = pick(hot ? hotUsers : allUsers);
  lookups.add(1, { set: hot ? 'hot' : 'cold' });

  const res = http.get(`${BASE}/usuarios/${id}`, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'user_lookup' },
    timeout: '30s',
    responseCallback: http.expectedStatuses(200),
  });
  if (res.status >= 500) serverErrors.add(1, { name: 'user_lookup' });
  if (res.status === 0) timeouts.add(1, { name: 'user_lookup' });
  contractErrors.add(contractOk(res, id) ? 0 : 1);

  if (THINK_MAX > 0) sleep((THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)) / 1000);
}

// Permite checagens ad-hoc com --vus/--iterations (sobrepõem os cenários declarados).
export default traffic;
