'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, getStages, log } = require('../db');
const auth = require('../auth');
const { docPath } = require('../storage');
const { parseViewerUrl, humanSize, fmtKg, fmtNum, fmtDate } = require('../utils');

const router = express.Router();

const INLINE_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function getProject(slug) {
  return db.prepare('SELECT * FROM projects WHERE slug = ?').get(String(slug || ''));
}

/** Arma todos los datos que necesita la vista del proyecto. */
function buildProjectView(project) {
  const stages = getStages(project.id);

  const pieces = db.prepare(
    'SELECT * FROM pieces WHERE project_id = ? ORDER BY lot, sort_order, id'
  ).all(project.id);

  const checks = db.prepare(
    'SELECT pc.piece_id, pc.stage, pc.checked, pc.updated_at, u.name AS user_name ' +
    'FROM piece_checks pc LEFT JOIN users u ON u.id = pc.user_id WHERE pc.project_id = ?'
  ).all(project.id);

  const checkMap = {};
  for (const c of checks) {
    if (!c.checked) continue;
    (checkMap[c.piece_id] = checkMap[c.piece_id] || {})[c.stage] = {
      at: c.updated_at, by: c.user_name || ''
    };
  }

  const docs = db.prepare(
    'SELECT * FROM documents WHERE project_id = ? ORDER BY category, rel_folder, original_name'
  ).all(project.id);

  const links = db.prepare(
    'SELECT dp.piece_id, dp.document_id FROM document_pieces dp ' +
    'JOIN documents d ON d.id = dp.document_id WHERE d.project_id = ?'
  ).all(project.id);

  const docsById = {};
  for (const d of docs) docsById[d.id] = d;
  const docsByPiece = {};
  for (const l of links) {
    (docsByPiece[l.piece_id] = docsByPiece[l.piece_id] || []).push(docsById[l.document_id]);
  }

  const lots = [];
  for (const p of pieces) {
    const key = p.lot || '';
    let lot = lots.find((l) => l.name === key);
    if (!lot) { lot = { name: key, pieces: [], weight: 0, qty: 0, done: 0 }; lots.push(lot); }
    lot.pieces.push(p);
    lot.weight += p.total_weight;
    lot.qty += p.qty;
    const done = checkMap[p.id] && stages.every((s) => checkMap[p.id][s]);
    if (done) lot.done++;
  }

  const totalPeso = pieces.reduce((a, p) => a + p.total_weight, 0);
  const totalPiezas = pieces.reduce((a, p) => a + p.qty, 0);
  const completas = pieces.filter((p) => checkMap[p.id] && stages.every((s) => checkMap[p.id][s])).length;
  const pesoCompleto = pieces
    .filter((p) => checkMap[p.id] && stages.every((s) => checkMap[p.id][s]))
    .reduce((a, p) => a + p.total_weight, 0);

  const stageProgress = stages.map((s) => ({
    name: s,
    done: pieces.filter((p) => checkMap[p.id] && checkMap[p.id][s]).length,
    total: pieces.length
  }));

  return {
    stages,
    pieces,
    lots,
    checkMap,
    docsByPiece,
    planos: docs.filter((d) => d.category === 'plano'),
    soldadura: docs.filter((d) => d.category === 'soldadura'),
    modelos: docs.filter((d) => d.category === 'modelo'),
    generales: docs.filter((d) => d.category === 'general'),
    docs,
    viewer: parseViewerUrl(project.viewer_url),
    stats: {
      totalPeso,
      totalPiezas,
      renglones: pieces.length,
      completas,
      pesoCompleto,
      avance: pieces.length ? Math.round((completas / pieces.length) * 100) : 0,
      avancePeso: totalPeso ? Math.round((pesoCompleto / totalPeso) * 100) : 0,
      documentos: docs.length
    },
    stageProgress
  };
}

/* ------------------------- LISTA DE PROYECTOS ------------------------- */

