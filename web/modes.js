// 딸깍 — 챔피언 선택 화면들 (app.html 의 전역 show·onEnter·setText·img·QUEUES·curQ·prefs·inGame 을 씀)
//   4 밴픽형 (교차 선택·솔랭·자랭·5인 랭크·클래식) · 5 칼바람형 (카드·벤치) · 6 아레나형 (2인·3인)
//   + 신속 대전 미리 고르기 (화면 2) + 챔피언 고르는 창
// 단계와 초는 실제 앱에선 LCU 챔프 선택 상태(timer.phase·adjustedTimeLeftInPhase·actions·bench…)에서 받는다.
// shortcut: 아래 DEMO 초는 시연용 — 공식 확인 값(교차 선택 5/7/25/150, 칼바람 카드 12)만 맞고 나머지는 임시

const CHAMPS = ['Ahri', 'Syndra', 'Orianna', 'Viktor', 'Ekko', 'Sylas', 'Diana', 'Fizz', 'Talon', 'Qiyana', 'Annie', 'Lux',
  'Aatrox', 'Ashe', 'Caitlyn', 'Darius', 'Ezreal', 'Graves', 'Irelia', 'Jax', 'Kaisa', 'Kayn', 'LeeSin', 'Lulu', 'Malphite',
  'Morgana', 'Nami', 'Nasus', 'Riven', 'Senna', 'Sett', 'Teemo', 'Vayne', 'Vi', 'Warwick', 'Yone', 'MissFortune', 'Jhin',
  'Leona', 'Nautilus', 'Camille', 'Fiora', 'Hecarim', 'Kindred', 'Viego', 'Seraphine', 'Pyke', 'Mordekaiser', 'Gwen', 'Ornn',
  'Zeri', 'Xayah', 'Garen', 'Jinx', 'Thresh', 'Yasuo', 'Zed', 'Katarina', 'Leblanc', 'Akali'];
const ROLE_KO = ['탑', '정글', '미드', '원딜', '서포터'];
const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
const $ = (s, r = document) => r.querySelector(s);

