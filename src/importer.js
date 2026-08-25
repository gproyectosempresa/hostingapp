'use strict';

const fs = require('fs');
const ExcelJS = require('exceljs');
const { stripAccents } = require('./utils');

/* Sinonimos de encabezados aceptados en el Excel / CSV de piezas. */
const FIELD_ALIASES = {
  mark: ['marca', 'marcadepieza', 'marcapieza', 'pieza', 'piezamarca', 'piecemark', 'mark', 'elemento',
    'clave', 'noelemento', 'numero', 'numeropieza', 'item', 'id', 'codigo', 'partmark', 'no'],
  description: ['descripcion', 'desc', 'nombre', 'concepto', 'detalle', 'description', 'tipo', 'elementodescripcion'],
  profile: ['perfil', 'seccion', 'section', 'profile', 'medida', 'medidas', 'dimension', 'dimensiones', 'shape'],
  material: ['material', 'grado', 'acero', 'calidad', 'norma', 'grade'],
  qty: ['cantidad', 'cant', 'cantidadpiezas', 'piezas', 'pzas', 'pz', 'qty', 'quantity', 'nodepiezas', 'numerodepiezas'],
  unit_weight: ['pesounitario', 'pesounit', 'pesounitariokg', 'pesocu', 'pesoporpieza', 'pesopieza', 'kgpieza',
    'kgpza', 'unitweight', 'pesokg', 'peso', 'weight', 'pesokgpza'],
  total_weight: ['pesototal', 'pesototalkg', 'totalkg', 'totalweight', 'pesoacumulado', 'kgtotal', 'pesototales'],
  lot: ['lote', 'fase', 'etapa', 'area', 'zona', 'nivel', 'eje', 'paquete', 'embarque', 'remision', 'modulo', 'lot', 'phase']
};

function norm(s) {
  return stripAccents(String(s == null ? '' : s)).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* Patrones de separador de miles:  1,234,567  /  1.234.567 */
const MILES_COMA = /^\d{1,3}(,\d{3})+$/;
const MILES_PUNTO = /^\d{1,3}(\.\d{3})+$/;

/**
 * Convierte a numero respetando como escriba la gente los pesos:
 *   850,25  -> 850.25      1.234,50 -> 1234.5
 *   1,234.5 -> 1234.5      1.234    -> 1234
 *   1234.500 -> 1234.5     12 500,75 kg -> 12500.75
 */
function toNumber(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'object' && v.result != null) return toNumber(v.result);

  let s = String(v).trim().replace(/[\s ]/g, '');
  const negativo = /^[-(]/.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return 0;

  const iComa = s.lastIndexOf(',');
  const iPunto = s.lastIndexOf('.');

  if (iComa >= 0 && iPunto >= 0) {
    // el separador decimal es el ultimo que aparece
    if (iComa > iPunto) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (iComa >= 0) {
    s = MILES_COMA.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (iPunto >= 0 && MILES_PUNTO.test(s)) {
    s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return negativo ? -n : n;
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v).trim();
}

/** Localiza la fila de encabezados y construye el mapeo de columnas. */
function buildMapping(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map(norm);
    const mapping = {};
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      const idx = cells.findIndex((c) => c && aliases.includes(c));
      if (idx >= 0 && !Object.values(mapping).includes(idx)) mapping[field] = idx;
    }
    // Segunda pasada: coincidencia parcial para lo que falto
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (mapping[field] != null) continue;
      const idx = cells.findIndex((c, i) =>
        c && !Object.values(mapping).includes(i) && aliases.some((a) => a.length > 3 && c.includes(a)));
      if (idx >= 0) mapping[field] = idx;
    }
    if (mapping.mark != null && (mapping.unit_weight != null || mapping.total_weight != null || mapping.qty != null)) {
      return { headerRow: r, mapping, headers: rows[r].map(cellText) };
    }
  }
  return null;
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function readGrid(filePath, originalName) {
  const lower = String(originalName || filePath).toLowerCase();

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    let text = fs.readFileSync(filePath, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    const first = lines[0] || '';
    const delim = (first.split(';').length > first.split(',').length) ? ';'
      : (first.split('\t').length > first.split(',').length ? '\t' : ',');
    return lines.map((l) => splitCsvLine(l, delim));
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets.find((s) => s.rowCount > 1) || wb.worksheets[0];
  if (!ws) return [];
  const grid = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const arr = [];
    const n = Math.max(row.cellCount, 1);
    for (let c = 1; c <= n; c++) arr.push(cellText(row.getCell(c).value));
    grid.push(arr);
  });
  return grid;
}

