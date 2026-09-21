'use strict';

/* ============================================
   0. CONFIGURACIÓN Y ESTADO
   Las constantes y el estado viven en el ámbito del script (scope global del
   archivo) y se declaran ANTES de que corra cualquier función: las funciones
   declaradas con "function" sí se elevan (hoisting) y pueden invocarse antes de
   su definición, pero const/let/class no; quedan en zona muerta hasta su línea.
   ============================================ */
const URL_PRODUCTOS = 'assets/data/productos.json';
const URL_OPINIONES = 'https://fakestoreapi.com/products?limit=4';

// Categorías permitidas. El JSON solo puede usar estas claves (se valida al cargar).
const CATEGORIAS = { consolas: 'Consolas', juegos: 'Juegos', accesorios: 'Accesorios' };

// Parámetros de red configurables. Se pasan a obtenerJSON() y pueden
// sobrescribirse en cada llamada: obtenerJSON(url, { timeoutMs: 3000 }).
const CONFIG_FETCH = {
  timeoutMs: 8000, // tiempo máximo de espera por intento
  intentos: 3,     // intentos totales (1 inicial + 2 reintentos)
  esperaMs: 800    // pausa base entre intentos; crece con cada reintento
};

const formatoPrecio = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0
});

// Imagen de reemplazo embebida (no depende de otro archivo que también pueda fallar).
const IMAGEN_FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">'
  + '<rect width="800" height="400" fill="#ebdbb2"/>'
  + '<text x="400" y="210" text-anchor="middle" font-family="monospace" font-size="32" fill="#7c6f64">'
  + 'Imagen no disponible</text></svg>'
);

// Única fuente de verdad de la tienda: la interfaz se dibuja a partir de estos datos.
const tienda = {
  productos: [],       // catálogo validado (viene del JSON)
  carrito: [],         // líneas { id, cantidad }; el precio se consulta en "productos"
  categoria: 'todas',  // filtro activo del navbar
  termino: '',         // texto activo del buscador
  cargado: false       // true cuando el catálogo ya se cargó con éxito
};


// Todo el script espera a que el DOM esté completamente cargado
// antes de buscar elementos, evitando errores por referencias nulas.
document.addEventListener('DOMContentLoaded', function () {

  inicializarReducedMotion();
  inicializarFallbackImagenes(document.querySelectorAll('.hero-carousel img'));
  inicializarCategorias();
  inicializarCierreMenuMovil();
  inicializarBuscador();
  inicializarCarrito();
  inicializarCatalogo();
  inicializarOpiniones();

});


/* ============================================
   1. ACCESIBILIDAD - REDUCED MOTION
   Si el usuario activó "reducir movimiento" en su sistema,
   pausamos el autoplay del carrusel (Bootstrap se encarga
   de la transición instantánea vía CSS, ver styles.css).
   ============================================ */
function inicializarReducedMotion() {
  const carruselEl = document.getElementById('heroCarousel');

  // Si la CDN de Bootstrap no respondió, "bootstrap" no existe y usarlo lanzaría un
  // ReferenceError que impediría inicializar el resto de la página.
  if (!carruselEl || typeof bootstrap === 'undefined') return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // getOrCreateInstance evita crear una segunda instancia si Bootstrap
    // ya inicializó el carrusel automáticamente.
    bootstrap.Carousel.getOrCreateInstance(carruselEl).pause();
  }
}


/* ============================================
   2. CAPA DE RED - obtenerJSON
   Función reutilizable para todas las solicitudes: aplica timeout,
   reintentos con espera creciente y clasifica cada fallo por tipo,
   de modo que la interfaz pueda mostrar un mensaje específico.
   ============================================ */

// Error propio con un "tipo" que identifica la causa:
// 'timeout' | 'red' | 'archivo-local' | 'http' | 'json' | 'datos' | 'desconocido'
class ErrorCarga extends Error {
  constructor(tipo, mensaje, estadoHttp) {
    super(mensaje);
    this.name = 'ErrorCarga';
    this.tipo = tipo;
    this.estadoHttp = estadoHttp || null;
  }
}

