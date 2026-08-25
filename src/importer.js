'use strict';

const fs = require('fs');
const ExcelJS = require('exceljs');
const { stripAccents } = require('./utils');

/* =========================================================================
 *  Lectura del listado de piezas.
 *
 *  Los alias van EN ORDEN DE PRIORIDAD: si la hoja trae "Marca" y "Pieza",
 *  la marca se toma de "Marca" y "Pieza" se usa como descripcion, sin que
 *  importe en que orden esten las columnas.
 * ========================================================================= */

const FIELD_ALIASES = {
  mark: ['marca', 'marcadepieza', 'marcapieza', 'piecemark', 'partmark', 'mark',
    'pieza', 'elemento', 'clave', 'codigo', 'noelemento', 'numeropieza', 'numero', 'item', 'id', 'no'],
  drawing: ['dibujo', 'nodibujo', 'numerodedibujo', 'numerodibujo', 'plano', 'noplano',
    'numerodeplano', 'drawing', 'drawingno', 'dwg', 'dwgno'],
  description: ['descripcion', 'desc', 'concepto', 'detalle', 'description', 'denominacion',
    'pieza', 'elemento', 'nombrepieza', 'tipo'],
  profile: ['perfil', 'seccion', 'section', 'profile', 'medida', 'medidas', 'dimension', 'dimensiones', 'shape'],
  material: ['material', 'grado', 'acero', 'calidad', 'norma', 'grade'],
  qty: ['cantidad', 'cant', 'cantidadpiezas', 'piezas', 'pzas', 'pz', 'qty', 'quantity',
    'nodepiezas', 'numerodepiezas'],
  unit_weight: ['pesounitario', 'pesounit', 'pesounitariokg', 'pesocu', 'pesoporpieza', 'pesopieza',
    'kgpieza', 'kgpza', 'unitweight', 'pesokgpza', 'peso', 'weight', 'pesokg'],
  total_weight: ['pesototal', 'pesototalkg', 'totalkg', 'totalweight', 'pesoacumulado', 'kgtotal', 'pesototales'],
  lot: ['lote', 'fase', 'etapa', 'area', 'zona', 'nivel', 'eje', 'paquete', 'embarque',
    'remision', 'modulo', 'lot', 'phase']
};

/* Columnas que describen al PROYECTO, no a la pieza. Se detectan primero y
   se excluyen del mapeo de piezas. */
const PROJECT_ALIASES = {
  name: ['nombreproyecto', 'nombredeproyecto', 'nombredelproyecto', 'projectname', 'descripcionproyecto'],
  code: ['proyecto', 'codigoproyecto', 'noproyecto', 'numerodeproyecto', 'project', 'projectno',
    'ordendetrabajo', 'shoporder', 'orden', 'ot', 'job', 'jobno'],
  client: ['cliente', 'customer', 'nombrecliente', 'clientname'],
  client_code: ['codecliente', 'codigocliente', 'clientecodigo', 'customercode', 'clientcode', 'codcliente']
};

function norm(s) {
  return stripAccents(String(s == null ? '' : s)).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ------------------------------ numeros ------------------------------ */

const MILES_COMA = /^\d{1,3}(,\d{3})+$/;
const MILES_PUNTO = /^\d{1,3}(\.\d{3})+$/;

/**
 * Convierte a numero respetando como escriba la gente los pesos:
 *   850,25  -> 850.25      1.234,50 -> 1234.5
 *   1,234.5 -> 1234.5      1.234    -> 1234
 *   1234.500 -> 1234.5     12 500,75 kg -> 12500.75
 */
function toNumber(v, conv) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'object' && v.result != null) return toNumber(v.result, conv);

  let s = String(v).trim().replace(/[\s ]/g, '');
  const negativo = /^[-(]/.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return 0;

  const iComa = s.lastIndexOf(',');
  const iPunto = s.lastIndexOf('.');

  if (iComa >= 0 && iPunto >= 0) {
    // vienen los dos: el separador decimal es el ultimo
    if (iComa > iPunto) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (iComa >= 0) {
    if (conv && conv.comaDecimal) s = s.replace(/\./g, '').replace(',', '.');
    else s = MILES_COMA.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (iPunto >= 0) {
    const esMiles = conv ? (conv.puntoMiles && !conv.puntoDecimal) : MILES_PUNTO.test(s);
    if (esMiles && MILES_PUNTO.test(s)) s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return negativo ? -n : n;
}

/**
 * Mira TODA la columna para decidir si el punto (o la coma) es separador
 * decimal o de miles.  Es la unica forma de saber que en una columna con
 * 995.629656 y 417.726 el punto siempre es decimal: 417.726 son 417 kg
 * con gramos, no 417 mil kilos.
 */
function convencionColumna(grid, headerRow, idx) {
  if (idx == null || idx < 0) return null;
  let comaDecimal = false;
  let puntoDecimal = false;
  let puntoMiles = false;

  for (let r = headerRow + 1; r < grid.length; r++) {
    const fila = grid[r];
    if (!fila) continue;
    const s = cellText(fila[idx]).replace(/[\s ]/g, '').replace(/[^0-9.,]/g, '');
    if (!s) continue;

    const comas = (s.match(/,/g) || []).length;
    const puntos = (s.match(/\./g) || []).length;

    if (comas && puntos) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) { comaDecimal = true; puntoMiles = true; }
      else puntoDecimal = true;
      continue;
    }
    if (puntos > 1) { puntoMiles = true; continue; }
    if (puntos === 1 && s.length - s.lastIndexOf('.') - 1 !== 3) puntoDecimal = true;
    if (comas === 1 && s.length - s.lastIndexOf(',') - 1 !== 3) comaDecimal = true;
  }

  return { comaDecimal, puntoDecimal, puntoMiles };
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim();
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    if (v.hyperlink && v.hyperlink.text) return String(v.hyperlink.text).trim();
    return '';
  }
  return String(v).trim();
}