/**
 * Lee el archivo de piezas y devuelve:
 *   { ok, rows:[{mark,description,profile,material,qty,unit_weight,total_weight,lot}],
 *     mapping, headers, warnings, totals }
 */
async function parsePieces(filePath, originalName) {
  let grid;
  try {
    grid = await readGrid(filePath, originalName);
  } catch (e) {
    return { ok: false, error: 'No se pudo leer el archivo: ' + e.message, rows: [] };
  }
  if (!grid.length) return { ok: false, error: 'El archivo esta vacio.', rows: [] };

  const found = buildMapping(grid);
  if (!found) {
    return {
      ok: false,
      rows: [],
      error: 'No se encontraron las columnas necesarias. El archivo debe tener un encabezado con al menos ' +
        '"Marca" y "Peso" (o "Cantidad"). Columnas reconocidas: Marca, Descripcion, Perfil, Material, ' +
        'Cantidad, Peso unitario, Peso total, Lote.'
    };
  }

  const { mapping, headerRow, headers } = found;
  const get = (row, field) => (mapping[field] == null ? '' : cellText(row[mapping[field]]));
  const rows = [];
  const warnings = [];
  const seen = new Map();

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    const mark = get(row, 'mark');
    if (!mark) continue;
    if (/^(total|totales|suma|subtotal)/i.test(mark)) continue;

    let qty = mapping.qty != null ? toNumber(row[mapping.qty]) : 1;
    if (!qty || qty <= 0) qty = 1;
    let unit = mapping.unit_weight != null ? toNumber(row[mapping.unit_weight]) : 0;
    let total = mapping.total_weight != null ? toNumber(row[mapping.total_weight]) : 0;
    if (!unit && total) unit = total / qty;
    if (!total && unit) total = unit * qty;

    const lot = get(row, 'lot');
    const key = (mark + '||' + lot).toLowerCase();
    if (seen.has(key)) {
      const prev = rows[seen.get(key)];
      prev.qty += qty;
      prev.total_weight += total;
      prev.unit_weight = prev.qty ? prev.total_weight / prev.qty : prev.unit_weight;
      continue;
    }
    seen.set(key, rows.length);

    rows.push({
      mark,
      description: get(row, 'description'),
      profile: get(row, 'profile'),
      material: get(row, 'material'),
      qty: Math.round(qty * 100) / 100,
      unit_weight: Math.round(unit * 1000) / 1000,
      total_weight: Math.round(total * 1000) / 1000,
      lot,
      sort_order: rows.length
    });
  }

  if (!rows.length) return { ok: false, error: 'No se encontraron filas de piezas debajo del encabezado.', rows: [] };
  if (!rows.some((p) => p.total_weight > 0)) warnings.push('Ninguna pieza trae peso: revisa la columna de peso.');

  const totals = {
    piezas: rows.length,
    cantidad: rows.reduce((a, p) => a + p.qty, 0),
    peso: rows.reduce((a, p) => a + p.total_weight, 0)
  };
  const usedColumns = Object.fromEntries(
    Object.entries(mapping).map(([f, i]) => [f, headers[i] || ('Columna ' + (i + 1))])
  );

  return { ok: true, rows, mapping: usedColumns, headers, warnings, totals };
}

module.exports = { parsePieces };
