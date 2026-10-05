import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error('Invalid path');
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    response.writeHead(200, {'content-type':types[extname(file).toLowerCase()] || 'application/octet-stream','cache-control':'no-store'});
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, {'content-type':'text/plain; charset=utf-8'});
    response.end('Not found');
  }
}).listen(4173, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:4173'));