router.get('/proyectos', auth.requireLogin, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM pieces  WHERE project_id = p.id) AS n_piezas,
      (SELECT COUNT(*) FROM documents WHERE project_id = p.id) AS n_docs,
      (SELECT IFNULL(SUM(total_weight),0) FROM pieces WHERE project_id = p.id) AS peso
    FROM projects p
    WHERE p.status != 'terminado' OR ? = 1
    ORDER BY (p.status = 'activo') DESC, p.updated_at DESC
  `).all(req.user.role === 'admin' ? 1 : 0);

  res.render('projects', { title: 'Proyectos', projects, fmtKg, fmtNum, fmtDate });
});

/* --------------------- PAGINA DEL PROYECTO (NFC) --------------------- */

router.get('/p/:slug', auth.requireLogin, (req, res) => {
  const project = getProject(req.params.slug);
  if (!project) {
    return res.status(404).render('error', {
      title: 'Proyecto no encontrado', code: 404,
      message: 'El enlace de esta etiqueta NFC no corresponde a ningun proyecto activo.'
    });
  }
  const view = buildProjectView(project);
  log(project.id, req.user.id, 'consulta', 'Abrio el proyecto');
  res.render('project', {
    title: project.name,
    project,
    ...view,
    humanSize, fmtKg, fmtNum, fmtDate
  });
});

/* ----------------------- CHECKLIST (guardado) ----------------------- */

router.post('/api/check', auth.requireLogin, express.json(), (req, res) => {
  const pieceId = Number(req.body.piece_id);
  const stage = String(req.body.stage || 'Fabricado');
  const checked = req.body.checked ? 1 : 0;

  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId);
  if (!piece) return res.status(404).json({ ok: false, error: 'Pieza no encontrada' });

  const stages = getStages(piece.project_id);
  if (!stages.includes(stage)) return res.status(400).json({ ok: false, error: 'Etapa no valida' });

  db.prepare(`INSERT INTO piece_checks (piece_id, project_id, stage, checked, user_id, updated_at)
    VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(piece_id, stage) DO UPDATE SET
      checked = excluded.checked, user_id = excluded.user_id, updated_at = excluded.updated_at`)
    .run(pieceId, piece.project_id, stage, checked, req.user.id);

  const pieces = db.prepare('SELECT id, total_weight FROM pieces WHERE project_id = ?').all(piece.project_id);
  const done = db.prepare(
    'SELECT piece_id, stage FROM piece_checks WHERE project_id = ? AND checked = 1'
  ).all(piece.project_id);
  const map = {};
  for (const d of done) (map[d.piece_id] = map[d.piece_id] || new Set()).add(d.stage);

  const completas = pieces.filter((p) => map[p.id] && stages.every((s) => map[p.id].has(s)));
  const totalPeso = pieces.reduce((a, p) => a + p.total_weight, 0);
  const pesoCompleto = completas.reduce((a, p) => a + p.total_weight, 0);

  res.json({
    ok: true,
    checked: !!checked,
    by: req.user.name,
    at: new Date().toISOString(),
    stats: {
      completas: completas.length,
      renglones: pieces.length,
      avance: pieces.length ? Math.round((completas.length / pieces.length) * 100) : 0,
      avancePeso: totalPeso ? Math.round((pesoCompleto / totalPeso) * 100) : 0,
      pesoCompleto: fmtKg(pesoCompleto)
    }
  });
});

/* --------------------- DETALLE DE UNA PIEZA (panel) --------------------- */

router.get('/api/pieza/:id', auth.requireLogin, (req, res) => {
  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(req.params.id));
  if (!piece) return res.status(404).json({ ok: false });
  const docs = db.prepare(`SELECT d.id, d.original_name, d.ext, d.size, d.category, d.rel_folder
    FROM documents d JOIN document_pieces dp ON dp.document_id = d.id
    WHERE dp.piece_id = ? ORDER BY d.category, d.original_name`).all(piece.id);
  const checks = db.prepare(`SELECT pc.stage, pc.checked, pc.updated_at, u.name AS user_name
    FROM piece_checks pc LEFT JOIN users u ON u.id = pc.user_id WHERE pc.piece_id = ?`).all(piece.id);
  res.json({
    ok: true,
    piece,
    stages: getStages(piece.project_id),
    checks,
    docs: docs.map((d) => ({ ...d, size_h: humanSize(d.size) }))
  });
});

/* --------------------------- ARCHIVOS --------------------------- */

router.get('/archivo/:id', auth.requireLogin, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).send('Archivo no encontrado');
  const full = docPath(doc.project_id, doc.stored_name);
  if (!fs.existsSync(full)) return res.status(404).send('El archivo ya no esta disponible');

  const ext = String(doc.ext || '').toLowerCase();
  const mime = INLINE_TYPES[ext];
  const download = req.query.descargar === '1' || !mime;
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    (download ? 'attachment' : 'inline') + '; filename="' + encodeURIComponent(doc.original_name) + '"'
  );
  fs.createReadStream(full).pipe(res);
});

/* --------------------- VISOR DE PLANOS (pantalla) --------------------- */

router.get('/ver/:id', auth.requireLogin, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).render('error', { title: 'No encontrado', code: 404, message: 'Archivo no encontrado.' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(doc.project_id);
  const ext = String(doc.ext || '').toLowerCase();
  res.render('viewer', {
    title: doc.original_name,
    doc,
    project,
    esPdf: ext === '.pdf',
    esImagen: ['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext),
    humanSize
  });
});

/* ------------------------ EXPORTAR AVANCE (CSV) ------------------------ */

router.get('/p/:slug/avance.csv', auth.requireLogin, (req, res) => {
  const project = getProject(req.params.slug);
  if (!project) return res.status(404).send('Proyecto no encontrado');
  const stages = getStages(project.id);
  const pieces = db.prepare('SELECT * FROM pieces WHERE project_id = ? ORDER BY lot, sort_order, id').all(project.id);
  const checks = db.prepare(`SELECT pc.piece_id, pc.stage, pc.checked, pc.updated_at, u.name AS user_name
    FROM piece_checks pc LEFT JOIN users u ON u.id = pc.user_id WHERE pc.project_id = ? AND pc.checked = 1`).all(project.id);
  const map = {};
  for (const c of checks) (map[c.piece_id] = map[c.piece_id] || {})[c.stage] = c;

  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['Marca', 'Descripcion', 'Perfil', 'Material', 'Cantidad', 'Peso unitario (kg)', 'Peso total (kg)', 'Lote']
    .concat(stages).concat(['Ultima actualizacion', 'Registro por']);
  const lines = [head.map(esc).join(',')];

  for (const p of pieces) {
    const marks = stages.map((s) => (map[p.id] && map[p.id][s] ? 'SI' : ''));
    const last = stages.map((s) => map[p.id] && map[p.id][s]).filter(Boolean)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    lines.push([p.mark, p.description, p.profile, p.material, p.qty, p.unit_weight, p.total_weight, p.lot]
      .concat(marks)
      .concat([last ? last.updated_at : '', last ? last.user_name || '' : ''])
      .map(esc).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="avance-' + project.slug + '.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

module.exports = { router, buildProjectView, getProject };
