// 롤 클라이언트(LCU) 로컬 API 접속. 실제 롤과 가짜 롤(mock-lcu) 모두 같은 코드로 붙는다.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import WebSocket from 'ws';

import { execFileSync } from 'node:child_process';

export const POSITIONS = ['top', 'jungle', 'middle', 'bottom', 'utility'];

// 롤 '플레이' 화면에 보이는 사람 상대 큐만 (AI·사용자 설정·격전·튜토리얼·숨김 제외), 클라이언트 순서대로
export const visibleQueues = queues => (queues ?? [])
  .filter(q => q.queueAvailability === 'Available' && q.isVisible && q.gameSelectCategory === 'kPvP' &&
    ['kSummonersRift', 'kARAM', 'kAlternativeLeagueGameModes', 'kTeamfightTactics'].includes(q.gameSelectModeGroup))
  .sort((a, b) => b.gameSelectPriority - a.gameSelectPriority)
  .map(q => ({ id: q.id, name: q.shortName || q.description || q.name, group: q.gameSelectModeGroup, cat: q.gameSelectCategory, gameMode: q.gameMode,
    isRanked: q.isRanked, mapId: q.mapId, pos: !!q.showPositionSelector, slots: !!q.showQuickPlaySlotSelection, desc: q.detailedDescription || q.description }));

// 롤 클라이언트 찾기: 실행 중인 LeagueClientUx 의 명령줄(포트·토큰) → 안 되면 기본 설치 경로 lockfile
export function findClient() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\").CommandLine"], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const port = out.match(/--app-port=(\d+)/)?.[1], password = out.match(/--remoting-auth-token=([\w-]+)/)?.[1];
    if (port && password) return { port: Number(port), password, protocol: 'https' };
  } catch {}
  for (const f of ['C:\\Riot Games\\League of Legends\\lockfile', 'D:\\Riot Games\\League of Legends\\lockfile']) {
    try { return readLockfile(f); } catch {}
  }
  return null;
}

// lockfile 형식: 이름:pid:포트:비밀번호:프로토콜
export function readLockfile(file) {
  const [, , port, password, protocol] = fs.readFileSync(file, 'utf8').trim().split(':');
  return { port: Number(port), password, protocol };
}

export function connect(lock) {
  const auth = 'Basic ' + Buffer.from('riot:' + lock.password).toString('base64');
  const secure = lock.protocol === 'https';
  const mod = secure ? https : http;

  function req(method, path, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const headers = { Authorization: auth, Accept: 'application/json' };
      if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
      // 실제 롤은 127.0.0.1 전용 자체 서명 인증서라 검증을 끈다
      const r = mod.request({ host: '127.0.0.1', port: lock.port, method, path, headers, rejectUnauthorized: false }, res => {
        let s = '';
        res.setEncoding('utf8');
        res.on('data', c => (s += c));
        res.on('end', () => {
          let d = s;
          try { d = s ? JSON.parse(s) : null; } catch {}
          resolve({ status: res.statusCode, data: d });
        });
      });
      r.on('error', reject);
      r.end(data ?? undefined);
    });
  }

  // WAMP 구독: [5,"OnJsonApiEvent"] 을 보내면 [8,"OnJsonApiEvent",{uri,eventType,data}] 가 계속 온다
  function subscribe(onEvent) {
    const ws = new WebSocket(`${secure ? 'wss' : 'ws'}://127.0.0.1:${lock.port}/`, { headers: { Authorization: auth }, rejectUnauthorized: false });
    ws.on('open', () => ws.send(JSON.stringify([5, 'OnJsonApiEvent'])));
    ws.on('message', m => {
      try {
        const [op, , ev] = JSON.parse(m);
        if (op === 8) onEvent(ev);
      } catch {}
    });
    return ws;
  }

  return { req, subscribe };
}

const id = v => Number.isInteger(v) && v >= 0;
const CS = '/lol-champ-select/v1/session';

