#!/usr/bin/env python3
"""Gera code/docs/resultados.md a partir dos artefatos reais de code/k6/results.

Lê summary.json (export do k6), metricas.json / metricas-antes.json e contagens.json de
cada execução e renderiza o relatório. Nenhum número é calculado por estimativa: tudo que
aparece no documento vem de um arquivo de execução. Interpretação e conclusões ficam para a
monografia; este documento é operacional e não deve ser editado à mão.

Uso: python3 scripts/resultados.py [--results code/k6/results] [--output code/docs/resultados.md]
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE_RE = re.compile(r'^baseline-(sync|async)-(smoke|tcc)-(\d{8}T\d{6}Z)$')
VIRAL_RE = re.compile(r'^viral-(sync|async)-(smoke|tcc|warmup)-([a-z_]+)(?:-vus(\d+))?-(\d{8}T\d{6}Z)$')
SUBMETRIC_RE = re.compile(r'^http_req_duration\{name:([^}]+)\}$')
K6_VERSION_RE = re.compile(r'^k6 (v[\d.]+)')

TREND_KEYS = [('p(50)', 'p50'), ('p(95)', 'p95'), ('p(99)', 'p99'), ('avg', 'média'), ('max', 'máx')]


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def parse_run(directory: Path):
    """Classifica uma pasta de execução; None se o nome não segue o padrão dos runners."""
    name = directory.name
    summary = load_json(directory / 'summary.json')
    if summary is None:
        return None
    baseline = BASELINE_RE.match(name)
    viral = VIRAL_RE.match(name)
    if baseline:
        kind = 'baseline'
        arch, mode, ts = baseline.groups()
        scenario = 'user_lookup'
    elif viral:
        kind, arch, mode, scenario, vus, ts = 'viral', *viral.groups()
    else:
        return None
    if mode == 'warmup':
        return None
    return {
        'dir': name,
        'kind': kind,
        'arch': arch,
        'mode': mode,
        'scenario': scenario,
        'vus_dir': int(vus) if viral and vus else None,
        'ts': ts,
        'summary': summary,
        'metricas': load_json(directory / 'metricas.json'),
        'metricas_antes': load_json(directory / 'metricas-antes.json'),
        'contagens': load_json(directory / 'contagens.json'),
        'k6_version': parse_k6_version(directory / 'output.log'),
    }


def parse_k6_version(log: Path):
    try:
        for line in log.read_text(encoding='utf-8', errors='replace').splitlines()[:5]:
            match = K6_VERSION_RE.match(line.strip())
            if match:
                return match.group(1)
    except OSError:
        pass
    return None


def metric(summary, name):
    return (summary.get('metrics') or {}).get(name) or {}


def stat_of(summary, name, key):
    """k6 v2 (summary-export) grava as estatísticas planas no entry; o formato aninhado
    em `values` é aceito por tolerância."""
    entry = metric(summary, name)
    if key in entry:
        return entry[key]
    return (entry.get('values') or {}).get(key)


def rate_ratio(summary, name):
    """Taxa 0..1 de métricas Rate (contract_errors, http_req_failed): campo `value` no k6 v2."""
    entry = metric(summary, name)
    if 'value' in entry:
        return entry['value']
    return (entry.get('values') or {}).get('rate')


def fmt(value, digits=1):
    if value is None:
        return '—'
    if isinstance(value, float):
        return f'{value:.{digits}f}'.rstrip('0').rstrip('.') if digits else f'{value:.0f}'
    return str(value)


def duration_ms(summary):
    """Duração da janela medível: contagem/rate do http_reqs (rate é req/s sobre a duração)."""
    count = stat_of(summary, 'http_reqs', 'count')
    rate = stat_of(summary, 'http_reqs', 'rate')
    if count and rate:
        return count / rate
    return None


def max_vus(run):
    # Preferir o pico das stages do cenário `traffic` quando o export as traz (nem toda versão do
    # k6 inclui `options` no summary-export).
    stages = ((run['summary'].get('options') or {}).get('scenarios') or {}).get('traffic', {}).get('stages')
    if stages:
        return max(stage.get('target', 0) for stage in stages)
    vus = stat_of(run['summary'], 'vus_max', 'value')
    if vus:
        vus = int(vus)
        # A métrica `vus_max` conta também o VU único da sonda de fila (presente só quando o k6
        # publicou `rabbitmq_queue_total`, i.e. no async com fila). Descontá-lo iguala o pico de
        # carga entre sync e async e permite o pareamento por configuração.
        if run['kind'] == 'viral' and 'rabbitmq_queue_total' in (run['summary'].get('metrics') or {}):
            vus -= 1
        return vus
    if run['vus_dir']:
        return run['vus_dir']
    if run['kind'] == 'baseline':
        return 80 if run['mode'] == 'smoke' else 600
    return None


def thresholds_status(summary):
    """[(métrica, expressão, ok)] de todas as métricas com thresholds definidos.

    No export do k6 v2 o booleano significa "limiar cruzado" (true = reprovado), o oposto
    do campo `ok` do formato antigo; a inversão é confirmada contra o output.log de cada run.
    """
    rows = []
    for name, entry in sorted((summary.get('metrics') or {}).items()):
        for expression, state in sorted((entry.get('thresholds') or {}).items()):
            if isinstance(state, dict):
                ok = bool(state.get('ok'))
            else:
                ok = not bool(state)
            rows.append((name, expression, ok))
    return rows


def per_route(summary):
    """Latências por rota (submétricas http_req_duration{name:...})."""
    routes = {}
    for name, entry in (summary.get('metrics') or {}).items():
        match = SUBMETRIC_RE.match(name)
        if match:
            routes[match.group(1)] = entry
    return routes


def fmt_ts(ts):
    return f'{ts[0:4]}-{ts[4:6]}-{ts[6:8]} {ts[9:15][0:2]}:{ts[9:15][2:4]}:{ts[9:15][4:6]}Z'


def render_run_row(run):
    summary = run['summary']
    duration = duration_ms(summary)
    row = [
        fmt_ts(run['ts']),
        run['arch'],
        run['mode'],
        fmt(max_vus(run)),
        fmt(duration, 0),
        fmt(stat_of(summary, 'http_reqs', 'count'), 0),
        fmt(stat_of(summary, 'http_reqs', 'rate'), 1),
    ]
    for key, _ in TREND_KEYS:
        row.append(fmt(stat_of(summary, 'http_req_duration', key), 1))
    row.append(fmt(rate_ratio(summary, 'http_req_failed'), 3))
    if run['kind'] == 'baseline':
        rate = rate_ratio(summary, 'contract_errors')
        row.append(fmt(rate, 3) if rate is not None else '—')
    row.append(fmt(stat_of(summary, 'http_5xx', 'count'), 0))
    row.append(fmt(stat_of(summary, 'http_timeouts', 'count'), 0))
    if run['kind'] == 'viral':
        drenagem = (run['contagens'] or {}).get('drenagem') or {}
        row.append(fmt(drenagem.get('pico_fila'), 0))
        segundos = drenagem.get('segundos_total')
        if segundos is None:
            segundos = drenagem.get('segundos')
        row.append(fmt(segundos, 0))
    ok = all(ok for _, _, ok in thresholds_status(summary))
    row.append('sim' if ok else 'não')
    return '| ' + ' | '.join(row) + ' |'


def run_header(kind):
    cells = ['execução (UTC)', 'arq.', 'modo', 'VUs', 'duração (s)', 'reqs', 'req/s']
    cells += [label for _, label in TREND_KEYS]
    cells += ['falha HTTP']
    if kind == 'baseline':
        cells += ['contract_errors']
    cells += ['5xx', 'timeouts']
    if kind == 'viral':
        cells += ['pico fila', 'drenagem (s)']
    cells += ['thresholds']
    return '| ' + ' | '.join(cells) + ' |\n|' + '|'.join([' --- '] * len(cells)) + '|'


def render_routes(run):
    routes = per_route(run['summary'])
    if not routes:
        return '_Sem submétricas por rota nesta execução._\n'
    lines = ['| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |', '| --- | --- | --- | --- | --- |']
    for name, entry in sorted(routes.items()):
        get = lambda key: entry.get(key) if key in entry else (entry.get('values') or {}).get(key)
        lines.append('| {} | {} | {} | {} | {} |'.format(
            name, fmt(get('p(50)')), fmt(get('p(95)')),
            fmt(get('p(99)')), fmt(get('max'))))
    return '\n'.join(lines) + '\n'


def render_thresholds(run):
    rows = thresholds_status(run['summary'])
    if not rows:
        return '_Sem thresholds declarados._\n'
    lines = ['| métrica | expressão | ok |', '| --- | --- | --- |']
    for name, expression, ok in rows:
        lines.append(f'| {name} | `{expression}` | {"✓" if ok else "✗"} |')
    return '\n'.join(lines) + '\n'


def render_state(run):
    if run['kind'] == 'baseline':
        antes, depois = run['metricas_antes'], run['metricas']
        if depois is None:
            return '_Sem /metricas capturado nesta execução._\n'
        equal = 'sim' if antes == depois else 'NÃO'
        lines = [f'Estado em `/metricas` antes × depois da carga: **inalterado = {equal}**.\n']
        lines.append('```json\n' + json.dumps(depois, ensure_ascii=False, indent=2) + '\n```\n')
        return '\n'.join(lines)
    contagens = run['contagens']
    if contagens is None:
        return '_Sem contagens.json nesta execução._\n'
    drenagem = contagens.get('drenagem') or {}
    persistidos = contagens.get('persistidos_final') or {}
    aceitos = contagens.get('aceitos') or {}
    # Campos de pico de fila e tempo total de drenagem; ausentes viram — na tabela, nunca inventados.
    resumo_drenagem = {
        'completa': drenagem.get('completa'),
        'segundos': drenagem.get('segundos'),
        'segundos_total': drenagem.get('segundos_total'),
        'pico_fila': drenagem.get('pico_fila'),
    }
    for extra in ('pico_fila_k6', 'pico_fila_drenagem'):
        if extra in drenagem:
            resumo_drenagem[extra] = drenagem.get(extra)
    for passthrough in ('timeout_s', 'intervalo_s', 'filas_restantes'):
        if passthrough in drenagem:
            resumo_drenagem[passthrough] = drenagem.get(passthrough)
    return (
        '```json\n' + json.dumps(
            {'aceitos': aceitos,
             'persistidos_final': persistidos,
             'drenagem': resumo_drenagem}, ensure_ascii=False, indent=2) + '\n```\n'
    )


def render_section(runs, title, kind, intro):
    if not runs:
        return f'## {title}\n\n_Ainda não há execuções registradas._\n'
    parts = [f'## {title}\n', intro + '\n', run_header(kind)]
    parts[-1] += '\n' + '\n'.join(render_run_row(run) for run in runs) + '\n'
    for run in runs:
        parts.append(f'\n### {run["dir"]}\n')
        if run['k6_version']:
            parts.append(f'k6 {run["k6_version"]}.\n')
        parts.append('\n' + render_routes(run))
        parts.append('\n' + render_thresholds(run))
        parts.append('\n' + render_state(run))
    return '\n'.join(parts)


def _run_scenario(run):
    """Rótulo de cenário estável para o agrupamento estatístico. No baseline de controle o
    cenário é sempre `user_lookup`; nos virais, o SCENARIO da pasta (organic, viral_peak, ...)."""
    return run['scenario']


def _queue_peak(run):
    if run['kind'] != 'viral':
        return None
    drenagem = (run['contagens'] or {}).get('drenagem') or {}
    return drenagem.get('pico_fila')


def _drain_seconds(run):
    if run['kind'] != 'viral':
        return None
    drenagem = (run['contagens'] or {}).get('drenagem') or {}
    value = drenagem.get('segundos_total')
    if value is None:
        value = drenagem.get('segundos')
    return value


def _mean_sd(values):
    """(média, desvio) de uma amostra; desvio = None quando N < 2 (um único ponto)."""
    numbers = [v for v in values if isinstance(v, (int, float))]
    if not numbers:
        return None, None, 0
    mean = statistics.mean(numbers)
    sd = statistics.stdev(numbers) if len(numbers) >= 2 else None
    return mean, sd, len(numbers)


def _fmt_stat(values, digits=1):
    """"média ± desvio" a partir das amostras; — se não há amostra, ± — se N < 2."""
    mean, sd, _ = _mean_sd(values)
    if mean is None:
        return '—'
    if sd is None:
        return f'{fmt(mean, digits)} ± —'
    return f'{fmt(mean, digits)} ± {fmt(sd, digits)}'


def render_consolidation(runs, mode='tcc'):
    """Agrega as repetições da bateria oficial por (cenário, arquitetura, modo).

    Imprime média ± desvio (statistics.mean/stdev; desvio = — quando N < 2) de req/s, p50, p95,
    p99, taxa de erro (%), pico de fila e drenagem (s), além de N por grupo. Nada é inventado:
    métricas ausentes numa execução não entram na amostra e grupos sem dados exibem —.
    """
    selected = [run for run in runs if run['mode'] == mode]
    title = f'## Consolidação Estatística (MODE={mode})\n'
    intro = (
        f'Agregação das repetições da bateria oficial (`scripts/run_tcc_suite.sh`, '
        f'`MODE={mode}`) por cenário e arquitetura. Cada célula traz **média ± desvio-padrão '
        f'amostral** das execuções do grupo; o desvio aparece como — quando há uma única amostra '
        f'(N < 2). `N` é o número de execuções agregadas. As colunas de pico de fila e drenagem '
        f'aplicam-se só aos cenários de viralização (— no baseline). Valores derivam apenas dos '
        f'artefatos reais das execuções; grupos ou métricas sem dado exibem —.\n'
    )
    if not selected:
        return title + '\n' + intro + f'\n_Ainda não há execuções registradas com `MODE={mode}`._\n'

    groups = {}
    for run in selected:
        key = (run['kind'], _run_scenario(run), run['arch'])
        groups.setdefault(key, []).append(run)

    header = (
        '| cenário | arquitetura | N | req/s | p50 (ms) | p95 (ms) | p99 (ms) '
        '| erro (%) | pico fila | drenagem (s) |'
    )
    sep = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    lines = [title, intro, header, sep]
    for (kind, scenario, arch), members in sorted(groups.items()):
        reqs = [stat_of(run['summary'], 'http_reqs', 'rate') for run in members]
        p50 = [stat_of(run['summary'], 'http_req_duration', 'p(50)') for run in members]
        p95 = [stat_of(run['summary'], 'http_req_duration', 'p(95)') for run in members]
        p99 = [stat_of(run['summary'], 'http_req_duration', 'p(99)') for run in members]
        # Taxa de falha HTTP (0..1) convertida em porcentagem; None fora da amostra.
        err = [(rate_ratio(run['summary'], 'http_req_failed') or 0) * 100
               if rate_ratio(run['summary'], 'http_req_failed') is not None else None
               for run in members]
        err = [e for e in err if e is not None]
        peak = [_queue_peak(run) for run in members]
        drain = [_drain_seconds(run) for run in members]
        label = f'{kind}/{scenario}' if kind == 'viral' else scenario
        row = [
            label, arch, str(len(members)),
            _fmt_stat(reqs, 1), _fmt_stat(p50, 1), _fmt_stat(p95, 1), _fmt_stat(p99, 1),
            _fmt_stat(err, 2),
            _fmt_stat(peak, 0) if kind == 'viral' else '—',
            _fmt_stat(drain, 0) if kind == 'viral' else '—',
        ]
        lines.append('| ' + ' | '.join(row) + ' |')
    return '\n'.join(lines) + '\n'


def render_consolidation_blocks(runs):
    """Bloco oficial da bateria (MODE=tcc) sempre presente; quando houver repetições em MODE=smoke
    (validação por `make smoke-suite`), acrescenta um bloco smoke equivalente para conferir a
    agregação média ± desvio antes da coleta oficial."""
    blocks = [render_consolidation(runs, 'tcc')]
    smoke_groups = {}
    for run in runs:
        if run['mode'] == 'smoke':
            smoke_groups.setdefault((run['kind'], _run_scenario(run), run['arch']), []).append(run)
    if any(len(members) >= 2 for members in smoke_groups.values()):
        blocks.append('> Validação (`make smoke-suite`): a agregação abaixo confirma o cálculo de '
                      'média ± desvio em `MODE=smoke`; os números oficiais vêm da bateria `MODE=tcc`.\n')
        blocks.append(render_consolidation(runs, 'smoke'))
    return '\n'.join(blocks)


def render_comparison(runs):
    """Números observados lado a lado quando as duas arquiteturas têm a mesma configuração."""
    pairs = {}
    for run in runs:
        key = (run['kind'], run['scenario'], run['mode'], max_vus(run))
        pairs.setdefault(key, {})[run['arch']] = run
    matched = {key: value for key, value in pairs.items() if len(value) == 2}
    if not matched:
        return ('## Comparações observadas (sync × async)\n\n'
                '_Ainda não há pares completos de execuções equivalentes nas duas arquiteturas._\n')
    lines = ['## Comparações observadas (sync × async)\n',
             'Apenas números das execuções listadas acima, sem interpretação. As colunas de pico de '
             'fila e drenagem aplicam-se só aos cenários de viralização (— no baseline).\n',
             '| configuração | req/s sync | req/s async | p50 sync | p50 async | p95 sync | p95 async '
             '| p99 sync | p99 async | falha sync | falha async '
             '| pico fila sync | pico fila async | drenagem sync (s) | drenagem async (s) |',
             '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for (kind, scenario, mode, vus), archs in sorted(matched.items(), key=lambda kv: kv[0]):
        label = f'{kind}/{scenario} — {mode}' + (f' — {vus} VUs' if vus else '')
        cells = [label]
        for index in range(5):
            for arch in ('sync', 'async'):
                summary = archs[arch]['summary']
                if index == 0:
                    cells.append(fmt(stat_of(summary, 'http_reqs', 'rate'), 1))
                elif index == 4:
                    cells.append(fmt(rate_ratio(summary, 'http_req_failed'), 3))
                else:
                    cells.append(fmt(stat_of(summary, 'http_req_duration', TREND_KEYS[index - 1][0]), 1))
        for field in ('pico_fila', 'segundos_total'):
            for arch in ('sync', 'async'):
                if kind == 'viral':
                    drenagem = (archs[arch]['contagens'] or {}).get('drenagem') or {}
                    value = drenagem.get(field)
                    if value is None and field == 'segundos_total':
                        value = drenagem.get('segundos')
                    cells.append(fmt(value, 0))
                else:
                    cells.append('—')
        lines.append('| ' + ' | '.join(cells) + ' |')
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', type=Path, default=ROOT / 'code/k6/results')
    parser.add_argument('--output', type=Path, default=ROOT / 'code/docs/resultados.md')
    args = parser.parse_args(argv)

    runs = []
    if args.results.is_dir():
        for directory in sorted(args.results.iterdir()):
            if directory.is_dir():
                run = parse_run(directory)
                if run:
                    runs.append(run)
    runs.sort(key=lambda run: run['ts'])

    baseline = [run for run in runs if run['kind'] == 'baseline']
    viral = [run for run in runs if run['kind'] == 'viral']

    document = f"""# Resultados dos experimentos

