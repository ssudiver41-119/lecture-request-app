import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

/** 아주 단순한 태그 존재 검사 도우미 */
function has(needle) {
  return html.includes(needle);
}

function countOccurrences(needle) {
  return html.split(needle).length - 1;
}

// ── 기본 문서 구조 ────────────────────────────────────────

test('한국어 문서이며 모바일 반응형 viewport 를 선언한다', () => {
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /<title>[^<]*강의 의뢰 접수[^<]*<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+"/);
});

test('외부 스크립트·스타일·폰트를 불러오지 않는다(단일 파일 배포)', () => {
  assert.equal(/<script[^>]+src=/i.test(html), false);
  assert.equal(/<link[^>]+rel="stylesheet"[^>]+href="https?:/i.test(html), false);
  assert.equal(/<script[^>]*>[\s\S]*?fetch\(\s*['"]https?:/i.test(html), false);
});

// ── 브랜딩 ────────────────────────────────────────────────

test('소속 표기가 119복지인권연구소 · ONEBLOCKAI연구소 로 들어간다', () => {
  assert.ok(has('119복지인권연구소 · ONEBLOCKAI연구소'));
  assert.ok(has('이대영'));
  assert.ok(has('사회복지'));
});

test('히어로 소개에 AI 교육과 함께 인권·개인정보보호법·4대 법정의무교육을 한다는 점이 드러난다', () => {
  assert.match(html, /<strong>인권교육 · 개인정보보호법 · 4대 법정의무교육<\/strong>/);
  assert.match(html, /4대 법정의무교육/);
  assert.match(html, /인권교육/);
  assert.match(html, /개인정보보호법/);
  // 히어로 제목이 AI 교육만 언급하고 끝나지 않아야 한다
  assert.match(html, /<h1>[\s\S]*?인권·법정의무교육[\s\S]*?<\/h1>/);
  // 주제 배지로 4과목이 나란히 안내된다
  ['AI 실무 교육', '인권교육', '개인정보보호법 교육', '4대 법정의무교육'].forEach((subject) => {
    assert.ok(
      has(`<li class="badge-subject">${subject}</li>`),
      `주제 배지 누락: ${subject}`,
    );
  });
});

test('대표 강의 분야 7종이 두 묶음의 빠른 선택 칩으로 제공된다', () => {
  const aiTopics = [
    'AI가 바꾸는 사회복지와 인권',
    '실무자 생성형 AI 문서·서식 자동화',
    '노코드 AI 웹도구·업무 자동화',
    '개인정보·AI 보안 실천 특강',
  ];
  const dutyTopics = [
    '인권교육',
    '개인정보보호법 교육',
    '4대 법정의무교육',
  ];
  [...aiTopics, ...dutyTopics].forEach((topic) => {
    assert.ok(has(topic), `주제 누락: ${topic}`);
    assert.match(
      html,
      new RegExp(`<button type="button" class="chip" data-topic="${topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      `칩 버튼 누락: ${topic}`,
    );
  });
  assert.equal(countOccurrences('class="chip"'), 7);
  assert.equal(countOccurrences('aria-pressed="false"'), 7);
});

test('칩은 AI 실무와 인권·법정의무교육 두 묶음으로 나뉘어 접근성 있게 묶인다', () => {
  assert.match(html, /id="topicChips"/);
  assert.match(html, /id="chipGroupAI"/);
  assert.match(html, /id="chipGroupLaw"/);
  assert.match(html, /class="chips" role="group" aria-labelledby="chipGroupAI"/);
  assert.match(html, /class="chips" role="group" aria-labelledby="chipGroupLaw"/);
  assert.match(html, /AI 실무 교육과 인권·개인정보보호법·4대 법정의무교육은 함께 또는 따로 요청하실 수 있습니다/);
});

test('칩을 모두 눌러도 희망 주제 200자 상한을 넘지 않는다', () => {
  const topics = [...html.matchAll(/data-topic="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(topics.length, 7);
  const filled = topics.join(', ');
  assert.ok(filled.length <= 200, `칩 전체 선택 시 ${filled.length}자 (상한 200자)`);
});

test('칩을 누르면 희망 주제 입력란에 값이 들어가도록 스크립트가 연결돼 있다', () => {
  assert.match(html, /id="topicChips"/);
  assert.match(html, /id="topic"[^>]*name="topic"/);
  assert.match(html, /data-topic/);
  assert.match(html, /syncChipState/);
  assert.match(html, /topicInput\.value/);
});

// ── 폼 항목 ──────────────────────────────────────────────

test('필수 4개 항목(기관명·담당자·연락처·이메일)이 required 로 표시된다', () => {
  const required = [
    ['orgName', '기관명'],
    ['contactName', '담당자 성함'],
    ['phone', '연락처'],
    ['email', '이메일'],
  ];
  required.forEach(([name, label]) => {
    assert.ok(has(`name="${name}"`), `name 누락: ${name}`);
    assert.ok(has(`for="${name}">${label}`), `label 누락: ${label}`);
    assert.match(
      html,
      new RegExp(`id="${name}" name="${name}"[^>]*required`),
      `required 누락: ${name}`,
    );
  });
  // 기관명은 길이 상한이 있어야 한다
  assert.match(html, /id="orgName" name="orgName" maxlength="100"/);
  assert.ok(countOccurrences('req-mark') >= 4, '필수 표시(*)가 항목마다 있어야 한다');
});

test('희망 날짜는 날짜 입력이며 기본값을 KST 오늘로 채운다', () => {
  assert.match(html, /type="date" id="preferredDate"/);
  assert.match(html, /function todayKST\(\)/);
  assert.match(html, /timeZone: 'Asia\/Seoul'/);
  assert.match(html, /dateInput\.min = today/);
  assert.match(html, /if \(!dateInput\.value\) dateInput\.value = today/);
});

test('희망 시간대·진행 방식·교육 대상·인원·교육 시간·예산·요청사항 항목이 모두 있다', () => {
  assert.match(html, /id="preferredTime" name="preferredTime"/);
  ['오전 (09:00~12:00)', '오후 (13:00~18:00)', '저녁 (19:00~21:00)', '협의 후 결정'].forEach((v) => {
    assert.ok(has(v), `시간대 옵션 누락: ${v}`);
  });

  ['대면', 'Zoom 온라인', '혼합 (대면+온라인)'].forEach((v) => {
    assert.ok(has(`name="method" value="${v}"`), `진행 방식 옵션 누락: ${v}`);
  });

  ['사회복지사', '요양·돌봄 실무자', '장애인활동지원', '공공기관·지자체', '기관 전체 직원', '기타'].forEach((v) => {
    assert.ok(has(`<option value="${v}">`), `교육 대상 옵션 누락: ${v}`);
  });

  assert.match(html, /id="headcount" name="headcount"[^>]*type="number"|type="number" id="headcount"/);
  ['90분', '2시간', '3시간', '협의'].forEach((v) => {
    assert.ok(has(`<option value="${v}">`), `교육 시간 옵션 누락: ${v}`);
  });

  assert.match(html, /id="budget" name="budget"/);
  assert.match(html, /id="message" name="message" maxlength="2000"/);
});

// ── 스팸·개인정보 ─────────────────────────────────────────

test('허니팟 필드는 화면에서 숨겨지고 탭 순서에서 빠진다', () => {
  assert.match(html, /name="website"/);
  assert.match(html, /class="hp-field"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /\.hp-field\s*\{[^}]*left: -9999px/s);
  assert.match(html, /aria-hidden="true"/);
});

test('개인정보 수집·이용 안내에 항목·목적·보유기간·거부 권리가 적혀 있고 동의 체크가 필수다', () => {
  assert.match(html, /type="checkbox" id="consent" name="consent" required/);
  assert.match(html, /<strong>수집 항목<\/strong>/);
  assert.match(html, /<strong>이용 목적<\/strong>/);
  assert.match(html, /<strong>보유 기간<\/strong>/);
  assert.match(html, /동의 거부 권리/);
});

// ── 제출·완료 흐름 ────────────────────────────────────────

test('제출은 /api/submit 으로 JSON POST 한다', () => {
  assert.match(html, /fetch\('\/api\/submit'/);
  assert.match(html, /method: 'POST'/);
  assert.match(html, /'Content-Type': 'application\/json'/);
  assert.match(html, /JSON\.stringify\(payload\)/);
});

test('접수 완료 카드와 의뢰 내용 복사 버튼이 있다', () => {
  assert.match(html, /id="successSection"/);
  assert.match(html, /id="receiptNo"/);
  assert.match(html, /id="summaryList"/);
  assert.match(html, /id="copyBtn">의뢰 내용 복사</);
  assert.match(html, /navigator\.clipboard\.writeText/);
  assert.match(html, /document\.execCommand\('copy'\)/);
  assert.match(html, /buildCopyText/);
});

test('데모 모드(웹훅 미설정) 안내를 화면에 보여 준다', () => {
  assert.match(html, /id="demoNotice"/);
  assert.match(html, /result\.mode === 'demo'/);
  assert.match(html, /result\.notice/);
});

test('필수 항목 오류 메시지를 항목별로 보여 준다', () => {
  ['err-orgName', 'err-contactName', 'err-phone', 'err-email', 'err-consent', 'err-preferredDate', 'err-headcount'].forEach((id) => {
    assert.ok(has(`id="${id}"`), `오류 표시 요소 누락: ${id}`);
  });
  assert.match(html, /class="alert error" id="formAlert" role="alert"/);
  assert.match(html, /aria-invalid/);
});

test('접수 후 새 의뢰를 쓸 수 있는 초기화 버튼이 있다', () => {
  assert.match(html, /id="againBtn"/);
  assert.match(html, /function resetToForm\(\)/);
  assert.match(html, /form\.reset\(\)/);
});

test('제출 중 중복 전송을 막는다', () => {
  assert.match(html, /var submitting = false;/);
  assert.match(html, /if \(submitting\) return;/);
  assert.match(html, /submitBtn\.disabled = true;/);
});

test('본문 스크립트는 문법 오류 없이 파싱된다', () => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, '인라인 스크립트를 찾지 못했습니다');
  // new Function 은 실행하지 않고 문법만 검사합니다.
  assert.doesNotThrow(() => new Function(match[1]));
});
