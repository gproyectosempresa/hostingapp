'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Calcula una "version" corta a partir del contenido de la carpeta public.
 *
 * Los estilos y el JavaScript se sirven con caché larga (son los mismos en
 * cada visita), pero eso hace que al actualizar la plataforma el navegador
 * siga usando los archivos viejos que ya tenía guardados. Por eso las
 * páginas los piden como  /static/js/app.js?v=<version> : cuando cambia
 * cualquier archivo cambia la version, la direccion es otra y el navegador
 * baja la version nueva sola, sin que nadie tenga que limpiar la cache.
 */
function versionDeAssets(dir) {
  const hash = crypto.createHash('sha1');

  const recorrer = (carpeta) => {
    const entradas = fs.readdirSync(carpeta, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entrada of entradas) {
      const completa = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(completa);
      } else {
        const info = fs.statSync(completa);
        hash.update(entrada.name + ':' + info.size + ':' + info.mtimeMs + ';');
      }
    }
  };

  try {
    recorrer(dir);
  } catch (_) {
    return String(Date.now());       // ante cualquier problema, no cachear
  }
  return hash.digest('hex').slice(0, 10);
}

module.exports = { versionDeAssets };
