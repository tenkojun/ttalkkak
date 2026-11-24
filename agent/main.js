// 딸깍 에이전트: 비밀번호 → 롤 클라이언트 찾기 → 폰 서버(같은 와이파이 + Cloudflare 중계) + PIN/QR
//   딸깍.exe / npm run app   창 모드: 검은 창에 비밀번호 → QR·PIN·상태 (콘솔 숨김, 창 닫으면 종료)
//   npm run agent            콘솔 모드 (비밀번호를 콘솔에서)
//   npm run agent:mock       가짜 롤 (먼저 npm run mock)
// 폰은 롤이 보낸 상태(단계·남은 시간·액션·벤치…)를 그대로 받아 그린다. 폰 명령은 lcu.js COMMANDS 만 통과.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import WebSocket, { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { checkPassword } from './gate.js';
import { readLockfile, findClient, connect, runCommand, visibleQueues } from './lcu.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const LABEL = { None: '대기', Lobby: '로비', Matchmaking: '매칭 찾는 중', ReadyCheck: '매칭 잡힘! 수락 대기', ChampSelect: '챔피언 선택', InProgress: '게임 중' };

async function main() {
  let sea = null;
  try { sea = await import('node:sea'); if (!sea.isSea()) sea = null; } catch {}
  const args = process.argv.slice(2);
  const GUI = args.includes('--gui') || (!!sea && !args.includes('--console'));

  // 창 모드: 검은 콘솔 없이 다시 실행 (exe 더블클릭 시)
  if (GUI && sea && !args.includes('--child')) {
    spawn(process.execPath, [...args, '--child'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    process.exit(0);
  }

  const here = sea ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));
  const MOCK = args.includes('--mock') || !!process.env.TTALKKAK_LOCKFILE;
  const LOCKFILE = process.env.TTALKKAK_LOCKFILE || path.join(here, '..', 'mock-lcu', 'lockfile');
  const PORT = Number(process.env.TTALKKAK_PORT ?? 8817);
  const WEB = path.join(here, '..', 'web');
  // 중계 주소 (Cloudflare). 끄려면 TTALKKAK_RELAY= (빈 값)
  const RELAY = process.env.TTALKKAK_RELAY ?? (MOCK ? '' : 'https://ttalkkak.nocal-cloud.workers.dev');
  const log = GUI ? () => {} : console.log;

  // web/ 파일: exe 안에 묻은 것 또는 폴더
  const readWeb = rel => {
    if (sea) { try { return Buffer.from(sea.getAsset('web/' + rel)); } catch { return null; } }
    const f = path.normalize(path.join(WEB, rel));
    return f.startsWith(WEB + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f) : null;
  };

  // ── 비밀번호: 콘솔 모드는 여기서, 창 모드는 창에서
  let unlocked = false, recN = 0, recErr = ''; // recN·recErr = 롤 기록 줄 수·오류 (PC 창에 보임)
  if (!GUI) {
    console.log('\n  딸깍 — 매칭 잡아야만 한다\n');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    for (let i = 0; i < 5 && !unlocked; i++) {
      unlocked = checkPassword(await rl.question('비밀번호: '));
      if (!unlocked) console.log('  틀렸습니다.');
    }
    rl.close();
    if (!unlocked) { console.log('5번 틀려서 종료합니다.'); process.exit(1); }
  }

  // ── 롤 상태 (폰에 그대로 보냄)
  const S = { lol: false, phase: 'None', lobby: null, search: null, ready: null, session: null, pickable: [], bannable: [], subset: [], queues: [], summoner: null };
  const ctx = { queues: new Set() };
  let lcu = null;

  // ── 서버: 폰 화면(web/) · /ws 폰 · /pcws PC 창(이 PC 에서만)
  const newPin = () => String(crypto.randomInt(1e6)).padStart(6, '0');
  let PIN = newPin();
  const tokens = new Set();
  let fails = 0, lockedUntil = 0, pwFails = 0;
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const local = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const server = http.createServer((req, res) => {
    let url; try { url = decodeURIComponent(req.url.split('?')[0]); } catch { url = ''; }
    if (url.startsWith('/pc/')) return pcHttp(req, res, url); // PC 창(WinForms) — 이 PC 에서만
    const rel = url === '/' ? 'app.html' : url.replace(/^\/+/, '');
    if (rel === 'pc.html' && !local(req)) { res.writeHead(404); return res.end(); }
    const body = !rel.includes('..') && readWeb(rel);
    if (!body) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });

  // 폰 하나 = { send, authed }. 같은 와이파이(직접 ws)든 중계든 같은 처리
  const clients = new Set();
  let bt = null;
  const broadcast = () => { clearTimeout(bt); bt = setTimeout(() => { clients.forEach(c => c.authed && c.send({ t: 'state', s: S })); pcPush(); }, 40); };
  function makeClient(sendFn) {
    const c = { authed: false, send: sendFn };
    c.onMessage = async raw => {
      let m; try { m = typeof raw === 'object' && !Buffer.isBuffer(raw) ? raw : JSON.parse(raw); } catch { return; }
      if (m.t === 'hello') {
        if (!unlocked) return c.send({ t: 'auth', ok: false, why: 'PC 에서 비밀번호를 먼저 넣어 주세요' });
        if (m.token && tokens.has(m.token)) c.authed = true;
        else if (typeof m.pin === 'string') {
          if (Date.now() < lockedUntil) return c.send({ t: 'auth', ok: false, why: '잠시 후 다시 (너무 많이 틀림)' });
          if (m.pin === PIN) { c.authed = true; fails = 0; const tk = crypto.randomBytes(24).toString('base64url'); tokens.add(tk); c.send({ t: 'auth', ok: true, token: tk }); }
          else { if (++fails >= 5) { lockedUntil = Date.now() + 30000; fails = 0; } return c.send({ t: 'auth', ok: false, why: 'PIN 이 틀림' }); }
        }
        if (!c.authed) return c.send({ t: 'auth', ok: false, why: '다시 연결 필요' });
        if (m.token) c.send({ t: 'auth', ok: true, token: m.token });
        log('폰 연결됨'); pcPush();
        return c.send({ t: 'state', s: S });
      }
      if (m.t === 'cmd' && c.authed) {
        try {
          if (!lcu) throw new Error('PC 롤이 꺼져 있음');
          const r = await runCommand(lcu, m.name, m.args, ctx);
          rec('cmd', { name: m.name, args: m.args, status: r.status, data: r.data });
          c.send({ t: 'res', id: m.id, ok: r.status < 300, status: r.status, msg: r.data?.message, data: r.status < 300 ? r.data : undefined });
        } catch (e) { c.send({ t: 'res', id: m.id, ok: false, msg: e.message }); }
      }
    };
    return c;
  }
  const wss = new WebSocketServer({ noServer: true });
  const pcs = new Set();
  server.on('upgrade', (req, sock, head) => {
    const p = req.url.split('?')[0];
    if (p === '/ws') return wss.handleUpgrade(req, sock, head, ws => {
      const c = makeClient(m => ws.readyState === 1 && ws.send(JSON.stringify(m)));
      clients.add(c);
      ws.on('message', raw => c.onMessage(raw));
      ws.on('close', () => { clients.delete(c); pcPush(); });
    });
    if (p === '/pcws' && local(req)) return wss.handleUpgrade(req, sock, head, ws => {
      pcs.add(ws); pcPush();
      ws.on('message', raw => {
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (m.t !== 'unlock' || unlocked) return;
        const r = tryUnlock(m.pw);
        if (!r.ok) ws.send(JSON.stringify({ t: 'unlock', ...r }));
      });
      ws.on('close', () => { pcs.delete(ws); if (GUI) setTimeout(() => !pcs.size && process.exit(0), 4000); }); // 창 닫으면 종료
    });
    sock.destroy();
  });

  // PC 창에 보낼 것: PIN · QR · 상태
  let qrFor = '', qrSvg = '', relayUp = false;
  const phoneUrl = () => RELAY ? `${RELAY}/#pin=${PIN}` : `http://${lanIps()[0] ?? 'localhost'}:${server.address().port}/#pin=${PIN}`;
  async function pcPush() {
    if (!pcs.size) return;
    const url = phoneUrl();
    if (qrFor !== url) { qrFor = url; qrSvg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#efebe6', light: '#0000' } }); }
    const msg = JSON.stringify({ t: 'pc', unlocked, pin: PIN, qr: qrSvg, url: url.replace(/#.*/, ''), lol: S.lol, phase: S.phase, phones: [...clients].filter(c => c.authed).length, relay: relayUp || !RELAY });
    pcs.forEach(ws => ws.readyState === 1 && ws.send(msg));
  }
  function tryUnlock(pw) {
    if (unlocked) return { ok: true };
    if (Date.now() < lockedUntil) return { ok: false, why: '5번 틀려서 30초 뒤에 다시' };
    if (checkPassword(String(pw ?? ''))) { unlocked = true; start(); pcPush(); return { ok: true }; }
    if (++pwFails >= 5) { lockedUntil = Date.now() + 30000; pwFails = 0; }
    pcPush();
    return { ok: false, why: '틀렸습니다' };
  }
  // WinForms 창: 0.8초마다 상태를 묻고, 비밀번호를 보낸다. 창을 닫으면 물음이 끊기고 → 프로그램도 끝
  let qrPngFor = '', qrPng = '', lastPoll = 0;
  async function pcHttp(req, res, url) {
    const send = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
    if (!local(req)) return send({}, 404);
    if (url === '/pc/state') {
      lastPoll = Date.now();
      const u = phoneUrl();
      if (unlocked && qrPngFor !== u) { qrPngFor = u; qrPng = (await QRCode.toBuffer(u, { type: 'png', margin: 1, width: 440, errorCorrectionLevel: 'M', color: { dark: '#efebe6', light: '#000000' } })).toString('base64'); }
      return send({ unlocked, pin: PIN, qrPng: unlocked ? qrPng : '', url: u.replace(/#.*/, ''), lol: S.lol, phaseLabel: LABEL[S.phase] ?? S.phase, phones: [...clients].filter(c => c.authed).length, relay: relayUp || !RELAY, rec: recErr ? '오류: ' + recErr : `${recN}줄`, recDir });
    }
    if (url === '/pc/unlock' && req.method === 'POST') {
      let b = ''; for await (const c of req) { b += c; if (b.length > 1000) return send({}, 413); }
      let pw; try { pw = JSON.parse(b).pw; } catch {}
      return send(tryUnlock(pw));
    }
    send({}, 404);
  }
  if (GUI) setInterval(() => { if (lastPoll && Date.now() - lastPoll > 6000 && !pcs.size) process.exit(0); }, 2000);
  const lanIps = () => Object.values(os.networkInterfaces()).flat().filter(a => a?.family === 'IPv4' && !a.internal).map(a => a.address)
    .sort((a, b) => /^192\.168\.|^10\./.test(b) - /^192\.168\.|^10\./.test(a)); // 집 공유기 주소 먼저

  // 이미 켜져 있으면 그 창만 다시 띄우고 끝 (한 대에 하나)
  const listening = await new Promise(r => { server.once('error', () => r(false)); server.listen(PORT, '0.0.0.0', () => r(true)); });
  if (!listening) { if (GUI) openWindow(PORT, sea); else console.log(`포트 ${PORT} 사용 중 — 딸깍이 이미 켜져 있어요`); process.exit(0); }
  if (GUI) openWindow(server.address().port, sea);

  // ── 중계: PC 가 Cloudflare 로 나가서 PIN 방을 연다
  const KEY = crypto.randomBytes(24).toString('base64url');
  const relayed = new Map();
  function relay() {
    if (!RELAY) return;
    const rs = new WebSocket(`${RELAY.replace(/^http/, 'ws')}/agent?room=${PIN}&key=${KEY}`);
    rs.on('open', () => { if (!relayUp) log('  중계 연결됨'); relayUp = true; pcPush(); });
    rs.on('unexpected-response', (_, res) => { if (res.statusCode === 403) { PIN = newPin(); log(`  PIN 이 겹쳐서 바꿨어요 → PIN: ${PIN}`); } });
    rs.on('message', raw => {
      let o; try { o = JSON.parse(raw); } catch { return; }
      if (o.m?.t === 'bye') { clients.delete(relayed.get(o.from)); relayed.delete(o.from); return pcPush(); }
      let c = relayed.get(o.from);
      if (!c) { c = makeClient(m => rs.readyState === 1 && rs.send(JSON.stringify({ to: o.from, m }))); relayed.set(o.from, c); clients.add(c); }
      c.onMessage(o.m);
    });
    rs.on('close', () => { relayed.forEach(c => clients.delete(c)); relayed.clear(); if (relayUp) log('  중계 끊김 · 다시 연결 중'); relayUp = false; pcPush(); setTimeout(relay, 3000); });
    rs.on('error', () => {});
  }

  // ── 롤 연결
  const get = async p => { const r = await lcu.req('GET', p); return r.status < 300 ? r.data : null; };
  // subset = 칼바람(아수라장 포함) 시작 때 고르라고 주는 2~3장 카드 (실제 롤 /help 에서 찾음, 11/24)
  async function refreshChamps() { [S.pickable, S.bannable, S.subset] = await Promise.all([get('/lol-champ-select/v1/pickable-champion-ids'), get('/lol-champ-select/v1/bannable-champion-ids'), get('/lol-lobby-team-builder/champ-select/v1/subset-champion-list')]).then(x => x.map(v => Array.isArray(v) ? v : [])); rec('get', { pickable: S.pickable, bannable: S.bannable, subset: S.subset }); }
  async function refreshAll() {
    const [phase, lobby, search, ready, session, queues, summoner] = await Promise.all(['/lol-gameflow/v1/gameflow-phase', '/lol-lobby/v2/lobby',
      '/lol-matchmaking/v1/search', '/lol-matchmaking/v1/ready-check', '/lol-champ-select/v1/session', '/lol-game-queues/v1/queues', '/lol-summoner/v1/current-summoner'].map(get));
    Object.assign(S, { phase: phase ?? 'None', lobby, search, ready, session, summoner });
    // 지금 열린 큐만 (폰 목록 + createLobby 허용 목록)
    // 롤 '플레이' 화면에 실제로 보이는 큐만 (격전·튜토리얼·사용자 설정·숨김 큐 제외). 묶음·순서도 클라이언트 값 그대로
    S.queues = visibleQueues(queues);
    ctx.queues = new Set(S.queues.map(q => q.id));
    if (session) await refreshChamps();
    await refreshPerks(true);
    // 가진 챔피언 (신속 대전 미리 고르기용) — 보유 + 무료 순환
    S.owned = ((await get('/lol-champions/v1/owned-champions-minimal')) ?? []).filter(c => c.id > 0 && c.id < 10000 && (c.ownership?.owned || c.freeToPlay)).map(c => c.id); // 6만대 id 는 특수 모드용 가짜 챔피언
  }
  // ── 룬: 페이지·현재 페이지 (이벤트로 갱신) + 룬 종류·이름 (처음 한 번)
  async function refreshPerks(all) {
    const [pages, cur, inv] = await Promise.all(['/lol-perks/v1/pages', '/lol-perks/v1/currentpage', '/lol-perks/v1/inventory'].map(get));
    S.perks ??= {};
    Object.assign(S.perks, { current: cur?.id ?? null, canAdd: !!inv?.canAddCustomPage,
      pages: (pages ?? []).filter(p => !p.isTemporary).map(p => ({ id: p.id, name: p.name, editable: p.isEditable, primaryStyleId: p.primaryStyleId, subStyleId: p.subStyleId, selectedPerkIds: p.selectedPerkIds })) });
    if (all) {
      const [styles, perks] = await Promise.all(['/lol-perks/v1/styles', '/lol-perks/v1/perks'].map(get));
      S.perks.styles = (styles ?? []).map(s => ({ id: s.id, name: s.name, icon: s.iconPath, slots: s.slots.map(x => ({ type: x.type, perks: x.perks })), allowedSubStyles: s.allowedSubStyles }));
      S.perks.info = Object.fromEntries((perks ?? []).map(p => [p.id, { name: p.name, icon: p.iconPath, desc: p.shortDesc }]));
    }
  }
  let champT = null;
  // ── 롤 기록: 게임 흐름에 관련된 롤 이벤트와 폰 명령을 전부 남긴다 (사용자 지시 11/24 — 못 해 본 모드를 나중에 맞추려고)
  // %LOCALAPPDATA%\ttalkkak\log\날짜.jsonl · 하루 300MB 넘으면 그날은 그만 씀
  const REC_URI = /^\/(lol-gameflow|lol-lobby|lol-lobby-team-builder|lol-matchmaking|lol-champ-select|lol-perks|lol-end-of-game|lol-pre-end-of-game|lol-game-queues|lol-cherry|lol-tft|lol-honor-v2|lol-inventory\/v1\/wallet)\b/;
  const recDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ttalkkak', 'log');
  function rec(kind, o) {
    if (MOCK) return; // 가짜 롤 시험은 안 남김
    try {
      fs.mkdirSync(recDir, { recursive: true });
      const f = path.join(recDir, new Date().toISOString().slice(0, 10) + '.jsonl');
      if (fs.existsSync(f) && fs.statSync(f).size > 300e6) return;
      fs.appendFileSync(f, JSON.stringify({ t: new Date().toISOString(), kind, ...o }) + '\n'); recN++;
    } catch (e) { recErr = e.message; }
  }  function onEvent(ev) {
    if (REC_URI.test(ev.uri)) rec('ev', { uri: ev.uri, type: ev.eventType, data: ev.data });
    const d = ev.eventType === 'Delete' ? null : ev.data;
    switch (ev.uri) {
      case '/lol-gameflow/v1/gameflow-phase': S.phase = d ?? 'None'; log('상태:', LABEL[S.phase] ?? S.phase); break;
      case '/lol-lobby/v2/lobby': S.lobby = d; break;
      case '/lol-matchmaking/v1/search': S.search = d; break;
      case '/lol-matchmaking/v1/ready-check': S.ready = d; break;
      case '/lol-champ-select/v1/session':
        S.session = d;
        clearTimeout(champT); if (d) champT = setTimeout(() => refreshChamps().then(broadcast).catch(() => {}), 150); // 고를 수 있는 챔피언은 따로
        break;
      case '/lol-perks/v1/pages': case '/lol-perks/v1/currentpage':
        refreshPerks(false).then(broadcast).catch(() => {}); return;
      default: return;
    }
    broadcast();
  }
  async function lolLoop() {
    let waiting = false;
    for (;;) {
      const lock = MOCK ? (fs.existsSync(LOCKFILE) ? readLockfile(LOCKFILE) : null) : findClient();
      if (!lock) {
        if (!waiting) log(MOCK ? '가짜 롤을 기다리는 중... (npm run mock)' : '롤 클라이언트를 기다리는 중... (롤을 켜 주세요)');
        waiting = true; S.lol = false; broadcast();
        await sleep(2000); continue;
      }
      waiting = false;
      try {
        lcu = connect(lock);
        await refreshAll();
        S.lol = true;
        const ws = lcu.subscribe(onEvent);
        rec('snap', { S }); // 연결 순간 상태 전체
        log('연결됨. 현재 상태:', LABEL[S.phase] ?? S.phase);
        broadcast();
        await new Promise(r => { ws.on('close', r); ws.on('error', r); });
      } catch {}
      lcu = null; S.lol = false; broadcast();
      log('롤 클라이언트 연결이 끊겼습니다. 다시 기다립니다.');
      await sleep(2000);
    }
  }

  let started = false;
  async function start() {
    if (started) return; started = true;
    relay();
    if (!GUI) {
      await sleep(1500);
      if (RELAY) console.log(`\n  폰에서 (어디서든):       ${RELAY}`);
      console.log(`  폰에서 (같은 와이파이):  ${lanIps().slice(0, 2).map(ip => `http://${ip}:${server.address().port}`).join('  또는  ') || '(네트워크 없음)'}`);
      console.log(`  PIN: ${PIN}\n`);
    }
    lolLoop();
  }
  if (unlocked) start();
}

// PC 창: Windows 기본 창(WinForms, agent/window.ps1). Edge 앱 창은 입력 글자가 안 보이는 PC 가 있어서 버림 (11/24)
function openWindow(port, sea) {
  const dir = path.join(os.tmpdir(), 'ttalkkak-window'); fs.mkdirSync(dir, { recursive: true });
  const src = name => sea ? Buffer.from(sea.getAsset(name)) : fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', name === 'window.ps1' ? 'agent' : 'scripts', name));
  // PowerShell 5.1 은 BOM 없는 UTF-8 한글을 깨뜨리므로 BOM 을 붙여 쓴다
  fs.writeFileSync(path.join(dir, 'window.ps1'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), src('window.ps1')]));
  try { fs.writeFileSync(path.join(dir, 'ttalkkak.ico'), src('ttalkkak.ico')); } catch {}
  if (sea) try { const p = path.join(dir, 'NotoSerifKR.ttf'); if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(sea.getAsset('NotoSerifKR.ttf'))); } catch {}
  try { fs.writeFileSync(path.join(dir, 'devil-cut.png'), sea ? Buffer.from(sea.getAsset('web/img/devil-cut.png')) : fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'img', 'devil-cut.png'))); } catch {}
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(dir, 'window.ps1'), '-Port', String(port)], { stdio: 'ignore', windowsHide: true }).unref(); // detached 면 콘솔 없이 떠서 PowerShell 이 바로 죽음 (11/24 확인)
}
main();
