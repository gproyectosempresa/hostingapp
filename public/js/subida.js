/* =========================================================================
   Alta de proyectos y subida de archivos (con barra de progreso real)
   ========================================================================= */
(function () {
  'use strict';

  const form = document.getElementById('formProyecto') || document.getElementById('formDocs');
  if (!form) return;

  const esAlta = form.id === 'formProyecto';

  /* Cada archivo se guarda como { file, ruta } donde ruta es la ruta
     relativa dentro de la carpeta que eligio el administrador. */
  const bolsa = { documentos: [], soldadura: [], piezas: null };

  /* ----------------------------- utilidades ----------------------------- */

  function pesoLegible(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }

  function numero(n, dec) {
    return Number(n || 0).toLocaleString('es-MX', {
      minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec
    });
  }

  function escapar(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const IGNORAR = /^(\.|~\$|thumbs\.db$|desktop\.ini$)/i;

  function aceptable(file, ruta) {
    if (IGNORAR.test(file.name || '')) return false;
    if (ruta && ruta.split('/').some(function (p) { return p.indexOf('.') === 0; })) return false;
    return true;
  }

  /* ------------------------- pintar listas de archivos ------------------------- */

  function pintarLista(idLista, lista, idResumen) {
    const cont = document.getElementById(idLista);
    if (!cont) return;
    cont.innerHTML = '';

    const tope = 60;
    lista.slice(0, tope).forEach(function (item, i) {
      const div = document.createElement('div');
      div.className = 'archivo-min';
      div.style.animationDelay = Math.min(i * 12, 400) + 'ms';
      div.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#6b7a99" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<path d="M14 2v6h6"/></svg>' +
        '<span class="nombre">' + escapar(item.ruta || item.file.name) + '</span>' +
        '<span class="peso">' + pesoLegible(item.file.size) + '</span>';
      cont.appendChild(div);
    });

    if (lista.length > tope) {
      const div = document.createElement('div');
      div.className = 'archivo-min';
      div.innerHTML = '<span class="nombre txt-suave">... y ' + (lista.length - tope) + ' archivo(s) mas</span>';
      cont.appendChild(div);
    }

    if (idResumen) {
      const res = document.getElementById(idResumen);
      if (res) {
        const total = lista.reduce(function (a, x) { return a + x.file.size; }, 0);
        res.textContent = lista.length ? lista.length + ' archivo(s) · ' + pesoLegible(total) : '';
      }
    }
  }

  function agregar(destino, archivos, idLista, idResumen) {
    for (let i = 0; i < archivos.length; i++) {
      const item = archivos[i];
      if (!aceptable(item.file, item.ruta)) continue;
      const repetido = bolsa[destino].some(function (x) {
        return x.ruta === item.ruta && x.file.size === item.file.size;
      });
      if (!repetido) bolsa[destino].push(item);
    }
    pintarLista(idLista, bolsa[destino], idResumen);
  }

  function desdeInput(input) {
    return Array.prototype.map.call(input.files, function (f) {
      return { file: f, ruta: f.webkitRelativePath || f.name };
    });
  }

  /* ------------------------------ entradas ------------------------------ */

  const inputCarpeta = document.getElementById('inputCarpeta');
  const inputSueltos = document.getElementById('inputSueltos');
  const btnSueltos = document.getElementById('btnArchivosSueltos');
  const inputSoldadura = document.getElementById('inputSoldadura');
  const inputPiezas = document.getElementById('inputPiezas');
  const textoPiezas = document.getElementById('piezas_texto');

  if (inputCarpeta) {
    inputCarpeta.addEventListener('change', function () {
      agregar('documentos', desdeInput(inputCarpeta), 'listaCarpeta', 'resumenCarpeta');
    });
  }
  if (btnSueltos && inputSueltos) {
    btnSueltos.addEventListener('click', function () { inputSueltos.click(); });
    inputSueltos.addEventListener('change', function () {
      agregar('documentos', desdeInput(inputSueltos), 'listaCarpeta', 'resumenCarpeta');
    });
  }
  if (inputSoldadura) {
    inputSoldadura.addEventListener('change', function () {
      agregar('soldadura', desdeInput(inputSoldadura), 'listaSoldadura');
    });
  }
  if (inputPiezas) {
    inputPiezas.addEventListener('change', function () {
      const f = inputPiezas.files[0];
      bolsa.piezas = f ? { file: f, ruta: f.name } : null;
      pintarLista('listaPiezasArchivo', bolsa.piezas ? [bolsa.piezas] : []);
    });
  }

  /* ------------------- elegir entre archivo o texto pegado ------------------- */

  const fuente = document.getElementById('fuentePiezas');
  if (fuente) {
    fuente.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-fuente]');
      if (!btn) return;
      const cual = btn.getAttribute('data-fuente');
      fuente.querySelectorAll('[data-fuente]').forEach(function (b) {
        b.classList.toggle('activa', b === btn);
      });
      document.querySelectorAll('[data-fuente-panel]').forEach(function (p) {
        p.classList.toggle('oculto', p.getAttribute('data-fuente-panel') !== cual);
      });
    });
  }

  /* --------------------------- arrastrar y soltar --------------------------- */

  function recorrerEntrada(entry, prefijo, acumulador) {
    return new Promise(function (resolve) {
      if (entry.isFile) {
        entry.file(function (file) {
          acumulador.push({ file: file, ruta: prefijo + file.name });
          resolve();
        }, resolve);
      } else if (entry.isDirectory) {
        const lector = entry.createReader();
        const leerTanda = function () {
          lector.readEntries(function (entradas) {
            if (!entradas.length) return resolve();
            Promise.all(entradas.map(function (e) {
              return recorrerEntrada(e, prefijo + entry.name + '/', acumulador);
            })).then(leerTanda);
          }, resolve);
        };
        leerTanda();
      } else {
        resolve();
      }
    });
  }

  function conectarZona(idZona, destino, idLista, idResumen) {
    const zona = document.getElementById(idZona);
    if (!zona) return;

    ['dragenter', 'dragover'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add('encima'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove('encima'); });
    });

    zona.addEventListener('drop', function (e) {
      const dt = e.dataTransfer;
      if (!dt) return;
      const acumulador = [];
      const tareas = [];
      const items = dt.items;

      if (items && items.length && items[0].webkitGetAsEntry) {
        for (let i = 0; i < items.length; i++) {
          const entry = items[i].webkitGetAsEntry();
          if (entry) tareas.push(recorrerEntrada(entry, '', acumulador));
        }
      } else {
        for (let i = 0; i < dt.files.length; i++) {
          acumulador.push({ file: dt.files[i], ruta: dt.files[i].name });
        }
      }

      Promise.all(tareas).then(function () {
        if (destino === 'piezas') {
          if (acumulador.length) {
            bolsa.piezas = acumulador[0];
            pintarLista('listaPiezasArchivo', [bolsa.piezas]);
          }
        } else {
          agregar(destino, acumulador, idLista, idResumen);
        }
      });
    });
  }

  conectarZona('zonaCarpeta', 'documentos', 'listaCarpeta', 'resumenCarpeta');
  conectarZona('zonaSoldadura', 'soldadura', 'listaSoldadura');
  conectarZona('zonaPiezas', 'piezas', 'listaPiezasArchivo');

  /* ------------------------------ pasos ------------------------------ */

  const paneles = form.querySelectorAll('.paso-panel');
  const pasos = document.querySelectorAll('.paso');
  let pasoActual = 1;

  function irAPaso(n) {
    if (!paneles.length) return;
    pasoActual = n;
    paneles.forEach(function (p) {
      p.classList.toggle('oculto', Number(p.getAttribute('data-panel')) !== n);
    });
    pasos.forEach(function (p) {
      const i = Number(p.getAttribute('data-paso'));
      p.classList.toggle('activo', i === n);
      p.classList.toggle('hecho', i < n);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function validarPaso(n) {
    if (n === 2) {
      const nombre = document.getElementById('name');
      if (nombre && !nombre.value.trim()) {
        nombre.focus();
        window.avisar('Escribe el nombre del proyecto para continuar.', 'error');
        return false;
      }
      const entrega = document.getElementById('due_date');
      if (entrega && !entrega.value) {
        entrega.focus();
        window.avisar('Falta la fecha de entrega del proyecto.', 'error');
        return false;
      }
    }
    return true;
  }

  form.addEventListener('click', function (e) {
    if (e.target.closest('.siguiente-paso')) {
      if (!validarPaso(pasoActual)) return;
      irAPaso(Math.min(pasoActual + 1, paneles.length));
    }
    if (e.target.closest('.anterior-paso')) irAPaso(Math.max(pasoActual - 1, 1));
  });

  /* ------------------------- etapas predefinidas ------------------------- */

  document.querySelectorAll('.preset-etapas').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.preset-etapas').forEach(function (x) { x.classList.remove('activo'); });
      b.classList.add('activo');
      const campo = document.getElementById('stages');
      if (campo) campo.value = b.getAttribute('data-etapas');
    });
  });

  /* =====================================================================
     Paso 1 -> lee la lista de piezas y llena solo los datos del proyecto
     ===================================================================== */

  const btnAnalizar = document.getElementById('btnAnalizar');
  const estadoAnalisis = document.getElementById('estadoAnalisis');
  let ultimoAnalisis = null;

  function ponerSiVacio(id, valor) {
    const campo = document.getElementById(id);
    if (campo && valor && !campo.value.trim()) campo.value = valor;
  }

  function describirPeso(datos) {
    const ejemplo = document.getElementById('ejemploPeso');
    if (!ejemplo || !datos || !datos.muestra || !datos.muestra.length) return;
    const p = datos.muestra.find(function (x) { return x.qty > 1; }) || datos.muestra[0];
    const esTotal = document.getElementById('peso_es_total').value === '1';
    const unit = esTotal ? p.total_weight / (p.qty || 1) : p.unit_weight;
    const total = esTotal ? p.total_weight : p.unit_weight * p.qty;
    ejemplo.innerHTML = 'Ejemplo con <b>' + escapar(p.mark) + '</b>: ' + numero(p.qty) +
      ' pieza(s) × ' + numero(unit, 2) + ' kg = <b>' + numero(total, 2) + ' kg</b>';
  }

  function mostrarResumen(datos) {
    ultimoAnalisis = datos;

    ponerSiVacio('name', datos.proyecto.name);
    ponerSiVacio('code', datos.proyecto.code);
    ponerSiVacio('client', datos.proyecto.client);
    ponerSiVacio('client_code', datos.proyecto.client_code);

    const caja = document.getElementById('resumenPiezas');
    const txt = document.getElementById('resumenPiezasTxt');
    if (caja && txt) {
      let html = '<b>Se leyeron ' + datos.totals.piezas + ' renglones · ' +
        numero(datos.totals.cantidad) + ' piezas · ' + numero(datos.totals.peso, 2) + ' kg</b>';
      if (datos.totals.conDibujo) {
        html += '<div class="txt-chico">' + datos.totals.conDibujo + ' con numero de dibujo, ' +
          'se vincularan solas con los planos que subas.</div>';
      }
      const cols = Object.keys(datos.mapping).length;
      html += '<div class="txt-chico txt-suave">Columnas reconocidas (' + cols + '): ' +
        Object.keys(datos.mapping).map(function (k) { return escapar(datos.mapping[k]); }).join(', ') + '</div>';
      (datos.warnings || []).forEach(function (w) {
        html += '<div class="txt-chico" style="color:#96620a">⚠ ' + escapar(w) + '</div>';
      });
      txt.innerHTML = html;
      caja.classList.remove('oculto');
    }

    const avisoPeso = document.getElementById('avisoPeso');
    if (avisoPeso) {
      avisoPeso.classList.toggle('oculto', !datos.pesoAmbiguo);
      if (datos.pesoAmbiguo) describirPeso(datos);
    }

    irAPaso(2);
  }

  if (btnAnalizar) {
    btnAnalizar.addEventListener('click', function () {
      const hayArchivo = !!bolsa.piezas;
      const hayTexto = textoPiezas && textoPiezas.value.trim().length > 0;

      if (!hayArchivo && !hayTexto) {
        if (window.confirm('No seleccionaste ninguna lista de piezas.\n\nPuedes crear el proyecto ahora y subir el listado despues. Continuar?')) {
          irAPaso(2);
        }
        return;
      }

      const datos = new FormData();
      if (hayArchivo) datos.append('piezas', bolsa.piezas.file, bolsa.piezas.file.name);
      if (hayTexto) datos.append('piezas_texto', textoPiezas.value);
      datos.append('peso_es_total', document.getElementById('peso_es_total').value);

      btnAnalizar.disabled = true;
      btnAnalizar.classList.add('pulsando');
      if (estadoAnalisis) estadoAnalisis.textContent = 'Leyendo la lista...';

      fetch('/admin/nuevo/analizar', { method: 'POST', body: datos })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          btnAnalizar.disabled = false;
          btnAnalizar.classList.remove('pulsando');
          if (estadoAnalisis) estadoAnalisis.textContent = '';
          if (!data.ok) {
            window.avisar(data.error || 'No se pudo leer la lista.', 'error');
            return;
          }
          mostrarResumen(data);
          window.avisar(data.totals.piezas + ' renglones leidos correctamente.', 'exito');
        })
        .catch(function () {
          btnAnalizar.disabled = false;
          btnAnalizar.classList.remove('pulsando');
          if (estadoAnalisis) estadoAnalisis.textContent = '';
          window.avisar('No se pudo leer la lista. Revisa el archivo e intenta de nuevo.', 'error');
        });
    });
  }

  /* peso unitario o peso del renglon */
  document.querySelectorAll('[data-peso]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-peso]').forEach(function (x) { x.classList.remove('activo'); });
      b.classList.add('activo');
      document.getElementById('peso_es_total').value = b.getAttribute('data-peso');
      describirPeso(ultimoAnalisis);
    });
  });

  /* ------------------------------ enviar ------------------------------ */

  const cajaProgreso = document.getElementById('cajaProgreso');
  const barraProgreso = document.getElementById('barraProgreso');
  const porcentaje = document.getElementById('porcentaje');
  const textoProgreso = document.getElementById('textoProgreso');
  const btnGuardar = document.getElementById('btnGuardar');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (esAlta && !validarPaso(2)) { irAPaso(2); return; }

    const datos = new FormData();

    // campos de texto del formulario
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (!el.name || el.type === 'file') return;
      datos.append(el.name, el.value);
    });

    // rutas relativas primero, en el mismo orden que los archivos
    bolsa.documentos.forEach(function (x) { datos.append('relpath', x.ruta); });
    bolsa.documentos.forEach(function (x) { datos.append('documentos', x.file, x.file.name); });
    bolsa.soldadura.forEach(function (x) { datos.append('soldadura', x.file, x.file.name); });
    if (bolsa.piezas) datos.append('piezas', bolsa.piezas.file, bolsa.piezas.file.name);

    const totalArchivos = bolsa.documentos.length + bolsa.soldadura.length + (bolsa.piezas ? 1 : 0);

    if (!esAlta && totalArchivos === 0) {
      window.avisar('Selecciona al menos un archivo para subir.', 'error');
      return;
    }

    if (btnGuardar) {
      btnGuardar.disabled = true;
      btnGuardar.classList.add('pulsando');
    }
    if (cajaProgreso) cajaProgreso.classList.remove('oculto');
    if (textoProgreso) {
      textoProgreso.textContent = totalArchivos
        ? 'Subiendo ' + totalArchivos + ' archivo(s)...'
        : 'Guardando proyecto...';
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', form.action, true);

    xhr.upload.addEventListener('progress', function (ev) {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      if (barraProgreso) barraProgreso.style.width = pct + '%';
      if (porcentaje) porcentaje.textContent = pct + '%';
      if (pct >= 100 && textoProgreso) textoProgreso.textContent = 'Procesando en el servidor...';
    });

    xhr.addEventListener('load', function () {
      if (xhr.status >= 200 && xhr.status < 400) {
        window.location.href = xhr.responseURL || (esAlta ? '/admin' : window.location.href);
      } else {
        document.open();
        document.write(xhr.responseText);
        document.close();
      }
    });

    xhr.addEventListener('error', function () {
      if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.classList.remove('pulsando'); }
      if (cajaProgreso) cajaProgreso.classList.add('oculto');
      window.avisar('Se corto la conexion durante la subida. Intenta de nuevo.', 'error');
    });

    xhr.send(datos);
  });
})();
