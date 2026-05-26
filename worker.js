// worker.js - Cloudflare Worker para UBAC
// Mejorado con caché, manejo de rutas, y sistema de splash

const SECCIONES_VALIDAS = new Set([
  'main', 'settings', 'propuestas', 'periodico', 'empresa',
  'identidad', 'votaciones', 'trueque', 'ciudadanos'
]);

// Configuración
const CONFIG = {
  CACHE_NAME: 'ubac-v1',
  CACHE_TTL: 3600, // 1 hora en segundos
  SPLASH_ENABLED: true,
  SPLASH_MODE: 'first_visit' // 'first_visit' | 'always' | 'never'
};

// HTML del splash (versión mejorada)
const SPLASH_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>UBAC · Un mundo digital</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{min-height:100vh;background:#e8e5df;display:flex;align-items:center;justify-content:center;font-family:'Georgia','Times New Roman',serif}
        .loading-container{background:#fffef7;padding:60px 50px;max-width:550px;width:90%;margin:20px;box-shadow:0 20px 40px rgba(0,0,0,0.05);text-align:center;position:relative;animation:fadeIn 0.8s ease-out}
        .loading-container::before{content:'';position:absolute;top:20px;left:20px;right:20px;bottom:20px;border:1px solid rgba(0,0,0,0.05);pointer-events:none}
        .ubac-title{font-size:72px;letter-spacing:4px;font-weight:normal;color:#1a1a1a;margin-bottom:10px;animation:pulse 2s ease-in-out infinite}
        .ubac-subtitle{font-size:11px;letter-spacing:3px;color:#888;text-transform:uppercase;margin-bottom:40px;padding-bottom:20px;border-bottom:1px solid #ddd;display:inline-block}
        .loading-dots{font-size:14px;color:#444;margin:30px 0 20px;font-family:'Courier New',monospace}
        .loading-dots span{animation:blink 1.4s infinite;display:inline-block}
        .loading-dots span:nth-child(2){animation-delay:0.2s}
        .loading-dots span:nth-child(3){animation-delay:0.4s}
        .loading-dots span:nth-child(4){animation-delay:0.6s}
        .progress-bar{width:100%;height:2px;background:repeating-linear-gradient(90deg,#ddd,#ddd 10px,transparent 10px,transparent 20px);margin:30px 0 20px;position:relative;overflow:hidden}
        .progress-fill{position:absolute;left:0;top:0;height:100%;width:0%;background:#1a1a1a;animation:progress 2s ease-in-out infinite}
        .status-message{font-size:13px;color:#666;font-style:italic;margin:20px 0 10px;font-family:'Courier New',monospace}
        .decorative-line{width:60px;height:1px;background:#ddd;margin:25px auto 0}
        .hash-placeholder{font-family:'Courier New',monospace;font-size:10px;color:#aaa;margin-top:25px;letter-spacing:1px}
        @keyframes fadeIn{from{opacity:0;transform:scale(0.98)}to{opacity:1;transform:scale(1)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.7}}
        @keyframes blink{0%,20%{opacity:0}50%{opacity:1}100%{opacity:0}}
        @keyframes progress{0%{width:0%;left:0}50%{width:70%;left:0}100%{width:0%;left:100%}}
        @media(max-width:480px){.loading-container{padding:40px 30px}.ubac-title{font-size:48px}}
        @media(prefers-color-scheme:dark){body{background:#1a1a1a}.loading-container{background:#2a2a2a;box-shadow:0 20px 40px rgba(0,0,0,0.3)}.ubac-title{color:#fffef7}.status-message{color:#999}.progress-bar{background:repeating-linear-gradient(90deg,#444,#444 10px,#2a2a2a 10px,#2a2a2a 20px)}.progress-fill{background:#fffef7}.hash-placeholder{color:#555}}
    </style>
</head>
<body>
    <div class="loading-container">
        <div class="ubac-title">UBAC</div>
        <div class="ubac-subtitle">Un mundo digital</div>
        <div class="loading-dots">Cargando identidad<span>.</span><span>.</span><span>.</span></div>
        <div class="progress-bar"><div class="progress-fill"></div></div>
        <div class="status-message" id="statusMessage">Verificando hash VUB-25</div>
        <div class="decorative-line"></div>
        <div class="hash-placeholder" id="hashPlaceholder">██████████████</div>
    </div>
    <script>
        const messages = ["Verificando hash VUB-25","Conectando con Firebase","Cargando configuración","Preparando tu identidad digital","Casi listo..."];
        let messageIndex = 0;
        const statusElement = document.getElementById('statusMessage');
        const hashElement = document.getElementById('hashPlaceholder');
        const messageInterval = setInterval(() => {
            messageIndex++;
            if (messageIndex < messages.length) {
                statusElement.style.opacity = '0';
                setTimeout(() => {
                    statusElement.textContent = messages[messageIndex];
                    statusElement.style.opacity = '1';
                }, 150);
            } else {
                clearInterval(messageInterval);
                setTimeout(() => {
                    hashElement.textContent = "VUB-25 ████████";
                    hashElement.style.color = '#b33';
                }, 300);
            }
        }, 800);
        setTimeout(() => {
            const destino = localStorage.getItem('ubac_destino') || '/';
            localStorage.removeItem('ubac_destino');
            window.location.href = destino;
        }, 3500);
    </script>
</body>
</html>`;

// Helper para verificar si mostrar splash
async function shouldShowSplash(request) {
  if (!CONFIG.SPLASH_ENABLED) return false;
  if (CONFIG.SPLASH_MODE === 'never') return false;
  if (CONFIG.SPLASH_MODE === 'always') return true;
  
  const url = new URL(request.url);
  // No mostrar splash para assets
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|json|xml|txt)$/i)) return false;
  // No mostrar para APIs
  if (url.pathname.startsWith('/api/')) return false;
  // Verificar cookie
  const cookie = request.headers.get('Cookie') || '';
  return !cookie.includes('ubac_visited=1');
}

// Helper para respuesta con caché
async function cachedFetch(request, ttl = CONFIG.CACHE_TTL) {
  const cache = caches.default;
  let response = await cache.match(request);
  
  if (response) {
    const cacheDate = response.headers.get('CF-Cache-Date');
    if (cacheDate && (Date.now() - parseInt(cacheDate)) < ttl * 1000) {
      return response;
    }
  }
  
  response = await fetch(request);
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('CF-Cache-Date', Date.now().toString());
  newResponse.headers.set('Cache-Control', `public, max-age=${ttl}`);
  
  event.waitUntil(cache.put(request, newResponse.clone()));
  return newResponse;
}

// Manejo de errores
function handleError(error, url) {
  console.error(`Error en worker: ${error.message}`, url);
  return new Response(JSON.stringify({
    error: 'Internal Server Error',
    path: url.pathname,
    timestamp: new Date().toISOString()
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Manejo de rutas
function handleDashboardRouting(url, request) {
  const pathname = url.pathname;
  
  // Transformar /dashboard/algo → /dashboard?_m=algo
  const match = pathname.match(/^\/dashboard\/([^/?]+)/);
  const seccion = match ? match[1] : 'main';
  
  // Si la sección es válida, transformar
  if (seccion === 'main' || SECCIONES_VALIDAS.has(seccion)) {
    url.pathname = '/dashboard.html';
    url.searchParams.set('_m', seccion);
    return fetch(url.toString(), request);
  }
  
  return null;
}

// Middleware de seguridad
function addSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

// Middleware para splash
async function handleSplash(request, url) {
  if (await shouldShowSplash(request)) {
    const response = new Response(SPLASH_HTML, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Set-Cookie': 'ubac_visited=1; Max-Age=31536000; Path=/; Secure; HttpOnly',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
    return addSecurityHeaders(response);
  }
  return null;
}

// Handler principal
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    try {
      // 1. Manejo especial para splash
      const splashResponse = await handleSplash(request, url);
      if (splashResponse) return splashResponse;
      
      // 2. Dashboard routing
      const dashboardResponse = handleDashboardRouting(url, request);
      if (dashboardResponse) return addSecurityHeaders(await dashboardResponse);
      
      // 3. Assets estáticos (con caché)
      if (pathname.startsWith('/assets/') ||
        pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico)$/i)) {
        return addSecurityHeaders(await cachedFetch(request));
      }
      
      // 4. Archivos de configuración
      if (pathname === '/' ||
        pathname === '/index.html' ||
        pathname === '/dashboard.html' ||
        pathname.startsWith('/auth/') ||
        pathname.startsWith('/config/')) {
        return addSecurityHeaders(await cachedFetch(request, 300)); // 5 minutos
      }
      
      // 5. API (sin caché, paso directo)
      if (pathname.startsWith('/api/')) {
        const response = await fetch(request);
        return addSecurityHeaders(response);
      }
      
      // 6. Cualquier otra ruta, intentar servir como estático
      const staticResponse = await cachedFetch(request, 3600);
      if (staticResponse.status !== 404) {
        return addSecurityHeaders(staticResponse);
      }
      
      // 7. 404 personalizado
      return new Response(JSON.stringify({
        error: 'Página no encontrada',
        path: pathname,
        timestamp: new Date().toISOString()
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      return handleError(error, url);
    }
  }
};