'use strict';

const express = require('express');
const QRCode = require('qrcode');
const { db, getStages, setStages, setSetting, getSetting, log, DEFAULT_STAGES } = require('../db');
const authLib = require('../auth');
const mailer = require('../mailer');
const { parsePieces, parsePastedText } = require('../importer');
const storage = require('../storage');
const {
  uniqueSlug, token, humanSize, fmtKg, fmtNum, fmtDate, parseViewerUrl, slugify
} = require('../utils');

const router = express.Router();
router.use(authLib.requireAdmin);

const uploadFields = storage.upload.fields([
  { name: 'documentos', maxCount: 500 },
  { name: 'piezas', maxCount: 1 },
  { name: 'soldadura', maxCount: 50 }
]);

function appUrl(req) {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  return base || req.protocol + '://' + req.get('host');
}

function projectLink(req, project) {
  return appUrl(req) + '/p/' + project.slug;
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Guarda o reemplaza el listado de piezas de un proyecto. */
function savePieces(projectId, rows, replace, userId) {
  const insert = db.prepare(`INSERT INTO pieces
    (project_id, mark, drawing, description, profile, material, qty, unit_weight, total_weight, lot, sort_order)
    VALUES (@project_id,@mark,@drawing,@description,@profile,@material,@qty,@unit_weight,@total_weight,@lot,@sort_order)
    ON CONFLICT(project_id, mark, lot) DO UPDATE SET
      drawing = excluded.drawing, description = excluded.description, profile = excluded.profile,
      material = excluded.material, qty = excluded.qty, unit_weight = excluded.unit_weight,
      total_weight = excluded.total_weight`);

  const run = db.transaction(() => {
    if (replace) db.prepare('DELETE FROM pieces WHERE project_id = ?').run(projectId);
    rows.forEach((r, i) => insert.run({
      project_id: projectId,
      mark: r.mark,
      drawing: r.drawing || '',
      description: r.description || '',
      profile: r.profile || '',
      material: r.material || '',
      qty: r.qty,
      unit_weight: r.unit_weight,
      total_weight: r.total_weight,
      lot: r.lot || '',
      sort_order: i
    }));
  });
  run();
  log(projectId, userId, 'piezas', rows.length + ' piezas importadas');
}

/**
 * Lee las piezas desde el archivo subido O desde el texto pegado en pantalla.
 * Devuelve el mismo formato en los dos casos.
 */
async function leerPiezas(archivo, texto, opciones) {
  if (archivo) return parsePieces(archivo.path, archivo.originalname, opciones);
  if (texto && String(texto).trim()) return parsePastedText(texto, opciones);
  return null;
}

/* ============================== TABLERO ============================== */

router.get('/', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM pieces WHERE project_id = p.id) AS n_piezas,
      (SELECT COUNT(*) FROM documents WHERE project_id = p.id) AS n_docs,
      (SELECT IFNULL(SUM(total_weight),0) FROM pieces WHERE project_id = p.id) AS peso
    FROM projects p ORDER BY (p.status='activo') DESC, p.updated_at DESC`).all();

  for (const p of projects) {
    const stages = getStages(p.id);
    const done = db.prepare('SELECT piece_id, stage FROM piece_checks WHERE project_id = ? AND checked = 1').all(p.id);
    const map = {};
    for (const d of done) (map[d.piece_id] = map[d.piece_id] || new Set()).add(d.stage);
    const ids = db.prepare('SELECT id FROM pieces WHERE project_id = ?').all(p.id).map((r) => r.id);
    const completas = ids.filter((id) => map[id] && stages.every((s) => map[id].has(s))).length;
    p.avance = ids.length ? Math.round((completas / ids.length) * 100) : 0;
    p.link = projectLink(req, p);
  }

  const stats = {
    proyectos: projects.length,
    activos: projects.filter((p) => p.status === 'activo').length,
    usuarios: db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'activo'").get().n,
    pendientes: db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'invitado'").get().n,
    peso: projects.reduce((a, p) => a + (p.peso || 0), 0),
    documentos: projects.reduce((a, p) => a + (p.n_docs || 0), 0)
  };

  const actividad = db.prepare(`SELECT a.*, u.name AS user_name, p.name AS project_name, p.slug
    FROM activity a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN projects p ON p.id = a.project_id
    ORDER BY a.id DESC LIMIT 12`).all();

  res.render('admin/dashboard', {
    title: 'Tablero', projects, stats, actividad, fmtKg, fmtNum, fmtDate
  });
});

/* =========================== NUEVO PROYECTO =========================== */

router.get('/nuevo', (req, res) => {
  res.render('admin/new-project', {
    title: 'Nuevo proyecto',
    error: null,
    form: {},
    maxMb: storage.MAX_MB,
    stagesDefault: DEFAULT_STAGES
  });
});

/**
 * Paso 1 del asistente: lee la lista de piezas (archivo o texto pegado) y
 * devuelve en JSON los datos del proyecto detectados y un resumen, para
 * mostrarlos en pantalla antes de crear nada.
 */
router.post('/nuevo/analizar', uploadFields, async (req, res) => {
  const archivo = (req.files && req.files.piezas || [])[0];
  const texto = req.body.piezas_texto;
  const opciones = { pesoEsTotal: req.body.peso_es_total === '1' };

  try {
    const leido = await leerPiezas(archivo, texto, opciones);
    if (!leido) {
      return res.status(400).json({ ok: false, error: 'Sube el archivo de piezas o pega la informacion.' });
    }
    if (!leido.ok) return res.status(400).json({ ok: false, error: leido.error });

    res.json({
      ok: true,
      proyecto: leido.proyecto,
      mapping: leido.mapping,
      totals: leido.totals,
      warnings: leido.warnings,
      pesoAmbiguo: leido.pesoAmbiguo,
      pesoEsTotal: leido.pesoEsTotal,
      muestra: leido.rows.slice(0, 8),
      columnasFaltantes: ['drawing', 'qty', 'unit_weight'].filter((c) => !leido.mapping[c])
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'No se pudo leer la lista: ' + e.message });
  } finally {
    if (archivo) storage.cleanTmp([archivo]);
  }
});

router.post('/nuevo', uploadFields, async (req, res) => {
  const b = req.body;
  const files = req.files || {};
  const cleanup = () => storage.cleanTmp(
    [].concat(files.documentos || [], files.piezas || [], files.soldadura || [])
  );

  const fail = (error) => {
    cleanup();
    res.status(400).render('admin/new-project', {
      title: 'Nuevo proyecto', error, form: b, maxMb: storage.MAX_MB, stagesDefault: DEFAULT_STAGES
    });
  };

  const name = String(b.name || '').trim();
  if (!name) return fail('El nombre del proyecto es obligatorio.');

  if (b.viewer_url && !parseViewerUrl(b.viewer_url)) {
    return fail('El link del visor Autodesk no parece una direccion valida (debe empezar con https://).');
  }

  // Listado de piezas: archivo subido o texto pegado
  let parsed = null;
  const piezasFile = (files.piezas || [])[0];
  parsed = await leerPiezas(piezasFile, b.piezas_texto, { pesoEsTotal: b.peso_es_total === '1' });
  if (parsed && !parsed.ok) return fail(parsed.error);

  const slug = uniqueSlug(db, b.slug ? slugify(b.slug) : name);
  const info = db.prepare(`INSERT INTO projects
    (slug, code, name, client, client_code, location, description, status, viewer_url, color,
     start_date, due_date, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    slug,
    String(b.code || '').trim(),
    name,
    String(b.client || '').trim(),
    String(b.client_code || '').trim(),
    String(b.location || '').trim(),
    String(b.description || '').trim(),
    b.status || 'activo',
    String(b.viewer_url || '').trim(),
    b.color || '#2f6fed',
    String(b.start_date || '').trim(),
    String(b.due_date || '').trim(),
    req.user.id
  );
  const projectId = info.lastInsertRowid;

  // Etapas del checklist
  const etapas = String(b.stages || '').split(',').map((s) => s.trim()).filter(Boolean);
  setStages(projectId, etapas.length ? etapas : DEFAULT_STAGES);

  // Piezas
  if (parsed && parsed.ok) savePieces(projectId, parsed.rows, true, req.user.id);

  // Documentos (carpeta) y especificaciones de soldadura
  const relpaths = asArray(b.relpath);
  storage.saveDocuments(projectId, files.documentos || [], relpaths, req.user.id, 'auto');
  storage.saveDocuments(projectId, files.soldadura || [], [], req.user.id, 'soldadura');

  const vinculos = storage.relinkProject(projectId);
  log(projectId, req.user.id, 'proyecto', 'Proyecto creado: ' + name);

  req.session.flash = {
    tipo: 'exito',
    texto: 'Proyecto creado. Se vincularon ' + vinculos + ' referencias entre planos y piezas.'
  };
  res.redirect('/admin/proyecto/' + projectId + '?nuevo=1');
});

