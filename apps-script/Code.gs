/**
 * 강의 의뢰 접수 → 구글 드라이브 저장 웹훅 (Google Apps Script)
 *
 * Vercel 함수(api/submit.js)가 이 웹앱으로 JSON 을 POST 하면,
 *   1) 구글 드라이브에 `강의의뢰_접수` 폴더를 만들고(또는 지정 폴더 사용)
 *      `[접수일] 기관명_강의의뢰서` Google 문서를 생성
 *   2) `강의의뢰_접수현황` Google 스프레드시트에 1행 누적
 *   3) 생성된 문서/시트 링크를 JSON 으로 응답
 *
 * ── 설치 ────────────────────────────────────────────────
 *  1. https://script.google.com → 새 프로젝트
 *  2. 이 파일 내용 전체를 Code.gs 에 붙여넣고 저장
 *  3. (선택) 프로젝트 설정 → 스크립트 속성에 아래 값 등록
 *       PARENT_FOLDER_ID : 저장할 상위 폴더 ID (비우면 내 드라이브 최상위)
 *       FOLDER_NAME      : 기본값 `강의의뢰_접수`
 *       SHEET_NAME       : 기본값 `강의의뢰_접수현황`
 *       SHARED_TOKEN     : 웹훅 호출 시 함께 보낼 비밀 토큰 (권장)
 *  4. 배포 → 새 배포 → 유형 `웹 앱`
 *       실행 계정: 나
 *       액세스 권한: 모든 사용자
 *     → 배포 → 웹 앱 URL 복사
 *  5. Vercel 프로젝트 환경변수에
 *       GOOGLE_DRIVE_WEBHOOK_URL = <복사한 웹 앱 URL>
 *       WEBHOOK_SHARED_SECRET    = <SHARED_TOKEN 과 같은 값>   (토큰을 쓸 경우)
 *     를 넣고 Redeploy
 *
 * ── 주의 ────────────────────────────────────────────────
 *  · 코드를 수정하면 `배포 관리`에서 기존 배포를 편집해 새 버전으로 올려야 반영됩니다.
 *    (새 배포를 만들면 URL 이 바뀝니다.)
 *  · 액세스 권한을 `모든 사용자`로 두면 URL 을 아는 사람은 누구나 호출할 수 있으므로
 *    SHARED_TOKEN 을 꼭 설정하세요.
 */

// ── 설정 ────────────────────────────────────────────────
var PROPS = PropertiesService.getScriptProperties();

var DEFAULTS = {
  FOLDER_NAME: '강의의뢰_접수',
  SHEET_NAME: '강의의뢰_접수현황',
  SHEET_TAB: '접수현황',
  TZ: 'Asia/Seoul',
};

var HEADERS = [
  '접수일시',
  '접수번호',
  '기관명',
  '담당자',
  '연락처',
  '이메일',
  '희망날짜',
  '희망시간대',
  '진행방식',
  '교육대상',
  '예상인원',
  '교육시간',
  '예산·강사료',
  '희망주제',
  '요청사항',
  '의뢰서문서',
];

// ── 진입점 ──────────────────────────────────────────────

