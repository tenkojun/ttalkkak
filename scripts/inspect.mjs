// 실제 롤 클라이언트 읽기 전용 조사: node scripts/inspect.mjs [경로...]  (GET 만, 아무것도 바꾸지 않음)
import { findClient, connect } from '../agent/lcu.js';
const lock = findClient();
if (!lock) { console.log('롤 클라이언트 없음'); process.exit(1); }
const lcu = connect(lock);
const paths = process.argv.slice(2);
for (const p of paths) {
  const r = await lcu.req('GET', p);
  console.log(`\n### ${p} → ${r.status}\n` + JSON.stringify(r.data, null, 1).slice(0, 6000));
}
