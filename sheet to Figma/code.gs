/****************************************************
 * 설정값: 반드시 본인 것으로 교체하세요
 ****************************************************/
const CONFIG = {
  // 팀별 매출 현황 스프레드시트 ID
  A_SPREADSHEET_ID: "1gI47PKg1IRATU9jHU2zOR92ckHw4ngjv3GMbfkBXUrw",
  // 업체별 리스트 스프레드시트 ID
  B_SPREADSHEET_ID: "1iBlts-2QYPbRjNLeX0ARuJ_XBaAVVCoRipsKF2y76d0",

  // 팀별 매출 현황 시트 gid(uid) 4개
  A_SHEET_GIDS: [
    1019584492, // 케어팀
    2020096823, // 포스팀
    290432171, // 콘텐츠마케팅팀
    2022739518, // 유튜브팀
  ],

  // 업체별 리스트 시트 gid(uid)
  B_SHEET_GID: 1368125298,

  // A파일 데이터 시작 행 / 헤더 행
  A_HEADER_CELL: "A4",
  A_START_CELL: "A5",

  // 업체별 리스트 데이터 시작 행
  B_START_CELL: "B11",

  // 업체별 리스트 칸
  B_WRITE_COL_RANGE: "B:S", // 업체별 리스트 덮어쓸 구간
  B_VENDOR: "B", // 업체명
  B_COL_CONTRACT_DATE: "D", // 계약일
  B_COL_MANAGER: "E", // 담당자
  B_COL_SALES_START: "H", // 매출액 시작
};

// 담당자(K) 필수 예외 gid
const K_OPTIONAL_GIDS = new Set([2022739518]);

const realLast = aSheet.getLastRow();
if (realLast < A_START.row) continue;

// 빈칸 아래 5줄까지 추가로 스캔
const bufferedLastRow = realLast + 5;
const maxRows = aSheet.getMaxRows();
const safeLastRow = Math.min(bufferedLastRow, maxRows);

const numRows = safeLastRow - A_START.row + 1;
const realLast = aSheet.getLastRow();
if (realLast < A_START.row) continue;

// 빈칸 아래 5줄까지 추가로 스캔
const bufferedLastRow = realLast + 5;
const maxRows = aSheet.getMaxRows();
const safeLastRow = Math.min(bufferedLastRow, maxRows);

const numRows = safeLastRow - A_START.row +****
 * 메인 실행 함수 (스냅샷 방식)
 * - 매 실행마다 A를 기준으로 B(B~S)를 "완전 재구성"
 * - 따라서 A에 없는 업체(오타 등)는 B에서 자동 삭제됨
 ****************************************************/
