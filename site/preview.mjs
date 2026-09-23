import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const types={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',webmanifest:'application/manifest+json'};
const files=new Set(['index.html','app.js','auth.js','api.js','config.js','styles.css','service-worker.js','manifest.webmanifest','favicon.svg','assets/pudding-mascot.png']);
createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!files.has(file)){res.writeHead(404);return res.end();}
  try{const data=await readFile(new URL('dist/'+file,import.meta.url));res.writeHead(200,{'content-type':types[file.split('.').pop()]||'application/octet-stream','cache-control':'no-store'});res.end(data);}
  catch{res.writeHead(404);res.end();}
}).listen(4175,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4175'));
