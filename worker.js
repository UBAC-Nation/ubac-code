// worker.js
const SECCIONES_VALIDAS = new Set(['main', 'settings', 'propuestas', 'periodico', 'empresa']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    // Transformar /dashboard/algo → /dashboard?_m=algo
    const match = pathname.match(/^\/dashboard\/([^/?]+)/);
    const seccion = match ? match[1] : 'main';
    
    // Si la sección es válida, transformar
    if (seccion === 'main' || SECCIONES_VALIDAS.has(seccion)) {
      url.pathname = '/dashboard';
      url.searchParams.set('_m', seccion);
      return fetch(url.toString(), request);
    }
    
    // Si no es dashboard, seguir normal
    if (pathname.startsWith('/assets/') || pathname === '/' || pathname.startsWith('/auth/')) {
      return env.ASSETS.fetch(request);
    }
    
    // Si la sección no existe, 404
    return new Response(JSON.stringify({ error: 'Sección no encontrada' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}