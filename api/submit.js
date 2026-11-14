'use strict';

/**
 * POST /api/submit — 강의 의뢰 접수 (Vercel 서버리스 함수 / Node.js 런타임)
 *
 * 하는 일
 *   1) 요청 본문 파싱 + 크기 제한
 *   2) 허니팟(스팸) 검사
 *   3) 필수값·형식·길이 검증
 *   4) IP 기준 Rate Limit (분당 3회 / 일 20회, 메모리 기반 best-effort)
 *   5) GOOGLE_DRIVE_WEBHOOK_URL 이 설정돼 있으면 Google Apps Script 웹앱으로 전송
 *      → Apps Script 가 구글 드라이브에 강의의뢰서 문서 + 접수현황 시트 행을 만듭니다.
 *   6) 접수번호와 처리 결과를 JSON 으로 반환
 *
 * 환경변수
 *   GOOGLE_DRIVE_WEBHOOK_URL  (필수, 미설정 시 데모 모드로 응답)
 *   WEBHOOK_SHARED_SECRET     (선택, 설정 시 웹훅 URL 에 ?token=... 으로 함께 전달)
 *   RATE_LIMIT_PER_MINUTE     (선택, 기본 3)
 *   RATE_LIMIT_PER_DAY        (선택, 기본 20)
 *
 * 보안
 *   - 웹훅 URL 은 서버에서만 사용하므로 브라우저에 노출되지 않습니다.
 *   - IP 는 메모리 안에서만 쓰고 외부로 보내지 않습니다.
 */

const {
  validateSubmission,
  isHoneypotTriggered,
  makeReceiptNo,
  nowISOSeoul,
  todayKST,
} = require('../lib/validate.js');

const MAX_BODY_BYTES = 20 * 1024; // 20KB
const WEBHOOK_TIMEOUT_MS = 8000;
const APP_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Rate Limit (인스턴스 메모리 기반)
//   서버리스는 인스턴스마다 메모리가 분리되므로 완전한 방어가 아닙니다.
//   (README 의 "운영 시 참고" 참고 — 필요하면 Vercel KV/Upstash 로 교체)
// ---------------------------------------------------------------------------
const rateBuckets = new Map();

function limitFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clientIp(req) {
  const header = req && req.headers ? req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'] : '';
  const first = String(header || '').split(',')[0].trim();
  if (first) return first;
  if (req && req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return 'unknown';
}

/**
 * @returns {{allowed: boolean, scope?: 'minute'|'day', retryAfter?: number}}
 */
function checkRateLimit(ip, now = Date.now()) {
  const perMinute = limitFromEnv('RATE_LIMIT_PER_MINUTE', 3);
  const perDay = limitFromEnv('RATE_LIMIT_PER_DAY', 20);

  const bucket = rateBuckets.get(ip) || { minuteStart: now, minuteCount: 0, dayStart: now, dayCount: 0 };

  if (now - bucket.minuteStart >= 60 * 1000) {
    bucket.minuteStart = now;
    bucket.minuteCount = 0;
  }
  if (now - bucket.dayStart >= 24 * 60 * 60 * 1000) {
    bucket.dayStart = now;
    bucket.dayCount = 0;
  }

  if (bucket.minuteCount >= perMinute) {
    rateBuckets.set(ip, bucket);
    return {
      allowed: false,
      scope: 'minute',
      retryAfter: Math.max(1, Math.ceil((bucket.minuteStart + 60 * 1000 - now) / 1000)),
    };
  }
  if (bucket.dayCount >= perDay) {
    rateBuckets.set(ip, bucket);
    return {
      allowed: false,
      scope: 'day',
      retryAfter: Math.max(1, Math.ceil((bucket.dayStart + 24 * 60 * 60 * 1000 - now) / 1000)),
    };
  }

  bucket.minuteCount += 1;
  bucket.dayCount += 1;
  rateBuckets.set(ip, bucket);

  // 오래된 버킷 정리 (메모리 누수 방지)
  if (rateBuckets.size > 5000) {
    for (const [key, value] of rateBuckets) {
      if (now - value.dayStart >= 24 * 60 * 60 * 1000) rateBuckets.delete(key);
    }
  }

  return { allowed: true };
}

/** 테스트용: Rate Limit 상태 초기화 */
function __resetRateLimits() {
  rateBuckets.clear();
}

// ---------------------------------------------------------------------------
// 응답 유틸
// ---------------------------------------------------------------------------
function send(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    Object.keys(extraHeaders).forEach((key) => res.setHeader(key, extraHeaders[key]));
  }
  if (typeof res.end === 'function') {
    res.end(body);
  } else if (typeof res.send === 'function') {
    res.send(body);
  }
  return body;
}