document.head.insertAdjacentHTML('beforeend', `<style>
.phase-d{color:#8c8c8c}
.grid .portrait.used{pointer-events:none;opacity:.28}
.grid .portrait.fav::after{content:'★';position:absolute;right:4%;top:2%;font-size:calc(10px * var(--s));color:#e0b860;text-shadow:0 0 6px #000}
.slot{border:1px dashed #3a3636;background:#0b0909}
.slot.q::after{content:'?';position:absolute;inset:0;display:grid;place-items:center;color:#3a3636;font-family:'Bodoni Moda',serif;font-size:calc(22px * var(--s))}
.btn.off{opacity:.35;pointer-events:none}
.info{position:absolute;border:1px solid #2a2626;background:linear-gradient(180deg,#0c0909,#050404);padding:calc(14px * var(--s));font-size:calc(11px * var(--s));line-height:1.8;color:#8c8c8c}
.info b{color:var(--white);font-weight:400}
.toast{position:absolute;left:calc(26px * var(--sx));right:calc(26px * var(--sx));border:1px solid var(--red);background:#140405f2;padding:calc(10px * var(--s)) calc(12px * var(--s));
  display:flex;align-items:center;gap:calc(10px * var(--s));font-size:calc(14px * var(--s));color:var(--white);z-index:4;animation:toastin .45s var(--ease) both}
@keyframes toastin{from{opacity:0;translate:0 12px}}
.toast .ico{width:calc(30px * var(--s));height:calc(30px * var(--s));flex:none}
.toast span{flex:1}
.toast button{background:none;border:1px solid #5a2a2c;color:var(--white);font:inherit;padding:calc(5px * var(--s)) calc(10px * var(--s));cursor:pointer}
.toast button.y{background:var(--btn);border-color:var(--btn)}
.cards{position:absolute;left:0;right:0;display:flex;justify-content:center;gap:calc(14px * var(--s))}
.cards .portrait{width:calc(92px * var(--s));aspect-ratio:3/4;cursor:pointer;transition:border-color .3s,translate .4s var(--ease)}
.cards .portrait.sel{border-color:#c4454b;box-shadow:0 0 0 1px #c4454b,0 0 22px #c4454b66;translate:0 calc(-6px * var(--s))}
.cards .portrait.sel::before,.bench .portrait.mine::before{filter:none}
.cards .portrait.gone{opacity:.25;pointer-events:none}
.cards .portrait.third{border-color:#e0b860}
.cards .portrait.third::after{content:'행운 카드';position:absolute;left:0;right:0;bottom:calc(-16px * var(--s));text-align:center;font-size:calc(9px * var(--s));color:#e0b860}
.bench{position:absolute;display:grid;grid-template-columns:repeat(5,1fr);gap:calc(8px * var(--s))}
.bench .portrait{aspect-ratio:1;cursor:pointer;overflow:hidden}
.bench .portrait.wait{pointer-events:none}
.bench .portrait.wait::after{content:'';position:absolute;left:0;bottom:0;height:3px;background:var(--red);animation:unlock var(--lock) linear forwards}
@keyframes unlock{from{width:100%}to{width:0}}
.bench .portrait.empty{border-style:dashed;pointer-events:none}
.mates{position:absolute;left:0;right:0;display:flex;justify-content:center;gap:calc(14px * var(--s))}
.mates>div{display:flex;flex-direction:column;align-items:center;gap:calc(5px * var(--s));font-size:calc(9px * var(--s));color:#7b7b7a}
.mates .ico{width:calc(44px * var(--s));height:calc(44px * var(--s));filter:grayscale(.3)}
.mates .me .ico{border-color:#c4454b;filter:none}.mates .me{color:var(--white)}
.teams{position:absolute;display:flex;flex-direction:column;gap:calc(7px * var(--sy))}
.teams>div{display:flex;align-items:center;gap:calc(6px * var(--s));font-size:calc(9px * var(--s));color:#5f5f5f}
.teams .ico{width:calc(26px * var(--s));height:calc(26px * var(--s))}
.myteam{position:absolute;display:flex;flex-direction:column;gap:calc(12px * var(--sy))}
.myteam>div{display:flex;align-items:center;gap:calc(10px * var(--s));font-size:calc(11px * var(--s));color:#8c8c8c}
.myteam .portrait{width:calc(48px * var(--s));aspect-ratio:3/4}
.myteam .portrait.on::before{filter:none}
.myteam b{display:block;color:var(--white);font-weight:400;font-size:calc(12px * var(--s))}
.bannedrow{position:absolute;display:flex;gap:calc(4px * var(--s));flex-wrap:wrap}
.bannedrow .ico{width:calc(22px * var(--s));height:calc(22px * var(--s));filter:grayscale(1) brightness(.6)}
.chip{position:absolute;border:1px solid #e0b860;color:#e0b860;background:none;font:inherit;font-size:calc(10px * var(--s));letter-spacing:.2em;cursor:pointer;font-family:'Cinzel',serif}
.chip.on{background:#e0b86022;box-shadow:0 0 14px #e0b86044}
.swb{position:absolute;border-radius:50%;border:1px solid #c4454b;background:#000 center/cover;pointer-events:none;box-shadow:0 0 8px #000}
.swb.need{border-style:dashed;border-color:#8c8c8c;display:grid;place-items:center;color:#8c8c8c;font-size:calc(11px * var(--s))}
.picker{position:fixed;inset:0;z-index:30;background:#000e;display:none;flex-direction:column;padding:calc(48px * var(--sy)) calc(22px * var(--sx)) calc(22px * var(--sy))}
.picker.on{display:flex;animation:toastin .35s var(--ease)}
.pk-h{color:var(--white);font-size:calc(13px * var(--s));letter-spacing:.1em;margin-bottom:calc(16px * var(--sy));text-align:center}
.pk-h small{display:block;color:#7b7b7a;font-size:calc(10px * var(--s));margin-top:4px}
.pk-g{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(5,1fr);gap:calc(9px * var(--s));align-content:start;scrollbar-width:none}
.pk-g .portrait{aspect-ratio:3/4;cursor:pointer}.pk-g .portrait::before{filter:grayscale(.2)}
.pk-g .portrait.used{opacity:.25;pointer-events:none}
</style>`);

