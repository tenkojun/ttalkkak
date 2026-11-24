// 실제 롤 클라이언트 정밀 검증 (매칭은 절대 안 잡음): node scripts/verify-real.mjs
// 앱과 똑같이 runCommand(화이트리스트·변환 포함)로 쓰고, 롤이 가진 값을 다시 읽어 비교한다. 끝나면 원래 상태로 되돌림.
import { findClient, connect, runCommand, visibleQueues, POSITIONS } from '../agent/lcu.js';

const lcu = connect(findClient());
const get = async p => { const r = await lcu.req('GET', p); return r.status < 300 ? r.data : null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push([ok, name, detail]); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const queues = visibleQueues(await get('/lol-game-queues/v1/queues'));
const ctx = { queues: new Set(queues.map(q => q.id)) };
const cmd = (n, a) => runCommand(lcu, n, a, ctx);
const lobby = () => get('/lol-lobby/v2/lobby');

// ── 원래 상태 기록
const phase0 = await get('/lol-gameflow/v1/gameflow-phase');
if (!['None', 'Lobby'].includes(phase0)) { console.log('지금 상태가', phase0, '— 로비/대기에서만 검증합니다'); process.exit(1); }
const lob0 = await lobby();
const orig = { queue: lob0?.gameConfig?.queueId, f: lob0?.localMember?.firstPositionPreference, s: lob0?.localMember?.secondPositionPreference,
  slots: lob0?.localMember?.playerSlots, page: (await get('/lol-perks/v1/currentpage'))?.id, tmp: (await get('/lol-perks/v1/currentpage'))?.isTemporary };
console.log('원래:', JSON.stringify({ ...orig, slots: orig.slots?.map(s => s.championId) }));
const pagesBefore = new Set(((await get('/lol-perks/v1/pages')) ?? []).map(p => p.id));

try {
  // 1. 보이는 큐마다 로비 만들기
  console.log('\n[1] 큐마다 로비 만들기 (' + queues.map(q => q.id).join(',') + ')');
  for (const q of queues) {
    const r = await cmd('createLobby', { queueId: q.id }); await sleep(600);
    const l = await lobby();
    check(`${q.name}(${q.id}) 로비`, r.status < 300 && l?.gameConfig?.queueId === q.id, `응답 ${r.status}, 로비 큐 ${l?.gameConfig?.queueId}, 포지션칸 ${l?.gameConfig?.showPositionSelector}=${q.pos}, 미리고르기 ${l?.gameConfig?.showQuickPlaySlotSelection}=${q.slots}`);
  }
  await runCommand(lcu, 'createLobby', { queueId: 1 }, ctx).then(() => check('목록 밖 큐는 막힘', false)).catch(() => check('목록 밖 큐는 막힘', true));

  // 2. 포지션: 1·2지망 모든 조합 + 모두
  const posQ = queues.find(q => q.pos);
  if (posQ) {
    console.log(`\n[2] 포지션 (${posQ.name})`);
    await cmd('createLobby', { queueId: posQ.id }); await sleep(600);
    let bad = 0, n = 0;
    for (const f of [...POSITIONS, 'fill']) for (const s of [...POSITIONS, 'fill', 'unselected']) {
      if (f === s || (f === 'fill' && s !== 'unselected') || (f !== 'fill' && s === 'unselected')) continue;
      n++;
      const r = await cmd('setPositions', { first: f, second: s });
      await sleep(300); const m = (await lobby()).localMember;
      if (r.status >= 300 || m.firstPositionPreference !== f.toUpperCase() || m.secondPositionPreference !== s.toUpperCase()) { bad++; console.log('    틀림', f, s, r.status, m.firstPositionPreference, m.secondPositionPreference); }
    }
    check(`포지션 ${n}가지 조합`, !bad, bad ? `${bad}개 틀림` : '전부 롤 값과 같음');
  }

  // 3. 신속 대전 칸: 챔피언·포지션·주문·룬(모든 주/보조 스타일 조합)
  const sq = queues.find(q => q.slots);
  const styles = await get('/lol-perks/v1/styles');
  const owned = ((await get('/lol-champions/v1/owned-champions-minimal')) ?? []).filter(c => c.id > 0 && c.id < 10000 && (c.ownership?.owned || c.freeToPlay)).map(c => c.id);
  const st = id => styles.find(s => s.id === id);
  const build = (P, S, k) => { // 주 4줄 + 보조 2개(다른 줄) + 능력치 3 — 줄마다 k 번째로 골고루
    const prim = st(P).slots.filter(x => x.type !== 'kStatMod'), sh = st(P).slots.filter(x => x.type === 'kStatMod');
    const sub = st(S).slots.filter(x => x.type !== 'kStatMod' && x.type !== 'kKeyStone');
    const a = k % sub.length, b = (k + 1) % sub.length;
    return { perkIds: [...prim.map(r => r.perks[k % r.perks.length]), sub[Math.min(a, b)].perks[k % sub[Math.min(a, b)].perks.length], sub[Math.max(a, b)].perks[k % sub[Math.max(a, b)].perks.length], ...sh.map(r => r.perks[k % r.perks.length])], perkStyle: P, perkSubStyle: S };
  };
  if (sq) {
    console.log(`\n[3] 신속 대전 칸 (${sq.name})`);
    await cmd('createLobby', { queueId: sq.id }); await sleep(800);
    let k = 0, bad = 0, n = 0;
    for (const P of styles.map(s => s.id)) for (const S of st(P).allowedSubStyles) {
      const pk = build(P, S, k), c1 = owned[k % owned.length], c2 = owned[(k + 7) % owned.length];
      const p1 = POSITIONS[k % 5], p2 = POSITIONS[(k + 2) % 5], spells = [[4, 14], [4, 12], [11, 4], [7, 4], [4, 3]][k % 5];
      const slots = [{ championId: c1, position: p1, spell1: spells[0], spell2: spells[1], perks: pk }, { championId: c2, position: p2, spell1: 4, spell2: 7, perks: build(S, P, k + 1) }];
      const r = await cmd('setSlots', { slots }); await sleep(250);
      const got = (await lobby()).localMember.playerSlots;
      const same = (g, w) => g && g.championId === w.championId && g.positionPreference === w.position.toUpperCase() && g.spell1 === w.spell1 && g.spell2 === w.spell2 && JSON.stringify(JSON.parse(g.perks)) === JSON.stringify(w.perks);
      n++;
      if (r.status >= 300 || !same(got[0], slots[0]) || !same(got[1], slots[1])) { bad++; console.log('    틀림', P, S, r.status, r.data?.message ?? '', JSON.stringify(got?.map(g => [g.championId, g.positionPreference, g.spell1, g.spell2, g.perks]))); }
      k++;
    }
    check(`칸 ${n}가지 (주/보조 룬 스타일 전 조합 × 챔피언·포지션·주문)`, !bad, bad ? `${bad}개 틀림` : '전부 롤 값과 같음');
    // 추천 룬은 그대로 넣었을 때 롤이 받는지
    const rec = await cmd('slotPerks', { championId: owned[0], position: 'middle' });
    const rp = JSON.parse(rec.data);
    const r2 = await cmd('setSlots', { slots: [{ championId: owned[0], position: 'middle', spell1: 4, spell2: 14, perks: rp }, { championId: owned[1], position: 'top', spell1: 4, spell2: 12, perks: rp }] });
    check('추천 룬을 칸에 넣기', rec.status === 200 && r2.status < 300 && (await lobby()).localMember.playerSlots[0].perks === JSON.stringify(rp));
    // 보조 룬 순서를 뒤집어 보내면 롤이 어떻게 하는지 (앱은 항상 줄 순서로 보냄)
    const rev = build(8100, 8300, 0); [rev.perkIds[4], rev.perkIds[5]] = [rev.perkIds[5], rev.perkIds[4]];
    const r3 = await cmd('setSlots', { slots: [{ championId: owned[0], position: 'middle', spell1: 4, spell2: 14, perks: rev }, { championId: owned[1], position: 'top', spell1: 4, spell2: 12, perks: rp }] });
    console.log('    (참고) 보조 순서 뒤집음 →', r3.status, (await lobby()).localMember.playerSlots[0].perks);
  }

  // 4. 룬 페이지: 새로 만들기·고치기·고르기 (시험 페이지는 끝나고 지움)
  console.log('\n[4] 룬 페이지');
  const inv = await get('/lol-perks/v1/inventory');
  if (!inv?.canAddCustomPage) check('룬 페이지 새로 만들기', true, '건너뜀: 페이지 칸이 꽉 참 (기존 페이지는 안 건드림)');
  else {
    const mk = await cmd('perkSave', { name: '딸깍검증', primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: build(8000, 8100, 0).perkIds });
    const pages = await get('/lol-perks/v1/pages'), made = pages.find(p => !pagesBefore.has(p.id));
    check('새 페이지 저장', mk.status < 300 && made && JSON.stringify(made.selectedPerkIds) === JSON.stringify(build(8000, 8100, 0).perkIds), `응답 ${mk.status}`);
    if (made) {
      let bad = 0, n = 0, k = 1;
      for (const P of styles.map(s => s.id)) for (const S of st(P).allowedSubStyles) {
        const ids = build(P, S, k++).perkIds; n++;
        const r = await cmd('perkSave', { id: made.id, name: '딸깍검증', primaryStyleId: P, subStyleId: S, selectedPerkIds: ids });
        const pg = (await get('/lol-perks/v1/pages')).find(p => p.id === made.id);
        if (r.status >= 300 || JSON.stringify(pg.selectedPerkIds) !== JSON.stringify(ids) || pg.primaryStyleId !== P || pg.subStyleId !== S) { bad++; console.log('    틀림', P, S, r.status, JSON.stringify(pg?.selectedPerkIds)); }
      }
      check(`페이지 고치기 ${n}가지 (스타일 전 조합)`, !bad, bad ? `${bad}개 틀림` : '전부 롤 값과 같음');
      const other = [...pagesBefore][0];
      if (other) { const r = await cmd('perkSelect', { id: other }); check('페이지 고르기', r.status < 300 && (await get('/lol-perks/v1/currentpage'))?.id === other, `응답 ${r.status}`); }
      const bad9 = await cmd('perkSave', { id: made.id, primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [8005, 9101, 9104, 8014, 8126, 8139, 5008, 5008, 5001] }); // 보조가 같은 줄 2개
      const pg = (await get('/lol-perks/v1/pages')).find(p => p.id === made.id);
      console.log('    (참고) 잘못된 조합 저장 →', bad9.status, 'isValid', pg?.isValid, JSON.stringify(pg?.selectedPerkIds));
    }
  }
} finally {
  // ── 원래대로
  console.log('\n[되돌리기]');
  for (const p of (await get('/lol-perks/v1/pages')) ?? []) if (!pagesBefore.has(p.id)) await lcu.req('DELETE', `/lol-perks/v1/pages/${p.id}`);
  if (orig.queue) {
    await lcu.req('POST', '/lol-lobby/v2/lobby', { queueId: orig.queue }); await sleep(800);
    if (orig.f) await lcu.req('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', { firstPreference: orig.f, secondPreference: orig.s || 'UNSELECTED' });
    if (orig.slots?.length) await lcu.req('PUT', '/lol-lobby/v1/lobby/members/localMember/player-slots', orig.slots);
  } else await lcu.req('DELETE', '/lol-lobby/v2/lobby');
  await sleep(800); if (orig.page) await lcu.req('PUT', '/lol-perks/v1/currentpage', orig.page); // 로비를 만들면 롤이 페이지를 바꾸므로 마지막에
  const l = await lobby();
  const back = { queue: l?.gameConfig?.queueId, f: l?.localMember?.firstPositionPreference, s: l?.localMember?.secondPositionPreference,
    slots: l?.localMember?.playerSlots, page: (await get('/lol-perks/v1/currentpage'))?.id };
  const ok = back.queue === orig.queue && (!orig.f || (back.f === orig.f && back.s === orig.s)) && JSON.stringify(back.slots ?? null) === JSON.stringify(orig.slots ?? null) && (orig.tmp || back.page === orig.page) && // 임시(자동) 페이지는 롤이 새 번호로 다시 만듦
   
    ((await get('/lol-perks/v1/pages')) ?? []).every(p => pagesBefore.has(p.id));
  check('원래 상태로 복구', ok, JSON.stringify({ ...back, slots: back.slots?.map(s => s.championId) }));
  const fails = results.filter(r => !r[0]);
  console.log(`\n결과: ${results.length - fails.length}/${results.length} 통과${fails.length ? ' — 실패: ' + fails.map(f => f[1]).join(', ') : ''}`);
}