function esperar(ms) {
  return new Promise(function (resolver) { setTimeout(resolver, ms); });
}

// Convierte cualquier excepción de fetch/json en un ErrorCarga con tipo.
function normalizarError(error) {
  if (error instanceof ErrorCarga) return error;

  // AbortController.abort() rechaza el fetch con AbortError: es nuestro timeout.
  if (error && error.name === 'AbortError') {
    return new ErrorCarga('timeout', 'La solicitud superó el tiempo máximo');
  }
  // response.json() lanza SyntaxError cuando el cuerpo no es JSON válido.
  if (error instanceof SyntaxError) {
    return new ErrorCarga('json', 'La respuesta no es JSON válido');
  }
  // fetch rechaza con TypeError ante fallos de red y bloqueos del navegador
  // (CORS, o abrir el HTML con file://, donde fetch no puede leer otros archivos).
  if (error instanceof TypeError) {
    return window.location.protocol === 'file:'
      ? new ErrorCarga('archivo-local', 'fetch no puede leer archivos con file://')
      : new ErrorCarga('red', 'No se pudo establecer la conexión');
  }
  return new ErrorCarga('desconocido', (error && error.message) || 'Error inesperado');
}

// Solo tiene sentido reintentar fallos que pueden ser pasajeros.
// Un 404 o un JSON mal formado no se arreglan repitiendo la solicitud.
function esReintentable(error) {
  return error.tipo === 'timeout'
    || error.tipo === 'red'
    || (error.tipo === 'http' && (error.estadoHttp >= 500 || error.estadoHttp === 429));
}

// Devuelve el JSON de la URL o lanza un ErrorCarga.
// opciones: { timeoutMs, intentos, esperaMs, alReintentar(intentoActual, total) }
async function obtenerJSON(url, opciones) {
  const config = Object.assign({}, CONFIG_FETCH, opciones);
  const intentos = Math.max(1, config.intentos);
  let ultimoError;

  for (let intento = 1; intento <= intentos; intento++) {
    // AbortController + setTimeout (en vez de AbortSignal.timeout) por compatibilidad
    // con navegadores más antiguos.
    const controlador = new AbortController();
    const temporizador = setTimeout(function () { controlador.abort(); }, config.timeoutMs);

    try {
      const respuesta = await fetch(url, { signal: controlador.signal });

      // Una respuesta HTTP con error (404, 500, etc.) no lanza una excepción
      // por sí sola: hay que verificar response.ok a mano.
      if (!respuesta.ok) {
        throw new ErrorCarga('http', 'Respuesta HTTP ' + respuesta.status, respuesta.status);
      }
      // El timeout sigue activo mientras se lee el cuerpo de la respuesta.
      return await respuesta.json();

    } catch (error) {
      ultimoError = normalizarError(error);
      if (!esReintentable(ultimoError) || intento === intentos) break;

      if (typeof config.alReintentar === 'function') config.alReintentar(intento + 1, intentos);
      await esperar(config.esperaMs * intento);

    } finally {
      // Se ejecuta en todos los caminos (éxito, error, break): evita timers colgados.
      clearTimeout(temporizador);
    }
  }
  throw ultimoError;
}

// Mensaje para la persona usuaria: dice qué pasó y qué puede hacer.
// El detalle técnico va a la consola, no a la pantalla.
function mensajeParaUsuario(error) {
  switch (error.tipo) {
    case 'timeout':
      return 'La carga está tardando más de lo esperado. Revisa tu conexión e inténtalo de nuevo.';
    case 'red':
      return 'No pudimos conectarnos. Revisa tu conexión a internet e inténtalo de nuevo.';
    case 'archivo-local':
      return 'Abriste la página directamente desde el disco y el navegador bloquea la carga de datos en ese modo. '
        + 'Usa la versión publicada en GitHub Pages o un servidor local (por ejemplo, Live Server).';
    case 'http':
      return error.estadoHttp === 404
        ? 'No encontramos los datos solicitados (error 404).'
        : 'El servidor respondió con un error (código ' + error.estadoHttp + '). Inténtalo más tarde.';
    case 'json':
      return 'Recibimos los datos, pero tienen un formato inválido.';
    case 'datos':
      return 'No hay información válida para mostrar en este momento.';
    default:
      return 'Ocurrió un error inesperado. Inténtalo nuevamente.';
  }
}