// ── 공통: 단계 진행기. 단계마다 [이름, 초, 영문 제목, 설명, 버튼 글자]
function runner(screen, { label, desc, te, tr, btn }) {
  let iv, list, i, t, total, hooks;
  const stop = () => clearInterval(iv);
  const draw = () => {
    setText(te, String(t)); tr.style.transform = `scaleX(${Math.max(0, t - 1) / total})`;
    te.style.color = t <= 10 ? '#e0464e' : ''; tr.style.background = t <= 10 ? '#e0303a' : '';
    te.animate([{ opacity: .25, filter: 'blur(3px)', translate: '0 -18%' }, { opacity: 1, filter: 'none', translate: '0 0' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (t <= 5) te.animate([{ translate: '0 0' }, { translate: '-2px 0' }, { translate: '2px 0' }, { translate: '0 0' }], { duration: 260, delay: 300 });
  };
  const enter = k => {
    stop(); i = k;
    if (i >= list.length) return hooks.done?.();
    const [name, sec, en, ko, b] = list[i];
    t = total = sec;
    setText(label, en); setText(desc, ko);
    btn.textContent = b || ''; btn.classList.toggle('off', !b); btn.style.visibility = b ? '' : 'hidden';
    // 단계 바뀔 때 시간 바가 꽉 찬 채로 다시 시작
    tr.style.transition = 'none'; tr.style.transform = 'scaleX(1)'; tr.offsetWidth; tr.style.transition = '';
    label.animate([{ opacity: 0, letterSpacing: '.6em' }, { opacity: 1 }], { duration: 500, easing: 'cubic-bezier(.2,.8,.2,1)' });
    hooks.phase?.(name, i);
    draw();
    iv = setInterval(() => {
      if (!screen.classList.contains('on')) return stop();
      t--; hooks.tick?.(name, t, total);
      if (t <= 0) { stop(); if (hooks.timeout?.(name) !== false) enter(i + 1); } else draw();
    }, 1000);
  };
  return { start(l, h) { list = l; hooks = h; enter(0); }, next: () => enter(i + 1), stop, get name() { return list[i]?.[0]; } };
}
// 화면 위 공통 머리 (YOUR TURN 자리): 제목 · 초 · 바 · 설명
const head = s => `
  <div class="t f-ci red in" id="lb${s}" data-x="60" data-cy="125" data-h="10">READY</div>
  <div class="t f-di in" id="te${s}" data-x="60" data-cy="163" data-h="30">0</div>
  <div class="t in" data-x="108" data-cy="172" data-h="9">초</div>
  <div class="a in" style="--x:60;--y:184;--w:60;--h:2;background:var(--red)"></div>
  <div class="a track in" style="--x:132;--y:184;--w:183;--h:2"><i id="tr${s}"></i></div>
  <div class="t phase-d in" id="ds${s}" data-x="132" data-cy="166" data-h="10"></div>`;
const toast = (scr, y, icoC, text, onYes) => {
  scr.querySelector('.toast')?.remove();
  const d = document.createElement('div'); d.className = 'toast'; d.style.top = `calc(${y} * var(--sy) * 1px)`;
  d.innerHTML = `<div class="ico" style="background-image:url(${img(icoC)})"></div><span>${text}</span><button>거절</button><button class="y">수락</button>`;
  const [no, yes] = d.querySelectorAll('button');
  no.onclick = () => d.remove(); yes.onclick = () => { d.remove(); onYes(); };
  scr.append(d); navigator.vibrate?.([60, 40, 60]);
  setTimeout(() => d.remove(), 8000);
};
const lockFx = el => el.animate([{ filter: 'grayscale(1) brightness(2)', boxShadow: '0 0 0 0 #e0303acc' }, { filter: 'none', boxShadow: '0 0 0 14px #e0303a00' }], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' });

// ── 챔피언 고르는 창 (신속 대전 미리 고르기에 씀)
const picker = $('#picker');
function openPicker(title, sub, used, cb) {
  $('#pkh').innerHTML = `${title}<small>${sub}</small>`;
  $('#pkg').innerHTML = CHAMPS.map(c => `<div class="portrait${used.includes(c) ? ' used' : ''}" data-c="${c}" style="--img:url(${img(c)})"></div>`).join('');
  picker.classList.add('on');
  picker.onclick = e => { const c = e.target.dataset?.c; picker.classList.remove('on'); if (c) cb(c); };
}

// ═══ 신속 대전: 1·2지망 포지션마다 챔피언 하나씩 미리 (매칭 수락 뒤엔 선택 화면 없음)
const swift = {}; // 포지션 번호 → 챔피언
function drawSwift() {
  document.querySelectorAll('.swb').forEach(e => e.remove());
  if (curQ().flow !== 'swift') return;
  const roles = $('#roles');
  prefs.forEach((r, k) => {
    const b = document.createElement('div'); b.className = 'swb' + (swift[r] ? '' : ' need');
    Object.assign(b.style, { left: `calc(${ROLE_X[r] + 9} * var(--sx) * 1px)`, top: `calc(${520} * var(--sy) * 1px)`, width: 'calc(22px * var(--s))', height: 'calc(22px * var(--s))' });
    if (swift[r]) b.style.backgroundImage = `url(${img(swift[r])})`; else b.textContent = '+';
    roles.append(b);
  });
}
window.onQ = () => drawSwift();
const swiftPick = r => openPicker(`${ROLE_KO[r]} 챔피언`, `${prefs[0] === r ? '1' : '2'}지망 포지션에서 쓸 챔피언 · 5인 파티면 서로 달라야 함`,
  Object.values(swift), c => { swift[r] = c; drawSwift(); });
window.swiftReady = () => {
  const miss = prefs.find(r => !swift[r]);
  if (miss == null) return true;
  swiftPick(miss); return false;
};
{
  const rolesEl = $('#roles'), base = rolesEl.onclick;
  rolesEl.onclick = e => {
    const i = +e.target.dataset.i;
    if (curQ().flow === 'swift' && !isNaN(i) && prefs.includes(i) && !go.classList.contains('searching')) return swiftPick(i);
    base(e); drawSwift();
  };
}

// ═══ 4. 밴픽형
const s4 = screens[3];
const ROW = i => 405 + i * 81.25;
const FLOWS4 = {
  draft: [['intro', 5, 'GET READY', '챔피언 선택 시작', ''], ['intent', 7, 'DECLARE', '희망 챔피언 · 팀에게만 보임', '희망 표시'],
    ['ban', 25, 'BAN PHASE', '상대에게서 하나 금지', '금지 확정'], ['wait', 6, 'PICKING', '팀이 고르는 중', ''],
    ['pick', 25, 'YOUR TURN', '내 차례 · 시간 넘기면 닷지', '선택 완료'], ['final', 30, 'LOADOUT', '장비 준비 · 교환', '룬·스펠은 PC 에서']],
  tour: [['plan', 15, 'STRATEGY', '상대 팀 정보 · 전략 수립', ''], ['ban', 20, 'BAN · 1', '1차 금지 3개 · 팀 교대', '금지 확정'],
    ['wait', 6, 'PICK · 1', '1차 선택 3개', ''], ['ban2', 20, 'BAN · 2', '2차 금지 2개', '금지 확정'],
    ['pick', 25, 'PICK · 2', '2차 선택 · 내 차례', '선택 완료'], ['final', 30, 'LOADOUT', '장비 준비 · 교환', '룬·스펠은 PC 에서']],
  classic: [['intro', 5, 'CLASSIC', '팀·포지션 배정 확인', ''], ['wait', 5, 'PICKING', '팀이 고르는 중', ''],
    ['pick', 30, 'YOUR TURN', '내 차례 · 교환 요청 가능', '선택 완료'], ['final', 30, 'LOADOUT', '클래식 룬·특성 준비 · 교환', '룬·특성은 PC 에서']],
};
let r4;
onEnter[4] = () => {
  const q = curQ(), flow = FLOWS4[q.flow] ? q.flow : 'draft', ME = prefs[0];
  const pool = shuffle(CHAMPS), banned = [], picked = {}; let myBan = null, myIntent = null, myPick = null;
  const allyBans = flow === 'classic' ? 0 : 5;
  s4.innerHTML = head(4) + `
    <div class="t in" id="bh" data-x="26.5" data-cy="242" data-h="12" style="--d:.1s">${allyBans ? '금지 챔피언' : '금지 없음 · 클래식'}</div>
    <div id="bans"></div>
    <div class="a hy divider" style="--x:160;--y:358;--h:414"></div>
    <div id="team"></div>
    <div class="a search in" style="--x:180;--y:385;--w:175;--h:37;--d:.4s"><svg viewBox="0 0 16 16" fill="none" stroke="#9a948f" stroke-width="1.4"><circle cx="7" cy="7" r="5"/><path d="m11 11 4 4"/></svg>챔피언 검색</div>
    <div class="a hy grid" id="grid" style="--x:180;--y:444;--w:175;--h:328"></div>
    <button class="a cx btn in off" id="lock" style="--y:827;--w:322;--h:70;--d:.8s"></button>`;
  const bansEl = $('#bans', s4), grid = $('#grid', s4), lock = $('#lock', s4);
  bansEl.innerHTML = [...Array(allyBans)].map((_, i) =>
    `<div class="a portrait slot q flipin" id="ban${i}" style="--x:${26.5 + i * 67};--y:263;--w:54;--h:69;height:calc(69px * var(--sy));--d:${.2 + i * .08}s"></div>`).join('');
  $('#team', s4).innerHTML =
    `<div class="a hy mebox drawbox" style="--x:13;--y:${ROW(ME) - 38};--w:149;--h:76;--d:.75s"></div>` +
    ROLE_KO.map((n, i) => `
      <div class="a ws yc ico in" id="ico${i}" style="--x:20;--y:${ROW(i)};--w:40;--h:40;--d:${.3 + i * .07}s"><img src="img/role${i + 1}.png" alt=""></div>
      <div class="t f-kr4 in" data-x="68" data-cy="${ROW(i) - 11}" data-h="12" style="--d:${.3 + i * .07}s">${n}</div>
      <div class="t dim3 in" id="sub${i}" data-x="68" data-cy="${ROW(i) + 14}" data-h="11" style="--d:${.3 + i * .07}s">${i === ME ? '나' : '플레이어 ' + (i + 1)}</div>`).join('') +
    `<img class="a ws xc yc peek" src="img/devil-cut.png" alt="" style="--x:155;--y:${ROW(ME) - 6};--w:30;--h:31;--d:1.35s">`;
  const drawGrid = () => {
    grid.innerHTML = CHAMPS.slice(0, 30).map((c, i) =>
      `<div class="portrait in${banned.includes(c) || Object.values(picked).includes(c) ? ' used' : ''}" data-c="${c}" style="--d:${.5 + i * .03}s;--img:url(${img(c)})"></div>`).join('');
  };
  drawGrid();
  const sub = (i, t) => setText($('#sub' + i, s4), t);
  const setIco = (i, c) => { const e = $('#ico' + i, s4); e.style.backgroundImage = `url(${img(c)})`; e.innerHTML = ''; };
  const sel = () => grid.querySelector('.sel')?.dataset.c;
  grid.onclick = e => {
    const p = e.target.closest('.portrait'); if (!p || p.classList.contains('used') || !['intent', 'ban', 'ban2', 'pick'].includes(r4.name)) return;
    if (r4.name === 'pick' && myPick) return;
    grid.querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
    p.classList.add('sel');
    p.animate([{ scale: 1 }, { scale: 1.07 }, { scale: 1 }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (r4.name === 'pick' || r4.name === 'intent') { setIco(ME, p.dataset.c); sub(ME, r4.name === 'intent' ? '희망 · ' + p.dataset.c : '고르는 중'); }
  };
  // 금지 공개: 교차 선택은 금지 단계가 끝날 때 한꺼번에, 5인 랭크는 3개·2개씩
  const reveal = (from, to) => {
    for (let k = from; k < to; k++) {
      const c = k === 0 && myBan ? myBan : pool.find(x => !banned.includes(x) && x !== myIntent);
      banned.push(c);
      const e = $('#ban' + k, s4); e.classList.remove('slot', 'q', 'flipin'); e.classList.add('ban'); e.style.setProperty('--img', `url(${img(c)})`);
      e.animate([{ rotate: 'y 90deg', opacity: 0 }, { rotate: 'y 0deg', opacity: 1 }], { duration: 600, delay: (k - from) * 90, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    }
    drawGrid();
  };
  // 팀원들 픽 (시연: 순서대로 몇 초 간격) — 실제는 LCU actions 그대로
  const botPick = (who) => who.forEach((i, k) => setTimeout(() => {
    if (!s4.classList.contains('on') || picked[i]) return;
    const c = pool.find(x => !banned.includes(x) && !Object.values(picked).includes(x) && x !== myIntent);
    picked[i] = c; setIco(i, c); sub(i, '선택 · ' + c); lockFx($('#ico' + i, s4)); drawGrid();
  }, 800 + k * 1700));
  const others = [0, 1, 2, 3, 4].filter(i => i !== ME);
  lock.onclick = () => {
    const c = sel(), n = r4.name;
    if (n === 'intent' && c) { myIntent = c; sub(ME, '희망 · ' + c); return r4.next(); }
    if ((n === 'ban' || n === 'ban2') && c) { if (n === 'ban') myBan = c; lock.textContent = '금지함 · 상대 대기'; lock.classList.add('off'); return setTimeout(() => r4.name === n && r4.next(), 1800); } // 시연: 다들 금지했다고 치고 넘어감
    if (n === 'pick' && c && !myPick) {
      myPick = picked[ME] = c; grid.querySelector('.sel')?.classList.replace('sel', 'lock');
      sub(ME, '확정 · ' + c); setIco(ME, c); lockFx($('#ico' + ME, s4)); $('#ico' + ME, s4).style.borderColor = '#c4454b';
      lock.textContent = '확정됨'; lock.classList.add('off');
      botPick(others.filter(i => !picked[i])); setTimeout(() => s4.classList.contains('on') && r4.name === 'pick' && r4.next(), 4200);
    }
  };
  r4 = runner(s4, { label: $('#lb4', s4), desc: $('#ds4', s4), te: $('#te4', s4), tr: $('#tr4', s4), btn: lock });
  r4.start(FLOWS4[flow], {
    phase(n) {
      if (n === 'plan') { const d = document.createElement('div'); d.className = 'info'; d.id = 'plan';
        Object.assign(d.style, { left: 'calc(180 * var(--sx) * 1px)', top: 'calc(444 * var(--sy) * 1px)', width: 'calc(175 * var(--sx) * 1px)' });
        d.innerHTML = '<b>상대 5인 파티</b><br>최근 20판 · 승률 61%<br>주 챔피언: 탑 다리우스, 정글 비에고<br><br>밴 3 → 픽 3 → 밴 2 → 픽 2<br>팀이 번갈아 진행'; s4.append(d); grid.style.visibility = 'hidden'; }
      else { $('#plan', s4)?.remove(); grid.style.visibility = ''; }
      if (n === 'wait') {
        if (flow === 'tour' && banned.length === 0) reveal(0, 3);
        if (flow === 'draft' && banned.length === 0) reveal(0, 5);
        botPick(others.slice(0, flow === 'classic' ? 2 : 3));
      }
      if (n === 'ban2') {} // 1차 픽은 wait 에서
      if (n === 'pick' && flow === 'tour' && banned.length < 5) reveal(3, 5);
      if (n === 'final') {
        botPick(others.filter(i => !picked[i]));
        grid.style.visibility = 'hidden';
        const d = document.createElement('div'); d.className = 'info'; d.id = 'plan';
        Object.assign(d.style, { left: 'calc(180 * var(--sx) * 1px)', top: 'calc(444 * var(--sy) * 1px)', width: 'calc(175 * var(--sx) * 1px)' });
        d.innerHTML = `<b>${myPick || '-'}</b> 확정<br>룬 · 소환사 주문 · 스킨은<br>PC 에서 바꾸세요<br><br>${flow === 'classic' ? '교환 요청은 라인을 바꾸지 않음' : '포지션은 챔프 선택 중에만 교환 가능'}`;
        s4.append(d);
        setTimeout(() => { const j = others[1]; if (s4.classList.contains('on') && r4.name === 'final' && picked[j])
          toast(s4, 760, picked[j], `${ROLE_KO[j]} 와(과) 챔피언 교환 요청`, () => { [picked[j], picked[ME]] = [picked[ME], picked[j]]; myPick = picked[ME]; setIco(ME, myPick); setIco(j, picked[j]); sub(ME, '교환 · ' + myPick); sub(j, '선택 · ' + picked[j]); lockFx($('#ico' + ME, s4)); }); }, 3000);
      }
    },
    timeout(n) {
      if (n === 'pick' && !myPick) { // 시간 안에 못 고르면 닷지 → 매칭 화면
        setText($('#lb4', s4), 'DODGED'); setText($('#ds4', s4), '시간 초과 · 사전 이탈'); setTimeout(() => show(2), 1500); return false;
      }
    },
    done() { inGame('게임 로딩 중 · PC 에서 진행'); },
  });
};

// ═══ 5. 칼바람형 (칼바람 · 아수라장): 카드 12초 → 벤치·교환 → 로딩
const s5 = screens[4];
let r5;
onEnter[5] = () => {
  const q = curQ(), pool = shuffle(CHAMPS);
  const three = Math.random() < .25; // 실제 5% + 보유 챔프당 0.15% — 시연에선 자주 보이게
  const cards = pool.splice(0, three ? 3 : 2), mates = [0, 1, 2, 3].map(() => pool.shift());
  let mine = null; const bench = [];
  s5.innerHTML = head(5) + `
    <div class="t in" data-x="26.5" data-cy="242" data-h="12">내 챔피언 카드</div>
    <div class="cards in" id="cards" style="top:calc(268 * var(--sy) * 1px);--d:.2s">${cards.map((c, k) =>
      `<div class="portrait${k === 2 ? ' third' : ''}" data-c="${c}" style="--img:url(${img(c)})"></div>`).join('')}</div>
    <div class="t in" data-x="26.5" data-cy="452" data-h="12" style="--d:.3s">팀 벤치</div>
    <div class="t dim3 in" id="bhint" data-x="100" data-cy="452" data-h="10" style="--d:.3s">고르지 않은 카드가 올라옴 · 눌러서 바꾸기</div>
    <div class="bench in" id="bench" style="left:calc(26.5 * var(--sx) * 1px);width:calc(322 * var(--sx) * 1px);top:calc(472 * var(--sy) * 1px);--d:.35s"></div>
    <div class="mates in" id="mates" style="top:calc(668 * var(--sy) * 1px);--d:.45s"></div>
    <button class="a cx btn in off" id="lock5" style="--y:827;--w:322;--h:70;--d:.6s"></button>`;
  const cardsEl = $('#cards', s5), benchEl = $('#bench', s5), lock = $('#lock5', s5);
  const drawMates = () => $('#mates', s5).innerHTML = [...mates.slice(0, 2), mine, ...mates.slice(2)].map((c, k) =>
    `<div class="${k === 2 ? 'me' : ''}"><div class="ico" style="background-image:${c ? `url(${img(c)})` : 'none'}"></div>${k === 2 ? '나' : '팀원 ' + (k < 2 ? k + 1 : k)}</div>`).join('');
  const LOCK_S = 3; // 벤치에 막 올라온 챔피언은 잠깐 잠김 (시연 3초 · 실제 값은 클라이언트)
  const drawBench = () => {
    benchEl.innerHTML = [...Array(10)].map((_, k) => {
      const b = bench[k];
      return b ? `<div class="portrait${Date.now() - b.at < LOCK_S * 1000 ? ' wait' : ''}" data-k="${k}" style="--img:url(${img(b.c)});--lock:${Math.max(0, LOCK_S * 1000 - (Date.now() - b.at))}ms"></div>`
        : '<div class="portrait empty"></div>';
    }).join('');
  };
  const addBench = c => { bench.push({ c, at: Date.now() }); drawBench(); setTimeout(drawBench, LOCK_S * 1000 + 50); };
  drawMates(); drawBench();
  cardsEl.onclick = e => {
    const p = e.target.closest('.portrait'); if (!p || r5.name !== 'cards') return;
    cardsEl.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); p.classList.add('sel');
    mine = p.dataset.c; drawMates();
  };
  benchEl.onclick = e => {
    const p = e.target.closest('.portrait[data-k]'); if (!p || r5.name !== 'bench' || !mine) return;
    const k = +p.dataset.k, got = bench[k].c;
    bench.splice(k, 1); addBench(mine); mine = got; drawMates(); lockFx($('#mates .me .ico', s5));
    navigator.vibrate?.(20);
  };
  lock.onclick = () => r5.name === 'cards' && mine && r5.next();
  r5 = runner(s5, { label: $('#lb5', s5), desc: $('#ds5', s5), te: $('#te5', s5), tr: $('#tr5', s5), btn: lock });
  r5.start([['cards', 12, q.n === '아수라장' ? 'MAYHEM' : 'ARAM', '카드에서 고르기 · 12초', '이 챔피언으로'],
            ['bench', 45, 'BENCH', q.n === '아수라장' ? '벤치 교환 · 증강은 게임 안에서' : '벤치에서 바꾸기 · 팀원과 교환', '']], {
    phase(n) {
      if (n !== 'bench') return;
      if (!mine) { mine = cards[0]; } // 안 고르면 첫 카드
      cards.filter(c => c !== mine).forEach(addBench);
      cardsEl.querySelectorAll('.portrait').forEach(p => p.classList.toggle('gone', p.dataset.c !== mine));
      drawMates();
      mates.forEach((_, k) => setTimeout(() => s5.classList.contains('on') && addBench(pool.shift()), 600 + k * 900)); // 팀원 카드도 벤치로
      setTimeout(() => s5.classList.contains('on') && r5.name === 'bench' &&
        toast(s5, 752, mates[1], '팀원 2 와(과) 챔피언 교환 요청', () => { [mates[1], mine] = [mine, mates[1]]; drawMates(); lockFx($('#mates .me .ico', s5)); }), 6000);
    },
    done() { inGame(q.n === '아수라장' ? '게임 로딩 중 · 첫 증강은 게임 안에서' : '게임 로딩 중 · PC 에서 진행'); },
  });
};

// ═══ 6. 아레나형 (아레나 2인 8팀 · 3x6 3인 6팀): 의사 표시 → 동시 금지 → 선택 → 최종
const s6 = screens[5];
let r6;
onEnter[6] = () => {
  const q = curQ(), size = q.team || 2, nTeams = q.teams || 8, pool = shuffle(CHAMPS);
  const favs = pool.slice(0, 4); // 관중 인기 챔피언 (게임 진입 때 능력치 모루)
  let mine = null, brave = false; const mates = [...Array(size - 1)].map(() => null), banned = [];
  const teams = [...Array(nTeams - 1)].map(() => [...Array(size)].map(() => null));
  s6.innerHTML = head(6) + `
    <div class="t in" data-x="26.5" data-cy="242" data-h="12">우리 팀 · ${size}인</div>
    <div class="myteam in" id="myteam" style="left:calc(26.5 * var(--sx) * 1px);top:calc(262 * var(--sy) * 1px);--d:.2s"></div>
    <div class="a hy divider" style="--x:180;--y:236;--h:${size === 2 ? 190 : 250}"></div>
    <div class="t in" data-x="196" data-cy="242" data-h="12">다른 팀 ${nTeams - 1}</div>
    <div class="teams in" id="teams" style="left:calc(196 * var(--sx) * 1px);top:calc(262 * var(--sy) * 1px);--d:.25s"></div>
    <div class="t dim3 in" data-x="26.5" data-cy="${size === 2 ? 455 : 510}" data-h="10">금지됨</div>
    <div class="bannedrow in" id="bannedrow" style="left:calc(70 * var(--sx) * 1px);top:calc(${size === 2 ? 445 : 500} * var(--sy) * 1px);width:calc(280 * var(--sx) * 1px)"></div>
    <button class="chip in" id="brave" style="left:calc(248 * var(--sx) * 1px);top:calc(${size === 2 ? 480 : 530} * var(--sy) * 1px);width:calc(100 * var(--sx) * 1px);height:calc(28 * var(--sy) * 1px)">BRAVERY</button>
    <div class="t dim3 in" data-x="26.5" data-cy="${size === 2 ? 494 : 544}" data-h="10">★ 관중 인기 · 모루 보상</div>
    <div class="grid in" id="grid6" style="position:absolute;left:calc(26.5 * var(--sx) * 1px);width:calc(322 * var(--sx) * 1px);top:calc(${size === 2 ? 520 : 570} * var(--sy) * 1px);height:calc(${size === 2 ? 280 : 230} * var(--sy) * 1px);grid-template-columns:repeat(6,1fr)"></div>
    <button class="a cx btn in off" id="lock6" style="--y:827;--w:322;--h:70;--d:.6s"></button>`;
  const grid = $('#grid6', s6), lock = $('#lock6', s6), brv = $('#brave', s6);
  const drawMy = () => $('#myteam', s6).innerHTML = [mine, ...mates].map((c, k) =>
    `<div><div class="portrait${c ? ' on' : ' slot q'}" style="${c ? `--img:url(${img(c)})` : ''}"></div><div><b>${k ? '팀원 ' + k : '나'}</b>${c ? (k || r6?.name !== 'intent' ? c : '의사 표시 · ' + c) : brave && !k ? 'BRAVERY · 무작위' : '고르는 중'}</div></div>`).join('');
  const drawTeams = () => $('#teams', s6).innerHTML = teams.map((t, k) =>
    `<div>${t.map(c => `<div class="ico" style="background-image:${c ? `url(${img(c)})` : 'none'}"></div>`).join('')}팀 ${k + 2}</div>`).join('');
  const drawGrid = () => grid.innerHTML = CHAMPS.slice(0, 36).map(c =>
    `<div class="portrait${banned.includes(c) ? ' used' : ''}${favs.includes(c) ? ' fav' : ''}" data-c="${c}" style="--img:url(${img(c)})"></div>`).join('');
  drawMy(); drawTeams(); drawGrid();
  grid.onclick = e => {
    const p = e.target.closest('.portrait'); if (!p || p.classList.contains('used') || r6.name === 'final' || brave) return;
    grid.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); p.classList.add('sel');
    if (r6.name !== 'ban') { mine = p.dataset.c; drawMy(); }
  };
  brv.onclick = () => { if (r6.name !== 'pick') return; brave = !brave; brv.classList.toggle('on', brave); if (brave) mine = null; drawMy(); };
  lock.onclick = () => {
    const c = grid.querySelector('.sel')?.dataset.c, n = r6.name;
    if (n === 'intent' && c) return r6.next();
    if (n === 'ban' && c) { banned.push(c); lock.textContent = '금지함 · 동시 공개 대기'; lock.classList.add('off'); return setTimeout(() => r6.name === 'ban' && r6.next(), 1800); }
    if (n === 'pick' && (c || brave)) {
      if (brave) mine = pool.find(x => !banned.includes(x));
      lockFx(grid.querySelector('.sel') || brv); drawMy(); lock.textContent = '확정됨'; lock.classList.add('off'); setTimeout(() => r6.name === 'pick' && r6.next(), 1500);
    }
  };
  r6 = runner(s6, { label: $('#lb6', s6), desc: $('#ds6', s6), te: $('#te6', s6), tr: $('#tr6', s6), btn: lock });
  r6.start([['intent', 10, 'DECLARE', '쓸 챔피언 의사 표시', '의사 표시'], ['ban', 25, 'BAN · ALL', '모두 동시에 하나 금지', '금지 확정'],
            ['pick', 40, 'PICK', '선택 · 또는 BRAVERY', '선택 완료'], ['final', 10, 'FINAL', '최종 정리 · 곧 입장', '']], {
    phase(n) {
      if (n === 'pick') { // 동시 금지 공개
        while (banned.length < nTeams * size / 2) banned.push(pool.find(x => !banned.includes(x) && !favs.includes(x)));
        $('#bannedrow', s6).innerHTML = banned.map(c => `<div class="ico" style="background-image:url(${img(c)})"></div>`).join('');
        if (banned.includes(mine)) mine = null;
        drawGrid(); drawMy();
        // 다른 팀·팀원 선택이 하나씩 들어옴
        [...teams.flatMap((t, k) => t.map((_, j) => [k, j])), ...mates.map((_, j) => ['m', j])].forEach(([k, j], z) => setTimeout(() => {
          if (!s6.classList.contains('on')) return;
          const c = pool.find(x => !banned.includes(x) && x !== mine && !mates.includes(x) && !teams.flat().includes(x));
          if (k === 'm') { mates[j] = c; drawMy(); } else { teams[k][j] = c; drawTeams(); }
        }, 500 + z * 260));
      }
      if (n === 'final' && !mine) { mine = pool.find(x => !banned.includes(x)); drawMy(); }
    },
    done() { inGame(`${q.n} 입장 중 · PC 에서 진행`); },
  });
};
