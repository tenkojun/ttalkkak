// 가짜 롤 클라이언트(LCU). 실제 롤 없이 딸깍을 개발·시험하기 위한 것.
// 실제와 같은 모양: lockfile, Basic 인증(riot:비번), REST, WAMP 웹소켓 이벤트.
// 흐름: 로비 → 매칭 → 수락 대기 → 챔프 선택(큐 종류별) → 게임 중
//   draft  : 희망(PLANNING) → 금지 → 픽 → 장비 준비(FINALIZATION, 교환 요청 하나)
//   aram   : 카드 픽(내 카드만 고를 수 있음) → 장비 준비(벤치 교환 · 교환 요청)
//   arena  : 2인/3인 팀, 동시 금지 → 동시 픽 → 장비 준비
//   instant: 신속 대전·TFT → 수락 뒤 바로 게임 · pve: 매칭 없이 바로 게임
// 시간은 실제 롤처럼 timer.adjustedTimeLeftInPhase / totalTimeInPhase 로 내보낸다 (폰은 이 값만 씀).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { POSITIONS } from '../agent/lcu.js';

export const CHAMPS = [1, 7, 11, 18, 21, 22, 24, 25, 37, 40, 51, 53, 55, 59, 64, 81, 86, 89, 99, 103, 104, 117, 145, 157, 222, 236, 238, 245, 266, 412];

// 가짜 큐 목록 (실제 롤의 /lol-game-queues/v1/queues 모양 일부). flow 는 가짜 롤 내부용.
// 가짜 큐 목록 — 실제 롤(26.23) /lol-game-queues/v1/queues 에서 본 값과 같은 필드. flow 는 가짜 롤 내부용.
export const MOCK_QUEUES = [
  [420, 'CLASSIC', '개인/2인 랭크 게임', true, 'draft', 1, 'kSummonersRift', 20], [440, 'CLASSIC', '자유 랭크 게임', true, 'draft', 1, 'kSummonersRift', 10],
  [480, 'SWIFTPLAY', '신속 대전', false, 'instant', 1, 'kSummonersRift', 40], [400, 'CLASSIC', '일반', false, 'draft', 1, 'kSummonersRift', 30],
  [450, 'ARAM', '무작위 총력전', false, 'aram', 0, 'kARAM', 40], [2400, 'KIWI', '무작위 총력전: 아수라장', false, 'aram', 0, 'kARAM', 40],
  [1750, 'CHERRY', '아레나 3x6', false, 'arena3', 0, 'kAlternativeLeagueGameModes', 0], [1700, 'CHERRY', '아레나', false, 'arena', 0, 'kAlternativeLeagueGameModes', 0],
  [6110, 'TFT', '세트 17 (일반)', false, 'instant', 0, 'kTeamfightTactics', 0], [1220, 'TFT', '톡톡이의 시험', false, 'pve', 0, 'kTeamfightTactics', 0],
  [1090, 'TFT', '전략적 팀 전투 (일반)', false, 'instant', 0, 'kTeamfightTactics', 60], [1100, 'TFT', '전략적 팀 전투 (랭크)', true, 'instant', 0, 'kTeamfightTactics', 50],
  [700, 'CLASSIC', '격전', true, 'draft', 1, 'kSummonersRift', 0, false], // 숨김 큐: 폰 목록에 나오면 안 됨
].map(([id, gameMode, description, isRanked, flow, pos, group, prio, visible = true]) => ({ id, gameMode, description, shortName: description, isRanked, flow, pos,
  queueAvailability: 'Available', isVisible: visible, isCustom: false, gameSelectCategory: 'kPvP', gameSelectModeGroup: group, gameSelectPriority: prio,
  showPositionSelector: !!pos, showQuickPlaySlotSelection: flow === 'instant' && gameMode === 'SWIFTPLAY' }));
