'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, log } = require('../db');
const auth = require('../auth');
const mailer = require('../mailer');
const { token } = require('../utils');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
});

function appUrl(req) {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  return base || req.protocol + '://' + req.get('host');
}

/* ------------------------------ INSTALACION ------------------------------ */

router.get('/instalacion', (req, res) => {
  if (!auth.needsSetup()) return res.redirect('/entrar');
  res.render('setup', { title: 'Instalacion', error: null, form: {} });
});

router.post('/instalacion', (req, res) => {
  if (!auth.needsSetup()) return res.redirect('/entrar');
  const { name, email, password, password2 } = req.body;
  const form = { name, email };
  const fail = (error) => res.status(400).render('setup', { title: 'Instalacion', error, form });

  if (!name || !auth.validEmail(email)) return fail('Escribe tu nombre y un correo valido.');
  if (password !== password2) return fail('Las contrasenas no coinciden.');
  const pwError = auth.passwordProblem(password);
  if (pwError) return fail(pwError);

  const info = db.prepare(
    "INSERT INTO users (email, name, role, password_hash, status) VALUES (?,?,'admin',?,'activo')"
  ).run(String(email).trim().toLowerCase(), String(name).trim(), auth.hash(password));

  req.session.uid = info.lastInsertRowid;
  log(null, info.lastInsertRowid, 'instalacion', 'Se creo el administrador principal');
  res.redirect('/admin');
});

/* -------------------------------- ENTRAR -------------------------------- */

router.get('/entrar', (req, res) => {
  if (auth.needsSetup()) return res.redirect('/instalacion');
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/proyectos');
  res.render('login', {
    title: 'Iniciar sesion',
    error: null,
    email: '',
    siguiente: req.query.siguiente || '',
    aviso: req.query.aviso || ''
  });
});

router.post('/entrar', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  const siguiente = req.body.siguiente || '';
  const user = auth.findByEmail(email);

  const fail = (error) => res.status(401).render('login', {
    title: 'Iniciar sesion', error, email: String(email || ''), siguiente, aviso: ''
  });

  if (!user || !auth.compare(password, user.password_hash)) {
    return fail('Correo o contrasena incorrectos.');
  }
  if (user.status === 'invitado') {
    return fail('Tu cuenta aun no esta activada. Revisa el correo de invitacion para crear tu contrasena.');
  }
  if (user.status !== 'activo') {
    return fail('Tu cuenta esta desactivada. Contacta al administrador.');
  }

  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  req.session.uid = user.id;

  let destino = siguiente && siguiente.startsWith('/') ? siguiente : null;
  if (!destino) destino = user.role === 'admin' ? '/admin' : '/proyectos';
  res.redirect(destino);
});

router.get('/salir', (req, res) => {
  req.session = null;
  res.redirect('/entrar?aviso=' + encodeURIComponent('Cerraste sesion correctamente.'));
});

/* ---------------------- ALTA POR INVITACION (usuario) ---------------------- */

router.get('/registro', (req, res) => {
  const t = String(req.query.token || '');
  const user = t && db.prepare('SELECT * FROM users WHERE invite_token = ?').get(t);
  if (!user || (user.invite_expires && user.invite_expires < Date.now())) {
    return res.status(400).render('error', {
      title: 'Invitacion no valida',
      code: 400,
      message: 'Este enlace de invitacion ya expiro o no es valido. Pidele al administrador que te reenvie la invitacion.'
    });
  }
  res.render('register', { title: 'Crear contrasena', user, token: t, error: null });
});

router.post('/registro', (req, res) => {
  const t = String(req.body.token || '');
  const user = t && db.prepare('SELECT * FROM users WHERE invite_token = ?').get(t);
  if (!user || (user.invite_expires && user.invite_expires < Date.now())) {
    return res.status(400).render('error', {
      title: 'Invitacion no valida', code: 400,
      message: 'Este enlace de invitacion ya expiro. Pidele al administrador que te reenvie la invitacion.'
    });
  }
  const { password, password2, name, phone } = req.body;
  const fail = (error) => res.status(400).render('register', {
    title: 'Crear contrasena', user, token: t, error
  });
  if (password !== password2) return fail('Las contrasenas no coinciden.');
  const pwError = auth.passwordProblem(password);
  if (pwError) return fail(pwError);

  db.prepare(`UPDATE users SET password_hash = ?, status = 'activo', invite_token = NULL,
      invite_expires = NULL, name = COALESCE(NULLIF(?,''), name), phone = COALESCE(NULLIF(?,''), phone)
      WHERE id = ?`)
    .run(auth.hash(password), String(name || '').trim(), String(phone || '').trim(), user.id);

  req.session.uid = user.id;
  log(null, user.id, 'alta', 'El usuario activo su cuenta');
  res.redirect(user.role === 'admin' ? '/admin' : '/proyectos');
});

