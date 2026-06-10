import { createElement, useEffect, useRef, useState } from "react";
import { readChaos, wait, type Chaos } from "./config";

// A web component whose button lives in an open shadow root — used to verify
// pr-preview records & replays interactions inside shadow DOM.
if (typeof customElements !== "undefined" && !customElements.get("pr-widget")) {
  class PrWidget extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>
        .box{padding:10px;border:1px solid #d4d7e3;border-radius:8px;display:flex;gap:10px;align-items:center}
        button{padding:6px 12px;border:0;border-radius:6px;background:#4f6ef7;color:#fff;cursor:pointer}
      </style>
      <div class="box">Shadow count: <span data-testid="shadow-count">0</span>
        <button data-testid="shadow-btn">Bump</button></div>`;
      let n = 0;
      root.querySelector('[data-testid="shadow-btn"]')!.addEventListener("click", () => {
        n += 1;
        root.querySelector('[data-testid="shadow-count"]')!.textContent = String(n);
      });
    }
  }
  customElements.define("pr-widget", PrWidget);
}

const chaos = readChaos();

/** Full-screen spinner that COVERS the UI during async work — this is what
 *  makes a naive coordinate-click land on the overlay instead of the button. */
function Spinner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="overlay" data-testid="spinner">
      <div className="spinner" />
      <p>Working…</p>
    </div>
  );
}

export function App() {
  // The OAuth-style popup target renders when the app is opened at /provider.
  if (location.pathname === "/provider") return <Provider />;

  const [authed, setAuthed] = useState(() => sessionStorage.getItem("dyn-auth") === "1");
  const [needOtp, setNeedOtp] = useState(false);

  if (!authed && !needOtp) {
    return (
      <Login
        chaos={chaos}
        onAuthed={() => {
          if (chaos.otp) setNeedOtp(true);
          else {
            sessionStorage.setItem("dyn-auth", "1");
            setAuthed(true);
          }
        }}
      />
    );
  }
  if (needOtp) {
    return (
      <Otp
        chaos={chaos}
        onVerified={() => {
          sessionStorage.setItem("dyn-auth", "1");
          setNeedOtp(false);
          setAuthed(true);
        }}
      />
    );
  }
  return <Dashboard chaos={chaos} />;
}

function Login({ chaos, onAuthed }: { chaos: Chaos; onAuthed: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await wait(chaos.lat); // backend latency
    setBusy(false);
    onAuthed();
  };

  const popupLogin = () => {
    window.open("/provider", "oauth", "width=420,height=520");
    // localStorage is shared across same-origin windows, so the popup's write
    // is visible here without relying on window.opener.
    const timer = setInterval(() => {
      if (localStorage.getItem("dyn-oauth") === "1") {
        clearInterval(timer);
        localStorage.removeItem("dyn-oauth");
        onAuthed();
      }
    }, 250);
  };

  return (
    <main className="card">
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <input data-testid="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          data-testid="password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button data-testid="login-btn" type="submit">Log in</button>
        {chaos.popup && (
          <button data-testid="oauth-btn" type="button" className="ghost" onClick={popupLogin}>
            Sign in with Provider
          </button>
        )}
      </form>
      <Spinner show={chaos.spinner && busy} />
    </main>
  );
}

function Otp({ chaos, onVerified }: { chaos: Chaos; onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await wait(chaos.lat);
    setBusy(false);
    onVerified();
  };
  return (
    <main className="card">
      <h1>Two-factor</h1>
      <p className="muted">Enter the 6-digit code (use 000000)</p>
      <form onSubmit={verify}>
        <input data-testid="otp" inputMode="numeric" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} />
        <button data-testid="verify-btn" type="submit">Verify</button>
      </form>
      <Spinner show={chaos.spinner && busy} />
    </main>
  );
}

interface Item {
  id: number;
  text: string;
  done: boolean;
}

function Dashboard({ chaos }: { chaos: Chaos }) {
  const [items, setItems] = useState<Item[] | null>(null); // null = still loading
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(chaos.modal);
  const [draft, setDraft] = useState("");
  const [feed, setFeed] = useState<string[]>([]);
  const [priority, setPriority] = useState("low");
  const [cleared, setCleared] = useState(false);
  const snap = useRef<Item[] | null>(null);

  const deleteAll = () => {
    if (window.confirm("Delete all items? This cannot be undone.")) {
      setItems([]);
      setCleared(true);
    }
  };

  // List loads "from the backend" after a delay (fetch-driven content).
  useEffect(() => {
    let alive = true;
    (async () => {
      await wait(chaos.lat);
      if (alive) setItems([
        { id: 1, text: "Alpha", done: false },
        { id: 2, text: "Beta", done: false },
        { id: 3, text: "Gamma", done: false },
      ]);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Optional streaming feed (websocket-like) — items arrive over time.
  useEffect(() => {
    if (!chaos.feed) return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      setFeed((f) => [...f, `event ${n}`]);
      if (n >= 5) clearInterval(t);
    }, chaos.lat / 2);
    return () => clearInterval(t);
  }, []);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true); // spinner overlay covers the toolbar (occlusion)
    await wait(chaos.lat);
    setBusy(false);
    setItems((prev) => [...(prev ?? []), { id: Date.now(), text, done: false }]);
    setDraft("");
  };

  const reload = async () => {
    setBusy(true);
    await wait(chaos.lat);
    setBusy(false);
    if (chaos.flaky) {
      // Transient detach: drop the list briefly, then restore it UNCHANGED
      // (preserving any toggles) — exercises waiting through a re-render race.
      setItems((prev) => {
        snap.current = prev;
        return null;
      });
      await wait(400);
      setItems(snap.current);
    } else {
      // Plain reload resets to a fresh list.
      setItems([
        { id: 1, text: "Alpha", done: false },
        { id: 2, text: "Beta", done: false },
        { id: 3, text: "Gamma", done: false },
      ]);
    }
  };

  const toggle = (id: number) =>
    setItems((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, done: !i.done } : i)));

  return (
    <main className="card card--wide">
      <h1>Dashboard</h1>
      <div className="row">
        <input data-testid="new-item" placeholder="New item" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button data-testid="add-btn" onClick={add}>Add</button>
        <button data-testid="reload-btn" className="ghost" onClick={reload}>Reload</button>
      </div>

      <div className="row">
        <select data-testid="priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="low">Low</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <span data-testid="priority-label" className="muted">priority: {priority}</span>
        <button data-testid="delete-all" className="ghost" onClick={deleteAll}>Delete all</button>
      </div>

      {createElement("pr-widget", { "data-testid": "widget" })}
      {cleared && <p data-testid="cleared" className="muted">All items cleared</p>}

      {items === null ? (
        <p data-testid="loading" className="muted">Loading items…</p>
      ) : (
        <ul className="items">
          {items.map((i, idx) => (
            <li key={i.id} data-testid={`item-${idx}`} className={i.done ? "done" : ""}>
              <label>
                <input type="checkbox" checked={i.done} onChange={() => toggle(i.id)} />
                {i.text}
              </label>
              <button data-testid={`done-${idx}`} className="link" onClick={() => toggle(i.id)}>
                {i.done ? "Undo" : "Done"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {chaos.feed && (
        <ul className="feed" data-testid="feed">
          {feed.map((f, i) => (
            <li key={i} data-testid={`feed-${i}`}>{f}</li>
          ))}
        </ul>
      )}

      <Spinner show={chaos.spinner && busy} />

      {showModal && (
        <div className="overlay" data-testid="modal">
          <div className="modal">
            <h2>Welcome 👋</h2>
            <p>Take a quick tour of the dashboard.</p>
            <button data-testid="modal-dismiss" onClick={() => setShowModal(false)}>Got it</button>
          </div>
        </div>
      )}
    </main>
  );
}

/** The OAuth provider page opened in a popup window. */
function Provider() {
  const approve = () => {
    // localStorage is shared with the opener window (same origin).
    localStorage.setItem("dyn-oauth", "1");
    window.close();
  };
  return (
    <main className="card">
      <h1>Provider login</h1>
      <p className="muted">Authorize Dynamic App to sign you in.</p>
      <button data-testid="provider-approve" onClick={approve}>Approve</button>
    </main>
  );
}
