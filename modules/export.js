import { getFileList, getFileIconState, getFileNote, getFileMetadata, setFileMetadata } from './fileState.js';
import { extractGuanoMetadata, parseGuanoMetadata } from './guanoReader.js';
import { showMessageBox } from './messageBox.js';

// ============================================================
// 通用輔助函數 (ZIP, CRC32, XML Helpers)
// ============================================================

function strToU8(str) {
  return new TextEncoder().encode(str);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function createZip(entries) {
  const fileParts = [];
  const dirParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = strToU8(entry.name);
    const dataBytes = typeof entry.data === 'string' ? strToU8(entry.data) : entry.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const header = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);
    dv.setUint32(22, size, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    const local = new Uint8Array(header.length + size);
    local.set(header, 0);
    local.set(dataBytes, header.length);
    fileParts.push(local);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dv2 = new DataView(dir.buffer);
    dv2.setUint32(0, 0x02014b50, true);
    dv2.setUint16(4, 20, true);
    dv2.setUint16(6, 20, true);
    dv2.setUint16(8, 0, true);
    dv2.setUint16(10, 0, true);
    dv2.setUint16(12, 0, true);
    dv2.setUint16(14, 0, true);
    dv2.setUint32(16, crc, true);
    dv2.setUint32(20, size, true);
    dv2.setUint32(24, size, true);
    dv2.setUint16(28, nameBytes.length, true);
    dv2.setUint16(30, 0, true);
    dv2.setUint16(32, 0, true);
    dv2.setUint16(34, 0, true);
    dv2.setUint16(36, 0, true);
    dv2.setUint32(38, 0, true);
    dv2.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    dirParts.push(dir);

    offset += local.length;
  }

  const centralDirSize = dirParts.reduce((a, b) => a + b.length, 0);
  const dirOffset = offset;

  const end = new Uint8Array(22);
  const dv3 = new DataView(end.buffer);
  dv3.setUint32(0, 0x06054b50, true);
  dv3.setUint16(4, 0, true);
  dv3.setUint16(6, 0, true);
  dv3.setUint16(8, entries.length, true);
  dv3.setUint16(10, entries.length, true);
  dv3.setUint32(12, centralDirSize, true);
  dv3.setUint32(16, dirOffset, true);
  dv3.setUint16(20, 0, true);

  const allParts = [...fileParts, ...dirParts, end];
  const total = allParts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let ptr = 0;
  for (const part of allParts) {
    out.set(part, ptr);
    ptr += part.length;
  }
  return out;
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// [NEW] 通用 Excel 生成核心函數
// ============================================================
function generateXlsxBlob(rows) {
  // 1. 計算每一列的最大寬度
  const colWidths = rows[0].map(h => String(h).length);
  for (const row of rows) {
    row.forEach((v, i) => {
      const len = String(v).length;
      if (len > colWidths[i]) colWidths[i] = len;
    });
  }

  const columnLetter = (idx) => {
    let s = '';
    idx++;
    while (idx > 0) {
      const m = (idx - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      idx = Math.floor((idx - 1) / 26);
    }
    return s;
  };

  const colsXml = colWidths.map((w, i) => `<col min="${i+1}" max="${i+1}" width="${w+2}" customWidth="1"/>`).join('');
  let sheetData = '';
  rows.forEach((row, rIdx) => {
    sheetData += `<row r="${rIdx+1}">`;
    row.forEach((v, cIdx) => {
      sheetData += `<c r="${columnLetter(cIdx)}${rIdx+1}" t="inlineStr"><is><t>${escapeXml(String(v))}</t></is></c>`;
    });
    sheetData += '</row>';
  });

  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>`+
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`+
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`+
    `<sheetFormatPr defaultRowHeight="15"/>`+
    `<cols>${colsXml}</cols>`+
    `<sheetData>${sheetData}</sheetData>`+
    `</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>`+
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
    `<fonts count="1"><font><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts>`+
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`+
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`+
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`+
    `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>`+
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`+
    `</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>`+
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`+
    `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>`+
    `</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8"?>`+
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`+
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`+
    `</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8"?>`+
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`+
    `</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>`+
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`+
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`+
    `<Default Extension="xml" ContentType="application/xml"/>`+
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`+
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`+
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`+
    `</Types>`;

  const zipBytes = createZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    { name: 'xl/styles.xml', data: stylesXml }
  ]);

  return new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ============================================================
// 舊有的 File List 導出功能 (保留)
// ============================================================

async function gatherRows() {
  const files = getFileList();
  const headers = ['File name','Remark','Date','Time','Latitude','Longitude','Noise','Star','Question'];
  const rows = [headers];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let meta = getFileMetadata(i);
    if (!meta || (!meta.date && !meta.time && !meta.latitude && !meta.longitude)) {
      try {
        const txt = await extractGuanoMetadata(file);
        meta = parseGuanoMetadata(txt);
        setFileMetadata(i, meta);
      } catch (err) {
        meta = { date: '', time: '', latitude: '', longitude: '' };
      }
    }

    const flags = getFileIconState(i);
    const note = getFileNote(i);
    rows.push([
      file.name,
      note,
      meta.date,
      meta.time,
      meta.latitude,
      meta.longitude,
      flags.trash ? '1' : '0',
      flags.star ? '1' : '0',
      flags.question ? '1' : '0'
    ]);
  }
  return rows;
}

