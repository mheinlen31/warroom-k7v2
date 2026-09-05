/* Read-only feed from the draft board's live room. This page NEVER writes:
   it subscribes to the same Realtime DB state the board publishes and
   re-shapes it (Firebase drops empty arrays, so a team with no picks comes
   back with no `players` key at all). Same project + room as the board. */
window.LiveDraft = (function () {
  const CONFIG = {
    apiKey: "AIzaSyBG2oR-YOOfi_IiHBErv-rKoqJ8zfhg3Xo",
    authDomain: "pandy-open-2026.firebaseapp.com",
    databaseURL: "https://pandy-open-2026-default-rtdb.firebaseio.com",
    projectId: "pandy-open-2026",
    appId: "1:658330035817:web:1ec09298fecf05222ee4f8",
  };
  const ROOM = "sunday-funday-draft-2026";
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
  let ready, mod, db;

  function connect() {
    if (ready) return ready;
    ready = (async () => {
      const [{ initializeApp }, _db, _auth] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-database.js`),
        import(`${SDK}/firebase-auth.js`),
      ]);
      mod = _db;
      const app = initializeApp(CONFIG);
      try { await _auth.signInAnonymously(_auth.getAuth(app)); } catch (e) { /* open rules */ }
      db = mod.getDatabase(app);
      return true;
    })();
    return ready;
  }

  const asArray = (v) => Array.isArray(v) ? v
    : (v && typeof v === 'object') ? Object.keys(v).sort((a, b) => a - b).map((k) => v[k]) : [];
  function normalize(st) {
    if (!st || typeof st !== 'object') return null;
    st.teams = asArray(st.teams);
    st.teams.forEach((t) => { t.players = asArray(t.players); t.keeperPool = asArray(t.keeperPool); });
    st.picks = asArray(st.picks);
    return st;
  }

  return {
    subscribe(cb) {
      return connect().then(() =>
        mod.onValue(mod.ref(db, `trips/${ROOM}/state`), (s) => cb(normalize(s.val()))));
    },
    onConnectionChange(cb) {
      return connect().then(() =>
        mod.onValue(mod.ref(db, ".info/connected"), (s) => cb(!!s.val())));
    },
  };
})();
