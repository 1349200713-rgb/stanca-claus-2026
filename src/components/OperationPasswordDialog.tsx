"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { registerOperationAuthorizationDialog, type OperationAuthorizationRequest } from "../storage/operation-authorization";

export function OperationPasswordDialog() {
  const [request, setRequest] = useState<OperationAuthorizationRequest | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeRequest = useRef<OperationAuthorizationRequest | null>(null);
  const submitting = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => registerOperationAuthorizationDialog((next) => {
    activeRequest.current = next;
    submitting.current = false;
    setRequest(next);
    setPassword("");
    setError("");
    setBusy(false);
  }), []);

  useEffect(() => {
    if (!request) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = panel.current?.parentElement;
    const background = Array.from(document.body.children).filter((element) => element !== backdrop);
    const originalInert = background.map((element) => element.getAttribute("inert"));
    background.forEach((element) => element.setAttribute("inert", ""));
    input.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        request!.cancel();
      } else if (event.key === "Tab") {
        const controls = panel.current?.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])");
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      background.forEach((element, index) => {
        if (originalInert[index] === null) element.removeAttribute("inert");
        else element.setAttribute("inert", originalInert[index]!);
      });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [request]);

  useEffect(() => { if (request && !busy) input.current?.focus(); }, [request, busy]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = activeRequest.current;
    if (!current || submitting.current) return;
    if (!password) { setError("请输入操作密码"); return; }
    submitting.current = true;
    setBusy(true);
    setError("");
    const suppliedPassword = password;
    setPassword("");
    try {
      await current.verify(suppliedPassword);
      current.complete();
    } catch (cause) {
      if (activeRequest.current === current) setError(cause instanceof Error ? cause.message : "验证失败，请重试");
    } finally {
      if (activeRequest.current === current) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }

  if (!request) return null;
  return createPortal(
    <div className="operation-password-backdrop">
      <div ref={panel} className="auth-panel operation-password-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <h2 id={titleId}>操作密码验证</h2>
        <p id={descriptionId} className="auth-description">验证成功后仅继续本次提交；取消不会保存，编辑内容会保留。</p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label className="auth-field"><span>操作密码</span><input ref={input} type="password" autoComplete="off" value={password} disabled={busy} onChange={(event) => setPassword(event.currentTarget.value)} required /></label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <div className="operation-password-actions">
            <button type="submit" className="auth-submit" disabled={busy}>{busy ? "验证中…" : "验证并继续保存"}</button>
            <button type="button" className="secondary-button" onClick={() => request.cancel()}>取消</button>
          </div>
        </form>
      </div>
    </div>, document.body,
  );
}
