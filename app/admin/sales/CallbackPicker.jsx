"use client";
import { useState } from "react";
import styles from "./DialerScreen.module.css";

function localDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Best-time notes remain rep guidance; recognize a stated hour without inventing one.
export function preferredCallbackTime(bestTime = "") {
  const match = bestTime.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return "10:00";
  const hours = Number(match[1]) % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
  return `${String(hours).padStart(2, "0")}:${match[2] || "00"}`;
}

export function resolveCallback({ date, time }) {
  if (!date || !time) return null;
  const result = new Date(`${date}T${time}`);
  if (!Number.isFinite(result.getTime())) return null;
  if (result.getDay() === 6) result.setDate(result.getDate() + 2);
  if (result.getDay() === 0) result.setDate(result.getDate() + 1);
  return result;
}

export default function CallbackPicker({ prospect, value, onSet, disabled, canSchedule, saveImmediately = false, now = Date.now(), onClose }) {
  const [date, setDate] = useState(value ? localDate(value) : ""),
    [time, setTime] = useState(value ? new Date(value).toTimeString().slice(0, 5) : preferredCallbackTime(prospect?.bestTime)),
    [amount, setAmount] = useState(1),
    [unit, setUnit] = useState("weeks"),
    [selection, setSelection] = useState("");
  const resolved = resolveCallback({ date, time });
  const future = resolved && resolved.getTime() > now;
  const relative = (count, period, label = "relative") => {
    const next = new Date(now);
    if (period === "months") next.setMonth(next.getMonth() + count);
    else next.setDate(next.getDate() + count * (period === "weeks" ? 7 : 1));
    setDate(localDate(next));
    setSelection(label);
  };
  return <div className={styles.callbackControl}>
    <div className={styles.scriptTitle}>
      <h2>Call back</h2>
      <span className={styles.caption}>{value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not set"}{value && <button type="button" className={styles.linkButton} disabled={disabled || !canSchedule} onClick={async () => { const result = await onSet(null); if (result !== false) { setDate(""); onClose?.(); } }}>Clear</button>}</span>
    </div>
    <div className={styles.callbackChips}>
      {[["Tomorrow AM", 1, "days"], ["Tomorrow PM", 1, "days"], ["3 days", 3, "days"], ["1 week", 1, "weeks"], ["2 weeks", 2, "weeks"], ["1 month", 1, "months"]].map(([label, count, period]) => <button type="button" className={styles.button} key={label} aria-pressed={selection === label} onClick={() => {
        relative(count, period, label);
        if (label.startsWith("Tomorrow")) setTime(prospect?.bestTime ? preferredCallbackTime(prospect.bestTime) : label.endsWith("PM") ? "14:00" : "10:00");
      }}>{label}</button>)}
    </div>
    <div className={styles.callbackFields}>
      <span>or in</span>
      <input type="number" aria-label="Callback interval" min="1" max="365" value={amount} onChange={(event) => {
        const count = event.target.value;
        setAmount(count);
        if (Number(count) >= 1 && Number(count) <= 365) relative(Number(count), unit);
      }} />
      <select aria-label="Callback interval unit" value={unit} onChange={(event) => { setUnit(event.target.value); if (Number(amount) > 0) relative(Number(amount), event.target.value); }}>
        <option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option>
      </select>
      <span>or on</span><input type="date" aria-label="Callback date" value={date} onChange={(event) => { setDate(event.target.value); setSelection("exact"); }} />
      <span>at</span><input type="time" aria-label="Callback time" value={time} onChange={(event) => setTime(event.target.value)} />
    </div>
    <div className={styles.callbackResult} role="status">
      {resolved ? resolved.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Choose when to call back"}
      {resolved && !future ? " · choose a future time" : ""}
      {future && canSchedule ? " · top of your list then" : ""}
    </div>
    <div className={styles.actions}>
      <button type="button" className={`${styles.button} ${styles.blue}`} disabled={disabled || !canSchedule || !future} onClick={async () => { const result = await onSet(resolved.toISOString()); if (result !== false) onClose?.(); }}>Set call back</button>
      {onClose && <button type="button" className={styles.button} onClick={onClose}>Cancel</button>}
    </div>
    <p className={styles.caption}>{canSchedule ? saveImmediately ? "Saved to this contact immediately. Weekend dates roll to Monday." : "Saved with the outcome when you press Save & next. Weekend dates roll to Monday." : "Callback scheduling is unavailable for this contact."}</p>
  </div>;
}
