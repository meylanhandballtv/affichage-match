// ============================================================
//  MHBTV — Serveur de synchronisation Overlay / Panneau de contrôle
// ============================================================
//  Ce serveur fait 3 choses :
//   1. Il sert les pages controle.html et overlay.html sur le réseau local
//   2. Il garde en mémoire l'état actuel du match (scores, sanctions, chrono...)
//   3. Il transmet en direct (Server-Sent Events) chaque changement à
//      tous les navigateurs connectés (panneau de contrôle ET overlay),
//      même s'ils sont sur des PC différents.
//
//  Aucune installation (npm install) n'est nécessaire : tout repose sur
//  les modules natifs de Node.js.
//
//  Lancement :  node server.js
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8765;
const PUBLIC_DIR = __dirname;

// ── État du match, gardé en mémoire côté serveur ──
// (sert de "source de vérité" : un overlay qui se reconnecte ou
// qu'OBS recharge reçoit immédiatement ce dernier état connu)
let state = {
  homeName: 'DOMICILE',
  awayName: 'EXTÉRIEUR',
  homeScore: 0,
  awayScore: 0,
  homeSanctions: { yellow: 0, red: 0, blue: 0, white: 0, min2: 0 },
  awaySanctions: { yellow: 0, red: 0, blue: 0, white: 0, min2: 0 },
  timer: { running: false, seconds: 0, lastSync: Date.now() },
  period: 1,
  timeoutActive: false,
  visible: true
};

// ── Clients connectés en Server-Sent Events ──
const sseClients = new Set();

function broadcast(msg) {
  const payload = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { /* client déjà fermé */ }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Fichier introuvable'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // ── Flux temps réel (overlay + panneau de contrôle s'y abonnent) ──
  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    // Envoie immédiatement l'état actuel au nouveau client
    res.write(`data: ${JSON.stringify({ type: 'state', state })}\n\n`);
    sseClients.add(res);

    // Garde la connexion ouverte (heartbeat toutes les 20s)
    const heartbeat = setInterval(() => {
      try { res.write(':\n\n'); } catch (e) { /* ignore */ }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  // ── Réception d'une mise à jour depuis le panneau de contrôle ──
  if (req.method === 'POST' && url === '/update') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // garde-fou anti-abus
    });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(body); } catch (e) {
        res.writeHead(400); res.end('JSON invalide'); return;
      }
      if (msg.type === 'state' && msg.state) {
        state = msg.state; // le panneau de contrôle envoie toujours l'état complet
      }
      broadcast(msg);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── Pages statiques ──
  if (req.method === 'GET' && (url === '/' || url === '/controle.html')) {
    serveFile(res, path.join(PUBLIC_DIR, 'controle.html'));
    return;
  }
  if (req.method === 'GET' && url === '/overlay.html') {
    serveFile(res, path.join(PUBLIC_DIR, 'overlay.html'));
    return;
  }

  res.writeHead(404);
  res.end('Page introuvable');
});

server.listen(PORT, () => {
  console.log('');
  console.log('===========================================================');
  console.log('  Serveur MHBTV démarré avec succès');
  console.log('===========================================================');
  console.log(`  Panneau de contrôle : http://<IP-DE-CE-PC>:${PORT}/controle.html`);
  console.log(`  Overlay (URL OBS)   : http://<IP-DE-CE-PC>:${PORT}/overlay.html`);
  console.log('');
  console.log('  Pour connaître l\'adresse IP de ce PC :');
  console.log('   - Windows : ouvrir une invite de commande, taper "ipconfig"');
  console.log('   - Mac     : Préférences Système > Réseau');
  console.log('===========================================================');
  console.log('');
});
