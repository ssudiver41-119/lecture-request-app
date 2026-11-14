'use strict';

/**
 * 강의 의뢰 접수 — 입력 검증/정규화 모듈
 *
 * api/submit.js(서버)와 테스트가 함께 사용합니다.
 * 브라우저에는 내려가지 않으므로, 클라이언트 검증과 별개로 항상 서버에서 다시 검사합니다.
 */

const LIMITS = {
  orgName: 100,
  contactName: 50,
  phone: 30,
  email: 254,
  preferredDate: 10,
  preferredTime: 40,
  method: 20,
  audience: 40,
  audienceEtc: 100,
  headcount: 5,
  duration: 20,
  budget: 100,
  topic: 200,
  message: 2000,
};

const OPTIONS = {
  preferredTime: ['오전 (09:00~12:00)', '오후 (13:00~18:00)', '저녁 (19:00~21:00)', '협의 후 결정'],
  method: ['대면', 'Zoom 온라인', '혼합 (대면+온라인)'],
  audience: [
    '사회복지사',
    '요양·돌봄 실무자',
    '장애인활동지원',
    '공공기관·지자체',
    '기관 전체 직원',
    '기타',
  ],
  duration: ['90분', '2시간', '3시간', '협의'],
};

const REQUIRED_FIELDS = ['orgName', 'contactName', 'phone', 'email'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 보이지 않는 제어문자 제거 + 앞뒤 공백 정리 */
function clean(value, maxLength) {
  if (value === null || value === undefined) return '';
  const text = String(value)
    // 유니코드 제어문자(스팸 삽입·문서 깨짐 방지). 줄바꿈/탭은 남깁니다.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  return typeof maxLength === 'number' ? text.slice(0, maxLength) : text;
}

/** Asia/Seoul 기준 YYYY-MM-DD */
function todayKST(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA 는 YYYY-MM-DD 형태
}

/** Asia/Seoul 기준 ISO8601(오프셋 포함, 예: 2026-11-15T08:20:31+09:00) */
function nowISOSeoul(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}

/** 접수번호: LR-YYYYMMDD-XXXX (혼동되기 쉬운 O/0, I/1 제외) */
function makeReceiptNo(now = new Date(), random = Math.random) {
  const day = todayKST(now).replace(/-/g, '');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 4; i += 1) {
    tail += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  }
  return `LR-${day}-${tail}`;
}

function validateOptionalOption(errors, data, field, label) {
  const allowed = OPTIONS[field];
  if (!data[field]) return;
  if (!allowed.includes(data[field])) {
    errors[field] = `${label} 항목을 목록에서 선택해 주세요.`;
  }
}

/** YYYY-MM-DD 형식이면서 달력에 실제로 존재하는 날짜인지 확인 */
function isRealDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

/**
 * 접수 데이터를 검증하고 정규화합니다.
 * @returns {{ok: boolean, errors: Object<string,string>, data: object}}
 */
function validateSubmission(input, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const raw = input && typeof input === 'object' ? input : {};
  const errors = {};

  const data = {
    orgName: clean(raw.orgName, LIMITS.orgName),
    contactName: clean(raw.contactName, LIMITS.contactName),
    phone: clean(raw.phone, LIMITS.phone),
    email: clean(raw.email, LIMITS.email),
    preferredDate: clean(raw.preferredDate, LIMITS.preferredDate),
    preferredTime: clean(raw.preferredTime, LIMITS.preferredTime),
    method: clean(raw.method, LIMITS.method),
    audience: clean(raw.audience, LIMITS.audience),
    audienceEtc: clean(raw.audienceEtc, LIMITS.audienceEtc),
    headcount: clean(raw.headcount, LIMITS.headcount),
    duration: clean(raw.duration, LIMITS.duration),
    budget: clean(raw.budget, LIMITS.budget),
    topic: clean(raw.topic, LIMITS.topic),
    message: clean(raw.message, LIMITS.message),
  };

  // 필수값
  REQUIRED_FIELDS.forEach((field) => {
    if (!data[field]) errors[field] = '필수 입력 항목입니다.';
  });

  // 길이 상한 (clean 이 잘라내므로, 원본 길이로 초과 여부를 판정)
  Object.keys(LIMITS).forEach((field) => {
    const original = raw[field];
    if (original === null || original === undefined) return;
    const length = String(original).replace(/\s+$/, '').length;
    if (length > LIMITS[field] && !errors[field]) {
      errors[field] = `최대 ${LIMITS[field]}자까지 입력할 수 있습니다.`;
    }
  });

  // 이메일 형식
  if (data.email && !errors.email && !EMAIL_RE.test(data.email)) {
    errors.email = '이메일 형식을 확인해 주세요. (예: name@example.com)';
  }

  // 연락처: 숫자 6자리 이상 포함
  if (data.phone && !errors.phone) {
    const digits = data.phone.replace(/[^0-9]/g, '');
    if (digits.length < 6 || digits.length > 20 || !/^[0-9+\-()\s.]+$/.test(data.phone)) {
      errors.phone = '연락처 형식을 확인해 주세요. (예: 010-1234-5678)';
    }
  }

  // 희망 날짜: 선택 입력이지만, 오늘(KST) 이전이면 거절
  if (data.preferredDate && !errors.preferredDate) {
    if (!DATE_RE.test(data.preferredDate)) {
      errors.preferredDate = '날짜는 YYYY-MM-DD 형식으로 입력해 주세요.';
    } else if (!isRealDate(data.preferredDate)) {
      errors.preferredDate = '존재하지 않는 날짜입니다.';
    } else if (data.preferredDate < todayKST(now)) {
      errors.preferredDate = '오늘 이후 날짜를 선택해 주세요.';
    }
  }

  validateOptionalOption(errors, data, 'preferredTime', '희망 시간대');
  validateOptionalOption(errors, data, 'method', '진행 방식');
  validateOptionalOption(errors, data, 'audience', '교육 대상');
  validateOptionalOption(errors, data, 'duration', '교육 시간');

  // 예상 인원
  if (data.headcount && !errors.headcount) {
    if (!/^\d{1,4}$/.test(data.headcount)) {
      errors.headcount = '예상 인원은 숫자로 입력해 주세요.';
    } else if (Number(data.headcount) < 1 || Number(data.headcount) > 1000) {
      errors.headcount = '예상 인원은 1~1000명 사이로 입력해 주세요.';
    }
  }

  // 교육 대상이 '기타'인데 설명이 비어 있으면 안내만 (필수는 아님)
  if (data.audience === '기타' && !data.audienceEtc) {
    data.audienceEtc = '';
  }

  // 개인정보 수집·이용 동의
  const consent = raw.consent === true || raw.consent === 'true' || raw.consent === 'on' || raw.consent === '1';
  if (!consent) {
    errors.consent = '개인정보 수집·이용에 동의해 주셔야 접수됩니다.';
  }

  return { ok: Object.keys(errors).length === 0, errors, data };
}

/** 허니팟: 봇이 채우는 숨김 필드가 비어 있어야 정상 */
function isHoneypotTriggered(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const trap = clean(raw.website || raw.url || raw.homepage, 200);
  return trap.length > 0;
}

module.exports = {
  LIMITS,
  OPTIONS,
  REQUIRED_FIELDS,
  clean,
  todayKST,
  nowISOSeoul,
  makeReceiptNo,
  isRealDate,
  validateSubmission,
  isHoneypotTriggered,
};
