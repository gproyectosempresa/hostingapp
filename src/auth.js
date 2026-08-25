'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('./db');

function hash(password) {
  return bcrypt.hashSync(String(password), 10);
}

function compare(password, storedHash) {
  if (!storedHash) return false;
  return bcrypt.compareSync(String(password), storedHash);
}

function findByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email || '').trim());
}

function findById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function needsSetup() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n === 0;
}

/** Carga el usuario de la sesion en res.locals para todas las vistas. */
function attachUser(req, res, next) {
  req.user = null;
  if (req.session && req.session.uid) {
    const u = findById(req.session.uid);
    if (u && u.status === 'activo') {
      req.user = u;
    } else {
      req.session = null;
    }
  }
  res.locals.user = req.user;
  res.locals.appName = process.env.APP_NAME || 'Estructura Metalica';
  res.locals.currentPath = req.path;
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  const next_ = encodeURIComponent(req.originalUrl || '/');
  return res.redirect('/entrar?siguiente=' + next_);
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (!req.user) return res.redirect('/entrar?siguiente=' + encodeURIComponent(req.originalUrl || '/'));
  return res.status(403).render('error', {
    title: 'Sin permiso',
    code: 403,
    message: 'Esta seccion es solo para administradores.'
  });
}

/** Validacion simple de contrasena. Devuelve null si es valida. */
function passwordProblem(pw) {
  const p = String(pw || '');
  if (p.length < 8) return 'La contrasena debe tener al menos 8 caracteres.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'La contrasena debe incluir letras y numeros.';
  return null;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

module.exports = {
  hash, compare, findByEmail, findById, countUsers, needsSetup,
  attachUser, requireLogin, requireAdmin, passwordProblem, validEmail
};