/** Quita guiones o puntos sueltos al final: "UPPER HV CLAMP-" -> "UPPER HV CLAMP" */
function limpiarMarca(t) {
  return String(t || '').trim().replace(/[\s\-_.]+$/, '').trim();
}

/* --------------------------- mapeo de columnas --------------------------- */

/**
 * Busca la columna de un campo respetando la prioridad de sus alias:
 * primero intenta coincidencia exacta con el alias mas importante.
 */
function buscarColumna(cells, aliases, usadas) {
  for (const alias of aliases) {
    const idx = cells.findIndex((c, i) => c === alias && !usadas.has(i));
    if (idx >= 0) return idx;
  }
  for (const alias of aliases) {
    if (alias.length <= 3) continue;
    const idx = cells.findIndex((c, i) => c && !usadas.has(i) && c.includes(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Localiza la fila de encabezados y arma el mapeo de columnas. */
function construirMapeo(rows) {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = rows[r].map(norm);
    if (cells.filter(Boolean).length < 2) continue;

    const usadas = new Set();

    // 1) columnas del proyecto (se apartan para que no se confundan con piezas)
    const proyecto = {};
    for (const [campo, aliases] of Object.entries(PROJECT_ALIASES)) {
      const idx = buscarColumna(cells, aliases, usadas);
      if (idx >= 0) { proyecto[campo] = idx; usadas.add(idx); }
    }

    // 2) columnas de la pieza
    const mapping = {};
    for (const [campo, aliases] of Object.entries(FIELD_ALIASES)) {
      const idx = buscarColumna(cells, aliases, usadas);
      if (idx >= 0) { mapping[campo] = idx; usadas.add(idx); }
    }

    const tienePeso = mapping.unit_weight != null || mapping.total_weight != null;
    if (mapping.mark != null && (tienePeso || mapping.qty != null)) {
      return { headerRow: r, mapping, proyecto, headers: rows[r].map(cellText) };
    }
  }
  return null;
}

/* ------------------------------ lectura ------------------------------ */

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

/* ------------------------------ principal ------------------------------ */

/**
 * Convierte el texto pegado desde Excel (o escrito a mano) en una cuadricula.
 * Al copiar de Excel las columnas llegan separadas por tabulador; tambien se
 * aceptan punto y coma, coma o varios espacios seguidos.
 */
function gridDesdeTexto(texto) {
  const lineas = String(texto || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lineas.length) return [];

  const primera = lineas[0];
  let delim = '\t';
  if (primera.indexOf('\t') < 0) {
    if (primera.split(';').length > 1) delim = ';';
    else if (primera.split(',').length > 1) delim = ',';
    else delim = null;                      // columnas separadas por espacios
  }

  return lineas.map((linea) => (delim
    ? splitCsvLine(linea, delim)
    : linea.trim().split(/\s{2,}/).map((s) => s.trim())));
}

/**
 * Lee el archivo de piezas.
 *
 * opciones.pesoEsTotal : true si la columna generica "Peso" trae el peso
 *                        del renglon completo en vez del peso por pieza.
 *
 * Devuelve { ok, rows, proyecto, mapping, headers, warnings, totals }
 */
async function parsePieces(filePath, originalName, opciones = {}) {
  let grid;
  try {
    grid = await readGrid(filePath, originalName);
  } catch (e) {
    return { ok: false, error: 'No se pudo leer el archivo: ' + e.message, rows: [] };
  }
  if (!grid.length) return { ok: false, error: 'El archivo esta vacio.', rows: [] };
  return parseGrid(grid, opciones);
}

/** Igual que parsePieces pero a partir de datos pegados en pantalla. */
function parsePastedText(texto, opciones = {}) {
  const grid = gridDesdeTexto(texto);
  if (!grid.length) {
    return { ok: false, error: 'No pegaste ningun dato.', rows: [] };
  }
  if (grid.length < 2) {
    return {
      ok: false,
      rows: [],
      error: 'Pega tambien la fila de encabezados (Marca, Cantidad, Peso...) junto con las filas de piezas.'
    };
  }
  return parseGrid(grid, opciones);
}

function parseGrid(grid, opciones = {}) {
  const encontrado = construirMapeo(grid);
  if (!encontrado) {
    return {
      ok: false,
      rows: [],
      error: 'No se encontraron las columnas necesarias. El archivo debe tener un encabezado con al menos ' +
        '"Marca" (o "Pieza") y "Peso" (o "Cantidad"). Columnas que se reconocen: Marca, Pieza, Dibujo, ' +
        'Descripcion, Perfil, Material, Cantidad, Peso, Peso total, Lote, Proyecto, Nombre Proyecto y Cliente.'
    };
  }

  const { mapping, proyecto, headerRow, headers } = encontrado;
  const dato = (row, idx) => (idx == null || idx < 0 ? '' : cellText(row[idx]));
  const campo = (row, f) => dato(row, mapping[f]);

  /*
   * Una columna llamada solo "Peso" es ambigua: puede ser el peso de una
   * pieza o el del renglon completo.  Por omision se toma como TOTAL del
   * renglon, que es como lo entrega el sistema de ingenieria; el alta deja
   * cambiarlo si algun archivo viene al reves.
   * (Una columna llamada "Peso unitario" no entra aqui: esa siempre es unitaria.)
   */
  const columnaPesoGenerica = mapping.unit_weight != null &&
    /^(peso|weight|pesokg|kg|pesokgs)$/.test(norm(headers[mapping.unit_weight] || ''));
  const pesoEsTotal = opciones.pesoEsTotal === undefined ? true : !!opciones.pesoEsTotal;

  /* Convencion numerica de cada columna (punto o coma como decimal) */
  const conv = {
    qty: convencionColumna(grid, headerRow, mapping.qty),
    unit_weight: convencionColumna(grid, headerRow, mapping.unit_weight),
    total_weight: convencionColumna(grid, headerRow, mapping.total_weight)
  };

  const rows = [];
  const warnings = [];
  const vistos = new Map();
  const datosProyecto = { name: '', code: '', client: '', client_code: '' };

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    const marcaCruda = campo(row, 'mark');
    const mark = limpiarMarca(marcaCruda);
    if (!mark) continue;
    if (/^(total|totales|suma|subtotal|gran total)/i.test(mark)) continue;

    // datos del proyecto: se toma el primer valor que aparezca
    for (const clave of Object.keys(datosProyecto)) {
      if (!datosProyecto[clave] && proyecto[clave] != null) {
        datosProyecto[clave] = dato(row, proyecto[clave]);
      }
    }

    let qty = mapping.qty != null ? toNumber(row[mapping.qty], conv.qty) : 1;
    if (!qty || qty <= 0) qty = 1;

    let unit = mapping.unit_weight != null ? toNumber(row[mapping.unit_weight], conv.unit_weight) : 0;
    let total = mapping.total_weight != null ? toNumber(row[mapping.total_weight], conv.total_weight) : 0;

    if (columnaPesoGenerica && pesoEsTotal && !total) {
      total = unit;
      unit = qty ? total / qty : total;
    }
    if (!unit && total) unit = total / qty;
    if (!total && unit) total = unit * qty;

    const lot = campo(row, 'lot');
    const llave = (mark + '||' + lot).toLowerCase();
    if (vistos.has(llave)) {
      const previa = rows[vistos.get(llave)];
      previa.qty += qty;
      previa.total_weight += total;
      previa.unit_weight = previa.qty ? previa.total_weight / previa.qty : previa.unit_weight;
      continue;
    }
    vistos.set(llave, rows.length);

    let description = campo(row, 'description');
    // "UPPER HV CLAMP - 1ZXX461026C8242" junto a la marca "UPPER HV CLAMP"
    // se queda solo con la parte que aporta informacion nueva
    if (description && norm(description) === norm(mark)) description = '';

    rows.push({
      mark,
      drawing: limpiarMarca(campo(row, 'drawing')),
      description,
      profile: campo(row, 'profile'),
      material: campo(row, 'material'),
      qty: Math.round(qty * 100) / 100,
      unit_weight: Math.round(unit * 1000) / 1000,
      total_weight: Math.round(total * 1000) / 1000,
      lot,
      sort_order: rows.length
    });
  }

  if (!rows.length) return { ok: false, error: 'No se encontraron filas de piezas debajo del encabezado.', rows: [] };
  if (!rows.some((p) => p.total_weight > 0)) warnings.push('Ninguna pieza trae peso: revisa la columna de peso.');

  const conDibujo = rows.filter((p) => p.drawing).length;
  if (mapping.drawing != null && !conDibujo) warnings.push('La columna de dibujo llego vacia en todas las filas.');

  const totals = {
    piezas: rows.length,
    cantidad: rows.reduce((a, p) => a + p.qty, 0),
    peso: rows.reduce((a, p) => a + p.total_weight, 0),
    conDibujo
  };

  const usedColumns = Object.fromEntries(
    Object.entries(mapping).map(([f, i]) => [f, headers[i] || ('Columna ' + (i + 1))])
  );

  return {
    ok: true,
    rows,
    proyecto: datosProyecto,
    mapping: usedColumns,
    headers,
    warnings,
    totals,
    pesoAmbiguo: columnaPesoGenerica,
    pesoEsTotal
  };
}

module.exports = { parsePieces, parsePastedText };
