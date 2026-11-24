// 자체 검사: 가짜 롤을 빠른 속도로 띄워 에이전트 쪽 코드로 전 과정을 돌린다. npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMock, MOCK_QUEUES } from '../mock-lcu/server.js';
import { connect, readLockfile, runCommand } from '../agent/lcu.js';
import { checkPassword } from '../agent/gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ttalkkak-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FAST = { searchSec: 0.3, readySec: 1.5, turnSec: 2, planSec: 0.5, aramSec: 2, finalSec: 1.5 };
let n = 0;
const ok = msg => console.log(`  ✓ ${msg}`);

async function setup() {
  const lockfile = path.join(tmp, `lockfile${n++}`);
  const mock = await startMock({ lockfile, ...FAST });
  const lcu = connect(readLockfile(lockfile));
  const events = [];
  let seen = 0;
  const ws = lcu.subscribe(ev => events.push(ev));
  await new Promise(r => ws.once('open', r));
  await sleep(50); // 구독 메시지가 먼저 도착하도록
  const until = async (pred, label, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      while (seen < events.length) { const e = events[seen++]; if (pred(e)) return e; }
      await sleep(10);
    }
    throw new Error('기다림 초과: ' + label);
  };
  const phase = p => until(e => e.uri === '/lol-gameflow/v1/gameflow-phase' && e.data === p, p);
  const ctx = { queues: new Set(MOCK_QUEUES.map(q => q.id)) }; // 에이전트가 롤에서 받아 오는 '지금 열린 큐'
  const cmd = (name, args) => runCommand(lcu, name, args, ctx);
  return { lockfile, lcu, until, phase, cmd, done: () => { ws.close(); mock.close(); } };
}

// 내 차례마다 남은 챔피언을 호버→확정. 상대 호버가 새면 leaks 로 센다.
async function play(t) {
  const r = { leaks: 0, ban: 0, pick: 0, position: null };
  for (;;) {
    const e = await t.until(e => e.uri === '/lol-champ-select/v1/session' || (e.uri === '/lol-gameflow/v1/gameflow-phase' && e.data !== 'ChampSelect'), 'champ select');
    if (e.uri.endsWith('gameflow-phase')) return { ...r, end: e.data };
    if (!e.data) continue;
    const s = e.data, acts = s.actions.flat();
    r.position = s.myTeam.find(c => c.cellId === s.localPlayerCellId).assignedPosition;
    r.leaks += acts.filter(a => !a.isAllyAction && !a.completed && a.championId).length;
    const mine = acts.find(a => a.actorCellId === s.localPlayerCellId && a.isInProgress && !a.completed);
    if (!mine) continue;
    const used = new Set(acts.filter(a => a.completed).map(a => a.championId));
    const champ = (await t.cmd('getPickable')).data.find(c => !used.has(c));
    const h = await t.cmd('hover', { actionId: mine.id, championId: champ });
    const l = h.status < 300 && (await t.cmd('lockIn', { actionId: mine.id }));
    if (l && l.status < 300) r[mine.type]++; // 실패는 봇이 먼저 가져갔거나 지난 이벤트 — 다음 이벤트에서 다시
  }
}

console.log('딸깍 자체 검사');

// 1. 비밀번호
// 진짜 비밀번호는 저장소에 안 올림: test/.pw (git 제외) 또는 TTALKKAK_PW
const PW = process.env.TTALKKAK_PW ?? (fs.existsSync(new URL('./.pw', import.meta.url)) ? fs.readFileSync(new URL('./.pw', import.meta.url), 'utf8').trim() : null);
if (!PW) { console.log('test/.pw 가 없어 비밀번호가 필요한 시험은 건너뜀'); }
if (PW) assert.ok(checkPassword(PW));
if (PW) assert.ok(checkPassword('  ' + PW + '\r\n'));
for (const bad of ['', 'QWer', 'password', '1234', '차은우=정준화', ...(PW ? [PW.toLowerCase(), PW.slice(0, -1), PW + PW.at(-1)] : [])]) assert.ok(!checkPassword(bad), bad);
ok('비밀번호: 맞는 것만 통과');

// 2. 화이트리스트·인증
{
  const t = await setup();
  await assert.rejects(t.cmd('buyRP'), /허용되지/);
  await assert.rejects(t.cmd('constructor'), /허용되지/);
  await assert.rejects(t.cmd('hover', { actionId: '1/../../x', championId: 1 }), /잘못된/);
  await assert.rejects(t.cmd('createLobby', { queueId: 9999 }), /잘못된/); // 롤에 열려 있지 않은 큐
  await assert.rejects(t.cmd('setPositions', { first: 'mid', second: 'top' }), /잘못된/);
  const bad = connect({ ...readLockfile(t.lockfile), password: 'nope' });
  assert.equal((await bad.req('GET', '/lol-gameflow/v1/gameflow-phase')).status, 401);
  t.done();
  ok('허용 목록 밖 명령·잘못된 인자·틀린 인증은 막힘');
}

