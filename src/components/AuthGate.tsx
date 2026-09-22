"use client";

import { FormEvent, useEffect, useState } from "react";
import { migrateLocalDataToServer } from "../storage/db";

declare global {
  interface ImportMeta {
    readonly env?: { MODE?: string };
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState("");

  useEffect(() => {
    if (import.meta.env?.MODE === "test") {
      setState("ready");
      return;
    }
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => response.json() as Promise<{ authenticated: boolean }>)
      .then((result) => setState(result.authenticated ? "ready" : "login"))
      .catch(() => setState("login"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ password }) });
      if (response.ok) {
        setState("ready");
        setPassword("");
      } else {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "登录失败");
      }
    } catch {
      setError("连接失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <main className="auth-shell"><p>正在验证访问权限…</p></main>;
  async function migrate() {
    if (!window.confirm("上传本机历史数据？相同编号的记录将保留服务器版本，本机数据会保留。")) return;
    setBusy(true);
    setMigrationMessage("");
    try {
      const { written, skipped } = await migrateLocalDataToServer();
      setMigrationMessage(`已上传 ${written} 条，保留服务器记录 ${skipped} 条。`);
    } catch (migrationError) {
      setMigrationMessage(migrationError instanceof Error ? migrationError.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setState("login");
  }

  if (state === "ready") return <><div className="auth-toolbar"><button onClick={migrate} disabled={busy}>上传本机数据</button><button onClick={() => window.location.reload()}>刷新数据</button><button onClick={logout}>退出登录</button>{migrationMessage ? <span role="status">{migrationMessage}</span> : null}</div>{children}</>;
  return (
    <main className="auth-shell">
      <form className="auth-panel" onSubmit={submit}>
        <p className="eyebrow">SANTA OPS</p>
        <h1>经营驾驶舱</h1>
        <p className="auth-description">请输入统一访问密码</p>
        <label className="auth-field">
          <span>访问密码</span>
          <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        <button className="auth-submit" disabled={busy}>{busy ? "验证中…" : "进入驾驶舱"}</button>
      </form>
    </main>
  );
}