/* ------------------------- RECUPERAR CONTRASENA ------------------------- */

router.get('/recuperar', (req, res) => {
  res.render('recover', { title: 'Recuperar contrasena', message: null, error: null, link: null });
});

router.post('/recuperar', loginLimiter, async (req, res) => {
  const user = auth.findByEmail(req.body.email);
  const message = 'Si el correo esta registrado, en un momento recibiras las instrucciones para restablecer tu contrasena.';
  if (!user) return res.render('recover', { title: 'Recuperar contrasena', message, error: null, link: null });

  const t = token(24);
  db.prepare('UPDATE users SET invite_token = ?, invite_expires = ? WHERE id = ?')
    .run(t, Date.now() + 2 * 60 * 60 * 1000, user.id);
  const link = appUrl(req) + '/restablecer?token=' + t;

  let link_ = null;
  try {
    const r = await mailer.sendReset(user, link);
    if (!r.sent) link_ = link;
  } catch (_) {
    link_ = link;
  }
  res.render('recover', { title: 'Recuperar contrasena', message, error: null, link: link_ });
});

router.get('/restablecer', (req, res) => {
  const t = String(req.query.token || '');
  const user = t && db.prepare('SELECT * FROM users WHERE invite_token = ?').get(t);
  if (!user || (user.invite_expires && user.invite_expires < Date.now())) {
    return res.status(400).render('error', {
      title: 'Enlace vencido', code: 400,
      message: 'El enlace para restablecer la contrasena ya expiro. Solicita uno nuevo.'
    });
  }
  res.render('reset', { title: 'Nueva contrasena', token: t, error: null });
});

router.post('/restablecer', (req, res) => {
  const t = String(req.body.token || '');
  const user = t && db.prepare('SELECT * FROM users WHERE invite_token = ?').get(t);
  if (!user || (user.invite_expires && user.invite_expires < Date.now())) {
    return res.status(400).render('error', {
      title: 'Enlace vencido', code: 400,
      message: 'El enlace para restablecer la contrasena ya expiro. Solicita uno nuevo.'
    });
  }
  const { password, password2 } = req.body;
  const fail = (error) => res.status(400).render('reset', { title: 'Nueva contrasena', token: t, error });
  if (password !== password2) return fail('Las contrasenas no coinciden.');
  const pwError = auth.passwordProblem(password);
  if (pwError) return fail(pwError);

  db.prepare("UPDATE users SET password_hash = ?, status = 'activo', invite_token = NULL, invite_expires = NULL WHERE id = ?")
    .run(auth.hash(password), user.id);
  req.session.uid = user.id;
  res.redirect(user.role === 'admin' ? '/admin' : '/proyectos');
});

/* ----------------------------- MI CUENTA ----------------------------- */

router.get('/mi-cuenta', auth.requireLogin, (req, res) => {
  res.render('account', { title: 'Mi cuenta', error: null, message: null });
});

router.post('/mi-cuenta', auth.requireLogin, (req, res) => {
  const { name, phone, password, password2 } = req.body;
  db.prepare("UPDATE users SET name = COALESCE(NULLIF(?,''), name), phone = ? WHERE id = ?")
    .run(String(name || '').trim(), String(phone || '').trim(), req.user.id);

  if (password) {
    if (password !== password2) {
      return res.status(400).render('account', { title: 'Mi cuenta', error: 'Las contrasenas no coinciden.', message: null });
    }
    const pwError = auth.passwordProblem(password);
    if (pwError) return res.status(400).render('account', { title: 'Mi cuenta', error: pwError, message: null });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hash(password), req.user.id);
  }
  req.user = auth.findById(req.user.id);
  res.locals.user = req.user;
  res.render('account', { title: 'Mi cuenta', error: null, message: 'Tus datos se guardaron correctamente.' });
});

module.exports = router;