// 3. 랭크·드래프트 전체 흐름
for (const queueId of [420, 440, 400]) {
  const t = await setup();
  await t.cmd('createLobby', { queueId });
  assert.equal((await t.cmd('startSearch')).status, 400, '포지션 없이 매칭 시작은 거절');
  assert.equal((await t.cmd('setPositions', { first: 'middle', second: 'top' })).status, 204);
  assert.equal((await t.cmd('startSearch')).status, 204);
  await t.phase('ReadyCheck');
  assert.equal((await t.cmd('accept')).status, 204);
  await t.phase('ChampSelect');
  const r = await play(t);
  assert.equal(r.end, 'InProgress');
  assert.deepEqual([r.ban, r.pick, r.leaks], [1, 1, 0]);
  assert.ok(['middle', 'top'].includes(r.position), r.position);
  t.done();
  ok(`큐 ${queueId}: 매칭→수락→밴 1·픽 1→게임 시작, 포지션 ${r.position}, 상대 호버 안 보임`);
}

// 4. 아레나: 포지션 없음, 2인 팀 동시 금지 → 동시 픽 → 장비 준비 → 게임
{
  const t = await setup();
  await t.cmd('createLobby', { queueId: 1700 });
  assert.equal((await t.cmd('startSearch')).status, 204);
  await t.phase('ReadyCheck');
  await t.cmd('accept');
  await t.phase('ChampSelect');
  const r = await play(t);
  assert.deepEqual([r.end, r.ban, r.pick, r.position], ['InProgress', 1, 1, '']);
  t.done();
  ok('아레나: 포지션 없이 금지 1·픽 1 → 게임');
}

// 4-1. 칼바람: 내 카드만 고를 수 있음 → 장비 준비에서 벤치 교환·교환 요청 → 게임. 시간은 롤 값(남은/전체)으로 옴
{
  const t = await setup();
  await t.cmd('createLobby', { queueId: 450 });
  await t.cmd('startSearch');
  await t.phase('ReadyCheck');
  await t.cmd('accept');
  await t.phase('ChampSelect');
  const s = (await t.cmd('getSession')).data;
  assert.equal(s.timer.phase, 'BAN_PICK');
  assert.ok(s.timer.totalTimeInPhase === FAST.aramSec * 1000 && s.timer.adjustedTimeLeftInPhase <= s.timer.totalTimeInPhase, '카드 시간 = 롤 값');
  const cards = (await t.cmd('getPickable')).data;
  assert.ok(cards.length >= 1 && cards.length <= 3, '카드 ' + cards.length);
  const mine = s.actions.flat().find(a => a.actorCellId === s.localPlayerCellId);
  assert.equal((await t.cmd('hover', { actionId: mine.id, championId: 999 })).status, 400, '카드 밖 챔피언은 거절');
  await t.cmd('hover', { actionId: mine.id, championId: cards[0] });
  assert.equal((await t.cmd('lockIn', { actionId: mine.id })).status, 204);
  const f = await t.until(e => e.uri === '/lol-champ-select/v1/session' && e.data?.timer.phase === 'FINALIZATION', '장비 준비');
  const bench = f.data.benchChampions;
  assert.ok(f.data.benchEnabled && bench.length >= 3);
  assert.equal((await t.cmd('benchSwap', { championId: bench[0].championId })).status, 204);
  const after = (await t.cmd('getSession')).data;
  assert.equal(after.myTeam.find(c => c.cellId === after.localPlayerCellId).championId, bench[0].championId);
  assert.equal((await t.cmd('tradeAccept', { id: after.trades[0].id })).status, 204);
  await t.phase('InProgress');
  t.done();
  ok('칼바람: 카드 시간(롤 값 그대로), 카드 밖 거절, 벤치 교환, 교환 수락 → 게임');
}