/* ========================= DETALLE DEL PROYECTO ========================= */

function loadProject(id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
}

router.get('/proyecto/:id', (req, res) => {
  const project = loadProject(req.params.id);
  if (!project) return res.status(404).render('error', { title: 'No encontrado', code: 404, message: 'Proyecto no encontrado.' });

  const pieces = db.prepare('SELECT * FROM pieces WHERE project_id = ? ORDER BY lot, sort_order, id').all(project.id);
  const docs = db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY category, rel_folder, original_name').all(project.id);
  const linkCounts = db.prepare(`SELECT dp.document_id, COUNT(*) AS n FROM document_pieces dp
    JOIN documents d ON d.id = dp.document_id WHERE d.project_id = ? GROUP BY dp.document_id`).all(project.id);
  const countMap = Object.fromEntries(linkCounts.map((r) => [r.document_id, r.n]));
  for (const d of docs) d.n_piezas = countMap[d.id] || 0;

  const pieceLinks = db.prepare(`SELECT dp.piece_id, COUNT(*) AS n FROM document_pieces dp
    JOIN documents d ON d.id = dp.document_id WHERE d.project_id = ? GROUP BY dp.piece_id`).all(project.id);
  const pieceMap = Object.fromEntries(pieceLinks.map((r) => [r.piece_id, r.n]));
  for (const p of pieces) p.n_docs = pieceMap[p.id] || 0;

  const actividad = db.prepare(`SELECT a.*, u.name AS user_name FROM activity a
    LEFT JOIN users u ON u.id = a.user_id WHERE a.project_id = ? ORDER BY a.id DESC LIMIT 25`).all(project.id);

  const stages = getStages(project.id);
  const checks = db.prepare('SELECT piece_id, stage FROM piece_checks WHERE project_id = ? AND checked = 1').all(project.id);
  const cmap = {};
  for (const c of checks) (cmap[c.piece_id] = cmap[c.piece_id] || new Set()).add(c.stage);
  const completas = pieces.filter((p) => cmap[p.id] && stages.every((s) => cmap[p.id].has(s))).length;

  res.render('admin/project', {
    title: project.name,
    project,
    pieces,
    docs,
    stages,
    actividad,
    link: projectLink(req, project),
    viewer: parseViewerUrl(project.viewer_url),
    sinVinculo: docs.filter((d) => d.category === 'plano' && !d.n_piezas).length,
    stats: {
      peso: pieces.reduce((a, p) => a + p.total_weight, 0),
      piezas: pieces.reduce((a, p) => a + p.qty, 0),
      renglones: pieces.length,
      completas,
      avance: pieces.length ? Math.round((completas / pieces.length) * 100) : 0,
      docs: docs.length
    },
    nuevo: req.query.nuevo === '1',
    maxMb: storage.MAX_MB,
    humanSize, fmtKg, fmtNum, fmtDate
  });
});

