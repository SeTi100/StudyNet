/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = 'studynet-cache-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)).then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/opfs/')) {
    event.respondWith(handleOpfsRequest(event.request, url.pathname.replace('/opfs/', '')));
    return;
  }

  if (event.request.method === 'GET') {
    if (url.pathname.startsWith('/api/')) {
      // Network-First for API
      event.respondWith(
        fetch(event.request).catch(() => {
          return caches.match(event.request) as Promise<Response>;
        })
      );
      return;
    }

    // Cache-First for everything else
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          
          if (!url.pathname.startsWith('/opfs/')) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
    );
  }
});

function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'json':
      return 'application/json';
    case 'txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

async function handleOpfsRequest(request: Request, filePath: string): Promise<Response> {
  try {
    const cleanPath = decodeURIComponent(filePath);
    const parts = cleanPath.split('/').filter(Boolean);
    if (parts.length < 2) {
      return new Response('Invalid OPFS path', { status: 400 });
    }

    const directory = parts[0];
    const fileName = parts.slice(1).join('/');

    const root = await navigator.storage.getDirectory();
    const dirHandle = await root.getDirectoryHandle(directory);
    const fileHandle = await dirHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();

    const mimeType = getMimeType(fileName);
    const fileSize = file.size;
    const rangeHeader = request.headers.get('range');

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
          return new Response('Requested Range Not Satisfiable', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${fileSize}`,
            },
          });
        }

        const sliced = file.slice(start, end + 1);
        return new Response(sliced, {
          status: 206,
          statusText: 'Partial Content',
          headers: {
            'Content-Type': mimeType,
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': `${sliced.size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }
    }

    return new Response(file, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': `${fileSize}`,
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error: any) {
    if (error?.name === 'NotFoundError') {
      return new Response('File not found in OPFS', { status: 404 });
    }
    return new Response(`OPFS Streaming error: ${error?.message || 'Unknown error'}`, { status: 500 });
  }
}
