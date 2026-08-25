'use strict';

const crypto = require('crypto');

/* --------------------------- textos y slugs --------------------------- */

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function slugify(text) {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'proyecto';
}

function uniqueSlug(db, base) {
  const root = slugify(base);
  let slug = root;
  let i = 2;
  const stmt = db.prepare('SELECT 1 FROM projects WHERE slug = ?');
  while (stmt.get(slug)) slug = root + '-' + (i++);
  return slug;
}

function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/* ------------------- relacion plano <-> marca de pieza ------------------- */

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * Construye la expresion regular que localiza una marca de pieza dentro del
 * nombre de un plano.  "V-101" encuentra  V-101 / V101 / v_101 / V 101
 * pero NO encuentra V1010 ni BV101.
 */
function markRegex(mark) {
  const tokens = stripAccents(mark).toUpperCase().match(/[A-Z0-9]+/g);
  if (!tokens || !tokens.length) return null;
  const body = tokens.map((t) => t.replace(RE_SPECIAL, '\\$&')).join('[\\s._-]*');
  return new RegExp('(^|[^A-Z0-9])' + body + '(?![0-9])', 'i');
}

/** Devuelve true si el nombre del archivo hace referencia a la marca dada. */
function fileMatchesMark(fileName, mark) {
  const re = markRegex(mark);
  if (!re) return false;
  return re.test(stripAccents(fileName).toUpperCase());
}

/* ----------------------------- archivos ----------------------------- */

const PLAN_EXT = ['.pdf', '.dxf', '.dwg', '.dwf', '.png', '.jpg', '.jpeg', '.step', '.stp', '.nc1', '.nc'];
const MODEL_EXT = ['.ifc', '.rvt', '.nwd', '.nwc', '.sat', '.3dm'];

function extOf(name) {
  const m = String(name).toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

function guessCategory(fileName, relFolder = '') {
  const hay = stripAccents(relFolder + ' ' + fileName).toLowerCase();
  if (/soldad|weld|wps|pqr|wpq/.test(hay)) return 'soldadura';
  const e = extOf(fileName);
  if (MODEL_EXT.includes(e)) return 'modelo';
  if (PLAN_EXT.includes(e)) return 'plano';
  return 'general';
}

function safeName(name) {
  return stripAccents(name).replace(/[^A-Za-z0-9._\- ]+/g, '_').slice(0, 180) || 'archivo';
}

function humanSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

function fmtKg(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '';
  const s = String(iso);
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/* --------------------------- Autodesk Viewer --------------------------- */

/**
 * Acepta el link que ingenieria copia de Autodesk (ACC / BIM 360 / Autodesk
 * Viewer / A360 share) y lo prepara para mostrarse dentro de la pagina.
 * Si el dominio no permite incrustarse, embeddable = false y la interfaz
 * muestra un boton grande que abre el modelo en una pestana nueva.
 */
function parseViewerUrl(raw) {
  const url = String(raw || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (_) {
    return null;
  }

  const embeddableHosts = ['autodesk360.com', 'a360.co', 'autodesk.com', 'sketchfab.com'];
  const embeddable = embeddableHosts.some((h) => host === h || host.endsWith('.' + h));

  let embedUrl = url;
  if (embeddable && /autodesk360\.com|a360\.co/.test(host) && !/mode=embed/.test(url)) {
    embedUrl += (url.includes('?') ? '&' : '?') + 'mode=embed';
  }
  return { url, embedUrl, embeddable, host };
}

module.exports = {
  stripAccents, slugify, uniqueSlug, token,
  markRegex, fileMatchesMark,
  PLAN_EXT, MODEL_EXT, extOf, guessCategory, safeName,
  humanSize, fmtKg, fmtNum, fmtDate, parseViewerUrl
};