router.post('/proyecto/:id/editar', (req, res) => {
  const project = loadProject(req.params.id);
  if (!project) return res.status(404).send('No encontrado');
  const b = req.body;

  let slug = project.slug;
  if (b.slug && slugify(b.slug) !== project.slug) {
    slug = uniqueSlug(db, slugify(b.slug));
  }

  db.prepare(`UPDATE projects SET code=?, name=?, client=?, client_code=?, location=?, description=?,
      status=?, viewer_url=?, color=?, start_date=?, due_date=?, slug=?, updated_at=datetime('now')
      WHERE id=?`)
    .run(
      String(b.code || '').trim(), String(b.name || project.name).trim(), String(b.client || '').trim(),
      String(b.client_code || '').trim(), String(b.location || '').trim(), String(b.description || '').trim(),
      b.status || 'activo', String(b.viewer_url || '').trim(), b.color || project.color,
      String(b.start_date || '').trim(), String(b.due_date || '').trim(), slug, project.id
    );

  log(project.id, req.user.id, 'proyecto', 'Datos del proyecto actualizados');
  req.session.flash = { tipo: 'exito', texto: 'Los cambios se guardaron.' };
  res.redirect('/admin/proyecto/' + project.id);
});

router.post('/proyecto/:id/etapas', (req, res) => {
  const project = loadProject(req.params.id);
  if (!project) return res.status(404).send('No encontrado');
  const etapas = String(req.body.stages || '').split(',').map((s) => s.trim()).filter(Boolean);
  setStages(project.id, etapas.length ? etapas : DEFAULT_STAGES);
  log(project.id, req.user.id, 'checklist', 'Etapas del checklist: ' + (etapas.join(' / ') || 'Fabricado'));
  req.session.flash = { tipo: 'exito', texto: 'Se actualizaron las etapas del checklist.' };
  res.redirect('/admin/proyecto/' + project.id + '#checklist');
});