/* ============================================
   3. VALIDACIÓN DE DATOS EXTERNOS
   Nada que venga de un JSON o una API se inserta en el DOM sin revisar
   su forma. Los textos siempre se escriben con textContent (nunca innerHTML),
   así que aunque un dato traiga etiquetas HTML se muestran como texto plano.
   ============================================ */
function esTextoVacio(valor) {
  return typeof valor !== 'string' || valor.trim() === '';
}

// Devuelve el motivo por el que un producto no es válido, o '' si está correcto.
function detectarProblemaProducto(item, idsVistos) {
  if (item === null || typeof item !== 'object') return 'no es un objeto';
  if (!Number.isInteger(item.id) || item.id <= 0) return 'id inválido';
  if (idsVistos.has(item.id)) return 'id duplicado (' + item.id + ')';
  if (esTextoVacio(item.nombre)) return 'sin nombre';
  if (typeof item.precio !== 'number' || !Number.isFinite(item.precio) || item.precio < 0) return 'precio inválido';
  if (typeof item.categoria !== 'string' || !Object.prototype.hasOwnProperty.call(CATEGORIAS, item.categoria)) {
    return 'categoría desconocida';
  }
  if (esTextoVacio(item.imagen)) return 'sin imagen';
  if (item.descripcion !== undefined && typeof item.descripcion !== 'string') return 'descripción inválida';
  return '';
}

// Recibe lo que devolvió el JSON y entrega solo los productos utilizables,
// ya normalizados (textos recortados y valores por defecto).
function validarProductos(datos) {
  if (!Array.isArray(datos)) {
    throw new ErrorCarga('datos', 'Se esperaba una lista de productos');
  }

  const idsVistos = new Set();
  const validos = [];

  datos.forEach(function (item, posicion) {
    const problema = detectarProblemaProducto(item, idsVistos);
    if (problema) {
      // Una respuesta parcial no rompe la página: se omite el producto y se deja el motivo en consola.
      console.warn('[catálogo] Producto en la posición ' + posicion + ' omitido: ' + problema);
      return;
    }
    idsVistos.add(item.id);
    validos.push({
      id: item.id,
      nombre: item.nombre.trim(),
      descripcion: typeof item.descripcion === 'string' ? item.descripcion.trim() : '',
      precio: item.precio,
      categoria: item.categoria,
      imagen: item.imagen.trim(),
      alt: esTextoVacio(item.alt) ? item.nombre.trim() : item.alt.trim(),
      oferta: item.oferta === true
    });
  });

  return { validos: validos, omitidos: datos.length - validos.length };
}

// Opiniones de la API externa: solo se conservan las que traen título y calificación completos.
function validarOpiniones(datos) {
  if (!Array.isArray(datos)) {
    throw new ErrorCarga('datos', 'Se esperaba una lista de opiniones');
  }
  return datos.filter(function (item) {
    return item !== null && typeof item === 'object'
      && !esTextoVacio(item.title)
      && item.rating !== null && typeof item.rating === 'object'
      && Number.isFinite(item.rating.rate)
      && Number.isInteger(item.rating.count);
  });
}


/* ============================================
   4. ESTADOS DE LA INTERFAZ
   Un solo componente para los estados que puede tener una carga:
   cargando, error (con botón para reintentar), vacío e información.
   ============================================ */
function mostrarEstado(contenedor, tipo, mensaje, accion) {
  contenedor.textContent = '';
  contenedor.className = 'estado estado-' + tipo;

  if (tipo === 'cargando') {
    const spinner = document.createElement('span');
    spinner.className = 'spinner-border spinner-border-sm';
    spinner.setAttribute('aria-hidden', 'true');
    contenedor.appendChild(spinner);
  }

  const texto = document.createElement('span');
  texto.textContent = mensaje;
  contenedor.appendChild(texto);

  // accion (opcional): { texto, alClick } agrega un botón, por ejemplo "Reintentar".
  if (accion) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn btn-secundario';
    boton.textContent = accion.texto;
    boton.addEventListener('click', accion.alClick);
    contenedor.appendChild(boton);
  }
}