function syncAtoB_ByGid() {
  const aSS = SpreadsheetApp.openById(CONFIG.A_SPREADSHEET_ID);
  const bSS = SpreadsheetApp.openById(CONFIG.B_SPREADSHEET_ID);
  const bSheet = bSS.getSheetById(CONFIG.B_SHEET_GID);
  if (!bSheet)
    throw new Error(
      "B 시트를 gid로 찾지 못했습니다. CONFIG.B_SHEET_GID 확인 필요"
    );

  // ✅ CONFIG(셀/열문자/범위) -> 실제 숫자 row/col로 변환
  const A_HEADER = a1ToRowCol_(CONFIG.A_HEADER_CELL);
  const A_START = a1ToRowCol_(CONFIG.A_START_CELL);
  const B_START = a1ToRowCol_(CONFIG.B_START_CELL);

  const B_WRITE = colRangeToStartEnd_(CONFIG.B_WRITE_COL_RANGE); // ex) B:S
  const bWriteWidth = B_WRITE.width;

  // B 레이아웃 (1-based column)
  // B: 업체명
  // D: 계약일
  // E: 담당자
  // H~S: 월 매출 (H=1월, I=2월 ... S=12월)
  const B_COL_VENDOR = colToIndex_(colLetter_(CONFIG.B_VENDOR)); // B
  const B_COL_CONTRACT_DATE = colToIndex_(
    colLetter_(CONFIG.B_COL_CONTRACT_DATE)
  ); // D
  const B_COL_MANAGER = colToIndex_(colLetter_(CONFIG.B_COL_MANAGER)); // E
  const B_COL_SALES_START = colToIndex_(colLetter_(CONFIG.B_COL_SALES_START)); // H

  // =========================
  // 1) A 전체를 읽어서 "현재 상태" 스냅샷 생성
  // =========================
  // vendor -> { vendor, contractDate, manager, salesByMonth[12] }
  const vendorMap = new Map();

  for (const gid of CONFIG.A_SHEET_GIDS) {
    const aSheet = aSS.getSheetById(gid);
    if (!aSheet)
      throw new Error(
        `A 시트를 gid=${gid} 로 찾지 못했습니다. CONFIG.A_SHEET_GIDS 확인 필요`
      );

    const aLastRow = aSheet.getLastRow();
    if (aLastRow < A_START.row) continue;

    const numRows = aLastRow - A_START.row + 1;

    // 1~11까지 한번에 읽기 (C/E/H용)
    const aValues = aSheet.getRange(A_START.row, 1, numRows, 11).getValues();

    // 담당자 열 찾기
    const managerCol =
      findColumnByHeader_(aSheet, A_HEADER.row, "담당자") || 11;
    const aManagerDisplay = aSheet
      .getRange(A_START.row, managerCol, numRows, 1)
      .getDisplayValues();

    for (let r = 0; r < aValues.length; r++) {
      const row = aValues[r];

      const cRaw = rowCell_(row, "C"); // 계약일
      const eRaw = rowCell_(row, "E"); // 업체명
      const hRaw = rowCell_(row, "H"); // 매출
      const kRaw = aManagerDisplay[r][0]; // 담당자 표시값

      if (!isFilled_(cRaw)) continue;
      if (!isFilled_(eRaw)) continue;

      const sales = normalizeNumber_(hRaw);
      if (sales === null) continue;

      const managerRequired = !K_OPTIONAL_GIDS.has(gid);
      if (managerRequired && !isFilled_(kRaw)) continue;

      const contractDate = normalizeDate_(cRaw);
      if (!contractDate) continue;

      const vendor = String(eRaw).trim();
      const monthIdx0 = contractDate.getMonth(); // 0~11
      const manager = parseManagers_(kRaw).join(", ");

      if (!vendorMap.has(vendor)) {
        vendorMap.set(vendor, {
          vendor,
          contractDate,
          manager,
          salesByMonth: new Array(12).fill(""),
        });
      }

      const vObj = vendorMap.get(vendor);

      // 계약일은 가장 이른 날짜로
      if (vObj.contractDate && contractDate < vObj.contractDate) {
        vObj.contractDate = contractDate;
      }

      // 담당자 병합
      if (manager) vObj.manager = mergeManagers_(vObj.manager, manager);

      // 월 매출 저장(같은 월이 또 나오면 마지막 값으로 덮어씀)
      vObj.salesByMonth[monthIdx0] = sales;
    }
  }

  // =========================
  // 2) B에 쓸 bMatrix "완전 재구성"
  // =========================
  const vendors = Array.from(vendorMap.keys()).sort(); // 가나다순 정렬
  const bMatrix = [];

  for (const vendor of vendors) {
    const vObj = vendorMap.get(vendor);
    const row = new Array(bWriteWidth).fill("");

    // B..S (0-based index)
    const idxVendor = B_COL_VENDOR - B_WRITE.startCol; // B
    const idxContractDate = B_COL_CONTRACT_DATE - B_WRITE.startCol; // D
    const idxManager = B_COL_MANAGER - B_WRITE.startCol; // E
    const idxSalesStart = B_COL_SALES_START - B_WRITE.startCol; // H

    row[idxVendor] = vObj.vendor;
    row[idxContractDate] = vObj.contractDate;
    row[idxManager] = vObj.manager;

    // H~S에 월 매출 채우기 (12개월)
    for (let m = 0; m < 12; m++) {
      const cellIdx = idxSalesStart + m; // H + m
      if (cellIdx < 0 || cellIdx >= row.length) continue; // B..S 범위 밖이면 무시
      row[cellIdx] = vObj.salesByMonth[m] === "" ? "" : vObj.salesByMonth[m];
    }

    bMatrix.push(row);
  }

  // =========================
  // 3) B의 기존 관리구간(B~S) 전부 비우고, 새 스냅샷을 씀
  // =========================
  const bLastRowByVendor = getLastRowByColumn_(
    bSheet,
    B_START.row,
    B_COL_VENDOR
  ); // B열 기준
  const clearRows = Math.max(0, bLastRowByVendor - B_START.row + 1);

  if (clearRows > 0) {
    bSheet
      .getRange(B_START.row, B_WRITE.startCol, clearRows, bWriteWidth)
      .clearContent();
  }

  if (bMatrix.length > 0) {
    bSheet
      .getRange(B_START.row, B_WRITE.startCol, bMatrix.length, bWriteWidth)
      .setValues(bMatrix);
  }

  // ✅ 완료되면 A1에 "마지막 적용: yyyy/MM/dd HH:mm:ss" 작성
  const now = new Date();
  const tz = Session.getScriptTimeZone(); // 스프레드시트/스크립트 시간대
  const stamp = Utilities.formatDate(now, tz, "yyyy/MM/dd HH:mm:ss");
  bSheet.getRange("A1").setValue("마지막 적용: " + stamp);
}