router.post('/proyecto/:id/documentos', uploadFields, (req, res) => {
  const project = loadProject(req.params.id);
  if (!project) return res.status(404).send('No encontrado');
  const files = req.files || {};
  const categoria = req.body.categoria || 'auto';

  storage.saveDocuments(project.id, files.documentos || [], asArray(req.body.relpath), req.user.id, categoria);
  storage.saveDocuments(project.id, files.soldadura || [], [], req.user.id, 'soldadura');
  const n = (files.documentos || []).length + (files.soldadura || []).length;
  const vinculos = storage.relinkProject(project.id);
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(project.id);

  req.session.flash = {
    tipo: 'exito',
    texto: n + ' archivo(s) agregados. ' + vinculos + ' referencias plano-pieza vinculadas.'
  };
  res.redirect('/admin/proyecto/' + project.id + '#documentos');
});

router.post('/proyecto/:id/piezas', uploadFields, async (req, res) => {
  const project = loadProject(req.params.id);
  if (!project) return res.status(404).send('No encontrado');
  const file = (req.files && req.files.piezas || [])[0];
  const parsed = await leerPiezas(file, req.body.piezas_texto, { pesoEsTotal: req.body.peso_es_total === '1' });
  storage.cleanTmp(file ? [file] : []);

  if (!parsed) {
    req.session.flash = { tipo: 'error', texto: 'Sube el archivo de piezas (Excel o CSV) o pega la informacion.' };
    return res.redirect('/admin/proyecto/' + project.id + '#piezas');
  }

  if (!parsed.ok) {
    req.session.flash = { tipo: 'error', texto: parsed.error };
    return res.redirect('/admin/proyecto/' + project.id + '#piezas');
  }
  const replace = req.body.modo !== 'agregar';
  savePieces(project.id, parsed.rows, replace, req.user.id);
  const vinculos = storage.relinkProject(project.id);
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(project.id);

  req.session.flash = {
    tipo: 'exito',
    texto: parsed.rows.length + ' piezas importadas (' + fmtKg(parsed.totals.peso) + ' kg). ' +
      vinculos + ' referencias plano-pieza vinculadas.'
  };
  res.redirect('/admin/proyecto/' + project.id + '#piezas');
});

router.post('/proyecto/:id/revincular', (req, res) => {
  const project = loadProject(req.params.id);
  if (!project) return res.status(404).send('No encontrado');
  const n = storage.relinkProject(project.id);
  req.session.flash = { tipo: 'exito', texto: 'Se revincularon ' + n + ' referencias entre planos y piezas.' };
  res.redirect('/admin/proyecto/' + project.id + '#documentos');
});

