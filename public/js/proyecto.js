/* =========================================================================
   Pagina del proyecto: checklist, filtros y detalle de pieza
   ========================================================================= */
(function () {
  'use strict';

  const P = window.PROYECTO || { etapas: ['Fabricado'] };
  const etapas = P.etapas || ['Fabricado'];

  /* --------------------------- guardar checklist --------------------------- */

  function actualizarPieza(fila) {
    const casillas = fila.querySelectorAll('.chk');
    let todas = casillas.length > 0;
    casillas.forEach(function (c) { if (!c.checked) todas = false; });
    fila.classList.toggle('lista', todas);
    fila.setAttribute('data-completa', todas ? '1' : '0');
  }

  function pintarAvance(stats) {
    const anillo = document.getElementById('anilloAvance');
    const anilloTxt = document.getElementById('anilloTxt');
    if (anillo) {
      const r = 31;
      const circ = 2 * Math.PI * r;
      anillo.setAttribute('stroke-dashoffset', String(circ * (1 - stats.avance / 100)));
    }
    if (anilloTxt) anilloTxt.textContent = stats.avance + '%';

    const heroCompletas = document.getElementById('heroCompletas');
    if (heroCompletas) heroCompletas.textContent = stats.completas;

    const barraPeso = document.getElementById('barraPeso');
    if (barraPeso) barraPeso.style.width = stats.avancePeso + '%';
    const avancePesoTxt = document.getElementById('avancePesoTxt');
    if (avancePesoTxt) avancePesoTxt.textContent = stats.avancePeso + '%';
    const pesoTerminado = document.getElementById('pesoTerminado');
    if (pesoTerminado) pesoTerminado.innerHTML = stats.pesoCompleto + ' <span>kg</span>';
  }

  document.addEventListener('change', function (e) {
    const chk = e.target.closest('.chk');
    if (!chk) return;

    const fila = chk.closest('.pieza');
    const pieceId = chk.getAttribute('data-pieza');
    const etapa = chk.getAttribute('data-etapa');
    const valor = chk.checked;

    chk.disabled = true;
    fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ piece_id: Number(pieceId), stage: etapa, checked: valor })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        chk.disabled = false;
        if (!data.ok) throw new Error(data.error || 'Error');
        if (fila) actualizarPieza(fila);
        pintarAvance(data.stats);
        if (navigator.vibrate) navigator.vibrate(valor ? 28 : 12);
        window.avisar(valor ? 'Marcado: ' + etapa : 'Se quito la marca de ' + etapa, valor ? 'exito' : '');
        aplicarFiltros();
      })
      .catch(function () {
        chk.disabled = false;
        chk.checked = !valor;
        window.avisar('No se pudo guardar. Revisa tu conexion e intenta de nuevo.', 'error');
      });
  });

  /* ------------------------------ filtros ------------------------------ */

  const inputBuscar = document.getElementById('buscarPieza');
  const botonesFiltro = document.querySelectorAll('.filtro[data-filtro]');
  const sinResultados = document.getElementById('sinResultados');
  let filtroActual = 'todas';
  let loteActual = '';

  function aplicarFiltros() {
    const q = inputBuscar ? inputBuscar.value.trim().toLowerCase() : '';
    let visibles = 0;

    document.querySelectorAll('.pieza').forEach(function (fila) {
      const texto = fila.getAttribute('data-buscar') || '';
      const completa = fila.getAttribute('data-completa') === '1';
      const lote = fila.getAttribute('data-lote') || '';

      let ok = !q || texto.indexOf(q) >= 0;
      if (ok && filtroActual === 'pendientes') ok = !completa;
      if (ok && filtroActual === 'listas') ok = completa;
      if (ok && filtroActual === 'lote') ok = lote === loteActual;

      fila.style.display = ok ? '' : 'none';
      if (ok) visibles++;
    });

    document.querySelectorAll('.grupo-lote').forEach(function (g) {
      const algo = Array.prototype.some.call(g.querySelectorAll('.pieza'), function (p) {
        return p.style.display !== 'none';
      });
      g.style.display = algo ? '' : 'none';
    });

    if (sinResultados) sinResultados.classList.toggle('oculto', visibles > 0);
  }

  if (inputBuscar) inputBuscar.addEventListener('input', aplicarFiltros);

  botonesFiltro.forEach(function (b) {
    b.addEventListener('click', function () {
      botonesFiltro.forEach(function (x) { x.classList.remove('activo'); });
      b.classList.add('activo');
      filtroActual = b.getAttribute('data-filtro');
      loteActual = b.getAttribute('data-lote') || '';
      aplicarFiltros();
    });
  });

  /* ---------------------------- plegar lotes ---------------------------- */

  document.querySelectorAll('.grupo-cab').forEach(function (cab) {
    cab.addEventListener('click', function () {
      cab.parentNode.classList.toggle('cerrado');
    });
  });

  /* -------------------------- detalle de pieza -------------------------- */

  const cajon = document.getElementById('cajonPieza');
  const cortina = document.getElementById('cortina');
  const cajonCuerpo = document.getElementById('cajonCuerpo');
  const cajonMarca = document.getElementById('cajonMarca');
  const cajonDesc = document.getElementById('cajonDesc');

  function cerrarCajon() {
    if (cajon) cajon.classList.remove('visible');
    if (cortina) cortina.classList.remove('visible');
  }

  function iconoDoc(ext) {
    const e = String(ext || '').toLowerCase();
    if (e === '.pdf') return 'doc-pdf';
    if (e === '.dxf') return 'doc-dxf';
    if (e === '.dwg' || e === '.dwf') return 'doc-dwg';
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].indexOf(e) >= 0) return 'doc-img';
    if (['.ifc', '.rvt', '.nwd', '.nwc', '.step', '.stp'].indexOf(e) >= 0) return 'doc-3d';
    return 'doc-otro';
  }

  function escapar(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function numero(n) {
    return Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
  }

  function abrirPieza(id) {
    if (!cajon) return;
    cajonCuerpo.innerHTML = '<div class="centro pulsando txt-suave" style="padding:40px 0">Cargando...</div>';
    cajon.classList.add('visible');
    cortina.classList.add('visible');

    fetch('/api/pieza/' + id)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error();
        const p = data.piece;
        cajonMarca.textContent = p.mark;
        cajonDesc.textContent = p.description || '';

        let html = '';

        html += '<div class="rejilla rejilla-2" style="gap:10px">';
        html += '<div class="metrica"><div class="etq">Cantidad</div><div class="val">' + numero(p.qty) + '</div></div>';
        html += '<div class="metrica naranja"><div class="etq">Peso total</div><div class="val">' + numero(p.total_weight) + ' <span>kg</span></div></div>';
        html += '</div>';

        html += '<table class="tabla mt-2" style="min-width:0"><tbody>';
        if (p.drawing) html += '<tr><td class="txt-suave">Dibujo</td><td class="negrita txt-tinta mono">' + escapar(p.drawing) + '</td></tr>';
        if (p.profile) html += '<tr><td class="txt-suave">Perfil</td><td class="negrita txt-tinta">' + escapar(p.profile) + '</td></tr>';
        if (p.material) html += '<tr><td class="txt-suave">Material</td><td class="negrita txt-tinta">' + escapar(p.material) + '</td></tr>';
        html += '<tr><td class="txt-suave">Peso unitario</td><td class="negrita txt-tinta">' + numero(p.unit_weight) + ' kg</td></tr>';
        if (p.lot) html += '<tr><td class="txt-suave">Lote</td><td class="negrita txt-tinta">' + escapar(p.lot) + '</td></tr>';
        html += '</tbody></table>';

        /* estado del checklist */
        html += '<h3 class="mt-3 mb-1">Checklist</h3>';
        const mapa = {};
        (data.checks || []).forEach(function (c) { if (c.checked) mapa[c.stage] = c; });
        html += '<div>';
        (data.stages || etapas).forEach(function (s) {
          const c = mapa[s];
          html += '<div class="fila" style="padding:8px 0;border-bottom:1px solid var(--linea)">' +
            '<span class="chip ' + (c ? 'chip-verde' : 'chip-gris') + ' chip-punto">' + escapar(s) + '</span>' +
            '<div class="crece txt-chico txt-suave">' +
            (c ? 'Marcado por <b class="txt-tinta">' + escapar(c.user_name || 'alguien') + '</b>' : 'Pendiente') +
            '</div></div>';
        });
        html += '</div>';

        /* planos de la pieza */
        html += '<h3 class="mt-3 mb-1">Planos de esta pieza</h3>';
        if (!data.docs.length) {
          html += '<p class="txt-suave txt-chico">No se encontraron planos con esta marca en el nombre del archivo.</p>';
        } else {
          data.docs.forEach(function (d) {
            html += '<a class="doc" href="/ver/' + d.id + '">' +
              '<span class="doc-icono ' + iconoDoc(d.ext) + '">' + escapar(String(d.ext || '').replace('.', '')) + '</span>' +
              '<span class="doc-datos"><span class="doc-nombre">' + escapar(d.original_name) + '</span>' +
              '<span class="doc-meta"><span>' + escapar(d.size_h) + '</span></span></span></a>';
          });
        }

        cajonCuerpo.innerHTML = html;
      })
      .catch(function () {
        cajonCuerpo.innerHTML = '<div class="aviso aviso-error"><div>No se pudo cargar la informacion de la pieza.</div></div>';
      });
  }

  document.addEventListener('click', function (e) {
    const abrir = e.target.closest('[data-abrir]');
    if (abrir) {
      abrirPieza(abrir.getAttribute('data-abrir'));
      return;
    }
    if (e.target.closest('#cerrarCajon') || e.target.id === 'cortina') cerrarCajon();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') cerrarCajon();
  });

  /* deslizar hacia abajo para cerrar en celular */
  if (cajon) {
    let inicio = null;
    cajon.addEventListener('touchstart', function (e) {
      if (cajon.querySelector('.cajon-cuerpo').scrollTop > 4) return;
      inicio = e.touches[0].clientY;
    }, { passive: true });
    cajon.addEventListener('touchmove', function (e) {
      if (inicio == null) return;
      const dy = e.touches[0].clientY - inicio;
      if (dy > 90) { cerrarCajon(); inicio = null; }
    }, { passive: true });
    cajon.addEventListener('touchend', function () { inicio = null; });
  }
})();