/** 웹훅 수신 (Vercel → Apps Script) */
function doPost(e) {
  try {
    var tokenError = checkToken_(e);
    if (tokenError) return json_({ ok: false, message: tokenError });

    var raw = e && e.postData && e.postData.contents;
    if (!raw) return json_({ ok: false, message: '요청 본문이 비어 있습니다.' });

    var payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      return json_({ ok: false, message: 'JSON 형식이 아닙니다.' });
    }

    if (!payload || !payload.orgName) {
      return json_({ ok: false, message: '기관명이 없습니다.' });
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(20000); // 동시 접수 시 폴더/시트 중복 생성을 막습니다.
    try {
      var folder = getFolder_();
      var sheetInfo = getSheet_(folder);
      var doc = createDoc_(folder, payload);
      appendRow_(sheetInfo.sheet, payload, doc.getUrl());

      return json_({
        ok: true,
        result: {
          receiptNo: payload.receiptNo || '',
          docUrl: doc.getUrl(),
          sheetUrl: sheetInfo.url,
          folderUrl: folder.getUrl(),
          docName: doc.getName(),
        },
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, message: '저장 중 오류: ' + (err && err.message ? err.message : String(err)) });
  }
}

/** 연결 확인용 (브라우저에서 URL 을 열면 설정 상태를 보여 줍니다) */
function doGet(e) {
  var folderName = prop_('FOLDER_NAME');
  return json_({
    ok: true,
    service: 'lecture-request-webhook',
    message: '강의 의뢰 접수 웹훅이 실행 중입니다. (POST 로 접수 데이터를 받습니다)',
    folder: folderName,
    sheet: prop_('SHEET_NAME'),
    tokenRequired: Boolean(prop_('SHARED_TOKEN')),
    time: Utilities.formatDate(new Date(), DEFAULTS.TZ, 'yyyy-MM-dd HH:mm:ss'),
  });
}

// ── 설정/유틸 ───────────────────────────────────────────

function prop_(key) {
  var value = PROPS.getProperty(key);
  if (value && String(value).trim()) return String(value).trim();
  return DEFAULTS[key] || '';
}

function checkToken_(e) {
  var expected = prop_('SHARED_TOKEN');
  if (!expected) return '';
  var got = (e && e.parameter && e.parameter.token) || '';
  if (got !== expected) return '인증 토큰이 올바르지 않습니다.';
  return '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function text_(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** 드라이브 파일명에 쓸 수 없는 문자 제거 */
function safeName_(value, maxLength) {
  var name = text_(value)
    .replace(/[\\/:*?"<>|#%{}$!'@`+=~^]/g, ' ')
    .replace(/\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLength && name.length > maxLength) name = name.slice(0, maxLength).trim();
  return name || '기관';
}

/** KST 날짜 문자열 (yyyy-MM-dd) */
function dateKST_(value) {
  var date = value ? new Date(value) : new Date();
  if (isNaN(date.getTime())) date = new Date();
  return Utilities.formatDate(date, DEFAULTS.TZ, 'yyyy-MM-dd');
}

/** KST 일시 문자열 (yyyy-MM-dd HH:mm) */
function dateTimeKST_(value) {
  var date = value ? new Date(value) : new Date();
  if (isNaN(date.getTime())) date = new Date();
  return Utilities.formatDate(date, DEFAULTS.TZ, 'yyyy-MM-dd HH:mm');
}

// ── 드라이브 ────────────────────────────────────────────

function getFolder_() {
  var folderName = prop_('FOLDER_NAME');
  var parentId = prop_('PARENT_FOLDER_ID');

  var parents = [];
  if (parentId) {
    try {
      parents = [DriveApp.getFolderById(parentId)];
    } catch (err) {
      throw new Error('PARENT_FOLDER_ID 폴더를 찾을 수 없습니다: ' + parentId);
    }
  }

  var found = null;
  if (parentId) {
    var it = parents[0].getFoldersByName(folderName);
    if (it.hasNext()) found = it.next();
  } else {
    var all = DriveApp.getFoldersByName(folderName);
    if (all.hasNext()) found = all.next();
  }
  if (found) return found;

  var folder = parentId ? parents[0].createFolder(folderName) : DriveApp.createFolder(folderName);
  return folder;
}

function getSheet_(folder) {
  var sheetName = prop_('SHEET_NAME');
  var file = null;

  // 1) 같은 폴더에서 먼저 찾고, 2) 없으면 내 드라이브 전체에서 찾습니다.
  var inFolder = folder.getFilesByName(sheetName);
  while (inFolder.hasNext()) {
    var candidate = inFolder.next();
    if (candidate.getMimeType() === MimeType.GOOGLE_SHEETS) { file = candidate; break; }
  }
  if (!file) {
    var anywhere = DriveApp.getFilesByName(sheetName);
    while (anywhere.hasNext()) {
      var candidate2 = anywhere.next();
      if (candidate2.getMimeType() === MimeType.GOOGLE_SHEETS) { file = candidate2; break; }
    }
  }

  var spreadsheet;
  if (file) {
    spreadsheet = SpreadsheetApp.open(file);
  } else {
    spreadsheet = SpreadsheetApp.create(sheetName);
    var created = DriveApp.getFileById(spreadsheet.getId());
    created.moveTo(folder);
  }

  var sheet = spreadsheet.getSheetByName(prop_('SHEET_TAB')) || spreadsheet.getSheets()[0];
  if (sheet.getName() !== prop_('SHEET_TAB')) sheet.setName(prop_('SHEET_TAB'));
  ensureHeader_(sheet);

  return { sheet: sheet, url: spreadsheet.getUrl(), spreadsheet: spreadsheet };
}

function ensureHeader_(sheet) {
  var hasContent = sheet.getLastRow() > 0 && text_(sheet.getRange(1, 1).getValue()).trim() !== '';
  if (hasContent) {
    var width = Math.max(sheet.getLastColumn(), HEADERS.length);
    var current = sheet.getRange(1, 1, 1, width).getValues()[0];
    var same = HEADERS.every(function (h, i) { return text_(current[i]).trim() === h; });
    if (same) return;
  }

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  var header = sheet.getRange(1, 1, 1, HEADERS.length);
  header.setFontWeight('bold');
  header.setBackground('#0f766e');
  header.setFontColor('#ffffff');
  header.setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);

  // 열 너비 (가독성)
  var widths = [130, 140, 180, 90, 130, 200, 100, 140, 130, 120, 80, 90, 130, 260, 420, 200];
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
}

function appendRow_(sheet, payload, docUrl) {
  var audience = text_(payload.audience);
  if (text_(payload.audienceEtc)) audience += ' · ' + text_(payload.audienceEtc);

  var row = [
    dateTimeKST_(payload.receivedAt),
    text_(payload.receiptNo),
    text_(payload.orgName),
    text_(payload.contactName),
    text_(payload.phone),
    text_(payload.email),
    text_(payload.preferredDate),
    text_(payload.preferredTime),
    text_(payload.method),
    audience,
    text_(payload.headcount),
    text_(payload.duration),
    text_(payload.budget),
    text_(payload.topic),
    text_(payload.message),
    docUrl,
  ];

  sheet.appendRow(row);

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 1, 1, HEADERS.length)
    .setVerticalAlignment('top')
    .setWrap(true);

  if (docUrl) {
    var cell = sheet.getRange(lastRow, HEADERS.length);
    var label = '의뢰서 열기';
    cell.setFormula('=HYPERLINK("' + docUrl + '","' + label + '")');
  }
}

// ── 문서 생성 ───────────────────────────────────────────

function createDoc_(folder, payload) {
  var receiptDate = dateKST_(payload.receivedAt);
  var title = '[' + receiptDate + '] ' + safeName_(payload.orgName, 40) + '_강의의뢰서';

  // 제목이 같으면 드라이브에서 구분이 어려우므로 접수번호를 뒤에 붙입니다.
  var suffix = text_(payload.receiptNo) ? ' (' + safeName_(payload.receiptNo, 20) + ')' : '';
  var doc = DocumentApp.create(title + suffix);

  var body = doc.getBody();

  var titlePara = body.appendParagraph('강의 의뢰서');
  titlePara.setHeading(DocumentApp.ParagraphHeading.TITLE);
  titlePara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  var subtitle = body.appendParagraph('119복지인권연구소 · ONEBLOCKAI연구소');
  subtitle.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  subtitle.editAsText().setFontSize(10).setForegroundColor('#5b6b7c');

  body.appendHorizontalRule();

  var meta = body.appendParagraph(
    '접수번호: ' + text_(payload.receiptNo) + '    |    접수일시: ' + dateTimeKST_(payload.receivedAt)
  );
  meta.editAsText().setFontSize(9).setForegroundColor('#5b6b7c');

  var audience = text_(payload.audience);
  if (text_(payload.audienceEtc)) audience += ' (' + text_(payload.audienceEtc) + ')';

  var rows = [
    ['기관명', text_(payload.orgName)],
    ['담당자', text_(payload.contactName)],
    ['연락처', text_(payload.phone)],
    ['이메일', text_(payload.email)],
    ['희망 날짜', text_(payload.preferredDate)],
    ['희망 시간대', text_(payload.preferredTime)],
    ['진행 방식', text_(payload.method)],
    ['교육 대상', audience],
    ['예상 인원', text_(payload.headcount) ? text_(payload.headcount) + '명' : ''],
    ['교육 시간', text_(payload.duration)],
    ['예산·강사료', text_(payload.budget)],
    ['희망 주제', text_(payload.topic)],
  ];

  var table = body.appendTable();
  rows.forEach(function (row) {
    var tr = table.appendTableRow();
    var labelCell = tr.appendTableCell(row[0]);
    var valueCell = tr.appendTableCell(row[1] || '-');
    labelCell.setBackgroundColor('#f1f5f9');
    labelCell.setWidth(90);
    valueCell.setWidth(360);
    try {
      labelCell.getChild(0).asParagraph().editAsText().setBold(true).setFontSize(10);
      valueCell.getChild(0).asParagraph().editAsText().setFontSize(10);
    } catch (err) { /* 무시 */ }
  });

  body.appendParagraph('');

  var requestHeading = body.appendParagraph('요청사항 및 특이사항');
  requestHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);

  var requestText = text_(payload.message) || '—';
  var requestPara = body.appendParagraph(requestText);
  requestPara.editAsText().setFontSize(10);

  body.appendParagraph('');

  var footer = body.appendParagraph(
    '본 문서는 강의 의뢰 접수 웹앱으로 자동 생성되었습니다. 개인정보는 강의 의뢰 확인 및 진행 목적으로만 사용됩니다.'
  );
  footer.editAsText().setFontSize(8).setForegroundColor('#8a97a6');

  doc.saveAndClose();

  var file = DriveApp.getFileById(doc.getId());
  file.moveTo(folder);

  return doc;
}

// ── 수동 점검용 ─────────────────────────────────────────

/** 편집기에서 한 번 실행하면 폴더/시트를 미리 만들어 두고 로그를 남깁니다. */
function setupDrive() {
  var folder = getFolder_();
  var info = getSheet_(folder);
  Logger.log('폴더: ' + folder.getName() + ' / ' + folder.getUrl());
  Logger.log('시트: ' + info.url);
  Logger.log('토큰 사용: ' + (prop_('SHARED_TOKEN') ? '예' : '아니오'));
}

/** 편집기에서 실행: 샘플 데이터로 문서·시트 생성이 되는지 확인합니다. */
function testWithSample() {
  var sample = {
    receiptNo: 'LR-TEST-0001',
    receivedAt: new Date().toISOString(),
    orgName: '테스트종합사회복지관',
    contactName: '홍길동',
    phone: '010-1234-5678',
    email: 'test@example.com',
    preferredDate: Utilities.formatDate(new Date(), DEFAULTS.TZ, 'yyyy-MM-dd'),
    preferredTime: '오후 (13:00~18:00)',
    method: '대면',
    audience: '사회복지사',
    audienceEtc: '',
    headcount: '30',
    duration: '2시간',
    budget: '기관 기준',
    topic: '실무자 생성형 AI 문서·서식 자동화',
    message: '샘플 데이터로 생성한 테스트 문서입니다.',
  };
  var folder = getFolder_();
  var sheetInfo = getSheet_(folder);
  var doc = createDoc_(folder, sample);
  appendRow_(sheetInfo.sheet, sample, doc.getUrl());
  Logger.log('문서: ' + doc.getUrl());
  Logger.log('시트: ' + sheetInfo.url);
}