// 룬 (실제 구조 축소판: 스타일 2개)
const STYLES = [
  { id: 8000, name: '정밀', iconPath: '/lol-game-data/assets/v1/perk-images/Styles/7201_Precision.png', allowedSubStyles: [8100],
    slots: [{ type: 'kKeyStone', perks: [8005, 8008, 8021, 8010] }, { type: 'kMixedRegularSplashable', perks: [9101, 9111, 8009] }, { type: 'kMixedRegularSplashable', perks: [9104, 9105, 9103] },
      { type: 'kMixedRegularSplashable', perks: [8014, 8017, 8299] }, { type: 'kStatMod', perks: [5008, 5005, 5007] }, { type: 'kStatMod', perks: [5008, 5010, 5001] }, { type: 'kStatMod', perks: [5011, 5013, 5001] }] },
  { id: 8100, name: '지배', iconPath: '/lol-game-data/assets/v1/perk-images/Styles/7200_Domination.png', allowedSubStyles: [8000],
    slots: [{ type: 'kKeyStone', perks: [8112, 8128, 9923] }, { type: 'kMixedRegularSplashable', perks: [8126, 8139, 8143] }, { type: 'kMixedRegularSplashable', perks: [8136, 8120, 8138] },
      { type: 'kMixedRegularSplashable', perks: [8135, 8105, 8106] }, { type: 'kStatMod', perks: [5008, 5005, 5007] }, { type: 'kStatMod', perks: [5008, 5010, 5001] }, { type: 'kStatMod', perks: [5011, 5013, 5001] }] },
];const Q = id => MOCK_QUEUES.find(q => q.id === id);

