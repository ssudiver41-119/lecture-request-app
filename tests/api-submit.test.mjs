import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const handlerModule = await import('../api/submit.js');
const handler = handlerModule.default;
const { __resetRateLimits, buildWebhookPayload, config } = handlerModule;

const WEBHOOK = 'https://script.google.com/macros/s/AKfycbTEST/exec';

// ── 도우미 ────────────────────────────────────────────────
function mockReq({ method = 'POST', body, headers = {} } = {}) {
  return { method, body, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
}

function mockRes() {
  const res = { statusCode: null, headers: {}, payload: null, raw: '' };
  res.setHeader = (key, value) => { res.headers[String(key).toLowerCase()] = value; };
  res.end = (chunk) => {
    res.raw += chunk || '';
    try { res.payload = JSON.parse(res.raw); } catch { res.payload = null; }
  };
  return res;
}

function validBody(overrides = {}) {
  return {
    orgName: '구래종합사회복지관',
    contactName: '김복지',
    phone: '010-1234-5678',
    email: 'staff@example.com',
    preferredDate: '2099-12-31',
    preferredTime: '오후 (13:00~18:00)',
    method: '대면',
    audience: '사회복지사',
    audienceEtc: '',
    headcount: '30',
    duration: '2시간',
    budget: '기관 기준 1회 60만원',
    topic: '실무자 생성형 AI 문서·서식 자동화',
    message: '노트북 지참 가능 여부 문의드립니다.',
    consent: true,
    website: '',
    ...overrides,
  };
}

let fetchCalls = [];
const originalFetch = globalThis.fetch;
let ipCounter = 0;

function nextIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

async function invoke(body, options = {}) {
  const req = mockReq({
    method: options.method || 'POST',
    body,
    headers: { 'x-forwarded-for': options.ip || nextIp() },
  });
  const res = mockRes();
  await handler(req, res);
  return res;
}

function stubFetch(impl) {
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return impl(url, init);
  };
}

function jsonResponse(status, obj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)),
  };
}

beforeEach(() => {
  fetchCalls = [];
  __resetRateLimits();
  delete process.env.GOOGLE_DRIVE_WEBHOOK_URL;
  delete process.env.WEBHOOK_SHARED_SECRET;
  delete process.env.RATE_LIMIT_PER_MINUTE;
  delete process.env.RATE_LIMIT_PER_DAY;
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── 데모 모드 (웹훅 미설정) ────────────────────────────────

test('웹훅 미설정 시 200 + 데모 안내를 반환하고 외부 호출을 하지 않는다', async () => {
  stubFetch(() => jsonResponse(200, { ok: true }));
  const res = await invoke(validBody());

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.mode, 'demo');
  assert.equal(res.payload.code, 'WEBHOOK_NOT_CONFIGURED');
  assert.match(res.payload.notice, /설정되지 않아/);
  assert.match(res.payload.receiptNo, /^LR-\d{8}-[A-Z2-9]{4}$/);
  assert.equal(fetchCalls.length, 0);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
});

// ── 정상 접수 (웹훅 연동) ──────────────────────────────────

test('웹훅 설정 시 Apps Script 로 데이터를 보내고 200 live 를 반환한다', async () => {
  process.env.GOOGLE_DRIVE_WEBHOOK_URL = WEBHOOK;
  stubFetch(() =>
    jsonResponse(200, {
      ok: true,
      result: {
        docUrl: 'https://docs.google.com/document/d/abc/edit',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/xyz/edit',
        folderUrl: 'https://drive.google.com/drive/folders/fdr',
      },
    }),
  );

  const res = await invoke(validBody());

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.mode, 'live');
  assert.equal(res.payload.stored.docUrl, 'https://docs.google.com/document/d/abc/edit');
  assert.equal(res.payload.stored.sheetUrl, 'https://docs.google.com/spreadsheets/d/xyz/edit');
  assert.equal(res.payload.stored.folderUrl, 'https://drive.google.com/drive/folders/fdr');

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, WEBHOOK);
  assert.equal(fetchCalls[0].init.method, 'POST');
  assert.equal(fetchCalls[0].init.headers['Content-Type'], 'application/json; charset=utf-8');

  const sent = JSON.parse(fetchCalls[0].init.body);
  assert.equal(sent.orgName, '구래종합사회복지관');
  assert.equal(sent.contactName, '김복지');
  assert.equal(sent.email, 'staff@example.com');
  assert.equal(sent.headcount, '30');
  assert.equal(sent.topic, '실무자 생성형 AI 문서·서식 자동화');
  assert.equal(sent.source, 'lecture-request-app');
  assert.equal(sent.appVersion, config.APP_VERSION);
  assert.equal(sent.consent, true);
  assert.match(sent.receiptNo, /^LR-\d{8}-[A-Z2-9]{4}$/);
  assert.match(sent.receivedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.equal(sent.website, undefined, '허니팟 값은 외부로 전달하지 않는다');
});