function limpiarEstado(contenedor) {
  contenedor.textContent = '';
  contenedor.className = 'estado';
}


/* ============================================
   5. IMÁGENES - FALLBACK
   Si una imagen no carga (evento "error"), se reemplaza por una imagen
   de reemplazo embebida. { once: true } evita un bucle si el reemplazo fallara.
   ============================================ */
function inicializarFallbackImagen(imagen) {
  imagen.addEventListener('error', function () {
    imagen.src = IMAGEN_FALLBACK;
  }, { once: true });
}

function inicializarFallbackImagenes(imagenes) {
  imagenes.forEach(function (imagen) {
    inicializarFallbackImagen(imagen);
    // En imágenes que ya estaban en el HTML, el error pudo ocurrir antes de registrar el
    // listener: complete + naturalWidth === 0 detecta esa imagen rota.
    if (imagen.complete && imagen.naturalWidth === 0 && imagen.getAttribute('src')) {
      imagen.src = IMAGEN_FALLBACK;
    }
  });
}


/* ============================================
   6. CATÁLOGO - carga con Fetch, filtros y renderizado
   ============================================ */
function inicializarCatalogo() {
  const lista = document.getElementById('listaProductos');
  if (!lista) return;

  // Delegación de eventos: UN listener en la lista atiende el click de todos los botones
  // "Agregar al carrito", incluso los de tarjetas que se vuelven a crear al filtrar.
  lista.addEventListener('click', function (event) {
    const boton = event.target.closest('[data-accion="agregar"]');
    if (!boton) return;

    const producto = agregarAlCarrito(Number(boton.dataset.id));
    if (producto) confirmarAgregado(boton, producto);
  });

  cargarCatalogo();
}

// Carga los productos desde el JSON local. async/await permite leer el flujo
// de arriba hacia abajo y concentrar todos los errores en un único try/catch.
async function cargarCatalogo() {
  const lista = document.getElementById('listaProductos');
  const contenedorEstado = document.getElementById('estadoCatalogo');

  lista.setAttribute('aria-busy', 'true');
  mostrarEstado(contenedorEstado, 'cargando', 'Cargando productos...');

  try {
    const datos = await obtenerJSON(URL_PRODUCTOS, {
      alReintentar: function (intento, total) {
        mostrarEstado(contenedorEstado, 'cargando', 'La conexión falló. Reintentando (' + intento + ' de ' + total + ')...');
      }
    });

    const resultado = validarProductos(datos);
    if (resultado.validos.length === 0) {
      throw new ErrorCarga('datos', 'El JSON no contiene productos válidos');
    }

    tienda.productos = resultado.validos;
    tienda.cargado = true;
    limpiarEstado(contenedorEstado);
    renderizarCatalogo();

  } catch (error) {
    const errorCarga = error instanceof ErrorCarga
      ? error
      : new ErrorCarga('desconocido', error && error.message);

    console.error('[catálogo] No se pudo cargar ' + URL_PRODUCTOS + ':', errorCarga);

    // En modo file:// reintentar no sirve; en cualquier otro caso se ofrece el botón.
    const accion = errorCarga.tipo === 'archivo-local'
      ? null
      : { texto: 'Reintentar', alClick: cargarCatalogo };
    mostrarEstado(contenedorEstado, 'error', mensajeParaUsuario(errorCarga), accion);

  } finally {
    lista.setAttribute('aria-busy', 'false');
  }
}