// 폰에서 올 수 있는 명령은 이것뿐. 그 밖의 LCU 호출(상점·계정·채팅 등)은 절대 중계하지 않는다.
// ctx.queues = 롤이 지금 열어 둔 큐 번호(Set) — 로비는 그 안에서만 만든다
export const COMMANDS = {
  getPhase: () => ['GET', '/lol-gameflow/v1/gameflow-phase'],
  getSession: () => ['GET', CS],
  getPickable: () => ['GET', '/lol-champ-select/v1/pickable-champion-ids'],
  createLobby: (a, ctx) => id(a.queueId) && ctx?.queues?.has(a.queueId) && ['POST', '/lol-lobby/v2/lobby', { queueId: a.queueId }],
  setPositions: a =>
    [...POSITIONS, 'fill'].includes(a.first) && [...POSITIONS, 'fill', 'unselected'].includes(a.second) && a.first !== a.second && // 모두(FILL)면 2지망 UNSELECTED
    ['PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', { firstPreference: a.first.toUpperCase(), secondPreference: a.second.toUpperCase() }], // 실제 롤은 대문자 (소문자면 BAD_JSON_FORMAT),
  startSearch: () => ['POST', '/lol-lobby/v2/lobby/matchmaking/search'],
  cancelSearch: () => ['DELETE', '/lol-matchmaking/v1/search'], // 실제 롤: 로비 쪽 DELETE 는 204 인데 대기열이 안 풀린 적 있음 (11/24)
  accept: () => ['POST', '/lol-matchmaking/v1/ready-check/accept'],
  decline: () => ['POST', '/lol-matchmaking/v1/ready-check/decline'],
  hover: a => id(a.actionId) && id(a.championId) && ['PATCH', `${CS}/actions/${a.actionId}`, { championId: a.championId }],
  lockIn: a => id(a.actionId) && ['POST', `${CS}/actions/${a.actionId}/complete`],
  benchSwap: a => id(a.championId) && ['POST', `${CS}/bench/swap/${a.championId}`],                 // 칼바람 벤치
  reroll: () => ['POST', `${CS}/my-selection/reroll`],
  tradeAccept: a => id(a.id) && ['POST', `${CS}/trades/${a.id}/accept`],                           // 챔피언 교환
  tradeDecline: a => id(a.id) && ['POST', `${CS}/trades/${a.id}/decline`],
  swapAccept: a => id(a.id) && ['POST', `${CS}/swaps/${a.id}/accept`],                             // 픽 순서 교환
  swapDecline: a => id(a.id) && ['POST', `${CS}/swaps/${a.id}/decline`],
  // 룬: 페이지 고르기 · 저장(있으면 고치고 없으면 새로). 9개 = 핵심 1 + 주 3 + 보조 2 + 능력치 3
  perkSelect: a => id(a.id) && ['PUT', '/lol-perks/v1/currentpage', a.id],
  perkSave: a => (a.id == null || id(a.id)) && id(a.primaryStyleId) && id(a.subStyleId) && a.primaryStyleId !== a.subStyleId &&
    Array.isArray(a.selectedPerkIds) && a.selectedPerkIds.length === 9 && a.selectedPerkIds.every(id) &&
    [a.id == null ? 'POST' : 'PUT', a.id == null ? '/lol-perks/v1/pages' : `/lol-perks/v1/pages/${a.id}`,
      { name: String(a.name ?? '딸깍').slice(0, 25), primaryStyleId: a.primaryStyleId, subStyleId: a.subStyleId, selectedPerkIds: a.selectedPerkIds, current: true }],
  // 신속 대전 미리 고르기 (실제 롤 26.23 에서 확인한 모양): 칸마다 챔피언·포지션(대문자)·스킨·주문 2·룬(JSON 문자열)
  setSlots: a => Array.isArray(a.slots) && a.slots.length >= 1 && a.slots.length <= 2 && a.slots.every(s =>
    id(s.championId) && POSITIONS.includes(s.position) && id(s.spell1) && id(s.spell2) && (s.skinId == null || id(s.skinId)) &&
    Array.isArray(s.perks?.perkIds) && s.perks.perkIds.length === 9 && s.perks.perkIds.every(id) && id(s.perks.perkStyle) && id(s.perks.perkSubStyle)) &&
    ['PUT', '/lol-lobby/v1/lobby/members/localMember/player-slots', a.slots.map(s => ({
      championId: s.championId, positionPreference: s.position.toUpperCase(), skinId: s.skinId ?? s.championId * 1000, spell1: s.spell1, spell2: s.spell2,
      perks: JSON.stringify({ perkIds: s.perks.perkIds, perkStyle: s.perks.perkStyle, perkSubStyle: s.perks.perkSubStyle }) }))],
  // 챔피언+포지션 추천 룬 (롤이 신속 대전 칸에 넣는 기본값)
  slotPerks: a => id(a.championId) && POSITIONS.includes(a.position) && ['GET', `/lol-perks/v1/quick-play-selections/champion/${a.championId}/position/${a.position.toUpperCase()}`],
};

export async function runCommand(lcu, name, args = {}, ctx) {
  if (!Object.hasOwn(COMMANDS, name)) throw new Error('허용되지 않은 명령: ' + name);
  const r = COMMANDS[name](args ?? {}, ctx);
  if (!r) throw new Error('잘못된 인자: ' + name);
  const res = await lcu.req(...r);
  if (name === 'setSlots' && res.status < 300) await syncSlotPages(lcu, args.slots).catch(() => {});
  return res;
}

// 실제 롤(11/24 확인): 신속 대전 칸마다 '챔피언 - 핵심룬' 페이지가 붙어 있고, 칸 룬과 그 페이지가 다르면 칸에 빨간 ! 가 뜬다.
// 그래서 칸 룬을 바꾸면 그 챔피언 이름으로 시작하는 페이지도 같은 룬으로 맞춘다.
export async function syncSlotPages(lcu, slots) {
  const get = async p => { const r = await lcu.req('GET', p); return r.status < 300 ? r.data : null; };
  const [pages, champs, perks] = await Promise.all([get('/lol-perks/v1/pages'), get('/lol-game-data/assets/v1/champion-summary.json'), get('/lol-perks/v1/perks')]);
  if (!pages || !champs) return;
  for (const s of slots) {
    const ids = s.perks.perkIds, champ = champs.find(c => c.id === s.championId)?.name;
    if (!champ || pages.some(p => JSON.stringify(p.selectedPerkIds) === JSON.stringify(ids))) continue;
    const pg = pages.filter(p => p.isEditable && p.name?.startsWith(champ + ' - ')).sort((a, b) => b.isTemporary - a.isTemporary)[0];
    if (!pg) continue; // shortcut: 페이지가 없으면 못 맞춤 — 롤이 칸에 페이지를 안 만든 경우가 보이면 그때 새로 만들기 추가
    const key = perks?.find(p => p.id === ids[0])?.name;
    await lcu.req('PUT', `/lol-perks/v1/pages/${pg.id}`, { ...pg, name: key ? `${champ} - ${key}` : pg.name, primaryStyleId: s.perks.perkStyle, subStyleId: s.perks.perkSubStyle, selectedPerkIds: ids });
  }
}