router.post('/proyecto/:id/eliminar', (req, res) => {
  const project = loadProject(req.params.id);
  if (!project) return res.status(404).send('No encontrado');
  if (String(req.body.confirmacion || '').trim().toLowerCase() !== project.slug) {
    req.session.flash = { tipo: 'error', texto: 'Para eliminar escribe exactamente: ' + project.slug };
    return res.redirect('/admin/proyecto/' + project.id + '#peligro');
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  storage.deleteProjectFiles(project.id);
  req.session.flash = { tipo: 'exito', texto: 'Proyecto eliminado.' };
  res.redirect('/admin');
});

router.post('/documento/:id/eliminar', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).send('No encontrado');
  storage.deleteDocument(doc.id);
  req.session.flash = { tipo: 'exito', texto: 'Archivo eliminado.' };
  res.redirect('/admin/proyecto/' + doc.project_id + '#documentos');
});

router.post('/documento/:id/categoria', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ ok: false });
  const cat = ['plano', 'soldadura', 'modelo', 'general'].includes(req.body.categoria) ? req.body.categoria : 'general';
  db.prepare('UPDATE documents SET category = ? WHERE id = ?').run(cat, doc.id);
  storage.relinkProject(doc.project_id);
  res.json({ ok: true, categoria: cat });
});

router.post('/pieza/:id/eliminar', (req, res) => {
  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(req.params.id));
  if (!piece) return res.status(404).send('No encontrada');
  db.prepare('DELETE FROM pieces WHERE id = ?').run(piece.id);
  req.session.flash = { tipo: 'exito', texto: 'Pieza eliminada.' };
  res.redirect('/admin/proyecto/' + piece.project_id + '#piezas');
});

/* ------------------------------ QR / NFC ------------------------------ */

router.get('/proyecto/:id/qr.png', async (req, res) => {
  const project = loadProject(req.params.id);
  if (!project) return res.status(404).send('No encontrado');
  const buf = await QRCode.toBuffer(projectLink(req, project), {
    width: 640, margin: 1, color: { dark: '#12213f', light: '#ffffff' }
  });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', 'inline; filename="qr-' + project.slug + '.png"');
  res.send(buf);
});

router.get('/enlaces', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY (status=\'activo\') DESC, name').all();
  for (const p of projects) p.link = projectLink(req, p);
  res.render('admin/links', { title: 'Enlaces NFC', projects, fmtDate });
});

/* ============================== USUARIOS ============================== */

router.get('/usuarios', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY (role=\'admin\') DESC, name').all();
  res.render('admin/users', {
    title: 'Usuarios',
    users,
    smtp: mailer.isConfigured(),
    invite: req.session.inviteLink || null,
    fmtDate
  });
  req.session.inviteLink = null;
});

router.post('/usuarios/invitar', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const position = String(req.body.position || '').trim();

  if (!authLib.validEmail(email) || !name) {
    req.session.flash = { tipo: 'error', texto: 'Escribe el nombre y un correo valido.' };
    return res.redirect('/admin/usuarios');
  }
  if (authLib.findByEmail(email)) {
    req.session.flash = { tipo: 'error', texto: 'Ese correo ya esta registrado.' };
    return res.redirect('/admin/usuarios');
  }

  const t = token(24);
  const info = db.prepare(`INSERT INTO users (email, name, role, status, position, invite_token, invite_expires, created_by)
    VALUES (?,?,?,'invitado',?,?,?,?)`)
    .run(email, name, role, position, t, Date.now() + 7 * 24 * 60 * 60 * 1000, req.user.id);

  const link = appUrl(req) + '/registro?token=' + t;
  const user = { id: info.lastInsertRowid, email, name };

  let enviado = false;
  let errorCorreo = null;
  try {
    const r = await mailer.sendInvite(user, link, req.user.name);
    enviado = !!r.sent;
  } catch (e) {
    errorCorreo = e.message;
  }

  req.session.inviteLink = { name, email, link, enviado };
  req.session.flash = enviado
    ? { tipo: 'exito', texto: 'Invitacion enviada a ' + email + '.' }
    : {
      tipo: 'aviso',
      texto: 'Usuario creado. ' + (errorCorreo ? 'No se pudo enviar el correo (' + errorCorreo + '). ' : 'El correo no esta configurado. ') +
        'Copia el enlace de invitacion y mandaselo por WhatsApp.'
    };
  res.redirect('/admin/usuarios');
});