// Ignora mayúsculas y tildes: "sÚper" encuentra "Super".
function normalizarTexto(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Función pura: recibe la lista y los filtros, devuelve una lista nueva (Array.filter).
function filtrarProductos(productos, categoria, termino) {
  const buscado = normalizarTexto(termino);

  return productos.filter(function (producto) {
    const coincideCategoria = categoria === 'todas' || producto.categoria === categoria;
    const coincideTexto = buscado === '' || normalizarTexto(producto.nombre).includes(buscado);
    return coincideCategoria && coincideTexto;
  });
}

// Dibuja el catálogo según el estado actual (filtros incluidos).
function renderizarCatalogo() {
  if (!tienda.cargado) return;

  const lista = document.getElementById('listaProductos');
  const contenedorEstado = document.getElementById('estadoCatalogo');
  const productos = filtrarProductos(tienda.productos, tienda.categoria, tienda.termino);

  // DocumentFragment: las tarjetas se arman fuera del DOM y se insertan de una sola vez,
  // lo que evita recalcular el diseño de la página en cada tarjeta.
  const fragmento = document.createDocumentFragment();
  productos.forEach(function (producto) {
    fragmento.appendChild(crearTarjetaProducto(producto));
  });
  lista.textContent = '';
  lista.appendChild(fragmento);

  const hayFiltros = tienda.categoria !== 'todas' || tienda.termino !== '';

  if (productos.length === 0) {
    mostrarEstado(contenedorEstado, 'vacio', 'No encontramos productos con esos criterios.',
      { texto: 'Limpiar filtros', alClick: limpiarFiltros });
  } else if (hayFiltros) {
    mostrarEstado(contenedorEstado, 'info', describirFiltros(productos.length));
  } else {
    limpiarEstado(contenedorEstado);
  }
}

function describirFiltros(cantidad) {
  let texto = cantidad + (cantidad === 1 ? ' producto encontrado' : ' productos encontrados');
  if (tienda.categoria !== 'todas') texto += ' en ' + CATEGORIAS[tienda.categoria];
  if (tienda.termino !== '') texto += ' para "' + tienda.termino + '"';
  return texto + '.';
}

function limpiarFiltros() {
  const campo = document.getElementById('buscarProducto');

  tienda.categoria = 'todas';
  tienda.termino = '';
  if (campo) {
    campo.value = '';
    campo.focus(); // el botón "Limpiar filtros" desaparece al re-renderizar; el foco no debe perderse
  }
  marcarCategoriaActiva();
  renderizarCatalogo();
}

// Construye una <li> con la tarjeta de un producto usando createElement y appendChild.
// Todo texto entra por textContent; las rutas de imagen, por la propiedad src.
function crearTarjetaProducto(producto) {
  const li = document.createElement('li');
  li.className = 'col-12 col-md-6 col-lg-4';

  const card = document.createElement('div');
  card.className = 'card h-100' + (producto.oferta ? ' en-oferta' : '');

  // La etiqueta depende de un dato (oferta), no de la posición: sigue correcta al filtrar.
  if (producto.oferta) {
    const etiqueta = document.createElement('span');
    etiqueta.className = 'etiqueta-oferta';
    etiqueta.textContent = '¡Oferta!';
    card.appendChild(etiqueta);
  }

  const figura = document.createElement('figure');
  figura.className = 'card-img-wrapper';

  const imagen = document.createElement('img');
  imagen.className = 'card-img-producto';
  imagen.alt = producto.alt;
  imagen.loading = 'lazy'; // las imágenes fuera de pantalla se cargan cuando se acercan
  inicializarFallbackImagen(imagen); // primero el listener, después el src
  imagen.src = producto.imagen;
  figura.appendChild(imagen);

  const cardBody = document.createElement('div');
  cardBody.className = 'card-body';

  const titulo = document.createElement('h3');
  titulo.className = 'card-title';
  titulo.textContent = producto.nombre;

  const texto = document.createElement('p');
  texto.className = 'card-text';
  texto.textContent = producto.descripcion;

  const precio = document.createElement('p');
  precio.className = 'card-precio';
  precio.textContent = formatoPrecio.format(producto.precio);

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn btn-accion';
  boton.textContent = 'Agregar al carrito';
  boton.dataset.accion = 'agregar';
  boton.dataset.id = producto.id;
  // Varios botones dicen lo mismo: la etiqueta indica de qué producto se trata.
  boton.setAttribute('aria-label', 'Agregar ' + producto.nombre + ' al carrito');

  cardBody.appendChild(titulo);
  cardBody.appendChild(texto);
  cardBody.appendChild(precio);
  cardBody.appendChild(boton);

  card.appendChild(figura);
  card.appendChild(cardBody);
  li.appendChild(card);

  return li;
}


/* ============================================
   7. EVENTOS - CATEGORÍAS (click) Y BUSCADOR (submit)
   ============================================ */
function inicializarCategorias() {
  const menu = document.getElementById('menuPrincipal');
  if (!menu) return;

  // Delegación: un listener en el menú atiende todos los enlaces con data-categoria.
  // No se llama a preventDefault: el enlace debe seguir llevando a #productos.
  menu.addEventListener('click', function (event) {
    const enlace = event.target.closest('[data-categoria]');
    if (!enlace) return;

    tienda.categoria = enlace.dataset.categoria;
    marcarCategoriaActiva();
    renderizarCatalogo();
  });

  marcarCategoriaActiva();
}

// Marca en el dropdown la categoría vigente (clase visual y aria-current para lectores de pantalla).
function marcarCategoriaActiva() {
  document.querySelectorAll('.dropdown-item[data-categoria]').forEach(function (item) {
    const activa = item.dataset.categoria === tienda.categoria;
    item.classList.toggle('active', activa);
    if (activa) {
      item.setAttribute('aria-current', 'true');
    } else {
      item.removeAttribute('aria-current');
    }
  });
}

// En móvil el menú hamburguesa queda abierto después de tocar un enlace. Se cierra al elegir
// cualquier enlace de ancla, excepto "Categorías", que solo despliega su submenú.
function inicializarCierreMenuMovil() {
  const menu = document.getElementById('menuPrincipal');
  const toggler = document.querySelector('.navbar-toggler');
  if (!menu || !toggler) return;

  menu.addEventListener('click', function (event) {
    const enlace = event.target.closest('a[href^="#"]');
    if (!enlace || enlace.classList.contains('dropdown-toggle') || !menu.classList.contains('show')) return;

    menu.classList.remove('show');
    toggler.classList.add('collapsed');
    toggler.setAttribute('aria-expanded', 'false');
  });
}

function inicializarBuscador() {
  const formulario = document.getElementById('formBuscador');
  const campo = document.getElementById('buscarProducto');
  if (!formulario || !campo) return;

  formulario.addEventListener('submit', function (event) {
    // Evita que el formulario recargue la página (comportamiento por
    // defecto de submit), ya que el filtrado se hace en el mismo DOM.
    event.preventDefault();

    tienda.termino = campo.value.trim();
    renderizarCatalogo(); // si el catálogo aún no carga, el término queda guardado y se aplica después
  });
}


/* ============================================
   8. CARRITO - estado, operaciones y renderizado
   Las operaciones solo modifican tienda.carrito; renderizarCarrito()
   vuelve a dibujar la interfaz a partir de ese estado.
   ============================================ */
function buscarProducto(id) {
  return tienda.productos.find(function (producto) { return producto.id === id; });
}

// Agrega una unidad (o crea la línea). Devuelve el producto, o null si el id no existe.
function agregarAlCarrito(id) {
  const producto = buscarProducto(id);
  if (!producto) return null;

  const linea = tienda.carrito.find(function (item) { return item.id === id; });
  if (linea) {
    linea.cantidad += 1;
  } else {
    tienda.carrito.push({ id: id, cantidad: 1 });
  }
  renderizarCarrito();
  return producto;
}

function cambiarCantidad(id, diferencia) {
  const linea = tienda.carrito.find(function (item) { return item.id === id; });
  if (!linea) return;

  linea.cantidad += diferencia;
  if (linea.cantidad <= 0) {
    eliminarDelCarrito(id);
    return;
  }
  renderizarCarrito();
}

function eliminarDelCarrito(id) {
  tienda.carrito = tienda.carrito.filter(function (item) { return item.id !== id; });
  renderizarCarrito();
}

function vaciarCarrito() {
  tienda.carrito = [];
  renderizarCarrito();
}

// Array.reduce: recorre las líneas una vez y acumula cantidad de artículos y total en pesos.
function calcularResumen() {
  return tienda.carrito.reduce(function (resumen, linea) {
    const producto = buscarProducto(linea.id);
    if (!producto) return resumen;

    resumen.articulos += linea.cantidad;
    resumen.total += producto.precio * linea.cantidad;
    return resumen;
  }, { articulos: 0, total: 0 });
}

function textoArticulos(cantidad) {
  return cantidad + (cantidad === 1 ? ' artículo' : ' artículos');
}

function inicializarCarrito() {
  const lista = document.getElementById('listaCarrito');
  const botonVaciar = document.getElementById('btnVaciarCarrito');
  if (!lista || !botonVaciar) return;

  // Delegación: un solo listener atiende los botones +, − y Quitar de todas las líneas.
  lista.addEventListener('click', function (event) {
    const boton = event.target.closest('button[data-accion]');
    if (!boton) return;

    const id = Number(boton.dataset.id);
    const accion = boton.dataset.accion;

    if (accion === 'sumar') cambiarCantidad(id, 1);
    else if (accion === 'restar') cambiarCantidad(id, -1);
    else if (accion === 'eliminar') eliminarDelCarrito(id);

    restaurarFoco(lista, accion, id);
  });

  botonVaciar.addEventListener('click', function () {
    vaciarCarrito();
    document.getElementById('tituloCarrito').focus();
  });

  renderizarCarrito();
}

// Al redibujar la lista se destruyen los botones; sin esto, quien navega con teclado
// pierde el foco y tiene que volver a recorrer toda la página.
function restaurarFoco(lista, accion, id) {
  const mismoBoton = lista.querySelector('button[data-accion="' + accion + '"][data-id="' + id + '"]');
  (mismoBoton || document.getElementById('tituloCarrito')).focus();
}

function renderizarCarrito() {
  const lista = document.getElementById('listaCarrito');
  const mensajeVacio = document.getElementById('carritoVacio');
  const resumenEl = document.getElementById('resumenCarrito');
  if (!lista || !mensajeVacio || !resumenEl) return;

  const fragmento = document.createDocumentFragment();
  tienda.carrito.forEach(function (linea) {
    const producto = buscarProducto(linea.id);
    if (producto) fragmento.appendChild(crearItemCarrito(producto, linea.cantidad));
  });
  lista.textContent = '';
  lista.appendChild(fragmento);

  const resumen = calcularResumen();
  const estaVacio = tienda.carrito.length === 0;

  mensajeVacio.hidden = !estaVacio;
  resumenEl.hidden = estaVacio;
  document.getElementById('cantidadCarrito').textContent = textoArticulos(resumen.articulos);
  document.getElementById('totalCarrito').textContent = formatoPrecio.format(resumen.total);
  document.getElementById('contadorCarrito').textContent = resumen.articulos;
}

function crearBotonCarrito(accion, id, texto, etiquetaAria) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn btn-secundario btn-carrito';
  boton.textContent = texto;
  boton.dataset.accion = accion;
  boton.dataset.id = id;
  boton.setAttribute('aria-label', etiquetaAria);
  return boton;
}

