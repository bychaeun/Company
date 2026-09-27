// 대분류별 메모 시트의 확장 프로그램 > Apps Script에 저장합니다.
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const name = sheet.getName();
  if (name === '접근관리' || name === '체크리스트' || name.indexOf('메모_백업') === 0) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const dateColumn = headers.indexOf('수정일') + 1;
  if (!['소분류', '제목', '내용', '이미지', '수정일'].every(header => headers.includes(header))) return;
  const columns = ['소분류', '제목', '내용', '이미지'].map(header => headers.indexOf(header) + 1).filter(col => col > 0);
  if (!dateColumn || !columns.some(col => col >= e.range.getColumn() && col <= e.range.getLastColumn())) return;
  const firstRow = Math.max(2, e.range.getRow());
  const lastRow = e.range.getLastRow();
  if (lastRow < firstRow) return;
  const rows = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, headers.length).getValues();
  const now = new Date();
  const dates = rows.map(row => [columns.some(col => row[col - 1] !== '') ? now : '']);
  sheet.getRange(firstRow, dateColumn, dates.length, 1).setValues(dates).setNumberFormat('yyyy-mm-dd');
}