export function startMock({ port = 0, lockfile, searchSec = 5, readySec = 12, turnSec = 30, planSec = 7, aramSec = 12, finalSec = 15, log } = {}) {
  const password = crypto.randomBytes(16).toString('base64url');
  const auth = 'Basic ' + Buffer.from('riot:' + password).toString('base64');
  let phase = 'None', lobby = null, ready = null, sess = null, search = null, timers = [], ticks = [];
  const later = (sec, fn) => timers.push(setTimeout(fn, sec * 1000));
  const every = (sec, fn) => ticks.push(setInterval(fn, sec * 1000));
  const stopTimers = () => { timers.forEach(clearTimeout); ticks.forEach(clearInterval); timers = []; ticks = []; };
  const err = message => ({ message });
  const clients = new Set();

  const emit = (uri, data, eventType = 'Update') => {
    const msg = JSON.stringify([8, 'OnJsonApiEvent', { uri, eventType, data }]);
    for (const c of clients) if (c.subscribed) c.send(msg);
  };
  const setPhase = p => { phase = p; log?.(`[가짜 롤] ${p}`); emit('/lol-gameflow/v1/gameflow-phase', p); };
  const flowOf = () => Q(lobby?.gameConfig.queueId)?.flow;
  const toLobby = () => {
    stopTimers();
    ready = null; search = null;
    if (sess) { sess = null; emit('/lol-champ-select/v1/session', null, 'Delete'); }
    setPhase('Lobby');
  };
  const toGame = () => { stopTimers(); ready = null; search = null; if (sess) { sess = null; emit('/lol-champ-select/v1/session', null, 'Delete'); } setPhase('InProgress'); };

  // ── 매칭: 경과 시간이 매초 올라감
  function startSearch() {
    search = { searchState: 'Searching', timeInQueue: 0, estimatedQueueTime: 90, errors: [] };
    setPhase('Matchmaking');
    emit('/lol-matchmaking/v1/search', search);
    every(1, () => { search.timeInQueue++; emit('/lol-matchmaking/v1/search', search); });
    later(searchSec, startReadyCheck);
  }

  // ── 수락 대기: 실제처럼 timer = 경과 초
  function startReadyCheck() {
    stopTimers();
    search = null;
    ready = { state: 'InProgress', playerResponse: 'None', timer: 0, declinerIds: [] };
    setPhase('ReadyCheck');
    emit('/lol-matchmaking/v1/ready-check', ready);
    every(1, () => { ready.timer++; emit('/lol-matchmaking/v1/ready-check', ready); });
    later(readySec, () => ready?.playerResponse !== 'Accepted' && toLobby());
  }

  // ── 챔피언 선택
  const all = () => sess.actions.flat();
  const usedChamps = () => new Set([...all().filter(a => a.completed).map(a => a.championId), ...sess.myTeam.map(c => c.championId), ...(sess.bench ?? []).map(b => b.championId)]);
  const freeChamp = () => { const u = usedChamps(); const f = CHAMPS.filter(c => !u.has(c)); return f[crypto.randomInt(f.length)]; };

  function view() {
    const bans = all().filter(a => a.type === 'ban' && a.completed);
    return {
      localPlayerCellId: sess.me,
      myTeam: sess.myTeam.map(c => ({ ...c })),
      theirTeam: sess.theirTeam.map(c => ({ ...c })),
      // 상대 호버는 실제 롤처럼 확정 전까지 숨긴다
      actions: sess.actions.map(ph => ph.map(a => (!a.isAllyAction && !a.completed ? { ...a, championId: 0 } : { ...a }))),
      bans: { myTeamBans: bans.filter(a => a.isAllyAction).map(a => a.championId), theirTeamBans: bans.filter(a => !a.isAllyAction).map(a => a.championId) },
      benchEnabled: !!sess.bench, benchChampions: (sess.bench ?? []).map(b => ({ ...b })),
      trades: sess.trades.map(t => ({ ...t })), pickOrderSwaps: [],
      timer: { phase: sess.tphase, adjustedTimeLeftInPhase: Math.max(0, sess.deadline - Date.now()), totalTimeInPhase: sess.total, internalNowInEpochMs: Date.now(), isInfinite: false },
    };
  }
  const emitSession = () => sess && emit('/lol-champ-select/v1/session', view());
  const setTimer = (tphase, sec) => { sess.tphase = tphase; sess.total = sec * 1000; sess.deadline = Date.now() + sec * 1000; };

  function startChampSelect() {
    stopTimers();
    ready = null;
    const flow = flowOf();
    if (flow === 'instant') return toGame();
    const size = flow === 'arena' ? 2 : flow === 'arena3' ? 3 : 5;
    const pos = Q(lobby.gameConfig.queueId).pos;
    const me = crypto.randomInt(size);
    const p1 = lobby.localMember.firstPositionPreference.toLowerCase(), p2 = lobby.localMember.secondPositionPreference.toLowerCase(); // 로비는 대문자, 챔프 선택 assignedPosition 은 소문자
    let mine = !pos ? '' : crypto.randomInt(10) < 8 ? p1 : p2; // 대부분 1지망
    if (pos && !POSITIONS.includes(mine)) mine = POSITIONS[crypto.randomInt(5)]; // 모두(fill)·없음 → 아무 데나
    const rest = POSITIONS.filter(p => p !== mine);
    const cell = (cellId, assignedPosition) => ({ cellId, assignedPosition: pos ? assignedPosition : '', championId: 0, championPickIntent: 0, spell1Id: 4, spell2Id: 14 });
    const myTeam = [...Array(size).keys()].map(i => cell(i, i === me ? mine : rest.shift()));
    const theirTeam = size === 5 ? POSITIONS.map((p, i) => cell(i + 5, p)) : [];
    let id = 0;
    const act = (c, type) => ({ id: id++, actorCellId: c, championId: 0, completed: false, isAllyAction: c < size, isInProgress: false, type });
    let actions;
    if (flow === 'aram') actions = [[...Array(5).keys()].map(c => act(c, 'pick'))];
    else if (size < 5) actions = [[...Array(size).keys()].map(c => act(c, 'ban')), [...Array(size).keys()].map(c => act(c, 'pick'))];
    else actions = [[...Array(10).keys()].map(c => act(c, 'ban')), ...[[0], [5, 6], [1, 2], [7, 8], [3, 4], [9]].map(ph => ph.map(c => act(c, 'pick')))];
    sess = { flow, me, myTeam, theirTeam, actions, idx: -1, deadline: 0, total: 0, tphase: 'PLANNING', trades: [], bench: flow === 'aram' ? [] : null };
    if (flow === 'aram') sess.cards = [freeChamp(), freeChamp()].filter((c, i, a) => a.indexOf(c) === i);
    setPhase('ChampSelect');
    if (flow === 'draft') { // 희망 챔피언 단계 (실제: 인트로 5 + 희망 7)
      setTimer('PLANNING', planSec); emitSession();
      later(planSec, nextPhase);
    } else nextPhase();
  }

  function nextPhase() {
    stopTimers();
    sess.idx++;
    if (sess.idx >= sess.actions.length) return finalization();
    const ph = sess.actions[sess.idx];
    ph.forEach(a => (a.isInProgress = true));
    const sec = sess.flow === 'aram' ? aramSec : turnSec;
    setTimer('BAN_PICK', sec);
    for (const a of ph) {
      if (a.actorCellId === sess.me) continue;
      later(sec * (0.1 + Math.random() * 0.3), () => {
        a.championId = freeChamp();
        if (a.type === 'pick' && a.isAllyAction) sess.myTeam[a.actorCellId].championPickIntent = a.championId;
        emitSession();
      });
      later(sec * (0.45 + Math.random() * 0.3), () => {
        if (!a.championId || usedChamps().has(a.championId)) a.championId = freeChamp();
        complete(a);
      });
    }
    if (sess.flow === 'aram') later(sec, () => { // 칼바람: 안 고르면 첫 카드
      const a = ph.find(x => x.actorCellId === sess.me);
      if (!a.completed) { a.championId = sess.cards[0]; complete(a); }
    });
    else later(sec, toLobby); // 시간 안에 못 고르면 닷지
    emitSession();
  }

  // 장비 준비: 칼바람은 고르지 않은 카드가 벤치로. 팀원 하나가 교환 요청.
  function finalization() {
    if (sess.bench) {
      sess.cards.filter(c => c !== sess.myTeam[sess.me].championId).forEach(c => sess.bench.push({ championId: c, isPriority: false }));
      for (let i = 0; i < 3; i++) sess.bench.push({ championId: freeChamp(), isPriority: false });
    }
    const mate = sess.myTeam.find(c => c.cellId !== sess.me);
    if (mate) sess.trades.push({ id: 1, cellId: mate.cellId, state: 'RECEIVED' });
    setTimer('FINALIZATION', finalSec);
    emitSession();
    later(sess.total / 1000, toGame);
  }

  function complete(a) {
    a.completed = true;
    a.isInProgress = false;
    if (a.type === 'pick') {
      const c = (a.isAllyAction ? sess.myTeam : sess.theirTeam).find(x => x.cellId === a.actorCellId);
      c.championId = a.championId;
      c.championPickIntent = 0;
    }
    if (sess.actions[sess.idx].every(x => x.completed)) nextPhase();
    else emitSession();
  }

  const myAction = n => phase === 'ChampSelect' && sess?.actions[sess.idx]?.find(a => a.id === n && a.actorCellId === sess.me && !a.completed);
  const myPlanning = n => phase === 'ChampSelect' && sess?.tphase === 'PLANNING' && all().find(a => a.id === n && a.actorCellId === sess.me && a.type === 'pick');
  const pickableIds = () => sess?.flow === 'aram' && sess.tphase === 'BAN_PICK' ? sess.cards : CHAMPS.filter(c => !sess || !usedChamps().has(c));
  const pickable = c => pickableIds().includes(c);

  // ── 룬 페이지
  const perks = { pages: [{ id: 1, name: '기본 정밀', isEditable: true, primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [8005, 9101, 9104, 8014, 8126, 8136, 5008, 5008, 5011] }], current: 1, next: 2 };
  const validPage = b => { // 롤과 같은 규칙: 주 4줄 각 1, 보조 2개(다른 줄), 능력치 3줄 각 1
    const ps = STYLES.find(s => s.id === b?.primaryStyleId), ss = STYLES.find(s => s.id === b?.subStyleId), p = b?.selectedPerkIds;
    if (!ps || !ss || ps === ss || !Array.isArray(p) || p.length !== 9) return false;
    const main = ps.slots.slice(0, 4), shard = ps.slots.slice(4), subRows = ss.slots.slice(1, 4);
    const r = i => subRows.findIndex(x => x.perks.includes(p[i]));
    return main.every((s, i) => s.perks.includes(p[i])) && r(4) >= 0 && r(5) >= 0 && r(4) !== r(5) && shard.every((s, i) => s.perks.includes(p[6 + i]));
  };
  const emitPerks = () => { emit('/lol-perks/v1/pages', perks.pages); emit('/lol-perks/v1/currentpage', perks.pages.find(p => p.id === perks.current)); };

  // ── REST
  const routes = [
    ['GET', /^\/lol-perks\/v1\/pages$/, () => [200, perks.pages]],
    ['GET', /^\/lol-perks\/v1\/currentpage$/, () => [200, perks.pages.find(p => p.id === perks.current)]],
    ['GET', /^\/lol-perks\/v1\/inventory$/, () => [200, { canAddCustomPage: perks.pages.length < 3 }]],
    ['GET', /^\/lol-perks\/v1\/styles$/, () => [200, STYLES]],
    ['GET', /^\/lol-perks\/v1\/perks$/, () => [200, [...new Set(STYLES.flatMap(s => s.slots.flatMap(x => x.perks)))].map(id => ({ id, name: '룬 ' + id, iconPath: '', shortDesc: '' }))]],
    ['PUT', /^\/lol-perks\/v1\/currentpage$/, b => { if (!perks.pages.some(p => p.id === b)) return [404, err('없는 페이지')]; perks.current = b; emitPerks(); return [204, null]; }],
    ['PUT', /^\/lol-perks\/v1\/pages\/(\d+)$/, (b, m) => {
      const pg = perks.pages.find(p => p.id === Number(m[1]));
      if (!pg?.isEditable) return [400, err('고칠 수 없는 페이지')];
      if (!validPage(b)) return [400, err('룬 조합이 잘못됨')];
      Object.assign(pg, { name: b.name, primaryStyleId: b.primaryStyleId, subStyleId: b.subStyleId, selectedPerkIds: b.selectedPerkIds });
      if (b.current) perks.current = pg.id;
      emitPerks(); return [201, pg];
    }],
    ['POST', /^\/lol-perks\/v1\/pages$/, b => {
      if (perks.pages.length >= 3) return [400, err('페이지가 꽉 참')];
      if (!validPage(b)) return [400, err('룬 조합이 잘못됨')];
      const pg = { id: perks.next++, isEditable: true, name: b.name, primaryStyleId: b.primaryStyleId, subStyleId: b.subStyleId, selectedPerkIds: b.selectedPerkIds };
      perks.pages.push(pg); perks.current = pg.id; emitPerks(); return [200, pg];
    }],
    ['GET', /^\/lol-gameflow\/v1\/gameflow-phase$/, () => [200, phase]],
    ['GET', /^\/lol-gameflow\/v1\/session$/, () => [200, { phase, gameData: { queue: lobby ? Q(lobby.gameConfig.queueId) : {} } }]],
    ['GET', /^\/lol-game-queues\/v1\/queues$/, () => [200, MOCK_QUEUES]],
    ['GET', /^\/lol-summoner\/v1\/current-summoner$/, () => [200, { gameName: '테스트소환사', tagLine: 'KR1' }]],
    ['GET', /^\/lol-lobby\/v2\/lobby$/, () => (lobby ? [200, lobby] : [404, err('로비 없음')])],
    ['POST', /^\/lol-lobby\/v2\/lobby$/, b => {
      const q = Q(b?.queueId);
      if (!q) return [400, err('지원하지 않는 큐')];
      if (!['None', 'Lobby', 'InProgress'].includes(phase)) return [400, err('지금은 로비를 만들 수 없음')];
      lobby = { gameConfig: { queueId: q.id, gameMode: q.gameMode, showPositionSelector: !!q.pos, isCustom: false },
        localMember: { isLeader: true, firstPositionPreference: '', secondPositionPreference: '', puuid: 'me' }, members: [{ puuid: 'me', isLeader: true }] };
      setPhase('Lobby');
      emit('/lol-lobby/v2/lobby', lobby);
      return [200, lobby];
    }],
    ['PUT', /^\/lol-lobby\/v2\/lobby\/members\/localMember\/position-preferences$/, b => {
      if (phase !== 'Lobby') return [400, err('로비에서만 바꿀 수 있음')];
      const { firstPreference: f, secondPreference: s } = b ?? {};
      const UP = POSITIONS.map(x => x.toUpperCase()); // 실제 롤과 같게 대문자만
      if (![...UP, 'FILL'].includes(f) || ![...UP, 'FILL', 'UNSELECTED'].includes(s) || f === s) return [400, err('BAD_JSON_FORMAT')];
      Object.assign(lobby.localMember, { firstPositionPreference: f, secondPositionPreference: s });
      emit('/lol-lobby/v2/lobby', lobby);
      return [204, null];
    }],
    ['GET', /^\/lol-perks\/v1\/quick-play-selections\/champion\/(\d+)\/position\/([A-Z]+)$/, () => [200, JSON.stringify({ perkIds: [8005, 9101, 9104, 8014, 8126, 8136, 5008, 5008, 5011], perkStyle: 8000, perkSubStyle: 8100 })]],
    ['GET', /^\/lol-champions\/v1\/owned-champions-minimal$/, () => [200, CHAMPS.map(id => ({ id, ownership: { owned: true } }))]],
    ['PUT', /^\/lol-lobby\/v1\/lobby\/members\/localMember\/player-slots$/, b => {
      if (phase !== 'Lobby' || !Array.isArray(b)) return [400, err('로비에서만')];
      if (b.some(s => typeof s.perks !== 'string' || !/^[A-Z]+$/.test(s.positionPreference))) return [400, err('칸 모양이 틀림')]; // 실제 롤: perks 는 JSON 문자열, 포지션 대문자
      lobby.localMember.playerSlots = b; emit('/lol-lobby/v2/lobby', lobby); return [201, null];
    }],
    ['POST', /^\/lol-lobby\/v2\/lobby\/matchmaking\/search$/, () => {
      if (phase !== 'Lobby') return [400, err('로비에서만 매칭 시작 가능')];
      if (lobby.gameConfig.showPositionSelector && !lobby.localMember.firstPositionPreference) return [400, err('포지션을 먼저 골라야 함')];
      if (flowOf() === 'pve') { toGame(); return [204, null]; } // 툭툭이의 시험: 상대 없음
      startSearch();
      return [204, null];
    }],
    ['DELETE', /^\/(lol-lobby\/v2\/lobby\/matchmaking|lol-matchmaking\/v1)\/search$/, () => {
      if (phase !== 'Matchmaking') return [400, err('매칭 중이 아님')];
      toLobby();
      return [204, null];
    }],
    ['GET', /^\/lol-matchmaking\/v1\/search$/, () => (search ? [200, search] : [404, err('매칭 중 아님')])],
    ['GET', /^\/lol-matchmaking\/v1\/ready-check$/, () => (ready ? [200, ready] : [404, err('수락 대기 아님')])],
    ['POST', /^\/lol-matchmaking\/v1\/ready-check\/accept$/, () => {
      if (phase !== 'ReadyCheck') return [400, err('수락 대기 아님')];
      ready.playerResponse = 'Accepted';
      emit('/lol-matchmaking/v1/ready-check', ready);
      stopTimers();
      later(Math.min(1, readySec / 5), startChampSelect);
      return [204, null];
    }],
    ['POST', /^\/lol-matchmaking\/v1\/ready-check\/decline$/, () => {
      if (phase !== 'ReadyCheck') return [400, err('수락 대기 아님')];
      toLobby();
      return [204, null];
    }],
    ['GET', /^\/lol-champ-select\/v1\/session$/, () => (phase === 'ChampSelect' ? [200, view()] : [404, err('챔피언 선택 아님')])],
    ['GET', /^\/lol-champ-select\/v1\/pickable-champion-ids$/, () => [200, pickableIds()]],
    ['GET', /^\/lol-lobby-team-builder\/champ-select\/v1\/subset-champion-list$/, () => sess?.flow === 'aram' && sess.tphase === 'BAN_PICK' ? [200, sess.cards] : [404, { message: 'No active delegate' }]], // 칼바람 카드
    ['GET', /^\/lol-champ-select\/v1\/bannable-champion-ids$/, () => [200, pickableIds()]],
    ['PATCH', /^\/lol-champ-select\/v1\/session\/actions\/(\d+)$/, (b, m) => {
      const a = myAction(Number(m[1])) || myPlanning(Number(m[1]));
      if (!a) return [404, err('지금 내 차례가 아님')];
      if (!pickable(b?.championId)) return [400, err('고를 수 없는 챔피언')];
      a.championId = b.championId;
      if (a.type === 'pick') sess.myTeam.find(c => c.cellId === sess.me).championPickIntent = a.championId;
      emitSession();
      return [204, null];
    }],
    ['POST', /^\/lol-champ-select\/v1\/session\/actions\/(\d+)\/complete$/, (b, m) => {
      const a = myAction(Number(m[1]));
      if (!a) return [404, err('지금 내 차례가 아님')];
      if (!pickable(a.championId)) return [400, err('먼저 고를 수 있는 챔피언을 골라야 함')];
      complete(a);
      return [204, null];
    }],
    ['POST', /^\/lol-champ-select\/v1\/session\/bench\/swap\/(\d+)$/, (b, m) => {
      if (!sess?.bench || sess.tphase !== 'FINALIZATION') return [400, err('벤치 없음')];
      const k = sess.bench.findIndex(x => x.championId === Number(m[1]));
      if (k < 0) return [404, err('벤치에 없는 챔피언')];
      const meCell = sess.myTeam.find(c => c.cellId === sess.me);
      [sess.bench[k].championId, meCell.championId] = [meCell.championId, sess.bench[k].championId];
      emitSession();
      return [204, null];
    }],
    ['POST', /^\/lol-champ-select\/v1\/session\/trades\/(\d+)\/(accept|decline)$/, (b, m) => {
      const t = sess?.trades.find(x => x.id === Number(m[1]) && x.state === 'RECEIVED');
      if (!t) return [404, err('교환 요청 없음')];
      if (m[2] === 'accept') {
        const a = sess.myTeam.find(c => c.cellId === sess.me), o = sess.myTeam.find(c => c.cellId === t.cellId);
        [a.championId, o.championId] = [o.championId, a.championId];
      }
      t.state = m[2] === 'accept' ? 'ACCEPTED' : 'DECLINED';
      emitSession();
      return [204, null];
    }],
  ];

  const server = http.createServer(async (req, res) => {
    const send = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(data == null ? '' : JSON.stringify(data));
    };
    if (req.headers.authorization !== auth) return send(401, err('인증 실패'));
    let body = '';
    for await (const ch of req) body += ch;
    let json = null;
    try { json = body ? JSON.parse(body) : null; } catch { return send(400, err('JSON 아님')); }
    const url = req.url.split('?')[0];
    for (const [method, re, fn] of routes) {
      const m = req.method === method && url.match(re);
      if (m) return send(...fn(json, m));
    }
    send(404, err(`없는 경로: ${req.method} ${url}`));
  });

  const wss = new WebSocketServer({ server, verifyClient: ({ req }) => req.headers.authorization === auth });
  wss.on('connection', ws => {
    clients.add(ws);
    ws.on('message', m => {
      try {
        const [op, ev] = JSON.parse(m);
        if (op === 5 && ev === 'OnJsonApiEvent') ws.subscribed = true;
      } catch {}
    });
    ws.on('close', () => clients.delete(ws));
  });

  return new Promise(resolve =>
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      if (lockfile) fs.writeFileSync(lockfile, `LeagueClient:${process.pid}:${p}:${password}:http`);
      resolve({
        port: p,
        close() {
          stopTimers();
          wss.clients.forEach(c => c.terminate());
          wss.close();
          server.close();
          if (lockfile) fs.rmSync(lockfile, { force: true });
        },
      });
    }),
  );
}

// npm run mock — 사람 속도(실제 롤과 같은 시간)로 띄운다
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const lockfile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lockfile');
  const m = await startMock({ lockfile, log: console.log });
  console.log(`가짜 롤 클라이언트 실행 중 (포트 ${m.port}). 끄려면 Ctrl+C`);
  process.on('SIGINT', () => { m.close(); process.exit(0); });
}