// Construye una línea del carrito: nombre, controles de cantidad, subtotal y botón Quitar.
function crearItemCarrito(producto, cantidad) {
  const li = document.createElement('li');
  li.className = 'item-carrito';

  const nombre = document.createElement('span');
  nombre.className = 'item-nombre';
  nombre.textContent = producto.nombre;

  const controles = document.createElement('span');
  controles.className = 'item-cantidad';

  const cantidadEl = document.createElement('span');
  cantidadEl.className = 'item-unidades';
  cantidadEl.textContent = cantidad;

  controles.appendChild(crearBotonCarrito('restar', producto.id, '−', 'Quitar una unidad de ' + producto.nombre));
  controles.appendChild(cantidadEl);
  controles.appendChild(crearBotonCarrito('sumar', producto.id, '+', 'Agregar una unidad de ' + producto.nombre));

  const subtotal = document.createElement('span');
  subtotal.className = 'item-subtotal';
  subtotal.textContent = formatoPrecio.format(producto.precio * cantidad);

  li.appendChild(nombre);
  li.appendChild(controles);
  li.appendChild(subtotal);
  li.appendChild(crearBotonCarrito('eliminar', producto.id, 'Quitar', 'Quitar ' + producto.nombre + ' del carrito'));

  return li;
}

// Confirma visualmente (el botón cambia a "Agregado") y por voz (región aria-live oculta)
// que el producto entró al carrito, aunque el carrito no esté visible en pantalla.
function confirmarAgregado(boton, producto) {
  clearTimeout(Number(boton.dataset.temporizador)); // si se hace click seguido, reinicia la cuenta
  boton.textContent = '✔ Agregado';
  boton.classList.add('agregado');
  boton.dataset.temporizador = setTimeout(function () {
    boton.textContent = 'Agregar al carrito';
    boton.classList.remove('agregado');
  }, 1200);

  const anuncio = document.getElementById('anuncioCarrito');
  if (anuncio) {
    anuncio.textContent = producto.nombre + ' agregado al carrito. En el carrito: '
      + textoArticulos(calcularResumen().articulos) + '.';
  }
}


