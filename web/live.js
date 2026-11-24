// 딸깍 실사용 모드: 에이전트(PC)가 띄운 페이지(주소 끝이 /)에서만 켜진다. 시연 코드 대신 롤이 보낸 상태를 그린다.
// 원칙: 시간·단계·고를 수 있는 챔피언은 전부 롤 값. 폰은 상태를 들고 있지 않고 매번 S 를 그림.
(() => {
  const LIVE = location.pathname === '/' || new URLSearchParams(location.search).has('live');
  if (!LIVE) return;
  const $ = (s, r = document) => r.querySelector(s);
  const POS = ['top', 'jungle', 'middle', 'bottom', 'utility', 'fill']; // 5 = 모두
  const pos2 = () => prefs[1] >= 0 ? POS[prefs[1]] : 'unselected';
  const mmss = s => `${String(Math.max(0, s) / 60 | 0).padStart(2, '0')}:${String(Math.max(0, s | 0) % 60).padStart(2, '0')}`;
  let ws = null, S = null, at = 0, token = null, nid = 0;
  const pending = {};
  let room = '';
  try { token = localStorage.getItem('ttalkkak-token'); room = localStorage.getItem('ttalkkak-room') ?? ''; } catch {}

  // ── 챔피언 이름·그림: Data Dragon (폰이 직접 받음)
  let DD = {}, ver = '';
  fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r => r.json()).then(v => (ver = v[0], fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/ko_KR/champion.json`)))
    .then(r => r.json()).then(j => { for (const c of Object.values(j.data)) DD[c.key] = { id: c.id, name: c.name }; render(); })
    .then(() => fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/ko_KR/summoner.json`)).then(r => r.json())
    .then(j => { SP = Object.values(j.data).filter(s => s.modes.includes('CLASSIC')).map(s => ({ id: +s.key, name: s.name, img: `https://ddragon.leagueoflegends.com/cdn/${ver}/img/spell/${s.image.full}` })); render(); }).catch(() => {});
  let SP = []; // 소환사의 협곡 소환사 주문
  const cimg = id => DD[id] ? `https://ddragon.leagueoflegends.com/cdn/${ver}/img/champion/${DD[id].id}.png` : '';
  const cname = id => DD[id]?.name ?? (id ? '#' + id : '');

  // ── 알림 한 줄 (명령 실패 등)
  const note = msg => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:50%;top:14px;translate:-50% 0;z-index:40;background:#140405f2;border:1px solid #b3191f;color:#efebe6;padding:13px 18px;font-size:15px;max-width:88vw;text-align:center';
    d.textContent = msg; document.body.append(d); setTimeout(() => d.remove(), 2600);
  };
  const cmd = (name, args) => new Promise(res => {
    if (ws?.readyState !== 1) { note('PC 와 연결이 끊겼어요'); return res({ ok: false }); }
    const id = ++nid; pending[id] = res;
    ws.send(JSON.stringify({ t: 'cmd', id, name, args }));
  }).then(r => { if (!r.ok) note(r.msg || `안 됐어요 (${r.status ?? '오류'})`); return r; });

  // ═══ 1. 연결: 실제 PIN 입력
  const pinIn = document.createElement('input');
  Object.assign(pinIn, { type: 'tel', inputMode: 'numeric', maxLength: 6, autocomplete: 'one-time-code' });
  pinIn.style.cssText = 'position:absolute;inset:0;opacity:0;font-size:16px;width:100%;height:100%';
  pinBox.append(pinIn);
  const ask = $('.s1 [data-cy="500"]');
  const drawPin = () => {
    const v = pinIn.value.replace(/\D/g, '').slice(0, 6); pinIn.value = v;
    pin.forEach((d, i) => { d.className = i < v.length ? 'hit' : i === v.length ? 'cur' : ''; d.textContent = v[i] ?? ''; });
    pinBox.classList.toggle('done', v.length === 6);
    if (v.length === 6) connect(v);
  };
  pinIn.oninput = drawPin;
  onEnter[1] = () => { pinIn.value = ''; drawPin(); setTimeout(() => pinIn.focus(), 300); };
  connectBtn.onclick = () => (pinIn.value.length === 6 ? connect(pinIn.value) : pinIn.focus());

  let retry = null;
  function connect(p) {
    clearTimeout(retry);
    ws?.close();
    if (p) room = p; // 중계에선 PIN = 방 번호 (같은 와이파이 PC 서버는 무시)
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${room}`);
    ws.onopen = () => ws.send(JSON.stringify(p ? { t: 'hello', pin: p } : { t: 'hello', token }));
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'auth') {
        if (m.ok) { token = m.token; try { localStorage.setItem('ttalkkak-token', token); localStorage.setItem('ttalkkak-room', room); } catch {} }
        else { token = null; try { localStorage.removeItem('ttalkkak-token'); } catch {} setText(ask, m.why || 'PIN 이 틀렸어요'); pinIn.value = ''; drawPin();
          pinBox.animate([{ translate: '0' }, { translate: '-8px' }, { translate: '8px' }, { translate: '0' }], { duration: 300 }); if (cur() !== 1) show(1); }
      }
      if (m.t === 'rehello') ws.send(JSON.stringify({ t: 'hello', token })); // PC 가 다시 켜짐
      if (m.t === 'pc-off') { // 중계: 방에 PC 없음
        if (!token) { setText(ask, 'PC 가 꺼져 있거나 PIN 이 틀렸어요'); pinIn.value = ''; drawPin(); }
        else if (S) { S.lol = false; S.pc = false; render(); goText('OFFLINE', 'PC 프로그램 꺼짐 · 켜지면 자동 연결'); }
      }
      if (m.t === 'state') { S = m.s; at = Date.now(); render(); }
      if (m.t === 'res') { pending[m.id]?.(m); delete pending[m.id]; }
    };
    ws.onclose = () => { if (token) { goText('OFFLINE', 'PC 와 연결 끊김 · 다시 잇는 중'); retry = setTimeout(() => connect(), 2000); } };
  }

  // ═══ 화면 고르기: 롤 단계 그대로
  const cur = () => screens.findIndex(s => s.classList.contains('on')) + 1;
  function render() {
    if (!S) return;
    const target = !S.lol ? 2 : S.phase === 'ReadyCheck' ? 3 : S.phase === 'ChampSelect' ? 4 : 2;
    if (cur() !== target) return show(target); // onEnter 가 그림
    ({ 2: render2, 3: render3, 4: render4 })[target]?.();
  }
  onEnter[2] = () => render2();

  // ═══ 2. 모드·포지션·매칭
  let qKey = '', syncing = false;
  const flowOf = q => q.gameMode === 'TFT' ? (/톡톡이|툭툭이|tocker/i.test(q.name) ? 'pve' : 'tft') : /ARAM|KIWI/.test(q.gameMode) ? 'aram'
    : q.gameMode === 'CHERRY' ? 'arena' : q.gameMode === 'SWIFTPLAY' ? 'swift' : 'draft';
  // 롤 '플레이' 화면과 같은 묶음 (gameSelectModeGroup). 랭크/일반은 같은 줄 안에서 고름 — 클라이언트와 같게
  const GROUPS = [['kSummonersRift', 'RIFT'], ['kARAM', 'ARAM'], ['kAlternativeLeagueGameModes', 'SPECIAL'], ['kTeamfightTactics', 'TFT']]; // 사람 상대 4묶음만 (AI 대전 뺌 · 사용자 지시)
  // 롤 내부 코드(KIWI=아수라장, CHERRY=아레나 …) 대신 보이는 이름
  const MODE_EN = { CLASSIC: "SUMMONER'S RIFT", ARAM: 'ARAM', KIWI: 'MAYHEM', CHERRY: 'ARENA', TFT: 'TFT', SWIFTPLAY: 'SWIFTPLAY', URF: 'URF', JADE: 'CLASSIC' };
  function buildQueues() {
    const key = S.queues.map(q => q.id).join();
    if (key === qKey || !S.queues.length) return;
    qKey = key; $('#subq').style.display = '';
    const rows = GROUPS.map(([g, label]) => [label, S.queues.filter(q => (q.cat === 'kVersusAI' ? 'AI' : q.group) === g)]).filter(r => r[1].length);
    QUEUES.length = 0;
    rows.forEach(([, qs]) => QUEUES.push(qs.map(q => {
      const flow = q.slots ? 'swift' : flowOf(q);
      return { id: q.id, n: q.name, flow, pos: q.pos || q.slots ? 1 : 0, /* 신속 대전도 포지션 2칸 + 챔피언 */ note: [q.cat === 'kVersusAI' ? 'VS AI' : MODE_EN[q.gameMode] ?? q.name, q.name] }; // 설명 칸엔 롤의 한글 이름만 (Jade 같은 코드명 안 나오게)
    })));
    // 큰 글자 줄을 묶음 수만큼 다시 만듦 (시안 자리 218~346 안에 고르게)
    modes.forEach(m => m.remove()); modes.length = 0;
    const n = rows.length, pitch = n > 1 ? 128 / (n - 1) : 0, h = Math.min(44, pitch ? pitch * .86 : 44); // 폰에서 잘 보이게 시안 자리보다 넓게
    rows.forEach(([label], i) => {
      const m = document.createElement('div');
      m.className = 't f-os mode';
      Object.assign(m.dataset, { cy: 162 + i * pitch, h, w: Math.min(230, label.length * 33) });
      m.textContent = label;
      $('#subq').before(m); fitText(m); modeClick(m); modes.push(m);
    });
    subI = rows.map(() => 0); modeI = Math.min(modeI, n - 1);
    syncing = true; setMode(modeI); syncing = false;
  }
  const goText = (a, b) => { setText(goA, a, a.length > 6 ? 190 : 140); setText(goB, b, null); };
  function render2() {
    if (!S.lol) { if (!qKey) { modes.forEach(m => (m.style.display = 'none')); $('#subq').style.display = 'none'; } // 롤 목록 전엔 시안용 가짜 모드 줄(RANKED·NORMAL·TFT)을 안 보임
      go.classList.remove('searching', 'ingame'); goText('OFFLINE', 'PC 롤 꺼짐 · 켜지면 자동 연결'); setText(pcl, 'PC 롤 기다리는 중', null); return; }
    buildQueues();
    const L = S.lobby;
    // PC 로비 그대로: 큐·포지션을 폰에 맞춤
    if (L) {
      const qid = L.gameConfig?.queueId;
      QUEUES.forEach((g, i) => g.forEach((q, k) => { if (q.id === qid && (modeI !== i || subI[i] !== k)) { subI[i] = k; syncing = true; setMode(i); syncing = false; } }));
      const lm = L.localMember ?? {}, a = POS.indexOf(lm.firstPositionPreference?.toLowerCase()), b = POS.indexOf(lm.secondPositionPreference?.toLowerCase());
      if (a >= 0 && (b >= 0 || a === 5) && (prefs[0] !== a || prefs[1] !== b)) { prefs = [a, b]; drawRoles(); window.onQ?.(curQ()); }
      const n = L.members?.length ?? 1, leader = lm.isLeader !== false;
      setText(pcl, `PC 로비 그대로 · ${n > 1 ? `파티 ${n}명` : '혼자'}${leader ? '' : ' · 파티장만 매칭 시작'}`, null);
    } else setText(pcl, 'PC 로비 없음 · 모드 고르면 만들어요', null);
    const p = S.phase;
    go.classList.toggle('searching', p === 'Matchmaking'); subq.classList.toggle('lock', p === 'Matchmaking');
    go.classList.toggle('ingame', ['InProgress', 'GameStart', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame', 'Reconnect'].includes(p));
    if (p === 'Matchmaking') drawSearch();
    else if (go.classList.contains('ingame')) goText('IN GAME', p === 'Reconnect' ? '재접속 필요 · PC 에서' : '게임 중 · PC 에서 진행');
    else { const pen = S.search?.errors?.find(e => e.penaltyTimeRemaining > 0); goText('MATCH', pen ? `매칭 제한 ${mmss(pen.penaltyTimeRemaining)}` : '매칭 시작'); }
    drawSlots(); // 신속 대전 칸 = PC 로비 값
  }
  const pcl = $('#pcline');
  function drawSearch() {
    const s = S.search ?? {}, t = (s.timeInQueue ?? 0) + (Date.now() - at) / 1000;
    goText('SEARCHING', `${mmss(t)}${s.estimatedQueueTime ? ` · 예상 ${mmss(s.estimatedQueueTime)}` : ''}`);
  }
  setInterval(() => { if (S?.phase === 'Matchmaking' && cur() === 2) drawSearch(); }, 1000);

  // 모드 바꾸면 PC 로비를 그 큐로 (매칭 중엔 잠금)
  window.onQ = (base => q => {
    base?.(q);
    if (syncing || !S?.lol || !q.id || S.phase === 'Matchmaking') return;
    if (S.lobby?.gameConfig?.queueId !== q.id) cmd('createLobby', { queueId: q.id });
  })(window.onQ);
  {
    const rolesEl = $('#roles'), base = rolesEl.onclick;
    rolesEl.onclick = e => {
      const before = prefs.join();
      base(e);
      if (S?.lobby && prefs.join() !== before) cmd('setPositions', { first: POS[prefs[0]], second: pos2() });
    };
  }
  go.onclick = async () => {
    if (!S?.lol) return note('PC 에서 롤을 켜 주세요');
    if (S.phase === 'Matchmaking') return cmd('cancelSearch');
    if (go.classList.contains('ingame')) return note('게임 중이에요');
    if (S.lobby?.localMember?.isLeader === false) return note('파티장만 매칭을 시작할 수 있어요');
    const q = curQ();
    if (!S.lobby || S.lobby.gameConfig?.queueId !== q.id) { const r = await cmd('createLobby', { queueId: q.id }); if (!r.ok) return; }
    if (q.pos && q.flow !== 'swift') await cmd('setPositions', { first: POS[prefs[0]], second: pos2() });
    if (q.flow === 'swift') { // 신속 대전: 칸 2개(챔피언·포지션)가 다 차야 롤이 매칭을 받음
      const sl = slotsNow(), miss = [0, 1].find(i => !sl[i]?.championId || !sl[i]?.positionPreference);
      if (miss != null) { note('신속 대전 칸 ' + (miss + 1) + ' 을 먼저 채워 주세요'); return openSlot(miss); }
    }
    cmd('startSearch');
  };
  // 신속 대전 미리 고르기는 modes.js 의 이름 기반 → Data Dragon 키로 바꿈

  // ═══ 3. 매칭 잡힘: 롤의 수락 대기
  // shortcut: LCU ready-check 는 경과 초(timer)만 줌 → 전체 12초로 보고 남은 시간 표시. 실제 시험에서 전체 시간 확인
  const READY_TOTAL = 12;
  const baseEnter3 = onEnter[3];
  onEnter[3] = el => { baseEnter3(el); clearInterval(cd); render3(); cd = setInterval(render3, 1000); };
  function render3() {
    if (S?.phase !== 'ReadyCheck') return;
    const r = S.ready ?? {}, left = Math.ceil(READY_TOTAL - (r.timer ?? 0) - (Date.now() - at) / 1000);
    setText(nEl, String(Math.max(0, left)).padStart(2, '0')); nEl.classList.toggle('urgent', left <= 3);
    const acc = $('#accept');
    if (r.playerResponse === 'Accepted') { acc.classList.add('accepted'); acc.textContent = '수락됨 · 다른 사람 기다리는 중'; }
    if (r.playerResponse === 'Declined') acc.textContent = '거절함';
  }
  $('#accept').onclick = () => cmd('accept');
  $('#decline').onclick = () => cmd('decline');

  // ═══ 4. 챔피언 선택 (모든 모드 공통): 롤 세션 모양대로
  const s4 = screens[3];
  let sel = 0, gridKey = '', shownTrades = new Set(), t4i = null;
  const ROWY = (i, n) => 405 + i * (n > 3 ? 81.25 : 100);
  onEnter[4] = () => {
    sel = 0; gridKey = ''; shownTrades = new Set();
    s4.innerHTML = head(4) + `
      <div class="t in" data-x="26.5" data-cy="242" data-h="12">금지 챔피언</div>
      <div class="bannedrow" id="lban" style="left:calc(26.5 * var(--sx) * 1px);top:calc(262 * var(--sy) * 1px);width:calc(322 * var(--sx) * 1px)"></div>
      <div class="a hy divider" style="--x:160;--y:358;--h:414"></div>
      <div id="lteam"></div>
      <input class="a search" id="lsearch" placeholder="챔피언 검색" style="--x:180;--y:385;--w:175;--h:37;background:none;color:#efebe6;font:inherit;padding-left:10px">
      <div class="a hy grid" id="lgrid" style="--x:180;--y:444;--w:175;--h:328"></div>
      <button class="a cx btn" id="llock" style="--y:827;--w:322;--h:70"></button>`;
    $('#lsearch', s4).oninput = () => { gridKey = ''; render4(); };
    $('#lgrid', s4).onclick = onGrid;
    $('#llock', s4).onclick = onLock;
    clearInterval(t4i); t4i = setInterval(() => cur() === 4 && drawTime(), 1000);
    render4();
  };
  const sess = () => S?.session;
  const me = () => sess()?.localPlayerCellId;
  function state4() {
    const s = sess(), acts = (s?.actions ?? []).flat();
    const my = acts.find(a => a.actorCellId === me() && a.isInProgress && !a.completed);
    const myPick = acts.find(a => a.actorCellId === me() && a.type === 'pick' && !a.completed);
    const ph = s?.timer?.phase;
    const mode = my ? my.type : ph === 'PLANNING' && myPick ? 'intent' : ph === 'FINALIZATION' ? 'final' : 'wait';
    return { s, acts, my, myPick, ph, mode };
  }
  function drawTime() {
    const s = sess(); if (!s) return;
    const left = Math.max(0, (s.timer.adjustedTimeLeftInPhase - (Date.now() - at)) / 1000), total = (s.timer.totalTimeInPhase || s.timer.adjustedTimeLeftInPhase) / 1000;
    const te = $('#te4', s4), tr = $('#tr4', s4); if (!te) return;
    setText(te, String(Math.ceil(left)));
    tr.style.transform = `scaleX(${total ? Math.max(0, left - 1) / total : 0})`;
    te.style.color = left <= 10 ? '#e0464e' : ''; tr.style.background = left <= 10 ? '#e0303a' : '';
  }
  const LABEL4 = { intent: ['DECLARE', '희망 챔피언 · 팀에게만 보임'], ban: ['BAN PHASE', '내 금지 차례'], pick: ['YOUR TURN', '내 차례 · 시간 넘기면 닷지'],
    final: ['LOADOUT', '장비 준비 · 룬은 여기서 바꿀 수 있어요'], wait: ['PICKING', '다른 사람 차례'] };
  let lastMode = '';
  function render4() {
    const { s, acts, my, mode, ph } = state4(); if (!s || !$('#lteam', s4)) return;
    const [en, ko] = ph === 'GAME_STARTING' ? ['STARTING', '곧 게임 시작'] : LABEL4[mode];
    if (mode !== lastMode) { lastMode = mode; sel = 0; gridKey = ''; $('#tr4', s4).style.transition = 'none'; requestAnimationFrame(() => ($('#tr4', s4).style.transition = '')); }
    setText($('#lb4', s4), en); setText($('#ds4', s4), S.subset?.length && mode === 'pick' ? '카드 중 하나 고르기' : s.benchEnabled && mode !== 'pick' ? '벤치에서 바꾸기 · 교환 가능' : ko);
    drawTime();
    // 금지
    const bans = [...(s.bans?.myTeamBans ?? []), ...(s.bans?.theirTeamBans ?? [])].filter(Boolean);
    $('#lban', s4).innerHTML = bans.length ? bans.map(c => `<div class="ico" style="background-image:url(${cimg(c)})"></div>`).join('') : '<span style="color:#5f5f5f;font-size:11px">아직 없음</span>';
    // 우리 팀
    const team = s.myTeam ?? [], n = team.length;
    $('#lteam', s4).innerHTML = team.map((c, i) => {
      const isMe = c.cellId === me(), pi = POS.indexOf(c.assignedPosition), champ = c.championId || c.championPickIntent;
      const sub = c.championId ? cname(c.championId) : c.championPickIntent ? '희망 · ' + cname(c.championPickIntent) : '고르는 중';
      return `${isMe ? `<div class="a hy mebox" style="--x:13;--y:${ROWY(i, n) - 38};--w:149;--h:76"></div>` : ''}
        <div class="a ws yc ico" style="--x:20;--y:${ROWY(i, n)};--w:40;--h:40;${champ ? `background-image:url(${cimg(champ)});${c.championId ? '' : 'filter:grayscale(.7)'}` : ''}">${champ ? '' : pi >= 0 ? `<img src="img/role${pi + 1}.png" alt="">` : ''}</div>
        <div class="t f-kr4" data-x="68" data-cy="${ROWY(i, n) - 11}" data-h="12">${isMe ? '나' : ''}${pi >= 0 ? (isMe ? ' · ' : '') + ROLE_KO[pi] : isMe ? '' : '팀원'}</div>
        <div class="t dim3" data-x="68" data-cy="${ROWY(i, n) + 14}" data-h="11">${sub}</div>`;
    }).join('');
    $('#lteam', s4).querySelectorAll('.t').forEach(fitText);
    // 오른쪽: 고를 때는 챔피언, 아니면 벤치(칼바람) 또는 안내
    // 칼바람(벤치·카드): 검색·룬 없음 — 롤에서도 못 함 (사용자 확인 11/24)
    const aram = !!(s.benchEnabled || S.subset?.length);
    $('#lsearch', s4).style.display = aram ? 'none' : '';
    s4.querySelector('.runechip')?.style.setProperty('display', aram ? 'none' : '');
    const g = $('#lgrid', s4), q = aram ? '' : ($('#lsearch', s4).value || '').trim();
    let ids = [], kind = '';
    if (mode === 'ban') { ids = S.bannable; kind = 'c'; }
    else if (mode === 'pick' || mode === 'intent') { ids = S.subset?.length ? S.subset : S.pickable; kind = 'c'; } // 칼바람: 롤이 준 카드 2~3장만
    else if (s.benchEnabled) { ids = (s.benchChampions ?? []).map(b => b.championId ?? b); kind = 'b'; }
    if (q) ids = ids.filter(id => cname(id).includes(q) || (DD[id]?.id ?? '').toLowerCase().includes(q.toLowerCase()));
    ids = [...ids].sort((a, b) => cname(a).localeCompare(cname(b), 'ko'));
    const key = kind + ids.join() + ver;
    if (key !== gridKey) {
      gridKey = key;
      g.innerHTML = kind ? ids.map(id => `<div class="portrait${id === sel ? ' sel' : ''}" data-c="${id}" style="--img:url(${cimg(id)})"></div>`).join('') || '<div style="grid-column:1/-1;color:#5f5f5f;font-size:12px">없음</div>'
        : `<div style="grid-column:1/-1;color:#8c8c8c;font-size:12px;line-height:1.8">${mode === 'final' ? '확정됐어요.' : '다른 사람이 고르는 중이에요.'}</div>`;
    }
    // 버튼
    const lock = $('#llock', s4);
    const reroll = s.allowRerolling && s.rerollsRemaining > 0 && mode !== 'pick';
    lock.textContent = mode === 'ban' ? (sel ? '금지 확정' : '금지할 챔피언 고르기') : mode === 'pick' ? (sel ? '선택 완료' : '챔피언 고르기')
      : mode === 'intent' ? (sel ? '희망 표시됨' : '희망 챔피언 고르기 (선택)') : reroll ? `다시 굴리기 (${s.rerollsRemaining})` : mode === 'final' && !aram ? '룬 설정' : kind === 'b' ? '벤치 챔피언을 눌러 바꾸기' : '기다리는 중';
    lock.classList.toggle('off', !((mode === 'ban' || mode === 'pick') && sel) && !reroll && (mode !== 'final' || aram));
    // 교환 요청 (챔피언 · 픽 순서)
    for (const [list, acc, dec, what] of [[s.trades, 'tradeAccept', 'tradeDecline', '챔피언 교환'], [s.pickOrderSwaps, 'swapAccept', 'swapDecline', '픽 순서 교환']]) {
      for (const t of list ?? []) {
        const k = what + t.id;
        if (t.state !== 'RECEIVED' || shownTrades.has(k)) continue;
        shownTrades.add(k);
        const who = team.find(c => c.cellId === t.cellId);
        toastLive(`${who && POS.indexOf(who.assignedPosition) >= 0 ? ROLE_KO[POS.indexOf(who.assignedPosition)] : '팀원'} · ${what} 요청`, who?.championId, () => cmd(acc, { id: t.id }), () => cmd(dec, { id: t.id }));
      }
    }
  }
  function toastLive(text, champ, yes, no) {
    s4.querySelector('.toast')?.remove();
    const d = document.createElement('div'); d.className = 'toast'; d.style.top = 'calc(760 * var(--sy) * 1px)';
    d.innerHTML = `<div class="ico" style="background-image:url(${cimg(champ)})"></div><span>${text}</span><button>거절</button><button class="y">수락</button>`;
    const [b1, b2] = d.querySelectorAll('button'); b1.onclick = () => { d.remove(); no(); }; b2.onclick = () => { d.remove(); yes(); };
    s4.append(d); navigator.vibrate?.([60, 40, 60]);
  }
  function onGrid(e) {
    const p = e.target.closest('.portrait'); if (!p) return;
    const id = Number(p.dataset.c), { my, myPick, mode, s } = state4();
    if (mode !== 'ban' && mode !== 'pick' && mode !== 'intent') { if (s.benchEnabled) cmd('benchSwap', { championId: id }); return; }
    sel = id;
    $('#lgrid', s4).querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); p.classList.add('sel');
    p.animate([{ scale: 1 }, { scale: 1.07 }, { scale: 1 }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const act = my ?? myPick;
    if (act) cmd('hover', { actionId: act.id, championId: id }); // 롤에도 바로 호버 (팀원에게 보임)
    render4();
  }
  async function onLock() {
    const { my, mode, s } = state4();
    if ((mode === 'ban' || mode === 'pick') && my && sel) {
      const r = await cmd('lockIn', { actionId: my.id });
      if (r.ok) lockFx($('#llock', s4));
    } else if (s?.allowRerolling && s.rerollsRemaining > 0) cmd('reroll');
    else if (mode === 'final' && !(s.benchEnabled || S.subset?.length)) window.openRunes();
  }
  // ═══ 룬: 페이지 고르기 + 편집 (롤 /lol-perks 그대로). 그림은 CommunityDragon (롤 클라이언트와 같은 파일)
  const perkImg = p => p ? 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/' + p.replace('/lol-game-data/assets/', '').toLowerCase() : '';
  document.head.insertAdjacentHTML('beforeend', `<style>
  .runes{position:fixed;inset:0;z-index:35;background:#000f;display:none;flex-direction:column;padding:20px 16px 16px;color:#efebe6;font-size:15px;overflow-y:auto}
  .runes.on{display:flex;animation:toastin .3s var(--ease)}
  .runes h4{font-weight:400;color:#b0b0b0;font-size:14px;letter-spacing:.08em;margin:16px 0 8px}
  .rp{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
  .rp span{flex:none;border:1px solid #3a3636;padding:11px 14px;white-space:nowrap;cursor:pointer;font-size:15px}
  .rp span.on{border-color:#b3191f;background:#1a0607}
  .rrow{display:flex;justify-content:center;gap:12px;margin:7px 0}
  .rrow img{width:44px;height:44px;border-radius:50%;filter:grayscale(1) brightness(.55);cursor:pointer;transition:filter .2s,box-shadow .2s}
  .rrow.ks img{width:56px;height:56px}
  .rrow.sh img{width:32px;height:32px}
  .rrow img.on{filter:none;box-shadow:0 0 0 2px #b3191f,0 0 12px #b3191f88}
  .rname{text-align:center;color:#b0b0b0;min-height:20px;margin-top:8px;font-size:14px}
  .rbtns{display:flex;gap:8px;margin-top:auto;padding-top:12px}
  .rbtns button{flex:1;background:none;border:1px solid #3a3636;color:#efebe6;font:inherit;font-size:17px;padding:17px}
  .rbtns button.y{background:var(--btn);border-color:var(--btn)}
  .runechip{position:absolute;right:calc(26px * var(--sx));top:calc(112px * var(--sy));border:1px solid #b3191f;background:none;color:#efebe6;font:inherit;font-size:calc(14px * var(--s));width:calc(52px * var(--s));height:calc(38px * var(--s));padding:0;display:grid;place-items:center;letter-spacing:0;z-index:3} /* 글자 정가운데 */
  </style>`);
  const RN = document.createElement('div'); RN.className = 'runes'; document.body.append(RN);
  let draft = null; // 편집 중인 페이지
  const P = () => S?.perks ?? {};
  const style = id => P().styles?.find(s => s.id === id);
  function openRunes(slot) {
    if (slot?.perks) { // 신속 (버튼 onclick 으로 불리면 slot 이 클릭 이벤트라 걸러냄) 대전 칸의 룬: 페이지가 아니라 칸에 저장
      draft = { id: null, name: '', editable: true, primaryStyleId: slot.perks.perkStyle, subStyleId: slot.perks.perkSubStyle, selectedPerkIds: [...slot.perks.perkIds], done: slot.done };
      RN.classList.add('on'); return drawRunes();
    }
    const pg = P().pages?.find(p => p.id === P().current);
    draft = pg ? { ...pg, selectedPerkIds: [...pg.selectedPerkIds] } : { id: null, name: '딸깍', editable: true, primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [] };
    if (!draft.editable) draft = { ...draft, id: null, editable: true, name: '딸깍' }; // 기본(추천) 페이지는 고칠 수 없음 → 새 페이지로 저장
    RN.classList.add('on'); drawRunes();
  }
  function fixDraft() { // 스타일 바꾸면 그 스타일 룬으로 채움 (클라이언트 규칙: 핵심 1 + 주 3 + 보조 2줄 + 능력치 3)
    const ps = style(draft.primaryStyleId), ss = style(draft.subStyleId), sel = draft.selectedPerkIds;
    const pick = (row, cur) => row.perks.includes(cur) ? cur : row.perks[0];
    const prim = ps.slots.filter(s => s.type !== 'kStatMod'), shards = ps.slots.filter(s => s.type === 'kStatMod');
    const main = prim.map((row, i) => pick(row, sel[i]));
    const subRows = ss.slots.filter(s => s.type !== 'kStatMod' && s.type !== 'kKeyStone');
    let sub = sel.slice(4, 6).filter(p => subRows.some(r => r.perks.includes(p)));
    for (const r of subRows) if (sub.length < 2 && !sub.some(p => r.perks.includes(p))) sub.push(r.perks[0]);
    const sh = shards.map((row, i) => pick(row, sel[6 + i]));
    draft.selectedPerkIds = [...main, ...sub, ...sh];
  }
  function drawRunes() {
    const p = P();
    if (!p.styles?.length) { RN.innerHTML = '<div style="margin:auto;color:#8c8c8c">룬 정보를 받는 중…</div>'; return; }
    if (!style(draft.subStyleId) || draft.subStyleId === draft.primaryStyleId) draft.subStyleId = style(draft.primaryStyleId).allowedSubStyles[0];
    fixDraft();
    const keepTop = RN.scrollTop; // 룬 하나 눌러도 창이 맨 위로 안 튀게
    queueMicrotask(() => (RN.scrollTop = keepTop));
    const ps = style(draft.primaryStyleId), ss = style(draft.subStyleId), sel = draft.selectedPerkIds;
    const img = (id, on, d) => `<img src="${perkImg(p.info[id]?.icon)}" data-p="${id}" ${d} class="${on ? 'on' : ''}" alt="" title="${p.info[id]?.name ?? ''}">`;
    const styleRow = (cur, ids, kind) => `<div class="rrow">${ids.map(id => `<img src="${perkImg(style(id)?.icon)}" data-${kind}="${id}" class="${id === cur ? 'on' : ''}" alt="">`).join('')}</div>`;
    const prim = ps.slots.filter(s => s.type !== 'kStatMod'), shards = ps.slots.filter(s => s.type === 'kStatMod');
    const subRows = ss.slots.filter(s => s.type !== 'kStatMod' && s.type !== 'kKeyStone');
    RN.innerHTML = `
      ${draft.done ? '<h4>이 칸의 룬</h4>' : `<h4>룬 페이지 · 눌러서 쓰기</h4>
      <div class="rp">${(p.pages ?? []).map(pg => `<span data-page="${pg.id}" class="${pg.id === p.current ? 'on' : ''}">${pg.name}</span>`).join('')}${p.canAdd ? '<span data-page="new">+ 새 페이지</span>' : ''}</div>`}
      <h4>주 룬 · ${ps.name}</h4>${styleRow(ps.id, p.styles.map(s => s.id), 'ps')}
      ${prim.map((row, i) => `<div class="rrow${i ? '' : ' ks'}">${row.perks.map(id => img(id, sel[i] === id, `data-i="${i}"`)).join('')}</div>`).join('')}
      <h4>보조 룬 · ${ss.name} (2개)</h4>${styleRow(ss.id, ps.allowedSubStyles, 'ss')}
      ${subRows.map(row => `<div class="rrow">${row.perks.map(id => img(id, sel.slice(4, 6).includes(id), 'data-sub="1"')).join('')}</div>`).join('')}
      <h4>능력치</h4>
      ${shards.map((row, i) => `<div class="rrow sh">${row.perks.map(id => img(id, sel[6 + i] === id, `data-i="${6 + i}"`)).join('')}</div>`).join('')}
      <div class="rname" id="rname"></div>
      <div class="rbtns"><button id="rclose">닫기</button><button class="y" id="rsave">${draft.done ? '롤에 적용' : draft.id ? '저장' : '새 페이지로 저장'}</button></div>`;
  }
  RN.onclick = async e => {
    const t = e.target, d = t.dataset;
    if (t.id === 'rclose') return RN.classList.remove('on');
    if (t.id === 'rsave') {
      if (draft.done) { RN.classList.remove('on'); return draft.done({ perkIds: draft.selectedPerkIds, perkStyle: draft.primaryStyleId, perkSubStyle: draft.subStyleId }); }
      const r = await cmd('perkSave', { id: draft.id, name: draft.name, primaryStyleId: draft.primaryStyleId, subStyleId: draft.subStyleId, selectedPerkIds: draft.selectedPerkIds });
      if (r.ok) { note('룬 저장됨 · 롤에 바로 적용'); RN.classList.remove('on'); }
      return;
    }
    if (d.page === 'new') { draft = { id: null, name: '딸깍', editable: true, primaryStyleId: draft.primaryStyleId, subStyleId: draft.subStyleId, selectedPerkIds: draft.selectedPerkIds }; return drawRunes(); }
    if (d.page) { await cmd('perkSelect', { id: Number(d.page) }); setTimeout(() => RN.classList.contains('on') && openRunes(), 400); return; }
    if (d.ps) { draft.primaryStyleId = +d.ps; return drawRunes(); }
    if (d.ss) { draft.subStyleId = +d.ss; draft.selectedPerkIds.splice(4, 2); return drawRunes(); }
    if (d.p) {
      const id = +d.p, sel = draft.selectedPerkIds;
      if (d.i != null) sel[+d.i] = id;
      else if (d.sub) { // 보조: 2줄에서 하나씩. 같은 줄이면 바꾸고, 다른 줄이면 오래된 걸 밀어냄
        const rows = style(draft.subStyleId).slots.filter(s => s.type !== 'kStatMod' && s.type !== 'kKeyStone'), row = rows.find(r => r.perks.includes(id));
        let sub = sel.slice(4, 6).filter(x => !row.perks.includes(x));
        sub = [...sub, id].slice(-2);
        sub.sort((a, b) => rows.findIndex(r => r.perks.includes(a)) - rows.findIndex(r => r.perks.includes(b)));
        sel.splice(4, 2, ...sub);
      }
      drawRunes();
      $('#rname').textContent = `${P().info[id]?.name ?? ''} — ${P().info[id]?.desc ?? ''}`.replace(/<[^>]+>/g, '');
    }
  };
  // 챔프 선택 화면 오른쪽 위 '룬' 버튼
  const baseEnter4 = onEnter[4];
  onEnter[4] = () => { baseEnter4(); const b = document.createElement('button'); b.className = 'runechip'; b.textContent = '룬'; b.onclick = openRunes; s4.append(b); };
  window.openRunes = openRunes;

  // ═══ 신속 대전 칸 2개: PC 로비의 playerSlots 를 그대로 보여 주고, 바꾸면 롤에 저장 (롤 클라이언트 '챔피언을 선택하세요' 창과 같은 내용)
  const UPOS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const slotsNow = () => S?.lobby?.localMember?.playerSlots ?? [];
  const parsePerks = p => { try { return typeof p === 'string' ? JSON.parse(p) : p ?? null; } catch { return null; } };
  const spImg = id => SP.find(s => s.id === id)?.img ?? '';
  document.head.insertAdjacentHTML('beforeend', `<style>
  .slotsbox{position:absolute;left:0;right:0;top:calc(470px * var(--sy));display:none;justify-content:center;gap:calc(12px * var(--s))}
  .s2.slots-on .slotsbox{display:flex}.s2.slots-on #roles,.s2.slots-on #rul,.s2.slots-on .swb{display:none}
  .slot{width:calc(166px * var(--sx));border:1px solid #3a3636;background:#0b0909;padding:calc(8px * var(--s));display:flex;gap:calc(8px * var(--s));align-items:center;cursor:pointer;font-size:calc(13px * var(--s));color:#8c8c8c;line-height:1.45}
  .slot b{color:#efebe6;font-weight:400;font-size:calc(14px * var(--s))}
  .slot .ch{flex:none;width:calc(58px * var(--s));height:calc(58px * var(--s));background:#141212 center/cover;border:1px solid #b3191f;display:grid;place-items:center;color:#5f5f5f;font-size:20px}
  .slot .ic{display:flex;gap:3px;margin-top:3px}.slot .ic img{width:calc(22px * var(--s));height:calc(22px * var(--s));border-radius:3px}
  .slot.need{border-style:dashed}
  .pk-g .portrait.sel{border-color:#c4454b;box-shadow:0 0 0 1px #c4454b,0 0 12px #c4454b66}.pk-g .portrait.sel::before{filter:none}
  #slotEd .rrow img.pos{border-radius:0;filter:none;opacity:.35;width:46px;height:46px}#slotEd .rrow img.pos.on{opacity:1;box-shadow:none;border-bottom:2px solid #b3191f}
  #slotEd .rrow img.pos.taken{opacity:.1;pointer-events:none}
  #slotEd .rrow img.sp{border-radius:6px;width:46px;height:46px}
  #slotEd input{width:100%;background:#0b0909;border:1px solid #3a3636;color:#efebe6;font:inherit;font-size:16px;padding:12px;margin-bottom:10px}
  #slotEd .pk-g{max-height:44vh;grid-template-columns:repeat(5,1fr);gap:8px}#slotEd .pk-g .portrait::after{content:attr(data-n);position:absolute;left:0;right:0;bottom:-20px;text-align:center;font-size:13px;color:#d8d2cc;white-space:nowrap;overflow:hidden}#slotEd .pk-g{row-gap:26px;padding-bottom:20px}
  #slotEd .posw{position:relative;display:inline-block}#slotEd .posw.scarce::after{content:'◆';position:absolute;top:-4px;right:-2px;color:#3fc6e0;font-size:13px;pointer-events:none}
  .slotsbox{flex-wrap:wrap}.scarce-warn{flex:0 0 100%;color:#ff5a5a;font-size:14px;margin-top:8px;text-align:center}
  </style>`);
  const SB = document.createElement('div'); SB.className = 'slotsbox'; screens[1].append(SB);
  const SW = document.createElement('div'); SW.style.cssText = 'position:absolute;left:0;right:0;top:calc(608px * var(--sy));text-align:center;color:#ff5a5a;font-size:calc(14px * var(--s));pointer-events:none;z-index:5'; go.parentNode.append(SW); // 매칭 시작 바로 위
  function drawSlots() {
    const on = curQ()?.flow === 'swift';
    screens[1].classList.toggle('slots-on', on);
    if (!on) return void (SW.textContent = '');
    const sl = slotsNow();
    SB.innerHTML = [0, 1].map(i => {
      const s = sl[i] ?? {}, pi = UPOS.indexOf(s.positionPreference), pk = parsePerks(s.perks);
      return `<div class="slot${s.championId ? '' : ' need'}" data-k="${i}"><div class="ch" style="${s.championId ? `background-image:url(${cimg(s.championId)})` : ''}">${s.championId ? '' : '+'}</div>
        <div><b>${['I', 'II'][i]} · ${pi >= 0 ? ROLE_KO[pi] : '포지션?'}</b><br>${s.championId ? cname(s.championId) : '눌러서 고르기'}
        <div class="ic">${s.spell1 ? `<img src="${spImg(s.spell1)}" alt="">` : ''}${s.spell2 ? `<img src="${spImg(s.spell2)}" alt="">` : ''}${pk ? `<img src="${perkImg(P().info?.[pk.perkIds?.[0]]?.icon)}" style="border-radius:50%" alt="">` : ''}</div></div></div>`;
    }).join('');
    SE.querySelectorAll('.posw').forEach(w => w.classList.toggle('scarce', (S.lobby?.scarcePositions ?? []).includes(w.firstChild.dataset.pos))); // 편집 중에도 ◆ 실시간
    SW.textContent = scarceMiss() ? `◆ 표시 포지션(${(S.lobby?.scarcePositions ?? []).map(p => ROLE_KO[UPOS.indexOf(p)]).join('·')}) 중 하나를 칸에 넣어야 매칭돼요` : '';
  }
  // 롤(11/24 확인): 신속 대전은 lobby.scarcePositions(실시간으로 바뀜) 중 하나를 칸에 넣어야 함 — 아니면 restrictions 에 QPPlayerScarcePosition… 이 붙고 매칭 버튼이 막힘
  const scarceMiss = () => (S.lobby?.restrictions ?? []).some(r => r.restrictionCode?.startsWith('QPPlayerScarcePosition'));
  SB.onclick = e => { const k = e.target.closest('.slot')?.dataset.k; if (k != null) openSlot(+k); };
  window.onQ = (base => q => { base?.(q); drawSlots(); })(window.onQ);

  const SE = document.createElement('div'); SE.className = 'runes'; SE.id = 'slotEd'; SE.style.zIndex = 34; document.body.append(SE);
  let sd = null, sk = 0;
  function openSlot(k) {
    if (go.classList.contains('searching')) return note('매칭 중엔 못 바꿔요');
    const s = slotsNow()[k] ?? {};
    sk = k;
    sd = { championId: s.championId || 0, position: s.positionPreference || '', spell1: s.spell1 || 4, spell2: s.spell2 || 14, skinId: s.skinId, perks: parsePerks(s.perks) };
    SE.innerHTML = ''; SE.classList.add('on'); drawSlot();
  }
  async function recPerks() { // 챔피언·포지션이 정해지면 롤의 추천 룬을 기본으로
    if (!sd.championId || !sd.position) return;
    const r = await cmd('slotPerks', { championId: sd.championId, position: sd.position.toLowerCase() });
    if (r.ok) { sd.perks = parsePerks(r.data); drawSlot(); }
  }
  function drawSlot() {
    const other = slotsNow()[1 - sk] ?? {};
    const champs = (S.owned ?? []).filter(id => id !== other.championId)
      .sort((a, b) => (b === sd.championId) - (a === sd.championId) || cname(a).localeCompare(cname(b), 'ko')); // 고른 챔피언이 맨 위
    const pk = sd.perks;
    // 다시 그려도 스크롤·검색어는 그대로 (누를 때마다 맨 위로 튀던 것)
    const st = SE.scrollTop, gst = SE.querySelector('.pk-g')?.scrollTop ?? 0, q = SE.querySelector('#sq')?.value ?? '';
    SE.innerHTML = `
      <h4>칸 ${['I', 'II'][sk]} · 포지션</h4>
      <div class="rrow">${UPOS.map((p, i) => `<span class="posw${(S.lobby?.scarcePositions ?? []).includes(p) ? ' scarce' : ''}"><img class="pos${sd.position === p ? ' on' : ''}${other.positionPreference === p ? ' taken' : ''}" src="img/role${i + 1}.png" data-pos="${p}" alt="" title="${ROLE_KO[i]}"></span>`).join('')}</div>
      <h4>소환사 주문 · 2개</h4>
      <div class="rrow" style="flex-wrap:wrap">${SP.map(s => `<img class="sp${[sd.spell1, sd.spell2].includes(s.id) ? ' on' : ''}" src="${s.img}" data-sp="${s.id}" alt="" title="${s.name}">`).join('')}</div>
      <h4>룬 · ${pk ? (P().info?.[pk.perkIds[0]]?.name ?? '') : '없음'}</h4>
      <div class="rp"><span data-r="rec">추천 룬 (롤 기본)</span><span data-r="edit">직접 편집</span></div>
      <h4>챔피언 · ${sd.championId ? cname(sd.championId) : '고르기'}</h4>
      <input id="sq" placeholder="검색" autocomplete="off">
      <div class="pk-g">${champs.map(id => `<div class="portrait${id === sd.championId ? ' sel' : ''}" data-c="${id}" data-n="${cname(id)}" style="--img:url(${cimg(id)})"></div>`).join('')}</div>
      <div class="rbtns"><button class="y" id="sclose">완료</button></div>`;
    const sq = SE.querySelector('#sq');
    sq.oninput = () => SE.querySelectorAll('.pk-g .portrait').forEach(p => (p.style.display = p.dataset.n.includes(sq.value.trim()) ? '' : 'none'));
    SE.scrollTop = st; SE.querySelector('.pk-g').scrollTop = sd.top ? 0 : gst; sd.top = false;
    if (q) { sq.value = q; sq.oninput(); }
  }
  const toCmd = (s, pk) => ({ championId: s.championId, position: s.position.toLowerCase(), spell1: s.spell1, spell2: s.spell2, skinId: s.skinId, perks: pk });
  SE.onclick = async e => {
    const t = e.target, d = t.dataset;
    if (t.id === 'sclose') return SE.classList.remove('on');
    // 바꿀 때마다 바로 롤에 적용 (따로 '적용' 누르는 단계가 있으면 빠뜨림 → 사용자 버그 리포트 11/24)
    if (d.pos) { sd.position = d.pos; drawSlot(); await recPerks(); return applySlot(); }
    if (d.sp) { const id = +d.sp; if (![sd.spell1, sd.spell2].includes(id)) { sd.spell1 = sd.spell2; sd.spell2 = id; } drawSlot(); return applySlot(); }
    if (d.c) { sd.championId = +d.c; sd.skinId = null; sd.top = true; drawSlot(); await recPerks(); return applySlot(); }
    if (d.r === 'edit') {
      const base = sd.perks ?? { perkIds: P().pages?.[0]?.selectedPerkIds ?? [], perkStyle: 8000, perkSubStyle: 8100 };
      return openRunes({ perks: base, done: p => { sd.perks = p; drawSlot(); applySlot(); } });
    }
    if (d.r === 'rec') { await recPerks(); return applySlot(); }
  };
  // 칸을 롤에 저장. 챔피언·포지션이 아직 없으면 저장하지 않고 기다림 (롤이 빈 칸은 안 받음)
  async function applySlot() {
    if (!sd.championId || !sd.position) return;
    if (!sd.perks) await recPerks();
    if (!sd.perks) return note('룬을 정해 주세요');
    const other = slotsNow()[1 - sk], slots = [];
    const o = other?.championId && other.positionPreference && parsePerks(other.perks)
      ? toCmd({ championId: other.championId, position: other.positionPreference, spell1: other.spell1, spell2: other.spell2, skinId: other.skinId }, parsePerks(other.perks)) : null;
    slots[sk] = toCmd(sd, sd.perks); if (o) slots[1 - sk] = o;
    const r = await cmd('setSlots', { slots: slots.filter(Boolean) });
    if (r.ok) note('롤에 적용됨');
  }
  window.openSlot = openSlot;
  { const b = document.createElement('button'); b.className = 'runechip'; b.textContent = '룬'; b.onclick = openRunes; b.style.top = 'calc(60px * var(--sy))'; screens[1].append(b); }
  // 시작: QR 로 왔으면 주소의 PIN 으로 바로, 아니면 저장된 토큰으로
  const qrPin = location.hash.match(/pin=(\d{6})/)?.[1];
  if (qrPin) { history.replaceState(null, '', location.pathname); pinIn.value = qrPin; drawPin(); connect(qrPin); } // QR = PIN 이 든 주소라 바로 연결
  else if (token) connect();
})();
