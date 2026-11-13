"use client";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./InCallKeypad.module.css";

function OpenKeypad({ id, onSendDigit, onClose }) {
  const firstKey = useRef(null);
  const mounted = useRef(true);
  const queue = useRef([]);
  const sending = useRef(false);
  const send = useRef(onSendDigit);
  send.current = onSendDigit;
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    firstKey.current?.focus();
    return () => { mounted.current = false; queue.current = []; };
  }, []);
  async function press(digit) {
    if (queue.current.length >= 32) {
      setError("Wait for the queued keys to finish before entering more.");
      return;
    }
    queue.current.push(digit);
    if (sending.current) return;
    sending.current = true;
    setError("");
    try {
      while (mounted.current && queue.current.length) {
        const next = queue.current.shift();
        setStatus("Sending…");
        await send.current(next);
        if (mounted.current) setStatus(`Sent ${next === "*" ? "star" : next === "#" ? "pound" : next}`);
      }
    } catch {
      queue.current = [];
      if (mounted.current) {
        setStatus("");
        setError("The key could not be confirmed. Remaining keys were canceled. Check the call before trying again.");
      }
    } finally {
      sending.current = false;
    }
  }
  return <section id={id} className={styles.panel} aria-label="In-call keypad" onKeyDown={event => {
    if (event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return;
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || event.isComposing) return;
    if (/^[0-9*#]$/.test(event.key)) { event.preventDefault(); void press(event.key); }
  }}>
    <div className={styles.heading}><strong>Keypad</strong><button type="button" onClick={onClose} aria-label="Close keypad">×</button></div>
    <p>Press a key or type while the keypad has focus.</p>
    <div className={styles.keys}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((digit, index) =>
        <button key={digit} ref={index === 0 ? firstKey : undefined} type="button" aria-label={digit === "*" ? "Star (*)" : digit === "#" ? "Pound (#)" : digit} onClick={() => void press(digit)}>{digit}</button>)}
    </div>
    <div className={styles.status} role="status">{status}</div>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export default function InCallKeypad({ enabled, onSendDigit }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  const id = useId();
  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);
  const close = () => { setOpen(false); toggle.current?.focus(); };
  return <div className={styles.wrapper}>
    <button ref={toggle} type="button" className={styles.toggle} disabled={!enabled} aria-expanded={enabled && open} aria-controls={id} onClick={() => setOpen(value => !value)}>Keypad</button>
    {enabled && open && <OpenKeypad id={id} onSendDigit={onSendDigit} onClose={close} />}
  </div>;
}