/* ============================================
   9. FETCH API EXTERNA - Opiniones de la comunidad
   Carga datos de FakeStore API al hacer click. Reutiliza obtenerJSON
   (timeout, reintentos) y la misma validación y estados que el catálogo.
   ============================================ */
function inicializarOpiniones() {
  const boton = document.getElementById('btnCargarOpiniones');
  if (!boton) return;

  boton.addEventListener('click', cargarOpiniones);
}

async function cargarOpiniones() {
  const boton = document.getElementById('btnCargarOpiniones');
  const lista = document.getElementById('listaOpiniones');
  const contenedorEstado = document.getElementById('estadoOpiniones');

  boton.disabled = true;
  boton.textContent = 'Cargando...';
  lista.textContent = '';
  mostrarEstado(contenedorEstado, 'cargando', 'Cargando opiniones...');

  try {
    const datos = await obtenerJSON(URL_OPINIONES, {
      alReintentar: function (intento, total) {
        mostrarEstado(contenedorEstado, 'cargando', 'La conexión falló. Reintentando (' + intento + ' de ' + total + ')...');
      }
    });

    const opiniones = validarOpiniones(datos);
    if (opiniones.length === 0) {
      throw new ErrorCarga('datos', 'La API no devolvió opiniones válidas');
    }

    limpiarEstado(contenedorEstado);
    renderizarOpiniones(opiniones, lista);

  } catch (error) {
    const errorCarga = error instanceof ErrorCarga
      ? error
      : new ErrorCarga('desconocido', error && error.message);

    console.error('[opiniones] No se pudo cargar ' + URL_OPINIONES + ':', errorCarga);
    mostrarEstado(contenedorEstado, 'error', mensajeParaUsuario(errorCarga),
      { texto: 'Reintentar', alClick: cargarOpiniones });

  } finally {
    boton.disabled = false;
    boton.textContent = 'Cargar opiniones';
  }
}

// Genera una <li> por cada opinión válida, usando su rating como opinión de la comunidad.
function renderizarOpiniones(opiniones, lista) {
  const fragmento = document.createDocumentFragment();

  opiniones.forEach(function (opinion) {
    const item = document.createElement('li');

    const nombre = document.createElement('strong');
    nombre.textContent = opinion.title + ': ';

    const detalle = document.createElement('span');
    detalle.textContent = 'calificación ' + opinion.rating.rate + '/5 (' + opinion.rating.count + ' reseñas)';

    item.appendChild(nombre);
    item.appendChild(detalle);
    fragmento.appendChild(item);
  });

  lista.appendChild(fragmento);
}