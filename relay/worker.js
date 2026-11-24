// 딸깍 중계 (Cloudflare Worker + Durable Object). PC 방 유선 ↔ 폰 데이터처럼 서로 못 닿을 때 둘 다 여기로 나가서 만난다.
//   GET /            폰 화면 (web/ 정적 파일)
//   WS  /ws?room=PIN  폰. 메시지는 그대로 PC 로 (누가 보냈는지만 붙임) — PIN·토큰 확인은 PC(에이전트)가 한다
//   WS  /agent?room=PIN&key=비밀  PC. 방은 처음 들어온 PC 의 비밀로 잠김 → 남이 PC 인 척 못 함
// 중계는 내용을 해석하지 않는다 (롤 명령 화이트리스트는 PC 쪽 lcu.js).
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws' || url.pathname === '/agent') {
      const room = url.searchParams.get('room') ?? '';
      if (!/^\d{6}$/.test(room) || req.headers.get('Upgrade') !== 'websocket') return new Response('bad', { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(room)).fetch(req);
    }
    if (url.pathname === '/') return env.ASSETS.fetch(new Request(new URL('/app', url), req)); // 폰 화면 = app.html
    return env.ASSETS.fetch(req);
  },
};

export class Room {
  constructor(state) { this.state = state; }

  async fetch(req) {
    const url = new URL(req.url);
    const [client, server] = Object.values(new WebSocketPair());
    if (url.pathname === '/agent') {
      const key = url.searchParams.get('key') ?? '';
      const saved = await this.state.storage.get('key');
      const fresh = saved && Date.now() - (await this.state.storage.get('at') ?? 0) > 12 * 3600e3; // 12시간 지난 방은 새 PC 가 가져갈 수 있음
      if (saved && saved !== key && !fresh) return new Response('room taken', { status: 403 });
      await this.state.storage.put({ key, at: Date.now() });
      for (const ws of this.state.getWebSockets('agent')) ws.close(4000, 'replaced');
      this.state.acceptWebSocket(server, ['agent']);
      for (const ws of this.state.getWebSockets('phone')) ws.send(JSON.stringify({ t: 'rehello' })); // 이미 붙어 있던 폰은 다시 인사하게
    } else {
      const id = crypto.randomUUID();
      this.state.acceptWebSocket(server, ['phone', id]);
      if (!this.state.getWebSockets('agent').length) server.send(JSON.stringify({ t: 'pc-off' }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  toAgent(phone, m) {
    const from = this.state.getTags(phone)[1];
    for (const a of this.state.getWebSockets('agent')) a.send(JSON.stringify({ from, m }));
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 64 * 1024) return;
    const tags = this.state.getTags(ws);
    if (tags[0] === 'phone') {
      let m; try { m = JSON.parse(msg); } catch { return; }
      if (!this.state.getWebSockets('agent').length) return ws.send(JSON.stringify({ t: 'pc-off' }));
      return this.toAgent(ws, m);
    }
    // PC → 폰: { to: 폰id | '*', m }
    let o; try { o = JSON.parse(msg); } catch { return; }
    const out = JSON.stringify(o.m);
    for (const p of this.state.getWebSockets('phone')) if (o.to === '*' || this.state.getTags(p)[1] === o.to) p.send(out);
  }

  async webSocketClose(ws) {
    const tags = this.state.getTags(ws);
    if (tags[0] === 'phone') for (const a of this.state.getWebSockets('agent')) a.send(JSON.stringify({ from: tags[1], m: { t: 'bye' } }));
    else for (const p of this.state.getWebSockets('phone')) p.send(JSON.stringify({ t: 'pc-off' }));
  }
}
