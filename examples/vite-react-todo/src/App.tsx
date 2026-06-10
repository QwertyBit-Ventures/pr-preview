import { useEffect, useState } from "react";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

/** Tiny SPA: /login → /app, with real pushState navigation. */
export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [loggedIn, setLoggedIn] = useState(
    () => sessionStorage.getItem("demo-auth") === "1",
  );

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
  };

  if (!loggedIn || path === "/login") {
    return (
      <Login
        onLogin={() => {
          sessionStorage.setItem("demo-auth", "1");
          setLoggedIn(true);
          navigate("/app");
        }}
      />
    );
  }
  return <Todos />;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email === "demo@example.com" && password === "demo") onLogin();
    else setError("Use demo@example.com / demo");
  };

  return (
    <main className="card">
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <input
          data-testid="email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          data-testid="password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button data-testid="login-btn" type="submit">
          Log in
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}

function Todos() {
  const [todos, setTodos] = useState<Todo[]>([
    { id: 1, text: "Ship pr-preview", done: false },
  ]);
  const [draft, setDraft] = useState("");

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setTodos((t) => [...t, { id: Date.now(), text, done: false }]);
    setDraft("");
  };

  return (
    <main className="card">
      <h1>Todos</h1>
      <div className="row">
        <input
          data-testid="new-todo"
          placeholder="What needs doing?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button data-testid="add-todo" onClick={add}>
          Add
        </button>
      </div>
      <ul className="todos">
        {todos.map((todo) => (
          <li key={todo.id} className={todo.done ? "done" : ""}>
            <label>
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() =>
                  setTodos((t) =>
                    t.map((x) => (x.id === todo.id ? { ...x, done: !x.done } : x)),
                  )
                }
              />
              {todo.text}
            </label>
            <button
              className="delete"
              aria-label={`Delete ${todo.text}`}
              onClick={() => setTodos((t) => t.filter((x) => x.id !== todo.id))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
