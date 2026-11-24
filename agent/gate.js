import crypto from 'node:crypto';

// 공개 저장소라 평문 대신 SHA-256 만 둔다.
// shortcut: 해시는 누구나 볼 수 있어 진짜 보안은 아님 — 실제 방어선은 중계 서버의 PIN·세션 토큰.
const HASH = '456c2ac46bd91e44077967794c64474bc841bd466b504195753c88350abd7a1d';

export const checkPassword = input =>
  crypto.createHash('sha256').update(String(input).normalize('NFC').trim()).digest('hex') === HASH;
