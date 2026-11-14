import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import validateModule from '../lib/validate.js';

const { validateSubmission, OPTIONS, LIMITS } = validateModule;

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

/** 화면의 대표 강의 칩(data-topic) 값들 */
function chipTopics() {
  return [...html.matchAll(/data-topic="([^"]+)"/g)].map((m) => m[1]);
}

/** #audience <select> 안의 option 값들 */
function audienceOptions() {
  const block = html.match(/<select id="audience"[\s\S]*?<\/select>/);
  assert.ok(block, '교육 대상 select 를 찾지 못했습니다');
  return [...block[0].matchAll(/<option value="([^"]*)"/g)]
    .map((m) => m[1])
    .filter(Boolean);
}

function body(overrides = {}) {
  return {
    orgName: '구래종합사회복지관',
    contactName: '김복지',
    phone: '010-1234-5678',
    email: 'staff@example.com',
    preferredDate: '2099-12-31',
    preferredTime: '오후 (13:00~18:00)',
    method: '대면',
    audience: '기관 전체 직원',
    headcount: '30',
    duration: '3시간',
    budget: '',
    topic: '인권교육, 개인정보보호법 교육, 4대 법정의무교육',
    message: '',
    consent: true,
    website: '',
    ...overrides,
  };
}

// ── 새 주제(인권·개인정보보호법·4대 법정의무교육) ──────────────

test('인권·개인정보보호법·4대 법정의무교육 주제가 검증을 통과한다', () => {
  const { ok, errors, data } = validateSubmission(body());
  assert.equal(ok, true, JSON.stringify(errors));
  assert.equal(data.topic, '인권교육, 개인정보보호법 교육, 4대 법정의무교육');
  assert.equal(data.audience, '기관 전체 직원');
});

test('칩으로 고를 수 있는 주제는 모두 유효한 접수로 처리된다', () => {
  const topics = chipTopics();
  assert.ok(topics.length >= 7, `칩이 ${topics.length}개뿐입니다`);
  topics.forEach((topic) => {
    const { ok, errors } = validateSubmission(body({ topic }));
    assert.equal(ok, true, `${topic} → ${JSON.stringify(errors)}`);
  });
});

test('칩을 전부 선택해도 주제 200자 상한 안에 들어온다', () => {
  const filled = chipTopics().join(', ');
  assert.ok(filled.length <= LIMITS.topic, `${filled.length}자 > ${LIMITS.topic}자`);
  const { ok, errors } = validateSubmission(body({ topic: filled }));
  assert.equal(ok, true, JSON.stringify(errors));
});

test('주제 200자를 넘기면 서버가 거절한다', () => {
  const { ok, errors } = validateSubmission(body({ topic: '가'.repeat(201) }));
  assert.equal(ok, false);
  assert.match(errors.topic, /200자/);
});

// ── 교육 대상 목록 일치 ──────────────────────────────────────

test('교육 대상 선택지는 화면과 서버 검증 목록이 같다', () => {
  assert.deepEqual(audienceOptions(), OPTIONS.audience);
  assert.ok(OPTIONS.audience.includes('기관 전체 직원'));
});

test('교육 대상 목록 밖의 값은 거절한다', () => {
  const { ok, errors } = validateSubmission(body({ audience: '외부 자원봉사자' }));
  assert.equal(ok, false);
  assert.ok(errors.audience);
});