/****************************************************
 * Helpers (필요 최소)
 ****************************************************/
function isFilled_(v) {
  return !(v === null || v === undefined || String(v).trim() === "");
}

function normalizeDate_(v) {
  if (!v) return null;

  if (
    Object.prototype.toString.call(v) === "[object Date]" &&
    !isNaN(v.getTime())
  )
    return v;

  // 시트 날짜가 숫자(시리얼)로 들어오는 경우
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }

  const s = v.toString().trim();
  if (!s) return null;

  // 2025-1-7 / 2025.1.7 / 2025/1/7 등
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) {
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(dt.getTime()) ? null : dt;
  }

  const d2 = new Date(s);
  return isNaN(d2.getTime()) ? null : d2;
}

function normalizeNumber_(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;

  const s = v
    .toString()
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!s) return null;

  const n = Number(s);
  return isFinite(n) ? n : null;
}

function getLastRowByColumn_(sheet, startRow, col) {
  const last = sheet.getLastRow();
  if (last < startRow) return startRow - 1;

  const values = sheet
    .getRange(startRow, col, last - startRow + 1, 1)
    .getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    const v = (values[i][0] || "").toString().trim();
    if (v) return startRow + i;
  }
  return startRow - 1;
}

function parseManagers_(raw) {
  if (raw === null || raw === undefined) return [];
  const s = raw.toString().trim();
  if (!s) return [];

  const parts = s
    .split(/[\n,;\/\|]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function mergeManagers_(existingRaw, incomingRaw) {
  const a = parseManagers_(existingRaw);
  const b = parseManagers_(incomingRaw);

  const seen = new Set();
  const merged = [];
  for (const x of [...a, ...b]) {
    if (!seen.has(x)) {
      seen.add(x);
      merged.push(x);
    }
  }
  return merged.join(", ");
}

function findColumnByHeader_(sheet, headerRow, headerText) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet
    .getRange(headerRow, 1, 1, lastCol)
    .getDisplayValues()[0];
  const target = headerText.toString().trim();

  for (let c = 0; c < headers.length; c++) {
    const h = (headers[c] || "").toString().trim();
    if (!h) continue;
    if (h === target || h.includes(target)) return c + 1;
  }
  return null;
}

function colToIndex_(colLetter) {
  const s = String(colLetter)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n; // 1-based
}

function a1ToRowCol_(a1) {
  const m = String(a1)
    .trim()
    .match(/^([A-Z]+)(\d+)$/i);
  if (!m) throw new Error("잘못된 A1 주소: " + a1);
  return { col: colToIndex_(m[1]), row: Number(m[2]) };
}

function colLetter_(v) {
  const m = String(v)
    .trim()
    .match(/^([A-Z]+)/i);
  if (!m) throw new Error("열 문자를 해석할 수 없음: " + v);
  return m[1].toUpperCase();
}

function colRangeToStartEnd_(rangeText) {
  const m = String(rangeText)
    .trim()
    .match(/^([A-Z]+)\s*:\s*([A-Z]+)$/i);
  if (!m) throw new Error("잘못된 열 범위: " + rangeText + ' (예: "B:S")');

  const startCol = colToIndex_(m[1]);
  const endCol = colToIndex_(m[2]);
  if (endCol < startCol)
    throw new Error("열 범위가 거꾸로입니다: " + rangeText);

  return { startCol, endCol, width: endCol - startCol + 1 };
}

function rowCell_(rowValues, colLetter) {
  const idx = colToIndex_(colLetter) - 1; // 0-based
  return rowValues[idx];
}
