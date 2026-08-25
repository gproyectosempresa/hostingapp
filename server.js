'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const compression = require('compression');
const multer = require('multer');

const { db, initDb } = require('./src/db');
const auth = require('./src/auth');
const { icon } = require('./src/icons');
const { versionDeAssets } = require('./src/assets');
const authRoutes = require('./src/routes/auth.routes');
const adminRoutes = require('./src/routes/admin.routes');
const projectRoutes = require('./src/routes/project.routes');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.icon = icon;
app.locals.anio = new Date().getFullYear();
// Version de estilos y JavaScript, para que el navegador no se quede
// con los archivos viejos despues de actualizar la plataforma.
app.locals.v = versionDeAssets(path.join(__dirname, 'public'));

// Comprime el HTML: las listas de cientos de piezas viajan hasta 10 veces
// mas ligeras al celular del taller.  Los planos NO se comprimen: ya vienen
// comprimidos y ademas hay que servirlos por rangos para que el visor de
// PDF pueda abrirlos por pedazos.
app.use(compression({
  filter: (req, res) => {
    if (req.path.startsWith('/archivo')) return false;
    return compression.filter(req, res);
  }
}));

app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '2mb' }));

app.use(cookieSession({
  name: 'sesion',
  keys: [process.env.SESSION_SECRET || 'cambia-esta-llave-en-el-archivo-env-por-favor'],
  maxAge: Number(process.env.SESSION_DAYS || 30) * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: String(process.env.APP_URL || '').startsWith('https://')
}));

// Encabezados basicos de seguridad
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Las paginas nunca se guardan en cache: asi siempre traen la version
  // actual de los estilos y el JavaScript (y no muestran datos de una
  // sesion anterior al presionar "atras").
  if (!req.path.startsWith('/static') && !req.path.startsWith('/archivo')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

app.use(auth.attachUser);

// Mensajes de una sola vista (flash)
app.use((req, res, next) => {
  if (req.session && req.session.flash) {
    res.locals.flash = req.session.flash;
    req.session.flash = null;
  } else {
    res.locals.flash = null;
  }
  next();
});

// Si todavia no hay administrador, todo lleva a la instalacion
app.use((req, res, next) => {
  const libre = ['/instalacion', '/static', '/salud'].some((p) => req.path.startsWith(p));
  if (auth.needsSetup() && !libre) {
    return res.redirect('/instalacion');
  }
  next();
});

app.get('/', (req, res) => {
  if (!req.user) return res.redirect('/entrar');
  return res.redirect(req.user.role === 'admin' ? '/admin' : '/proyectos');
});

app.use('/', authRoutes);
app.use('/', projectRoutes.router);
app.use('/admin', adminRoutes);

// Salud del servicio (util para el panel de Hostinger)
app.get('/salud', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Pagina no encontrada',
    code: 404,
    message: 'La pagina que buscas no existe o cambio de direccion.'
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const texto = err.code === 'LIMIT_FILE_SIZE'
      ? 'Uno de los archivos supera el limite de ' + (process.env.MAX_FILE_MB || 200) + ' MB.'
      : 'No se pudieron subir los archivos (' + err.message + ').';
    if (req.session) req.session.flash = { tipo: 'error', texto };
    return res.status(413).render('error', { title: 'Archivo muy grande', code: 413, message: texto });
  }
  console.error('[error]', err);
  res.status(500).render('error', {
    title: 'Error del servidor',
    code: 500,
    message: 'Ocurrio un problema inesperado. Intenta de nuevo; si continua, avisa al administrador.'
  });
});

/* Administrador inicial desde el archivo .env (opcional) */
function seedAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (auth.findByEmail(email)) return;
  db.prepare("INSERT INTO users (email, name, role, password_hash, status) VALUES (?,?,'admin',?,'activo')")
    .run(email, process.env.ADMIN_NAME || 'Administrador', auth.hash(password));
  console.log('[inicio] Administrador creado desde .env:', email);
}
/* La base de datos se carga primero (motor WASM) y luego arranca el servidor */
initDb()
  .then(() => {
    seedAdmin();
    app.listen(PORT, () => {
      const url = process.env.APP_URL || 'http://localhost:' + PORT;
      console.log('');
      console.log('  ' + (process.env.APP_NAME || 'Estructura Metalica'));
      console.log('  Servidor listo en el puerto ' + PORT);
      console.log('  ' + url);
      if (auth.needsSetup()) console.log('  -> Abre ' + url + '/instalacion para crear el administrador');
      console.log('');
    });
  })
  .catch((e) => {
    console.error('[inicio] No se pudo abrir la base de datos:', e);
    process.exit(1);
  });
