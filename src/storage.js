'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db, log } = require('./db');
const { safeName, extOf, guessCategory, fileMatchesMark, token } = require('./utils');

const ROOT = path.join(__dirname, '..', 'storage');
const PROJECTS_DIR = path.join(ROOT, 'projects');
const TMP_DIR = path.join(ROOT, 'tmp');

for (const dir of [ROOT, PROJECTS_DIR, TMP_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function projectDir(projectId) {
  const dir = path.join(PROJECTS_DIR, String(projectId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function docPath(projectId, storedName) {
  return path.join(projectDir(projectId), storedName);
}

const MAX_MB = Number(process.env.MAX_FILE_MB || 200);

/** Todos los archivos llegan primero a una carpeta temporal. */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, token(8) + '-' + safeName(file.originalname))
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 600 }
});

/* ------------------------------------------------------------------ *
 *  Vincula automaticamente cada documento con las piezas cuya marca
 *  aparece en el nombre del archivo (o de su carpeta).
 * ------------------------------------------------------------------ */
function relinkProject(projectId) {
  const pieces = db.prepare('SELECT id, mark FROM pieces WHERE project_id = ?').all(projectId);
  const docs = db.prepare(
    "SELECT id, original_name, rel_folder FROM documents WHERE project_id = ? AND category IN ('plano','general','modelo')"
  ).all(projectId);

  const clear = db.prepare(
    'DELETE FROM document_pieces WHERE document_id IN (SELECT id FROM documents WHERE project_id = ?)'
  );
  const insert = db.prepare('INSERT OR IGNORE INTO document_pieces (document_id, piece_id) VALUES (?,?)');

  const run = db.transaction(() => {
    clear.run(projectId);
    for (const doc of docs) {
      const hay = (doc.rel_folder ? doc.rel_folder + '/' : '') + doc.original_name;
      for (const piece of pieces) {
        if (fileMatchesMark(hay, piece.mark)) insert.run(doc.id, piece.id);
      }
    }
  });
  run();

  return db.prepare(
    'SELECT COUNT(*) AS n FROM document_pieces dp JOIN documents d ON d.id = dp.document_id WHERE d.project_id = ?'
  ).get(projectId).n;
}

/**
 * Mueve los archivos temporales a la carpeta del proyecto y los registra.
 * relPaths es un arreglo paralelo con la ruta relativa dentro de la carpeta
 * que el administrador selecciono (viene del navegador).
 */
function saveDocuments(projectId, files, relPaths, userId, categoryOverride) {
  if (!files || !files.length) return { count: 0, ids: [] };
  const dir = projectDir(projectId);
  const insert = db.prepare(`INSERT INTO documents
    (project_id, category, original_name, stored_name, rel_folder, ext, size, uploaded_by)
    VALUES (?,?,?,?,?,?,?,?)`);

  const ids = [];
  const registrar = db.transaction((lista) => lista.forEach((file, i) => {
    const rel = String((relPaths && relPaths[i]) || '');
    const relFolder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const original = file.originalname;
    const stored = path.basename(file.path);
    try {
      fs.renameSync(file.path, path.join(dir, stored));
    } catch (_) {
      fs.copyFileSync(file.path, path.join(dir, stored));
      try { fs.unlinkSync(file.path); } catch (_e) { /* ignorar */ }
    }
    const category = categoryOverride && categoryOverride !== 'auto'
      ? categoryOverride
      : guessCategory(original, relFolder);
    const info = insert.run(projectId, category, original, stored, relFolder,
      extOf(original), file.size || 0, userId || null);
    ids.push(info.lastInsertRowid);
  }));
  registrar(files);

  log(projectId, userId, 'documentos', files.length + ' archivo(s) subidos');
  return { count: files.length, ids };
}

function deleteDocument(docId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc) return false;
  try { fs.unlinkSync(docPath(doc.project_id, doc.stored_name)); } catch (_) { /* ya no existe */ }
  db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
  return true;
}

function deleteProjectFiles(projectId) {
  const dir = path.join(PROJECTS_DIR, String(projectId));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignorar */ }
}

function cleanTmp(files) {
  for (const f of files || []) {
    try { if (f && f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) { /* ignorar */ }
  }
}

module.exports = {
  upload, TMP_DIR, projectDir, docPath, saveDocuments, relinkProject,
  deleteDocument, deleteProjectFiles, cleanTmp, MAX_MB
};
