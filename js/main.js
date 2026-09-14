// Todo el script espera a que el DOM esté completamente cargado
// antes de buscar elementos, evitando errores por referencias nulas.
document.addEventListener('DOMContentLoaded', function () {

  inicializarReducedMotion();
  inicializarDetallesProducto();
  inicializarBuscador();
  inicializarAgregarProducto();
  inicializarFetchOpiniones();

});


/* ============================================
   0. ACCESIBILIDAD - REDUCED MOTION
   Si el usuario activó "reducir movimiento" en su sistema,
   pausamos el autoplay del carrusel (Bootstrap se encarga
   de la transición instantánea vía CSS, ver styles.css).
   ============================================ */
function inicializarReducedMotion() {
  const prefiereMenosMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const carruselEl = document.getElementById('heroCarousel');

  if (prefiereMenosMovimiento && carruselEl) {
    // bootstrap.Carousel.getOrCreateInstance evita crear una segunda
    // instancia si Bootstrap ya inicializó el carrusel automáticamente.
    const instanciaCarrusel = bootstrap.Carousel.getOrCreateInstance(carruselEl);
    instanciaCarrusel.pause();
  }
}


/* ============================================
   1 y 2. MANIPULACIÓN DEL DOM + EVENTOS (click, mouseover)
   Agrega el precio a cada tarjeta existente y configura
   el botón "Ver detalles" (toggle) y el resaltado al pasar
   el mouse sobre la tarjeta.
   ============================================ */
function inicializarDetallesProducto() {
  const tarjetas = document.querySelectorAll('#listaProductos > li');

  tarjetas.forEach(function (tarjeta) {
    agregarPrecioYDetalles(tarjeta);
  });
}

// Construye y agrega dinámicamente el precio, el botón de detalles
// y el panel de detalles dentro de una tarjeta, usando createElement
// y appendChild (Paso 1 de la actividad).
function agregarPrecioYDetalles(tarjeta) {
  const cardBody = tarjeta.querySelector('.card-body');
  if (!cardBody) return;

  const precio = tarjeta.dataset.precio;

  // Precio: elemento <p> creado dinámicamente.
  const parrafoPrecio = document.createElement('p');
  parrafoPrecio.className = 'card-precio';
  parrafoPrecio.textContent = formatearPrecioCLP(precio);
  cardBody.appendChild(parrafoPrecio);

  // Panel de detalles, oculto por defecto.
  const panelDetalles = document.createElement('div');
  panelDetalles.className = 'card-detalles';
  panelDetalles.textContent = 'Producto verificado y revisado por nuestro equipo técnico. '
    + 'Incluye garantía de 30 días por defectos de origen.';
  cardBody.appendChild(panelDetalles);

  // Botón "Ver detalles".
  const botonDetalles = document.createElement('button');
  botonDetalles.type = 'button';
  botonDetalles.className = 'btn-detalles';
  botonDetalles.textContent = 'Ver detalles';
  cardBody.appendChild(botonDetalles);

  // Evento click: alterna la visibilidad del panel de detalles.
  botonDetalles.addEventListener('click', function () {
    const estaVisible = panelDetalles.classList.toggle('visible');
    botonDetalles.textContent = estaVisible ? 'Ocultar detalles' : 'Ver detalles';
  });

  // Eventos mouseover / mouseout: resaltan el precio mientras el
  // cursor está sobre la tarjeta completa (la clase .grid-productos
  // li:hover en CSS ya cubre el color; aquí reforzamos con una clase
  // para dejar explícito el manejo de mouseover pedido en la pauta).
  tarjeta.addEventListener('mouseover', function () {
    parrafoPrecio.classList.add('precio-resaltado');
  });
  tarjeta.addEventListener('mouseout', function () {
    parrafoPrecio.classList.remove('precio-resaltado');
  });
}

// Convierte un valor numérico en texto de precio con formato chileno.
function formatearPrecioCLP(valor) {
  const numero = Number(valor) || 0;
  return '$' + numero.toLocaleString('es-CL');
}


/* ============================================
   2. EVENTOS - SUBMIT (buscador de productos)
   ============================================ */
function inicializarBuscador() {
  const formulario = document.getElementById('formBuscador');
  const campoBusqueda = document.getElementById('buscarProducto');
  const mensaje = document.getElementById('mensajeBusqueda');

  if (!formulario) return;

  formulario.addEventListener('submit', function (event) {
    // Evita que el formulario recargue la página (comportamiento por
    // defecto de submit), ya que el filtrado se hace en el mismo DOM.
    event.preventDefault();

    const termino = campoBusqueda.value.trim().toLowerCase();
    const tarjetas = document.querySelectorAll('#listaProductos > li');
    let coincidencias = 0;

    tarjetas.forEach(function (tarjeta) {
      const titulo = tarjeta.querySelector('.card-title').textContent.toLowerCase();
      const coincide = termino === '' || titulo.includes(termino);
      tarjeta.classList.toggle('oculto', !coincide);
      if (coincide) coincidencias++;
    });

    mensaje.textContent = termino === ''
      ? ''
      : coincidencias + ' producto(s) encontrados para "' + campoBusqueda.value.trim() + '".';
  });
}