> **Documento gerado automaticamente por `scripts/resultados.py` a partir de
> `code/k6/results/`. Não editar manualmente.** Todos os números abaixo provêm de execuções
> reais realizadas neste repositório; estimativas e números não coletados não são impressos.
> A interpretação, as comparações conclusivas e as conclusões pertencem à monografia.

- Execuções registradas: {len(runs)} (baseline: {len(baseline)}, viralização: {len(viral)}).
- Origem dos dados: `code/k6/results/*/summary.json` (k6 `--summary-export`), `metricas*.json`
  (`GET /metricas`) e `contagens.json` (contagens diretas no banco, cenários de viralização).
- `contract_errors` é a taxa de violações de contrato HTTP (`status`, `id` requisitado e campos
  do schema `Usuario`); `falha HTTP` é `http_req_failed` do k6. `thresholds` indica se todos os
  thresholds declarados no script passaram na execução.

{render_section(baseline, 'Baseline — busca de perfil por ID (GET /usuarios/{id})', 'baseline',
    'Cenário de controle: leitura pontual de perfil sob alta concorrência, distribuição Pareto '
    '80/20 sobre 10.020 usuários (hot set de 500). Detalhes em '
    '[baseline-user-lookup.md](baseline-user-lookup.md).')}

{render_section(viral, 'Viralização (viral.js)', 'viral',
    'Cenários de escrita/leitura sobre o snapshot Zipf: cascatas de compartilhamento, fan-out de '
    'celebridades e leituras de feed/árvore. Além das misturas estáticas (`baseline`, `fanout`, '
    '`graph_read`, `mixed`), incluem-se `organic` (escrita comum sem celebridade, rampa suave) e '
    '`viral_peak` (cascata em fases: aquecimento, pico de centralidade, platô e resfriamento). '
    'Detalhes em [viralizacao.md](viralizacao.md). As colunas `pico fila` e `drenagem (s)` trazem o '
    'pico de profundidade de fila observado (`drenagem.pico_fila`) e o tempo total até a parada '
    'completa da drenagem (`drenagem.segundos_total`); contagens `aceitos × persistidos` e drenagem '
    'completas em `contagens.json`.')}

{render_consolidation_blocks(runs)}

{render_comparison(runs)}
"""
    args.output.write_text(document, encoding='utf-8')
    print(f'{args.output}: {len(runs)} execuções impressas ({len(baseline)} baseline, {len(viral)} viral)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