test('WEBHOOK_SHARED_SECRET 이 있으면 토큰을 쿼리로 붙인다', async () => {
  process.env.GOOGLE_DRIVE_WEBHOOK_URL = WEBHOOK;
  process.env.WEBHOOK_SHARED_SECRET = 's3cret value';
  stubFetch(() => jsonResponse(200, { ok: true, result: {} }));

  const res = await invoke(validBody());

  assert.equal(res.statusCode, 200);
  assert.equal(fetchCalls[0].url, `${WEBHOOK}?token=s3cret%20value`);
});

test('접수번호는 호출마다 생성되고 연속 호출도 서로 다른 값이 나온다', async () => {
  const seen = new Set();
  for (let i = 0; i < 5; i += 1) {
    const res = await invoke(validBody(), { ip: `198.51.100.${i}` });
    assert.match(res.payload.receiptNo, /^LR-\d{8}-[A-Z2-9]{4}$/);
    seen.add(res.payload.receiptNo);
  }
  assert.ok(seen.size >= 4, '접수번호가 충분히 다양해야 한다');
});

// ── 검증 오류 ─────────────────────────────────────────────

test('필수값이 비면 400 과 항목별 오류를 반환한다', async () => {
  const res = await invoke({ website: '' });

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.code, 'VALIDATION_ERROR');
  assert.deepEqual(Object.keys(res.payload.errors).sort(), [
    'consent',
    'contactName',
    'email',
    'orgName',
    'phone',
  ]);
  assert.match(res.payload.errors.orgName, /필수/);
});

test('이메일 형식이 틀리면 400 을 반환한다', async () => {
  const res = await invoke(validBody({ email: 'not-an-email' }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.errors.email.length > 0, true);
});

test('연락처에 숫자가 거의 없으면 400 을 반환한다', async () => {
  const res = await invoke(validBody({ phone: '문의' }));
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.errors.phone);
});

test('길이 상한을 넘으면 400 을 반환한다', async () => {
  const res = await invoke(validBody({ orgName: '가'.repeat(101), message: '나'.repeat(2001) }));
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.errors.orgName, /100자/);
  assert.match(res.payload.errors.message, /2000자/);
});

test('지난 날짜를 희망 날짜로 보내면 400 을 반환한다', async () => {
  const res = await invoke(validBody({ preferredDate: '2020-01-01' }));
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.errors.preferredDate, /오늘 이후/);
});

test('존재하지 않는 날짜(2099-02-31)는 400 을 반환한다', async () => {
  const res = await invoke(validBody({ preferredDate: '2099-02-31' }));
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.errors.preferredDate);
});

test('개인정보 동의가 없으면 400 을 반환한다', async () => {
  const res = await invoke(validBody({ consent: false }));
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.errors.consent);
});

test('예상 인원이 숫자가 아니거나 범위를 벗어나면 400 을 반환한다', async () => {
  const letters = await invoke(validBody({ headcount: 'abc' }));
  assert.equal(letters.statusCode, 400);
  assert.ok(letters.payload.errors.headcount);

  const tooMany = await invoke(validBody({ headcount: '5000' }));
  assert.equal(tooMany.statusCode, 400);
  assert.ok(tooMany.payload.errors.headcount);
});

test('선택 항목에 목록 밖의 값을 넣으면 400 을 반환한다', async () => {
  const res = await invoke(validBody({ method: '홀로그램', duration: '5시간' }));
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.errors.method);
  assert.ok(res.payload.errors.duration);
});

// ── 허니팟 ────────────────────────────────────────────────

test('허니팟 필드가 채워지면 스팸으로 보고 400 을 반환하며 웹훅을 호출하지 않는다', async () => {
  process.env.GOOGLE_DRIVE_WEBHOOK_URL = WEBHOOK;
  stubFetch(() => jsonResponse(200, { ok: true }));

  const res = await invoke(validBody({ website: 'http://spam.example.com' }));

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, 'SPAM_DETECTED');
  assert.equal(fetchCalls.length, 0);
});

// ── 메서드 / 본문 ─────────────────────────────────────────

test('GET 요청은 405 로 거절한다', async () => {
  const res = await invoke(undefined, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.payload.code, 'METHOD_NOT_ALLOWED');
  assert.equal(res.headers.allow, 'POST, OPTIONS');
});

test('잘못된 JSON 문자열은 400 INVALID_JSON 을 반환한다', async () => {
  const res = await invoke('{이건 JSON 이 아님');
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, 'INVALID_JSON');
});