/* ============================================
   1. MANIPULACIÓN DEL DOM - Agregar producto destacado
   Crea una tarjeta completa desde cero con createElement
   y appendChild, y la inserta al final del grid.
   ============================================ */
function inicializarAgregarProducto() {
  const boton = document.getElementById('btnAgregarProducto');
  const lista = document.getElementById('listaProductos');

  if (!boton || !lista) return;

  // Catálogo simple de productos "sorpresa" para no repetir siempre
  // la misma tarjeta al hacer click varias veces.
  const catalogoNuevos = [
    { titulo: 'Game Boy Color', texto: 'Consola portátil retro, pantalla original.', precio: 120000, imagen: 'img/gbc.png' },
    { titulo: 'Sonic the Hedgehog - Mega Drive', texto: 'Cartucho original para Sega Mega Drive.', precio: 80000, imagen: 'img/sonic-mega-drive.png' },
    { titulo: 'Control NES clásico', texto: 'Control original para Nintendo NES.', precio: 60000, imagen: 'img/control-nes.png' }
  ];

  let indiceSiguiente = 0;

  boton.addEventListener('click', function () {
    const datos = catalogoNuevos[indiceSiguiente % catalogoNuevos.length];
    const nuevaTarjeta = crearTarjetaProducto(datos, lista.children.length + 1);
    lista.appendChild(nuevaTarjeta);
    indiceSiguiente++;
  });
}

// Construye una <li> completa (estructura idéntica a las tarjetas
// existentes) usando exclusivamente createElement y appendChild.
function crearTarjetaProducto(datos, numero) {
  const li = document.createElement('li');
  li.className = 'col-12 col-md-6 col-lg-4';
  li.id = 'prod-' + numero;
  li.dataset.precio = datos.precio;

  const card = document.createElement('div');
  card.className = 'card h-100';

  const figura = document.createElement('figure');
  figura.className = 'card-img-wrapper';

  const imagen = document.createElement('img');
  imagen.src = datos.imagen;
  imagen.className = 'card-img-producto';
  imagen.alt = datos.titulo;
  figura.appendChild(imagen);

  const cardBody = document.createElement('div');
  cardBody.className = 'card-body';

  const titulo = document.createElement('h3');
  titulo.className = 'card-title';
  titulo.textContent = datos.titulo;

  const texto = document.createElement('p');
  texto.className = 'card-text';
  texto.textContent = datos.texto;

  cardBody.appendChild(titulo);
  cardBody.appendChild(texto);

  card.appendChild(figura);
  card.appendChild(cardBody);
  li.appendChild(card);

  agregarPrecioYDetalles(li);

  return li;
}


/* ============================================
   3. FETCH API - Opiniones de la comunidad
   Carga datos externos (FakeStore API) al hacer click,
   maneja la promesa y sus posibles errores.
   ============================================ */
function inicializarFetchOpiniones() {
  const boton = document.getElementById('btnCargarOpiniones');
  const lista = document.getElementById('listaOpiniones');

  if (!boton || !lista) return;

  boton.addEventListener('click', function () {
    cargarOpiniones(lista, boton);
  });
}

// Realiza la solicitud HTTP a FakeStore API y renderiza el resultado.
// Usa .then()/.catch() explícitos para dejar visible el manejo de
// promesas y errores pedido en el Paso 3 de la actividad.
function cargarOpiniones(lista, boton) {
  boton.disabled = true;
  boton.textContent = 'Cargando...';
  lista.innerHTML = '';

  fetch('https://fakestoreapi.com/products?limit=4')
    .then(function (respuesta) {
      // Una respuesta HTTP con error (404, 500, etc.) no lanza una
      // excepción por sí sola: hay que verificar response.ok a mano.
      if (!respuesta.ok) {
        throw new Error('Error del servidor: ' + respuesta.status);
      }
      return respuesta.json();
    })
    .then(function (productos) {
      renderizarOpiniones(productos, lista);
    })
    .catch(function (error) {
      mostrarErrorOpiniones(lista, error);
    })
    .finally(function () {
      boton.disabled = false;
      boton.textContent = 'Cargar opiniones';
    });
}

// Genera una <li> por cada producto recibido, usando su rating
// como si fuera una opinión de la comunidad.
function renderizarOpiniones(productos, lista) {
  productos.forEach(function (producto) {
    const item = document.createElement('li');
    const nombre = document.createElement('strong');
    nombre.textContent = producto.title + ': ';

    const detalle = document.createElement('span');
    const calificacion = producto.rating ? producto.rating.rate : 'N/D';
    const cantidad = producto.rating ? producto.rating.count : 0;
    detalle.textContent = 'calificación ' + calificacion + '/5 (' + cantidad + ' reseñas)';

    item.appendChild(nombre);
    item.appendChild(detalle);
    lista.appendChild(item);
  });
}

// Muestra un mensaje de error legible en la interfaz, además de
// dejar el detalle técnico en consola para depuración.
function mostrarErrorOpiniones(lista, error) {
  console.error('Error al cargar opiniones desde Fetch API:', error);

  const item = document.createElement('li');
  item.className = 'opinion-error';
  item.textContent = 'No se pudieron cargar las opiniones en este momento. Intenta nuevamente más tarde.';
  lista.appendChild(item);
}