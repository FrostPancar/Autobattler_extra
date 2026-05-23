(function (global) {
  'use strict';

  function defaultWsUrl() {
    const params = new URLSearchParams(global.location?.search || '');
    const override = params.get('coopWs');
    if (override) return override;
    const host = global.location?.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1') return 'ws://localhost:10000';
    if (host.endsWith('.onrender.com')) return 'wss://coop-ws.onrender.com';
    return '';
  }

  function isCoopPath(path) {
    const p = String(path || '');
    return p.startsWith('coopCampaignLobby/') || p.startsWith('coopRuns/');
  }

  function isDocumentPath(path) {
    return String(path || '').split('/').filter(Boolean).length % 2 === 0;
  }

  function makeQuerySnapshot(docs, collectionPath) {
    const list = Array.isArray(docs) ? docs : [];
    const prefix = collectionPath ? `${collectionPath}/` : '';
    const docObjs = list.map((d) => {
      const fullPath = prefix ? `${prefix}${d.id}` : String(d.id);
      return {
        id: d.id,
        ref: { path: fullPath },
        data: () => ({ ...(d.data || {}) })
      };
    });
    return {
      empty: docObjs.length === 0,
      size: docObjs.length,
      docs: docObjs,
      forEach(fn) {
        docObjs.forEach(fn);
      }
    };
  }

  function makeDocSnapshot(docs, docPath) {
    const row = Array.isArray(docs) && docs.length ? docs[0] : null;
    const data = row?.data || null;
    return {
      exists: () => !!data,
      data: () => (data ? { ...data } : null),
      id: row?.id || (docPath ? docPath.split('/').pop() : ''),
      get: (field) => (data ? data[field] : undefined)
    };
  }

  function makeSnapshot(docs, path) {
    if (isDocumentPath(path)) return makeDocSnapshot(docs, path);
    return makeQuerySnapshot(docs, path);
  }

  const CoopWs = {
    ws: null,
    connected: false,
    pending: new Map(),
    subs: new Map(),
    subCounter: 0,
    reqCounter: 0,
    wsUrl: '',
    reconnectTimer: null,

    isCoopPath,
    isConnected() {
      return this.connected;
    },

    connect(url) {
      this.wsUrl = url || defaultWsUrl();
      if (!this.wsUrl) {
        return Promise.reject(new Error('No coop WebSocket URL configured'));
      }
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return this.connected ? Promise.resolve() : new Promise((resolve, reject) => {
          const t = setInterval(() => {
            if (this.connected) { clearInterval(t); resolve(); }
            if (this.ws?.readyState === WebSocket.CLOSED) {
              clearInterval(t);
              reject(new Error('WebSocket closed'));
            }
          }, 50);
          setTimeout(() => { clearInterval(t); reject(new Error('WebSocket timeout')); }, 15000);
        });
      }
      return new Promise((resolve, reject) => {
        try {
          this.ws = new WebSocket(this.wsUrl);
        } catch (e) {
          reject(e);
          return;
        }
        const failTimer = setTimeout(() => {
          if (!this.connected) reject(new Error('WebSocket connect timeout'));
        }, 15000);
        this.ws.onopen = () => {
          clearTimeout(failTimer);
          this.connected = true;
          global.__coopWsConnected = true;
          console.info('[coop-ws] connected', this.wsUrl);
          resolve();
        };
        this.ws.onclose = () => {
          this.connected = false;
          global.__coopWsConnected = false;
          this.scheduleReconnect();
        };
        this.ws.onerror = () => {
          clearTimeout(failTimer);
          if (!this.connected) reject(new Error('WebSocket error'));
        };
        this.ws.onmessage = (ev) => this._onMessage(ev);
      });
    },

    scheduleReconnect() {
      if (this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.wsUrl) return;
        this.connect(this.wsUrl).catch(() => {});
      }, 3000);
    },

    _send(payload) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('coop WebSocket not connected'));
      }
      this.ws.send(JSON.stringify(payload));
      return Promise.resolve();
    },

    _request(payload) {
      const id = `r${++this.reqCounter}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('coop ws request timeout'));
        }, 20000);
        this.pending.set(id, { resolve, reject, timer });
        this._send({ ...payload, id }).catch((e) => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(e);
        });
      });
    },

    _onMessage(ev) {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'pong') return;

      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.type === 'ack') p.resolve(msg);
        else if (msg.type === 'doc') {
          p.resolve({
            exists: () => !!msg.exists,
            data: () => (msg.exists ? { ...msg.data } : null)
          });
        } else if (msg.type === 'docs') {
          p.resolve(makeSnapshot(msg.docs, msg.path || ''));
        } else p.resolve(msg);
        return;
      }

      if (msg.type === 'snapshot' && msg.subId && this.subs.has(msg.subId)) {
        const sub = this.subs.get(msg.subId);
        if (typeof sub.cb === 'function') {
          try {
            sub.cb(makeSnapshot(msg.docs, sub.path));
          } catch (e) {
            console.warn('[coop-ws] snapshot callback', e);
          }
        }
      }
    },

    setDoc(path, data, merge) {
      return this._request({
        type: 'setDoc',
        path: path.split('/'),
        data,
        merge: !!merge
      });
    },

    updateDoc(path, data) {
      return this.setDoc(path, data, true);
    },

    deleteDoc(path) {
      return this._request({ type: 'deleteDoc', path: path.split('/') });
    },

    getDoc(path) {
      return this._request({ type: 'getDoc', path: path.split('/') });
    },

    getDocs(path) {
      return this._request({ type: 'getDocs', path: path.split('/') });
    },

    addDoc(path, data) {
      const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const full = `${path}/${id}`;
      return this.setDoc(full, data, false).then(() => ({ id }));
    },

    writeBatch(ops) {
      return this._request({
        type: 'writeBatch',
        ops: ops.map((op) => ({
          type: op.type,
          path: op.path.split('/'),
          data: op.data,
          merge: !!op.merge
        }))
      });
    },

    onSnapshot(path, cb, onError) {
      const subId = `s${++this.subCounter}`;
      this.subs.set(subId, { cb, path });
      this._send({ type: 'subscribe', subId, path: path.split('/') }).catch((e) => {
        if (typeof onError === 'function') onError(e);
      });
      return () => {
        this.subs.delete(subId);
        this._send({ type: 'unsubscribe', subId }).catch(() => {});
      };
    },

  };

  CoopWs.install = function installCoopWsFirestoreShim(handlers) {
    const h = handlers || {};
    const preset = {
      getDocs(path) {
        if (path === 'presets') return Promise.resolve(makeQuerySnapshot(h.loadPresets?.() || [], path));
        if (path === 'hallOfFame') return Promise.resolve(makeQuerySnapshot(h.loadHof?.() || [], path));
        return Promise.resolve(makeQuerySnapshot([], path));
      },
      getDoc(path) {
        if (path.startsWith('presets/')) {
          const id = path.split('/').slice(1).join('/');
          const preset = (h.loadPresets?.() || []).find((p) => p.id === id);
          return Promise.resolve({
            exists: () => !!preset,
            data: () => {
              if (!preset) return null;
              const copy = { ...preset };
              delete copy.id;
              return copy;
            }
          });
        }
        return Promise.resolve({ exists: () => false, data: () => null });
      },
      addDoc(path, data) {
        if (path === 'presets') return h.addPreset?.(data);
        if (path === 'hallOfFame') return h.addHof?.(data);
        return Promise.resolve({ id: 'noop' });
      },
      setDoc() { return Promise.resolve(); },
      updateDoc() { return Promise.resolve(); },
      deleteDoc(path) {
        if (path.startsWith('presets/')) {
          const id = path.split('/').slice(1).join('/');
          h.deletePreset?.(id);
        }
        return Promise.resolve();
      },
      onSnapshot(path, cb) {
        const emit = () => {
          if (path === 'presets') cb(makeQuerySnapshot(h.loadPresets?.() || [], path));
          else if (path === 'hallOfFame') cb(makeQuerySnapshot(h.loadHof?.() || [], path));
          else cb(makeQuerySnapshot([], path));
        };
        emit();
        const ev = path === 'hallOfFame' ? 'render-hof-updated' : 'render-presets-updated';
        if (path === 'presets' || path === 'hallOfFame') {
          global.addEventListener(ev, emit);
          return () => global.removeEventListener(ev, emit);
        }
        return () => {};
      }
    };

    function route(path, coopFn, localFn) {
      if (isCoopPath(path)) return coopFn();
      return localFn();
    }

    global.window.collection = (_db, ...segments) => ({
      path: segments.filter(Boolean).join('/')
    });
    global.window.doc = (_db, ...segments) => ({
      path: segments.filter(Boolean).join('/')
    });
    global.window.query = (...args) => args;
    global.window.orderBy = () => null;
    global.window.limit = () => null;
    global.window.serverTimestamp = () => Date.now();

    global.window.getDocs = (ref) => route(ref.path, () => CoopWs.getDocs(ref.path), () => preset.getDocs(ref.path));
    global.window.getDocsFromServer = global.window.getDocs;
    global.window.getDoc = (ref) => route(ref.path, () => CoopWs.getDoc(ref.path), () => preset.getDoc(ref.path));
    global.window.setDoc = (ref, data, opts) => route(ref.path, () => CoopWs.setDoc(ref.path, data, !!opts?.merge), () => preset.setDoc(ref.path, data, opts));
    global.window.updateDoc = (ref, data) => route(ref.path, () => CoopWs.updateDoc(ref.path, data), () => preset.updateDoc(ref.path, data));
    global.window.deleteDoc = (ref) => route(ref.path, () => CoopWs.deleteDoc(ref.path), () => preset.deleteDoc(ref.path));
    global.window.addDoc = (ref, data) => route(ref.path, () => CoopWs.addDoc(ref.path, data), () => preset.addDoc(ref.path, data));
    global.window.onSnapshot = (ref, cb, onError) => route(ref.path, () => CoopWs.onSnapshot(ref.path, cb, onError), () => preset.onSnapshot(ref.path, cb));
    global.window.writeBatch = () => {
      const ops = [];
      return {
        set(ref, data, opts) {
          ops.push({ type: 'set', path: ref.path, data, merge: !!opts?.merge });
        },
        update(ref, data) {
          ops.push({ type: 'set', path: ref.path, data, merge: true });
        },
        delete(ref) {
          ops.push({ type: 'delete', path: ref.path });
        },
        commit() {
          const coopOps = ops.filter((o) => isCoopPath(o.path));
          const other = ops.filter((o) => !isCoopPath(o.path));
          const promises = [];
          if (coopOps.length) promises.push(CoopWs.writeBatch(coopOps));
          other.forEach((o) => {
            if (o.type === 'delete') promises.push(preset.deleteDoc(o.path));
            else promises.push(preset.setDoc(o.path, o.data, { merge: o.merge }));
          });
          return Promise.all(promises).then(() => {});
        }
      };
    };
    global.window.runTransaction = async (fn) => fn({
      get: async (ref) => global.window.getDoc(ref),
      set: (ref, data, opts) => { global.window.setDoc(ref, data, opts); },
      update: (ref, data) => { global.window.updateDoc(ref, data); }
    });

    return CoopWs.connect(h.wsUrl).catch((e) => {
      console.warn('[coop-ws] connect failed — co-op unavailable until server is up', e);
    });
  };

  global.CoopWs = CoopWs;
})(typeof window !== 'undefined' ? window : globalThis);
