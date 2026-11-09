"use client";
import { cloneElement, createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./DisabledHint.module.css";

export const DisabledReasonContext = createContext("");
export const busyReason = "Wait for the current action to finish.";
export function disabledReasons(...reasons) {
  return [...new Set(reasons.filter(Boolean))].join(" ");
}

// The wrapper receives pointer and keyboard events while the native control stays disabled.
// Portaling avoids clipping by cards, scrolling panels, or the fixed mobile footer.
export function DisabledHint({ children, disabled, reason, className = "", input = false, readOnly = false }) {
  const inherited = useContext(DisabledReasonContext);
  const explanation = disabledReasons(inherited, (disabled || readOnly) && reason);
  const unavailable = Boolean(disabled || inherited || readOnly);
  const id = useId();
  const anchor = useRef(null);
  const popup = useRef(null);
  const hideTimer = useRef(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const show = () => { clearTimeout(hideTimer.current); setOpen(true); };
  const enter = () => { hovered.current = true; show(); };
  const leave = () => {
    hovered.current = false;
    hideTimer.current = setTimeout(() => { if (!hovered.current && !focused.current) setOpen(false); }, 120);
  };
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useEffect(() => {
    if (!unavailable) {
      hovered.current = false;
      focused.current = false;
      clearTimeout(hideTimer.current);
      setOpen(false);
    }
  }, [unavailable, explanation]);
  useEffect(() => {
    if (!open || !unavailable) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      const tip = popup.current?.getBoundingClientRect();
      if (!rect || !tip) return;
      setPosition({
        left: Math.max(8, Math.min(rect.left + rect.width / 2 - tip.width / 2, window.innerWidth - tip.width - 8)),
        top: Math.max(8, rect.top - tip.height - 8 >= 8 ? rect.top - tip.height - 8 : Math.min(rect.bottom + 8, window.innerHeight - tip.height - 8)),
      });
    };
    const escape = (event) => { if (event.key === "Escape") setOpen(false); };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", escape);
    };
  }, [open, unavailable, explanation]);
  if (!unavailable) return children;
  return <span ref={anchor} className={`${styles.anchor} ${input ? styles.input : ""} ${readOnly && !disabled && !inherited ? styles.readOnly : ""} ${className}`} data-disabled-hint="" tabIndex={disabled || inherited ? 0 : undefined}
    aria-describedby={explanation ? id : undefined}
    onMouseEnter={enter} onMouseLeave={leave}
    onFocus={() => { focused.current = true; show(); }} onBlur={() => { focused.current = false; if (!hovered.current) setOpen(false); }}>
    {readOnly && explanation ? cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ") }) : children}
    {explanation && !open && <span id={id} className={styles.srOnly}>{explanation}</span>}
    {open && explanation && createPortal(<span id={id} ref={popup} role="tooltip" onMouseEnter={enter} onMouseLeave={leave} className={styles.tooltip} style={position}>{explanation}</span>, document.body)}
  </span>;
}

export function HintButton({ disabledReason, wrapperClassName, ...props }) {
  return <DisabledHint disabled={props.disabled} reason={disabledReason} className={wrapperClassName}>
    <button {...props} />
  </DisabledHint>;
}

export function HintInput({ disabledReason, wrapperClassName, ...props }) {
  return <DisabledHint disabled={props.disabled} readOnly={props.readOnly && Boolean(disabledReason)} reason={disabledReason} className={wrapperClassName} input>
    <input {...props} />
  </DisabledHint>;
}
