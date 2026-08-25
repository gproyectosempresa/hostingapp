/* =========================================================================
   Comportamiento general de la plataforma
   ========================================================================= */
(function () {
  'use strict';

  /* ------------------------------ avisos ------------------------------ */

  const tostada = document.getElementById('tostada');
  const tostadaTxt = document.getElementById('tostadaTxt');
  let tiempoTostada = null;

  window.avisar = function (texto, tipo) {
    if (!tostada) return;
    tostadaTxt.textContent = texto;
    tostada.className = 'tostada visible' + (tipo ? ' ' + tipo : '');
    clearTimeout(tiempoTostada);
    tiempoTostada = setTimeout(function () {
      tostada.className = 'tostada' + (tipo ? ' ' + tipo : '');
    }, 2600);
  };

  /* --------------------------- menu de usuario --------------------------- */

  const menu = document.getElementById('menuUsuario');
  if (menu) {
    const boton = menu.querySelector('.avatar');
    boton.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.toggle('abierto');
    });
    document.addEventListener('click', function () { menu.classList.remove('abierto'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') menu.classList.remove('abierto');
    });
  }

  /* ------------------------------ copiar ------------------------------ */

  function copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (resolve, reject) {
      const area = document.createElement('textarea');
      area.value = texto;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        resolve();
      } catch (err) {
        reject(err);
      }
      document.body.removeChild(area);
    });
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.copiar');
    if (!btn) return;
    e.preventDefault();
    const texto = btn.getAttribute('data-link') || '';
    copiarTexto(texto).then(function () {
      const original = btn.innerHTML;
      btn.classList.add('listo');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Copiado';
      window.avisar('Enlace copiado. Ya lo puedes pegar en tu app de NFC.', 'exito');
      setTimeout(function () {
        btn.classList.remove('listo');
        btn.innerHTML = original;
      }, 2200);
    }).catch(function () {
      window.prompt('Copia el enlace manualmente:', texto);
    });
  });

  /* --------------------------- confirmaciones --------------------------- */

  document.addEventListener('submit', function (e) {
    const form = e.target.closest('form.confirmar');
    if (!form) return;
    const mensaje = form.getAttribute('data-confirmar') || 'Seguro que quieres continuar?';
    if (!window.confirm(mensaje)) e.preventDefault();
  });

  /* ------------------------------ pestanas ------------------------------ */

  const barraPestanas = document.getElementById('pestanas');
  if (barraPestanas) {
    const pestanas = barraPestanas.querySelectorAll('.pestana');

    function activar(nombre, guardar) {
      let encontrada = false;
      pestanas.forEach(function (p) {
        const suyo = p.getAttribute('data-panel');
        const panel = document.getElementById('panel-' + suyo);
        const activa = suyo === nombre;
        p.classList.toggle('activa', activa);
        if (panel) panel.classList.toggle('activo', activa);
        if (activa) encontrada = true;
      });
      if (encontrada && guardar && history.replaceState) {
        history.replaceState(null, '', '#' + nombre);
      }
    }

    pestanas.forEach(function (p) {
      p.addEventListener('click', function () { activar(p.getAttribute('data-panel'), true); });
    });

    const hash = (location.hash || '').replace('#', '');
    if (hash) activar(hash, false);
  }

  /* --------------------------- buscadores simples --------------------------- */

  function conectarBuscador(idInput, selector) {
    const input = document.getElementById(idInput);
    if (!input) return;
    input.addEventListener('input', function () {
      const q = input.value.trim().toLowerCase();
      document.querySelectorAll(selector).forEach(function (el) {
        const texto = el.getAttribute('data-buscar') || el.textContent.toLowerCase();
        el.style.display = !q || texto.indexOf(q) >= 0 ? '' : 'none';
      });
    });
  }

  conectarBuscador('buscarPlano', '#listaPlanos .doc');
  conectarBuscador('buscarDoc', '#listaDocs .doc');
  conectarBuscador('buscarPiezaAdmin', '#tablaPiezas tr');

  /* ------------------------- visor 3D bajo demanda ------------------------- */

  const btnVisor = document.getElementById('btnVisor');
  if (btnVisor) {
    btnVisor.addEventListener('click', function () {
      const caja = document.getElementById('cajaVisor');
      const marco = document.getElementById('marcoVisor');
      const abierto = !caja.classList.contains('oculto');
      if (abierto) {
        caja.classList.add('oculto');
        btnVisor.querySelector('span').textContent = 'Mostrar visor';
      } else {
        if (!marco.src) marco.src = marco.getAttribute('data-src');
        caja.classList.remove('oculto');
        btnVisor.querySelector('span').textContent = 'Ocultar visor';
        caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  /* --------------------------- avisos temporales --------------------------- */

  document.querySelectorAll('[data-flash]').forEach(function (el) {
    setTimeout(function () {
      el.style.transition = 'opacity .4s, transform .4s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      setTimeout(function () { el.remove(); }, 400);
    }, 9000);
  });

  /* ------------------------- vista previa del slug ------------------------- */

  const campoNombre = document.getElementById('name');
  const campoSlug = document.getElementById('slug');
  const vistaSlug = document.getElementById('vistaSlug');
  if (vistaSlug && campoNombre) {
    const aSlug = function (t) {
      return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    };
    const pintar = function () {
      const base = (campoSlug && campoSlug.value) || campoNombre.value;
      vistaSlug.textContent = aSlug(base) || 'nombre-del-proyecto';
    };
    campoNombre.addEventListener('input', pintar);
    if (campoSlug) campoSlug.addEventListener('input', pintar);
    pintar();
  }
})();
