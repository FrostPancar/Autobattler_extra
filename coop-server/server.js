'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 10000;
const docs = Object.create(null);
const subs = new Map();

function pathKey(segments) {
  if (Array.isArray(segments)) return segments.filter(Boolean).join('/');
  return String(segments || '').replace(/^\/+/, '');
}

function getDoc(path) {
  return docs[path] ?? null;
}

function setDoc(path, data, merge) {
  if (!merge || !docs[path]) {
    docs[path] = { ...data };
    return;
  }
  docs[path] = { ...docs[path], ...data };
}

function deleteDoc(path) {
  delete docs[path];
}

function listCollection(prefix) {
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const out = [];
  for (const key of Object.keys(docs)) {
    if (!key.startsWith(base)) continue;
    const rest = key.slice(base.length);
    if (!rest || rest.includes('/')) continue;
    out.push({ id: rest, data: docs[key] });
  }
  return out;
}

function pathsAffected(path) {
  const parts = path.split('/');
  const affected = new Set([path]);
  for (let i = 1; i <= parts.length; i++) {
    affected.add(parts.slice(0, i).join('/'));
  }
  return affected;
}

function matchSub(subPath, changedPath) {
  if (subPath === changedPath) return true;
  if (changedPath.startsWith(`${subPath}/`)) return true;
  if (subPath.startsWith(`${changedPath}/`)) return true;
  return false;
}

function snapshotForPath(path) {
  const doc = getDoc(path);
  if (doc) {
    return [{ id: path.split('/').pop(), data: doc }];
  }
  const children = listCollection(path);
  if (children.length) return children;
  return [];
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastSnapshots(changedPaths) {
  const changed = Array.isArray(changedPaths) ? changedPaths : [changedPaths];
  for (const [subId, sub] of subs) {
    if (!sub.ws || sub.ws.readyState !== sub.ws.OPEN) continue;
    const hit = changed.some((p) => matchSub(sub.path, p));
    if (!hit) continue;
    send(sub.ws, {
      type: 'snapshot',
      subId,
      docs: snapshotForPath(sub.path)
    });
  }
}

function applySet(path, data, merge) {
  setDoc(path, data, merge);
  broadcastSnapshots([...pathsAffected(path)]);
}

function applyDelete(path) {
  deleteDoc(path);
  broadcastSnapshots([...pathsAffected(path)]);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('coop-ws ok\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.subIds = new Set();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong' });
      return;
    }

    if (msg.type === 'setDoc') {
      const path = pathKey(msg.path);
      applySet(path, msg.data || {}, !!msg.merge);
      if (msg.id) send(ws, { type: 'ack', id: msg.id, ok: true });
      return;
    }

    if (msg.type === 'deleteDoc') {
      const path = pathKey(msg.path);
      applyDelete(path);
      if (msg.id) send(ws, { type: 'ack', id: msg.id, ok: true });
      return;
    }

    if (msg.type === 'getDoc') {
      const path = pathKey(msg.path);
      const data = getDoc(path);
      send(ws, {
        type: 'doc',
        id: msg.id,
        exists: !!data,
        data: data || null
      });
      return;
    }

    if (msg.type === 'getDocs') {
      const path = pathKey(msg.path);
      send(ws, {
        type: 'docs',
        id: msg.id,
        docs: listCollection(path)
      });
      return;
    }

    if (msg.type === 'writeBatch') {
      const ops = Array.isArray(msg.ops) ? msg.ops : [];
      const touched = [];
      for (const op of ops) {
        const path = pathKey(op.path);
        if (op.type === 'delete') {
          applyDelete(path);
          touched.push(...pathsAffected(path));
        } else {
          applySet(path, op.data || {}, !!op.merge);
          touched.push(...pathsAffected(path));
        }
      }
      if (msg.id) send(ws, { type: 'ack', id: msg.id, ok: true });
      return;
    }

    if (msg.type === 'subscribe') {
      const subId = String(msg.subId || '');
      const path = pathKey(msg.path);
      if (!subId || !path) return;
      subs.set(subId, { ws, path });
      ws.subIds.add(subId);
      send(ws, {
        type: 'snapshot',
        subId,
        docs: snapshotForPath(path)
      });
      return;
    }

    if (msg.type === 'unsubscribe') {
      const subId = String(msg.subId || '');
      subs.delete(subId);
      ws.subIds.delete(subId);
      return;
    }
  });

  ws.on('close', () => {
    for (const subId of ws.subIds) subs.delete(subId);
    ws.subIds.clear();
  });
});

server.listen(PORT, () => {
  console.log(`coop-ws listening on ${PORT}`);
});
