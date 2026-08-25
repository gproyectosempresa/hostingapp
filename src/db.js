'use strict';

/* =========================================================================
 *  Base de datos SQLite en WebAssembly (sql.js).
 *
 *  Se usa sql.js en lugar de un modulo nativo para que la plataforma se
 *  instale en CUALQUIER hosting y con cualquier version de Node (18, 20, 22...)
 *  sin necesidad de compilador, Python ni node-gyp.
 *
 *  El archivo data/plataforma.db es un SQLite normal y corriente: se puede
 *  abrir con DB Browser for SQLite, respaldar y mover a otro servidor.
 * ========================================================================= */

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'plataforma.db');
const WASM_DIR = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',        -- 'admin' | 'user'
  password_hash TEXT,
  status        TEXT NOT NULL DEFAULT 'invitado',    -- 'invitado' | 'activo' | 'inactivo'
  phone         TEXT,
  position      TEXT,
  invite_token  TEXT,
  invite_expires INTEGER,
  last_login    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  code          TEXT,
  name          TEXT NOT NULL,
  client        TEXT,
  location      TEXT,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'activo',      -- 'activo' | 'pausado' | 'terminado'
  viewer_url    TEXT,
  color         TEXT NOT NULL DEFAULT '#2f6fed',
  start_date    TEXT,
  due_date      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pieces (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mark          TEXT NOT NULL,
  description   TEXT,
  profile       TEXT,
  material      TEXT,
  qty           REAL NOT NULL DEFAULT 1,
  unit_weight   REAL NOT NULL DEFAULT 0,
  total_weight  REAL NOT NULL DEFAULT 0,
  lot           TEXT,
  notes         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pieces_project ON pieces(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pieces_unique ON pieces(project_id, mark, lot);

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category      TEXT NOT NULL DEFAULT 'plano',       -- 'plano' | 'soldadura' | 'modelo' | 'general'
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  rel_folder    TEXT,
  ext           TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

CREATE TABLE IF NOT EXISTS document_pieces (
  document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  piece_id      INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, piece_id)
);

CREATE TABLE IF NOT EXISTS piece_checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id      INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL DEFAULT 'Fabricado',
  checked       INTEGER NOT NULL DEFAULT 0,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_check_unique ON piece_checks(piece_id, stage);

CREATE TABLE IF NOT EXISTS project_users (
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS activity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, id DESC);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT
);
`;

/* ------------------------------------------------------------------ *
 *  Adaptador con la misma forma de uso de better-sqlite3:
 *    db.prepare(sql).get(params) / .all(params) / .run(params)
 *    db.exec(sql) / db.transaction(fn) / db.pragma(txt)
 * ------------------------------------------------------------------ */

let cruda = null;          // instancia de sql.js
let pendiente = false;     // hay cambios sin escribir a disco
let enTransaccion = false;
let temporizador = null;

function listo() {
  if (!cruda) throw new Error('La base de datos todavia no se ha inicializado (falta await initDb()).');
  return cruda;
}

/** Escribe la base completa a disco de forma atomica. */
function guardar() {
  if (!cruda) return;
  const datos = Buffer.from(cruda.export());
  const temporal = DB_FILE + '.tmp';
  fs.writeFileSync(temporal, datos);
  fs.renameSync(temporal, DB_FILE);
  pendiente = false;
}

/** Marca cambios y los baja a disco (se agrupan dentro de una transaccion). */
function marcarCambio() {
  pendiente = true;
  if (enTransaccion) return;
  clearTimeout(temporizador);
  guardar();
}

/**
 * sql.js espera los parametros con nombre incluyendo su prefijo (@, : o $).
 * El resto del codigo los manda sin prefijo, asi que aqui se normalizan.
 */
function normalizar(params) {
  if (params == null) return undefined;
  if (Array.isArray(params)) return params.map((v) => (v === undefined ? null : v));
  if (typeof params === 'object' && !(params instanceof Date)) {
    const salida = {};
    for (const clave of Object.keys(params)) {
      const valor = params[clave] === undefined ? null : params[clave];
      salida[/^[@:$]/.test(clave) ? clave : '@' + clave] = valor;
    }
    return salida;
  }
  return [params];
}

/** Convierte los argumentos sueltos (a, b, c) en el formato de sql.js. */
function args(lista) {
  if (!lista.length) return undefined;
  if (lista.length === 1 && lista[0] !== null && typeof lista[0] === 'object' && !Array.isArray(lista[0])) {
    return normalizar(lista[0]);
  }
  return normalizar(lista);
}

function esEscritura(sql) {
  return !/^\s*(select|pragma|explain|with)\b/i.test(sql);
}

function prepare(sql) {
  const escritura = esEscritura(sql);

  return {
    get(...p) {
      const stmt = listo().prepare(sql);
      try {
        stmt.bind(args(p));
        return stmt.step() ? stmt.getAsObject() : undefined;
      } finally {
        stmt.free();
      }
    },

    all(...p) {
      const stmt = listo().prepare(sql);
      const filas = [];
      try {
        stmt.bind(args(p));
        while (stmt.step()) filas.push(stmt.getAsObject());
      } finally {
        stmt.free();
      }
      return filas;
    },

    run(...p) {
      const bd = listo();
      const stmt = bd.prepare(sql);
      try {
        stmt.bind(args(p));
        stmt.step();
      } finally {
        stmt.free();
      }
      const cambios = bd.getRowsModified();
      let ultimoId = 0;
      if (/^\s*insert\b/i.test(sql)) {
        const r = bd.exec('SELECT last_insert_rowid() AS id');
        ultimoId = (r[0] && r[0].values[0] && r[0].values[0][0]) || 0;
      }
      if (escritura) marcarCambio();
      return { changes: cambios, lastInsertRowid: ultimoId };
    }
  };
}

const db = {
  prepare,

  exec(sql) {
    listo().exec(sql);
    if (esEscritura(sql)) marcarCambio();
  },

  pragma(texto) {
    listo().exec('PRAGMA ' + texto + ';');
  },

  /** Devuelve una funcion que corre fn() dentro de una transaccion. */
  transaction(fn) {
    return function (...p) {
      const bd = listo();
      if (enTransaccion) return fn.apply(this, p);   // transacciones anidadas
      bd.exec('BEGIN');
      enTransaccion = true;
      try {
        const salida = fn.apply(this, p);
        bd.exec('COMMIT');
        enTransaccion = false;
        marcarCambio();
        return salida;
      } catch (e) {
        try { bd.exec('ROLLBACK'); } catch (_) { /* ignorar */ }
        enTransaccion = false;
        throw e;
      }
    };
  },

  /** Fuerza la escritura a disco (se usa al apagar el servidor). */
  flush() {
    if (pendiente) guardar();
  }
};

/** Carga el motor WASM, abre el archivo y crea las tablas que falten. */
async function initDb() {
  if (cruda) return db;

  const SQL = await initSqlJs({
    locateFile: (archivo) => path.join(WASM_DIR, archivo)
  });

  let previa = null;
  if (fs.existsSync(DB_FILE)) {
    try {
      previa = new Uint8Array(fs.readFileSync(DB_FILE));
    } catch (e) {
      console.error('[bd] No se pudo leer la base de datos:', e.message);
    }
  }

  cruda = previa && previa.length ? new SQL.Database(previa) : new SQL.Database();
  cruda.exec('PRAGMA foreign_keys = ON;');
  cruda.exec(ESQUEMA);
  guardar();

  // Nunca perder cambios al apagar el servidor
  const alSalir = () => { try { db.flush(); } catch (_) { /* ignorar */ } };
  process.on('exit', alSalir);
  process.on('SIGINT', () => { alSalir(); process.exit(0); });
  process.on('SIGTERM', () => { alSalir(); process.exit(0); });

  return db;
}

/* ---------- etapas del checklist configurables por proyecto ---------- */

const DEFAULT_STAGES = ['Fabricado'];

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function getStages(projectId) {
  const raw = getSetting('stages:' + projectId);
  if (!raw) return DEFAULT_STAGES.slice();
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? arr : DEFAULT_STAGES.slice();
  } catch (_) {
    return DEFAULT_STAGES.slice();
  }
}

function setStages(projectId, stages) {
  setSetting('stages:' + projectId, JSON.stringify(stages));
}

function log(projectId, userId, action, detail) {
  db.prepare('INSERT INTO activity (project_id, user_id, action, detail) VALUES (?,?,?,?)')
    .run(projectId || null, userId || null, action, detail || null);
}

module.exports = { db, initDb, getSetting, setSetting, getStages, setStages, DEFAULT_STAGES, log };
