// Gera um PDF estático do site público (uma página por seção), sem animações nem botões.
// Uso: node --experimental-websocket dashboard/scripts/site-pdf.mjs [saida.pdf]
// Requer o servidor rodando (node dashboard/server.mjs) e google-chrome no PATH.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const OUT = path.resolve(process.argv[2] ?? 'dashboard/site-tcc.pdf');
const URL = process.env.SITE_URL ?? 'http://127.0.0.1:8765/';
const PROFILE = mkdtempSync(path.join(tmpdir(), 'site-pdf-'));
const pages = [];
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${PROFILE}`, '--remote-debugging-port=9334', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 50; i++) { try { list = await (await fetch('http://127.0.0.1:9334/json/list')).json(); if (list.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') console.log('EXC', m.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = (e) => send('Runtime.evaluate', { expression: e });
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(3000);
await js(`document.body.classList.add('present');
const st=document.createElement('style');st.textContent=\`
#dots,#hud,.progress,.cta,#res-tabs,.sim-controls,.sim-grid,#cascata .btn-row,#cascata .counters{display:none!important}
.limits summary{list-style:none;cursor:default}.limits summary::-webkit-details-marker{display:none}
.casc-pair{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.casc-pair figure{margin:0}
.casc-pair figcaption{text-align:center;font-size:.85rem;color:var(--ink-2);margin-top:.25rem}.casc-pair figcaption b{color:var(--ink)}
#pico .charts{margin-top:1.5rem}.reveal{opacity:1!important;transform:none!important}\`;document.head.append(st);
document.querySelector('.limits').open=true;`);
const cap = async () => { const s = await send('Page.captureScreenshot', { format: 'png' }); pages.push(s.data); };
const go = async (sid, wait, extra = '') => { await js(`document.getElementById('${sid}').scrollIntoView({behavior:'instant'});${extra}`); await sleep(wait); };
await go('inicio', 3500); await cap();
await go('problema', 1500); await cap();
await go('rede', 3000); await cap();
// cascata: estado final de celebridade e de pessoa comum, lado a lado
await go('cascata', 7500);
await js(`window.__c=[];const snap=(t)=>window.__c.push({t,svg:document.getElementById('cascade').cloneNode(true),r:document.getElementById('cc-reach').textContent,w:document.getElementById('cc-writes').textContent});snap('Celebridade publica');window.__snap=snap;document.querySelector('[data-cascade=leaf]').click();`);
await sleep(7500);
await js(`__snap('Pessoa comum publica');
const fig=document.querySelector('#cascata .graph-fig');const leg=fig.querySelector('.legend-inline');
const pair=document.createElement('div');pair.className='casc-pair';
for(const c of __c){c.svg.querySelectorAll('.pulses').forEach(p=>p.remove());const f=document.createElement('figure');f.append(c.svg);const cp=document.createElement('figcaption');cp.innerHTML='<b>'+c.t+'</b><br>'+c.r+' pessoas alcançadas · '+c.w+' registros salvos';f.append(cp);pair.append(f);}
fig.replaceChildren(pair,leg);
document.querySelector('#cascata .lead').textContent='O mesmo post, publicado por uma celebridade e por uma pessoa comum, depois de até 4 ondas de compartilhamento. Cada pessoa que recebe o post no feed é mais um registro que o servidor precisa salvar.';`);
await sleep(500); await cap();
await go('arquiteturas', 1500); await cap();
await go('pico', 21000, `document.getElementById('sim-play').click();const p=document.createElement('p');p.className='lead';p.style.maxWidth='62rem';p.innerHTML='Simulação simplificada de um pico viral, só para ilustrar (não são medições). Na área cinza chegam pedidos. <b style="color:var(--sync)">Síncrono</b>: a espera sobe até 30 s e as pessoas desistem. <b style="color:var(--async)">Com fila</b>: a resposta continua rápida; o trabalho fica guardado e é terminado depois que os pedidos param.';document.querySelector('#pico h2').after(p);`);
await cap();
for (let i = 0; i < 3; i++) {
  await go('resultados', 2000, `document.querySelectorAll('#res-tabs button')[${i}].click();document.querySelector('#resultados h2').textContent='O que medimos: '+document.querySelectorAll('#res-tabs button')[${i}].textContent.toLowerCase();document.querySelector('#resultados > .wrap > .note').textContent='Valor médio dos testes (± quanto variou entre eles). Fonte: artigo do TCC.';`);
  await cap();
}
await go('conclusao', 1500); await cap();
// Monta o PDF com as capturas, uma por página 16:9.
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
const { frameTree } = await send('Page.getFrameTree');
await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: `<!doctype html><style>@page{size:1600px 900px;margin:0}html,body{margin:0}img{display:block;width:1600px;height:900px;break-after:page}</style>${pages.map((d) => `<img src="data:image/png;base64,${d}">`).join('')}` });
await sleep(1500);
const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
writeFileSync(OUT, Buffer.from(pdf.data, 'base64'));
console.log(`PDF: ${OUT} (${pages.length} páginas)`);
ws.close(); chrome.kill();
setTimeout(() => rmSync(PROFILE, { recursive: true, force: true }), 500);