async function generateCsvRows() {
  const rows = await gatherRows();
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
}

async function exportWav() {
  const expandBlob = window.__currentExpandBlob;
  const currentFileName = window.__currentFileName || 'recording';
  
  if (!expandBlob) {
    alert('No expanded session available for WAV export.');
    return;
  }

  try {
    const blob = expandBlob;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseFileName = currentFileName.replace(/\.[^/.]+$/, '');
    a.download = `${baseFileName}_edited.wav`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error exporting WAV:', err);
    alert('Failed to export WAV file.');
  }
}

async function exportCsv() {
  const rows = await generateCsvRows();
  const csvContent = rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'export.csv';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 舊的 exportXlsx 重構為使用通用函數
async function exportXlsx() {
  const rows = await gatherRows();
  const blob = generateXlsxBlob(rows);
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'file_list.xlsx';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showExportOptions() {
  showMessageBox({
    title: 'Export',
    message: 'Choose file type to export:',
    confirmText: 'CSV',
    customButtons: [
      { text: 'XLSX', callback: exportXlsx },
      { text: 'WAV', callback: exportWav }
    ],
    onConfirm: exportCsv
  });
}

// 用於初始化舊的 Export 按鈕 (Top Bar 左側那個)
export function initExport({ buttonId = 'exportBtn' } = {}) {
  const btn = document.getElementById(buttonId);
  if (!btn) {
    console.warn(`[export] Button with id '${buttonId}' not found.`);
    return;
  }
  btn.addEventListener('click', showExportOptions);
}

// ============================================================
// [NEW] Bat Call 專用導出函數
// ============================================================
export function exportBatCallsToXlsx(calls, filename = 'bat_calls_analysis.xlsx') {
  if (!calls || calls.length === 0) {
    alert("No calls to export.");
    return;
  }

  // 1. 定義 Headers (加入 Time 欄位)
  const headers = [
    "ID", 
    "Start Time (s)", 
    "End Time (s)", 
    "Duration (ms)", 
    
    // Frequency & Time Pairs
    "Low Freq (kHz)", "Low Freq Time (ms)", 
    "High Freq (kHz)", "High Freq Time (ms)", 
    "Peak Freq (kHz)", "Peak Freq Time (ms)", 
    "Knee Freq (kHz)", "Knee Freq Time (ms)", 
    "Char Freq (kHz)", "Char Freq Time (ms)", 
    
    // Other Freqs
    "Start Freq (kHz)", 
    "End Freq (kHz)",
    
    // Power & Quality
    "Bandwidth (kHz)", 
    "Peak Power (dB)", 
    "SNR (dB)", 
    "Quality"
  ];

  const rows = [headers];

  calls.forEach((call, index) => {
    rows.push([
      index + 1,
      call.startTime_s?.toFixed(4) || "",
      call.endTime_s?.toFixed(4) || "",
      call.duration_ms?.toFixed(2) || "",
      
      // Low Freq Pair
      call.lowFreq_kHz?.toFixed(2) || "",
      call.lowFreq_ms?.toFixed(2) || "",
      
      // High Freq Pair
      call.highFreq_kHz?.toFixed(2) || "",
      call.highFreqTime_ms?.toFixed(2) || "",
      
      // Peak Freq Pair
      call.peakFreq_kHz?.toFixed(2) || "",
      call.peakFreqTime_ms?.toFixed(2) || "",
      
      // Knee Freq Pair
      call.kneeFreq_kHz?.toFixed(2) || "",
      call.kneeFreq_ms?.toFixed(2) || "",
      
      // Char Freq Pair
      call.characteristicFreq_kHz?.toFixed(2) || "",
      call.characteristicFreq_ms?.toFixed(2) || "",
      
      call.startFreq_kHz?.toFixed(2) || "",
      call.endFreq_kHz?.toFixed(2) || "",
      
      call.bandwidth_kHz?.toFixed(2) || "",
      call.peakPower_dB?.toFixed(1) || "",
      call.snr_dB?.toFixed(1) || "",
      call.quality || ""
    ]);
  });

  const blob = generateXlsxBlob(rows);
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