router.post('/usuarios/:id/reenviar', async (req, res) => {
  const user = authLib.findById(Number(req.params.id));
  if (!user) return res.status(404).send('No encontrado');
  const t = token(24);
  db.prepare('UPDATE users SET invite_token = ?, invite_expires = ?, status = ? WHERE id = ?')
    .run(t, Date.now() + 7 * 24 * 60 * 60 * 1000, user.status === 'activo' ? 'activo' : 'invitado', user.id);
  const link = appUrl(req) + '/registro?token=' + t;

  let enviado = false;
  try {
    const r = await mailer.sendInvite(user, link, req.user.name);
    enviado = !!r.sent;
  } catch (_) { enviado = false; }

  req.session.inviteLink = { name: user.name, email: user.email, link, enviado };
  req.session.flash = enviado
    ? { tipo: 'exito', texto: 'Invitacion reenviada a ' + user.email + '.' }
    : { tipo: 'aviso', texto: 'Enlace generado. Copialo y mandaselo al usuario.' };
  res.redirect('/admin/usuarios');
});

router.post('/usuarios/:id/estado', (req, res) => {
  const user = authLib.findById(Number(req.params.id));
  if (!user) return res.status(404).send('No encontrado');
  if (user.id === req.user.id) {
    req.session.flash = { tipo: 'error', texto: 'No puedes desactivar tu propia cuenta.' };
    return res.redirect('/admin/usuarios');
  }
  const nuevo = user.status === 'activo' ? 'inactivo' : 'activo';
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(nuevo, user.id);
  req.session.flash = { tipo: 'exito', texto: user.name + ' ahora esta ' + nuevo + '.' };
  res.redirect('/admin/usuarios');
});

router.post('/usuarios/:id/rol', (req, res) => {
  const user = authLib.findById(Number(req.params.id));
  if (!user) return res.status(404).send('No encontrado');
  if (user.id === req.user.id) {
    req.session.flash = { tipo: 'error', texto: 'No puedes cambiar tu propio rol.' };
    return res.redirect('/admin/usuarios');
  }
  const nuevo = user.role === 'admin' ? 'user' : 'admin';
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(nuevo, user.id);
  req.session.flash = { tipo: 'exito', texto: user.name + ' ahora es ' + (nuevo === 'admin' ? 'administrador' : 'usuario') + '.' };
  res.redirect('/admin/usuarios');
});

router.post('/usuarios/:id/eliminar', (req, res) => {
  const user = authLib.findById(Number(req.params.id));
  if (!user) return res.status(404).send('No encontrado');
  if (user.id === req.user.id) {
    req.session.flash = { tipo: 'error', texto: 'No puedes eliminar tu propia cuenta.' };
    return res.redirect('/admin/usuarios');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  req.session.flash = { tipo: 'exito', texto: 'Usuario eliminado.' };
  res.redirect('/admin/usuarios');
});

/* ============================== AJUSTES ============================== */

router.get('/ajustes', async (req, res) => {
  res.render('admin/settings', {
    title: 'Ajustes',
    smtp: mailer.isConfigured(),
    appUrl: appUrl(req),
    maxMb: storage.MAX_MB,
    prueba: req.session.pruebaCorreo || null,
    marca: getSetting('marca', '')
  });
  req.session.pruebaCorreo = null;
});

router.post('/ajustes/probar-correo', async (req, res) => {
  const r = await mailer.verify();
  req.session.pruebaCorreo = r;
  res.redirect('/admin/ajustes');
});

router.post('/ajustes/marca', (req, res) => {
  setSetting('marca', String(req.body.marca || '').trim());
  req.session.flash = { tipo: 'exito', texto: 'Ajustes guardados.' };
  res.redirect('/admin/ajustes');
});

module.exports = router;