/** Vercel: req.body 는 이미 파싱되어 있을 수 있고, 아니면 스트림에서 읽습니다. */
async function readJsonBody(req) {
  const body = req && req.body;

  if (body !== undefined && body !== null && body !== '') {
    if (typeof body === 'object') return body;
    if (typeof body === 'string') {
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        const error = new Error('PAYLOAD_TOO_LARGE');
        error.code = 'PAYLOAD_TOO_LARGE';
        throw error;
      }
      try {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (err) {
        const error = new Error('INVALID_JSON');
        error.code = 'INVALID_JSON';
        throw error;
      }
    }
    return {};
  }

  if (!req || typeof req[Symbol.asyncIterator] !== 'function') return {};

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('PAYLOAD_TOO_LARGE');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    const error = new Error('INVALID_JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

/** Apps Script 로 보낼 데이터 (화면 라벨까지 함께 보내 문서/시트 서식이 흔들리지 않게) */
function buildWebhookPayload(data, meta) {
  return {
    receiptNo: meta.receiptNo,
    receivedAt: meta.receivedAt,
    receivedAtLabel: meta.receivedAtLabel,
    orgName: data.orgName,
    contactName: data.contactName,
    phone: data.phone,
    email: data.email,
    preferredDate: data.preferredDate,
    preferredTime: data.preferredTime,
    method: data.method,
    audience: data.audience,
    audienceEtc: data.audienceEtc,
    headcount: data.headcount,
    duration: data.duration,
    budget: data.budget,
    topic: data.topic,
    message: data.message,
    consent: true,
    source: 'lecture-request-app',
    appVersion: APP_VERSION,
  };
}

async function postToWebhook(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': `lecture-request-app/${APP_VERSION}`,
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (err) {
      parsed = null;
    }

    return { ok: response.ok, status: response.status, body: parsed, raw: text };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 핸들러
// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  const method = (req && req.method) || 'POST';
  if (method === 'OPTIONS') {
    return send(res, 204, {});
  }
  if (method !== 'POST') {
    return send(
      res,
      405,
      { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 처리합니다.' },
      { Allow: 'POST, OPTIONS' },
    );
  }

  const ip = clientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return send(
      res,
      429,
      {
        ok: false,
        code: 'RATE_LIMITED',
        message:
          limit.scope === 'minute'
            ? '짧은 시간에 여러 번 접수되었습니다. 잠시 후 다시 시도해 주세요.'
            : '오늘 접수 가능한 횟수를 넘었습니다. 급한 경우 담당자에게 직접 연락해 주세요.',
        retryAfter: limit.retryAfter,
        scope: limit.scope,
      },
      { 'Retry-After': String(limit.retryAfter) },
    );
  }

  let raw;
  try {
    raw = await readJsonBody(req);
  } catch (err) {
    if (err && err.code === 'PAYLOAD_TOO_LARGE') {
      return send(res, 413, {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: '요청 내용이 너무 큽니다. 요청사항을 줄여 다시 시도해 주세요.',
      });
    }
    if (err && err.code === 'INVALID_JSON') {
      return send(res, 400, {
        ok: false,
        code: 'INVALID_JSON',
        message: '요청 형식을 확인해 주세요.',
      });
    }
    return send(res, 400, {
      ok: false,
      code: 'INVALID_BODY',
      message: '요청 형식을 확인해 주세요.',
    });
  }

  // 1) 허니팟 — 봇이 숨김 필드를 채운 경우
  if (isHoneypotTriggered(raw)) {
    return send(res, 400, {
      ok: false,
      code: 'SPAM_DETECTED',
      message: '정상적인 접수로 확인되지 않아 전송되지 않았습니다.',
    });
  }

  // 2) 검증
  const { ok, errors, data } = validateSubmission(raw);
  if (!ok) {
    return send(res, 400, {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: '입력 내용을 확인해 주세요.',
      errors,
    });
  }

  // 3) 접수번호 · 시각
  const now = new Date();
  const receiptNo = makeReceiptNo(now);
  const receivedAt = nowISOSeoul(now);
  const receivedAtLabel = `${todayKST(now)} ${String(
    new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours(),
  ).padStart(2, '0')}:${String(
    new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCMinutes(),
  ).padStart(2, '0')} (KST)`;

  const meta = { receiptNo, receivedAt, receivedAtLabel };
  const webhookUrl = (process.env.GOOGLE_DRIVE_WEBHOOK_URL || '').trim();

  // 4) 웹훅 미설정 → 데모 모드 (500/503 대신 명확한 안내)
  if (!webhookUrl) {
    return send(res, 200, {
      ok: true,
      mode: 'demo',
      code: 'WEBHOOK_NOT_CONFIGURED',
      receiptNo,
      receivedAt,
      receivedAtLabel,
      notice:
        '구글 드라이브 연동(GOOGLE_DRIVE_WEBHOOK_URL)이 아직 설정되지 않아 접수 내용이 저장되지 않았습니다. '
        + '아래 접수 내용을 복사해 담당자에게 전달해 주세요. (관리자: README 의 배포 안내 참고)',
    });
  }

  // 5) Apps Script 웹앱으로 전송
  const payload = buildWebhookPayload(data, meta);
  let target = webhookUrl;
  const secret = (process.env.WEBHOOK_SHARED_SECRET || '').trim();
  if (secret) {
    target += (target.includes('?') ? '&' : '?') + `token=${encodeURIComponent(secret)}`;
  }

  try {
    const result = await postToWebhook(target, payload);
    if (!result.ok) {
      return send(res, 502, {
        ok: false,
        code: 'WEBHOOK_ERROR',
        receiptNo,
        receivedAt,
        message:
          '구글 드라이브 저장 단계에서 문제가 생겼습니다. 잠시 후 다시 시도하시거나 담당자에게 연락해 주세요.',
        detail: result.status,
      });
    }

    if (result.body && result.body.ok === false) {
      return send(res, 502, {
        ok: false,
        code: 'WEBHOOK_REJECTED',
        receiptNo,
        receivedAt,
        message: result.body.message || '구글 드라이브 저장이 거절되었습니다. 설정을 확인해 주세요.',
      });
    }

    const stored = (result.body && result.body.result) || {};
    return send(res, 200, {
      ok: true,
      mode: 'live',
      receiptNo,
      receivedAt,
      receivedAtLabel,
      message: '강의 의뢰가 접수되었습니다.',
      stored: {
        docUrl: stored.docUrl || null,
        sheetUrl: stored.sheetUrl || null,
        folderUrl: stored.folderUrl || null,
      },
    });
  } catch (err) {
    const timedOut = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
    return send(res, 504, {
      ok: false,
      code: timedOut ? 'WEBHOOK_TIMEOUT' : 'WEBHOOK_UNREACHABLE',
      receiptNo,
      receivedAt,
      message:
        '구글 드라이브 저장 서버에 연결하지 못했습니다. 잠시 후 다시 시도하시거나 담당자에게 연락해 주세요.',
    });
  }
};

// 테스트/재사용을 위한 내부 노출
module.exports.__resetRateLimits = __resetRateLimits;
module.exports.__checkRateLimit = checkRateLimit;
module.exports.buildWebhookPayload = buildWebhookPayload;
module.exports.config = {
  MAX_BODY_BYTES,
  WEBHOOK_TIMEOUT_MS,
  APP_VERSION,
};
