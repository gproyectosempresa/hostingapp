'use strict';

const nodemailer = require('nodemailer');

const APP_NAME = process.env.APP_NAME || 'Estructura Metalica';

let transporter = null;
let configured = false;

if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  configured = true;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function isConfigured() {
  return configured;
}

function shell(title, intro, buttonText, buttonUrl, footer) {
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#eef2f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,32,66,.10);">
        <tr><td style="background:linear-gradient(135deg,#1f3f7a,#2f6fed);padding:26px 30px;">
          <div style="color:#ffffff;font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.85;">${APP_NAME}</div>
          <div style="color:#ffffff;font-size:23px;font-weight:700;margin-top:6px;">${title}</div>
        </td></tr>
        <tr><td style="padding:30px;color:#28324a;font-size:15px;line-height:1.65;">
          ${intro}
          <div style="text-align:center;margin:30px 0 8px;">
            <a href="${buttonUrl}" style="display:inline-block;background:#ff7a29;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 34px;border-radius:12px;">${buttonText}</a>
          </div>
          <p style="font-size:12.5px;color:#7b869c;text-align:center;margin-top:18px;">
            Si el boton no funciona, copia y pega esta direccion en tu navegador:<br>
            <span style="color:#2f6fed;word-break:break-all;">${buttonUrl}</span>
          </p>
        </td></tr>
        <tr><td style="background:#f6f8fc;padding:18px 30px;color:#8894ab;font-size:12px;text-align:center;">
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function send(to, subject, html, text) {
  if (!configured) return { sent: false, reason: 'SMTP no configurado' };
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    text
  });
  return { sent: true };
}

async function sendInvite(user, link, invitedBy) {
  const intro = `
    <p style="margin-top:0;">Hola <strong>${user.name || ''}</strong>,</p>
    <p>${invitedBy ? invitedBy + ' te dio de alta' : 'Te dimos de alta'} en la plataforma de proyectos de <strong>${APP_NAME}</strong>.</p>
    <p>Desde tu celular vas a poder acercar la etiqueta NFC de cada proyecto y consultar los planos, la lista de piezas con su peso, las especificaciones de soldadura y el modelo 3D.</p>
    <p>Solo falta que crees tu contrasena:</p>`;
  const html = shell('Bienvenido al equipo', intro, 'Crear mi contrasena', link,
    'Este enlace es personal y expira en 7 dias.');
  const text = `Hola ${user.name || ''}. Crea tu contrasena aqui: ${link}`;
  return send(user.email, `Activa tu cuenta - ${APP_NAME}`, html, text);
}

async function sendReset(user, link) {
  const intro = `
    <p style="margin-top:0;">Hola <strong>${user.name || ''}</strong>,</p>
    <p>Recibimos una solicitud para restablecer la contrasena de tu cuenta.</p>
    <p>Si no fuiste tu, puedes ignorar este correo y tu contrasena seguira igual.</p>`;
  const html = shell('Restablecer contrasena', intro, 'Elegir nueva contrasena', link,
    'Este enlace expira en 2 horas.');
  const text = `Restablece tu contrasena aqui: ${link}`;
  return send(user.email, `Restablecer contrasena - ${APP_NAME}`, html, text);
}

async function verify() {
  if (!configured) return { ok: false, error: 'SMTP no configurado en el archivo .env' };
  try {
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { isConfigured, sendInvite, sendReset, verify };