// 4-2. 바로 게임: 신속 대전·TFT 는 수락 뒤 바로, 툭툭이(PvE)는 수락도 없이
for (const [queueId, needPos] of [[480, 1], [1100, 0]]) {
  const t = await setup();
  await t.cmd('createLobby', { queueId });
  if (needPos) {
    assert.equal((await t.cmd('startSearch')).status, 400, `${queueId}: 포지션 없이 매칭 시작은 거절`);
    await t.cmd('setPositions', { first: 'middle', second: 'top' });
    const pk = JSON.parse((await t.cmd('slotPerks', { championId: 103, position: 'middle' })).data); // 롤 추천 룬
    const slot = (championId, position) => ({ championId, position, spell1: 4, spell2: 14, perks: pk });
    assert.equal((await t.cmd('setSlots', { slots: [slot(103, 'middle'), slot(7, 'top')] })).status, 201);
    await assert.rejects(t.cmd('setSlots', { slots: [{ championId: 103, position: 'middle' }] }), /잘못된/); // 주문·룬 없으면 막힘
  }
  assert.equal((await t.cmd('startSearch')).status, 204);
  await t.phase('ReadyCheck');
  await t.cmd('accept');
  await t.phase('InProgress');
  t.done();
  ok(`큐 ${queueId}: 밴픽 없이 수락→게임${needPos ? ' (포지션·챔피언 미리)' : ''}`);
}
{
  const t = await setup();
  await t.cmd('createLobby', { queueId: 1220 });
  await t.cmd('startSearch');
  await t.phase('InProgress');
  t.done();
  ok('톡톡이의 시험: 수락 없이 바로 게임');
}
// 4-3. 룬: 잘못된 조합은 롤이 거절, 맞는 조합은 저장되고 현재 페이지가 됨 · 새 페이지
{
  const t = await setup();
  const ok9 = [8008, 9111, 9105, 8017, 8139, 8120, 5005, 5010, 5013];
  assert.equal((await t.cmd('perkSave', { id: 1, name: 'x', primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [8008, 9111, 9105, 8017, 8139, 8143, 5005, 5010, 5013] })).status, 400, '보조 같은 줄 2개는 거절');
  await assert.rejects(t.cmd('perkSave', { id: 1, primaryStyleId: 8000, subStyleId: 8000, selectedPerkIds: ok9 }), /잘못된/); // 주=보조 는 화이트리스트에서
  assert.equal((await t.cmd('perkSave', { id: 1, name: '딸깍', primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: ok9 })).status, 201);
  const made = await t.cmd('perkSave', { name: '새', primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: [8112, 8126, 8136, 8135, 9101, 8014, 5008, 5008, 5011] });
  assert.equal(made.status, 200);
  assert.equal((await t.cmd('perkSelect', { id: 1 })).status, 204);
  t.done();
  ok('룬: 롤 규칙대로 저장·새 페이지·페이지 바꾸기, 잘못된 조합 거절');
}
// 5. 실패 경로
for (const [label, act] of [
  ['수락 안 하면 로비로', async t => { await t.phase('ReadyCheck'); }],
  ['거절하면 로비로', async t => { await t.phase('ReadyCheck'); await t.cmd('decline'); }],
  ['매칭 취소하면 로비로', async t => { assert.equal((await t.cmd('cancelSearch')).status, 204); }],
  ['챔프 선택에서 시간 넘기면 닷지', async t => { await t.phase('ReadyCheck'); await t.cmd('accept'); await t.phase('ChampSelect'); }],
]) {
  const t = await setup();
  await t.cmd('createLobby', { queueId: 420 });
  await t.cmd('setPositions', { first: 'jungle', second: 'utility' });
  await t.cmd('startSearch');
  await act(t);
  await t.phase('Lobby');
  t.done();
  ok(label);
}

// 6. 에이전트 프로그램: 비밀번호 창 → 연결
async function runAgent(lockfile, inputs) {
  const p = spawn(process.execPath, [path.join(here, '..', 'agent', 'main.js')], { env: { ...process.env, TTALKKAK_LOCKFILE: lockfile, TTALKKAK_PORT: '0' } });
  let out = '';
  const exited = new Promise(r => p.on('exit', r)); // 마지막 입력 직후 바로 끝날 수 있어 먼저 걸어둔다
  p.stdout.setEncoding('utf8').on('data', d => (out += d));
  const waitOut = async (s, from) => { for (let i = 0; i < 300; i++) { if (out.indexOf(s, from) >= 0) return; await sleep(10); } throw new Error(`출력 없음: ${s}\n${out}`); };
  for (const line of inputs) {
    const at = out.length;
    await waitOut('비밀번호:', 0);
    p.stdin.write(line + '\n');
    if (line !== PW) await waitOut('틀렸습니다', at);
  }
  return { p, exited, waitOut, get out() { return out; } };
}
{
  const t = await setup();
  if (PW) { const a = await runAgent(t.lockfile, ['아무거나', PW]); await a.waitOut('연결됨', 0); a.p.kill(); }
  const b = await runAgent(t.lockfile, ['1', '2', '3', '4', '5']);
  const code = await b.exited;
  assert.equal(code, 1);
  assert.ok(!b.out.includes('연결됨'));
  t.done();
  ok('프로그램: 틀리면 다시 묻고, 맞으면 연결, 5번 틀리면 종료');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('전부 통과');