test('본문이 너무 크면 413 을 반환한다', async () => {
  const huge = JSON.stringify({ ...validBody(), message: 'x'.repeat(30 * 1024) });
  assert.ok(Buffer.byteLength(huge, 'utf8') > config.MAX_BODY_BYTES);
  const res = await invoke(huge);
  assert.equal(res.statusCode, 413);
  assert.equal(res.payload.code, 'PAYLOAD_TOO_LARGE');
});

test('빈 본문은 필수값 오류로 처리한다', async () => {
  const res = await invoke({});
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, 'VALIDATION_ERROR');
});

// ── Rate Limit ────────────────────────────────────────────

test('분당 제한을 넘으면 429 와 Retry-After 를 반환한다', async () => {
  process.env.RATE_LIMIT_PER_MINUTE = '2';
  const ip = '192.0.2.77';

  const first = await invoke(validBody(), { ip });
  const second = await invoke(validBody(), { ip });
  const third = await invoke(validBody(), { ip });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(third.statusCode, 429);
  assert.equal(third.payload.code, 'RATE_LIMITED');
  assert.equal(third.payload.scope, 'minute');
  assert.ok(Number(third.headers['retry-after']) >= 1);
});

test('IP 가 다르면 Rate Limit 이 따로 적용된다', async () => {
  process.env.RATE_LIMIT_PER_MINUTE = '1';
  const a = await invoke(validBody(), { ip: '192.0.2.10' });
  const b = await invoke(validBody(), { ip: '192.0.2.11' });
  const c = await invoke(validBody(), { ip: '192.0.2.10' });

  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(c.statusCode, 429);
});

test('일일 제한을 넘으면 scope=day 로 429 를 반환한다', async () => {
  process.env.RATE_LIMIT_PER_DAY = '2';
  process.env.RATE_LIMIT_PER_MINUTE = '10';
  const ip = '192.0.2.50';

  await invoke(validBody(), { ip });
  await invoke(validBody(), { ip });
  const third = await invoke(validBody(), { ip });

  assert.equal(third.statusCode, 429);
  assert.equal(third.payload.scope, 'day');
});

// ── 웹훅 실패 ─────────────────────────────────────────────

test('Apps Script 가 500 을 주면 502 WEBHOOK_ERROR 를 반환한다', async () => {
  process.env.GOOGLE_DRIVE_WEBHOOK_URL = WEBHOOK;
  stubFetch(() => jsonResponse(500, { ok: false }));

  const res = await invoke(validBody());

  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.code, 'WEBHOOK_ERROR');
  assert.match(res.payload.receiptNo, /^LR-/);
});

test('Apps Script 가 ok:false 를 주면 502 WEBHOOK_REJECTED 를 반환한다', async () => {
  process.env.GOOGLE_DRIVE_WEBHOOK_URL = WEBHOOK;
  stubFetch(() => jsonResponse(200, { ok: false, message: '인증 토큰이 올바르지 않습니다.' }));

  const res = await invoke(validBody());

  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.code, 'WEBHOOK_REJECTED');
  assert.match(res.payload.message, /인증 토큰/);
});

test('웹훅 연결 자체가 실패하면 504 WEBHOOK_UNREACHABLE 을 반환한다', async () => {
  process.env.GOOGLE_DRIVE_WEBHOOK_URL = WEBHOOK;
  stubFetch(() => { throw new Error('ECONNREFUSED'); });

  const res = await invoke(validBody());

  assert.equal(res.statusCode, 504);
  assert.equal(res.payload.code, 'WEBHOOK_UNREACHABLE');
});

test('웹훅이 HTML(비 JSON) 을 반환해도 저장 실패로 처리하지 않고 통과시킨다', async () => {
  process.env.GOOGLE_DRIVE_WEBHOOK_URL = WEBHOOK;
  stubFetch(() => jsonResponse(200, '<html>ok</html>'));

  const res = await invoke(validBody());

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.mode, 'live');
  assert.equal(res.payload.stored.docUrl, null);
});

// ── 페이로드 빌더 ─────────────────────────────────────────

test('buildWebhookPayload 는 화면 라벨용 시각 정보를 함께 담는다', () => {
  const payload = buildWebhookPayload(
    {
      orgName: '기관',
      contactName: '담당',
      phone: '010-0000-0000',
      email: 'a@b.co',
      preferredDate: '2099-01-01',
      preferredTime: '',
      method: '',
      audience: '',
      audienceEtc: '',
      headcount: '',
      duration: '',
      budget: '',
      topic: '',
      message: '',
    },
    { receiptNo: 'LR-20990101-ABCD', receivedAt: '2099-01-01T09:00:00+09:00', receivedAtLabel: '2099-01-01 09:00 (KST)' },
  );

  assert.equal(payload.receiptNo, 'LR-20990101-ABCD');
  assert.equal(payload.receivedAtLabel, '2099-01-01 09:00 (KST)');
  assert.equal(payload.source, 'lecture-request-app');
  assert.equal(payload.consent, true);
});
