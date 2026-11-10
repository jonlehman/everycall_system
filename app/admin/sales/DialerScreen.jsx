"use client";
import { useEffect, useState } from "react";
import { callDispositions, canonicalSalesOutcome, salesDispositionLabel } from '../../../lib/salesDispositions.js';
import { parseSalesSignupDollars, formatSalesSignupAmount } from '../../../lib/salesSignupAmount.js';
import { normalizeSalesCheckoutPhone } from "../../../lib/salesCheckoutRecipient.js";
import {
  OUTCOMES,
  HANDOFF,
  dialerPhase,
  elapsed,
  orderNumbers,
  renderScript,
  suggestedAsks,
  safeExternalUrl,
  formatPhone,
} from "./dialerState.mjs";
import { DisabledHint, HintButton, HintInput, DisabledReasonContext, busyReason, disabledReasons } from "./DisabledHint";
import styles from "./DialerScreen.module.css";
import CallbackPicker from "./CallbackPicker";
import AddContactForm from "./AddContactForm";
import ContactsScreen, { contactStatus } from "./ContactsScreen";
import { savedNoteHistory } from "./salesNoteHistory.mjs";
import { companyBriefFailureMessage, companyBriefAttemptMetadata } from "../../../lib/salesCompanyBriefDiagnostics.js";

function Button({
  children,
  tone = "",
  large = false,
  className = "",
  ...props
}) {
  return (
    <HintButton
      wrapperClassName={className}
      type="button"
      className={`${styles.button} ${tone ? styles[tone] : ""} ${large ? styles.large : ""} ${className}`}
      {...props}
    >
      {children}
    </HintButton>
  );
}
function Section({ children, className = "" }) {
  return (
    <section className={`${styles.card} ${className}`}>{children}</section>
  );
}
function Row({ label, children }) {
  return (
    <div className={styles.detail}>
      <span>{label}</span>
      <div>{children || "—"}</div>
    </div>
  );
}
function History({ prospect, ready = false }) {
  const history = prospect?.history || [];
  const notes = savedNoteHistory(prospect || {});
  return (
    <Section>
      <h2>{ready ? "Notes" : "History"}</h2>
      {prospect?.inboundReturn && prospect.returnMessage && (
        <Row label="Return message">{prospect.returnMessage}</Row>
      )}
      {history.slice(0, ready ? 1 : 3).map((item, index) => (
        <Row
          key={item.id || index}
          label={new Date(item.startedAt || item.createdAt).toLocaleDateString(
            undefined,
            { month: "short", day: "numeric" },
          )}
        >
          {new Date(item.startedAt || item.createdAt).toLocaleTimeString(
            undefined,
            { hour: "numeric", minute: "2-digit" },
          )}{" "}
          · {(callDispositions(item).length ? callDispositions(item).map(salesDispositionLabel).join(" · ") : String(item.outcome || item.state || "Call").replaceAll("_", " "))}
        </Row>
      ))}
      {!history.length && (
        <Row label="Last attempt">
          {prospect?.outcome?.replaceAll("_", " ") || "No prior calls"}
        </Row>
      )}
      {ready && (
        <Row label="Best time">
          {prospect?.bestTime || "No preferred time recorded"}
        </Row>
      )}
      <div className={styles.savedNoteHistory} aria-label="Saved note history">
        {notes.length ? notes.map(note => (
          <Row key={note.id} label={note.enteredAt === null ? "Undated" : new Date(note.enteredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}>
            {note.body}
          </Row>
        )) : <Row label="Notes">No notes yet</Row>}
      </div>
    </Section>
  );
}
function ReturnWorkItem({ item, busy, onPrepare }) {
  const [adding, setAdding] = useState(false);
  return (
    <Section>
      <h2>Returned your call</h2>
      <strong>{item.businessName || formatPhone(item.phoneE164)}</strong>
      <Row label="Caller">{formatPhone(item.phoneE164)}</Row>
      <Row label="Message">{item.message || "Message not available yet."}</Row>
      {item.needsWebsite || item.demoStatus === "failed" || (!["queued", "preparing", "building"].includes(item.demoStatus) && ((item.permission ?? item.permissionGranted) !== true || !item.timezone)) ? <>
        <Button disabled={Boolean(busy)} disabledReason={busyReason} onClick={() => setAdding(true)}>Add website & prepare</Button>
        {adding && <AddContactForm initialPhone={item.phoneE164} initialValues={item} requireWebsite busy={Boolean(busy)} onCancel={() => setAdding(false)} onSave={async (details) => {
          const result = await onPrepare(item, details);
          if (result !== true) throw new Error("Could not prepare this return call. Check the details and try again.");
        }} />}
      </> : <p>The demo is preparing. This return call moves to the top when ready.</p>}
    </Section>
  );
}

function Notes({ note, onNote }) {
  return (
    <label className={styles.notes}>
      Notes — carry into the wrap-up
      <textarea
        aria-label="Notes — carry into the wrap-up"
        maxLength={4000}
        value={note}
        onChange={(e) => onNote(e.target.value)}
        placeholder="What did they say about after-hours calls? Who answers now?"
      />
    </label>
  );
}
function ScriptPart({ label, text }) {
  return (
    <div className={styles.scriptPart}>
      <h3>{label}</h3>
      <p>{text || "No script has been configured for this phase."}</p>
    </div>
  );
}
export default function DialerScreen({
  queue,
  prospect,
  checkoutContext,
  selectedContactId = prospect?.defaultContactId,
  onCompanyContact,
  call,
  busy,
  error,
  softphoneState,
  microphoneState = "not_requested",
  pendingWrapups = 0,
  muted,
  note,
  outcome,
  dispositions = outcome && outcome !== "paid" ? [outcome] : [],
  callbackAt,
  dncReason,
  now = Date.now(),
  onNote,
  onOutcome,
  onCallback,
  onDncReason,
  onCall,
  onAction,
  onMute,
  onReconnect,
  onSkip,
  onRemove,
  onSave,
  onCheckout,
  onIntroEmail,
  onBook,
  availability,
  onMoreSlots,
  incoming,
  onIncoming,
  onPrepareReturn,
  onPrepareCompanyBrief,
  briefGenerating = false,
  searchResults,
  onSearch,
  onSignOut,
  view = "dial",
  onNavigate,
  onSelectContact,
  browsingContact = false,
  onPrepareContact,
  onRestoreContact,
  onAddContact,
}) {
  const phase = dialerPhase(call),
    active = Boolean(call?.id && !call.terminal),
    selectedContact = prospect?.contacts?.find(item => item.id === selectedContactId),
    displayContact = call?.id ? call.contactSnapshot : selectedContact,
    numbers = orderNumbers(selectedContact ? [...(selectedContact.numbers || []), ...(prospect?.sharedNumbers || []).map(number => ({ ...number, shared: true }))] : []),
    cell = numbers.find((n) => n.type === "cell");
  const [picker, setPicker] = useState(""),
    [channel, setChannel] = useState(cell ? "sms" : "email"),
    [email, setEmail] = useState(prospect?.email || ""),
    [signupCharge, setSignupCharge] = useState("100.00"),
    [phone, setPhone] = useState(cell?.phoneE164 || ""),
    [slot, setSlot] = useState(null),
    [addingIncoming, setAddingIncoming] = useState("");
  useEffect(() => { setSignupCharge("100.00"); setEmail(displayContact?.email || ""); setChannel(cell ? "sms" : "email"); setPhone(cell?.phoneE164 || ""); }, [prospect?.id, selectedContactId, call?.id, queue.config?.phoneTestMode, queue.config?.customSignupAmountEnabled]);
  const amountCents = checkoutContext?.amountCents ?? parseSalesSignupDollars(signupCharge);
  const selectedOutcome = canonicalSalesOutcome(dispositions);
  const suppressesCalls = ["do_not_call", "wrong_number", "not_interested"].includes(selectedOutcome);
  const scripts = queue.scripts || {},
    vars = {
      first_name: displayContact?.firstName || displayContact?.displayName?.split(" ")[0] || "there",
      business_name: (call?.id ? call.raw?.businessName || call.businessName : prospect?.businessName) || "your business",
      signup_charge: amountCents ? formatSalesSignupAmount(amountCents) : "the agreed signup charge",
      rep_name: queue.operator?.name || "",
      rep_phone: queue.operator?.phone || "",
      cell: call?.id ? (displayContact?.numberType === "cell" ? displayContact.phoneE164 : "") : cell?.phoneE164 || "",
      shop: call?.id ? (displayContact?.numberType === "shop" ? displayContact.phoneE164 : "") : numbers.find((n) => n.type === "shop")?.phoneE164 || "",
    },
    script = (key) =>
      renderScript(scripts[key] || (key === "handoff" ? HANDOFF : ""), vars);
  const duration = elapsed(
      call?.connectedAt || call?.startedAt,
      call?.endedAt || now,
    ),
    demoDuration = call?.demoDurationSeconds
      ? elapsed(0, call.demoDurationSeconds * 1000)
      : elapsed(call?.demoStartedAt, call?.demoEndedAt || call?.endedAt || now),
    currentStep =
      phase === "WRAPUP" ? 3 : phase === "DEMO" ? 2 : phase === "TALK" ? 1 : 0;
  const [selectedStage, setSelectedStage] = useState(null);
  useEffect(() => {
    setSelectedStage(null);
  }, [phase, call?.id, prospect?.id]);
  const panelStage = selectedStage ?? currentStep;
  const customerPaid = Boolean(call?.paidAt || call?.customerPaid) || prospect?.status === "paid";
  const testCheckout = call?.id ? Boolean(call.phoneTestMode) : Boolean(queue.config?.phoneTestMode);
  const checkoutRetryable = checkoutContext && ["creating", "created"].includes(checkoutContext.status);
  const checkoutChannel = checkoutContext?.channel || channel;
  const checkoutPhone = checkoutContext?.channel === "sms" ? checkoutContext.recipient : testCheckout ? queue.config?.checkoutTestPhone || "+14256154640" : phone;
  const validCheckoutPhone = normalizeSalesCheckoutPhone(checkoutPhone);
  const checkoutEmail = checkoutContext?.channel === "email" ? checkoutContext.recipient : testCheckout ? queue.config?.checkoutTestEmail || "" : email;
  const canDial =
      Boolean(selectedContact) && !busy && !call?.id && softphoneState === "ready" && prospect?.eligible && prospect?.demoStatus === "ready" && !["Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {})),
    editUrl = "/sales/scripts";
  const dialReason = disabledReasons(
    !selectedContact && "Choose an active company contact before dialing.",
    busy && busyReason,
    call?.id && "Finish the current call and save its outcome before dialing again.",
    softphoneState !== "ready" && `Browser calling is ${String(softphoneState).replaceAll("_", " ")}. Reconnect and wait until ready.`,
    !prospect?.eligible && (prospect?.callBlockedReason || "This prospect is not eligible to call. Check calling permission, timezone, and contact status."),
    prospect?.demoStatus !== "ready" && "The AI Receptionist must be ready before dialing.",
    ["Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {})) && `This contact is marked ${contactStatus(prospect || {})}.`,
  );
  const callbackReason = disabledReasons(
    queue.config?.phoneTestMode && "Contact callbacks cannot be changed during phone test mode.",
    prospect?.doNotCall && "This contact is on the Do not call list. Callbacks cannot be scheduled.",
    prospect?.suppressed && "This contact is suppressed. Callbacks cannot be scheduled.",
    ["Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {})) && `Callbacks cannot be scheduled for a contact marked ${contactStatus(prospect || {})}.`,
  );
  const micLabel =
    microphoneState === "live"
      ? muted
        ? "your mic is muted"
        : "mic live"
      : {
          not_requested: "microphone not requested",
          requesting: "requesting microphone",
          denied: "microphone permission denied",
          released: "microphone released",
          ended: "microphone ended",
          unavailable: "microphone unavailable",
        }[microphoneState] || "microphone unavailable";
  const pill =
    phase === "READY"
      ? browsingContact && (!prospect?.eligible || prospect?.demoStatus !== "ready" || ["Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {})))
        ? `${contactStatus(prospect || {})}${prospect?.callBlockedReason ? ` · ${prospect.callBlockedReason}` : ""}`
        : softphoneState === "ready"
        ? `Ready · ${micLabel} · browser connected`
        : `Calling ${String(softphoneState).replaceAll("_", " ")}`
      : phase === "DIALING"
        ? `Dialing · ${micLabel}`
        : phase === "WRAPUP"
          ? `Call ended · ${duration}`
          : phase === "DEMO"
            ? `On call ${duration} · demo ${demoDuration} · ${micLabel}`
            : `On call ${duration} · ${micLabel} · ${numbers.find((n) => n.phoneE164 === call?.dialedNumber)?.label || "phone"}`;
  const briefMetadata = companyBriefAttemptMetadata(prospect?.companyBrief);
  return (
    <div className={styles.dialer} data-phase={phase}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span>E</span>EveryCall Sales
          <nav className={styles.navigation} aria-label="Main">
            <HintButton type="button" aria-current={view === "dial" && !browsingContact ? "page" : undefined} onClick={() => onNavigate?.("dial")}>Dial</HintButton>
            <HintButton type="button" aria-current={view === "contacts" || browsingContact ? "page" : undefined} disabled={Boolean(call?.id) || Boolean(busy)} disabledReason={disabledReasons(call?.id && "Finish the current call and save its outcome before opening Contacts.", busy && busyReason)} onClick={() => onNavigate?.("contacts")}>Contacts</HintButton>
          </nav>
        </div>
        <div className={styles.counters}>
          <span className={styles.eyebrow}>Today</span>
          {["dials", "conversations", "demos", "paid"].map((key) => (
            <span key={key}>
              <strong>{queue.counters?.[key] ?? 0}</strong> {key}
            </span>
          ))}
          <span className={styles.readyCount}>
            <strong>{queue.readyCount ?? 0}</strong> ready to call
          </span>
        </div>
        <div className={styles.rep}>
          {queue.operator?.name || queue.operator?.displayName || "Sales"}
          <HintButton onClick={onSignOut} type="button">
            Sign out
          </HintButton>
        </div>
      </header>
      {pendingWrapups > 0 && (
        <div className={styles.draftNotice} role="status">
          {pendingWrapups} previous wrap-up{" "}
          {pendingWrapups === 1 ? "draft is" : "drafts are"} preserved,
          including notes and outcomes. Finish and save this call to return to
          it.
        </div>
      )}
      {(incoming || []).map((item) => (
        <div className={styles.incoming} key={item.incomingId} data-incoming-id={item.incomingId}>
          <div className={styles.incomingTop}>
            <div>
              <div className={styles.eyebrow}>
                Incoming call ·{" "}
                {item.state === "taken"
                  ? "connected"
                  : item.state === "receptionist"
                    ? "AI Receptionist taking a message"
                    : "ringing"}
                {!item.prospectId ? " · no match" : ""}
              </div>
              <strong>
                {[item.businessName, item.phoneE164, item.contactName]
                  .filter(Boolean)
                  .join(" · ")}
                {!item.prospectId ? " · not in your list" : ""}
              </strong>
              <p>
                {item.context ||
                  (!item.prospectId
                    ? "Take it first. Find or add them while you talk."
                    : "Returning your call")}
              </p>
            </div>
            <div className={styles.actions}>
              {!active && item.canTake !== false && item.state !== "taken" && (
                <Button
                  tone="green"
                  onClick={() => onIncoming(item, "take")}
                  disabled={busy || softphoneState !== "ready"}
                  disabledReason={disabledReasons(busy && busyReason, softphoneState !== "ready" && `Browser calling is ${String(softphoneState).replaceAll("_", " ")}. Reconnect and wait until ready.`)}
                >
                  Take call
                </Button>
              )}
              {item.state !== "taken" && (
                <Button
                  onClick={() => onIncoming(item, "receptionist")}
                  disabled={busy || item.state === "receptionist"}
                  disabledReason={disabledReasons(busy && busyReason, item.state === "receptionist" && "The AI Receptionist is already handling this caller.")}
                >
                  Send to AI Receptionist
                </Button>
              )}
            </div>
          </div>
          {!item.prospectId && item.state === "taken" ? (
            <div className={styles.incomingSearch}>
              <input
                aria-label="Search prospects"
                placeholder="Search by business name or number"
                onChange={(e) => onSearch(e.target.value)}
              />
              <span>or</span>
              <Button disabled={busy || queue.config?.phoneTestMode} disabledReason={disabledReasons(busy && busyReason, queue.config?.phoneTestMode && "Adding prospects is disabled during phone test mode.")} onClick={() => setAddingIncoming(item.incomingId)}>Add as new prospect</Button>
              {addingIncoming === item.incomingId && <AddContactForm initialPhone={item.phoneE164} busy={Boolean(busy)} onCancel={() => setAddingIncoming("")} onSave={async (details) => {
                const result = await onIncoming(item, "create", { ...details, businessName: details.business_name, contactName: details.contact_name, websiteUrl: details.website });
                if (result === false || result === null) throw new Error("Could not add this prospect. Check the details and try again.");
              }} />}
              {searchResults?.map((result) => (
                <Button
                  key={result.id}
                  onClick={() =>
                    onIncoming(item, "match", { prospectId: result.id })
                  }
                >
                  {result.businessName}
                </Button>
              ))}
            </div>
          ) : (
            <small>
              {active
                ? "You’re on a call. The AI Receptionist takes a message and adds “Returned your call” to your list."
                : `Taking it swaps this caller in; ${prospect?.businessName || "your current prospect"} goes back to the top of the list. No answer in 15 seconds → the AI Receptionist takes a message.`}
            </small>
          )}
        </div>
      ))}
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          {["error", "disconnected"].includes(softphoneState) && (
            <Button onClick={onReconnect}>Reconnect browser calling</Button>
          )}
        </div>
      )}
      {view === "contacts" ? <ContactsScreen onSelect={onSelectContact} onAdd={onAddContact} busy={Boolean(busy)} phoneTestMode={Boolean(queue.config?.phoneTestMode)} /> : <div className={styles.body}>
        <aside className={styles.prospect}>
          {(queue.returnItems || []).map((item) => (
            <ReturnWorkItem key={item.incomingId} item={item} busy={busy} onPrepare={onPrepareReturn} />
          ))}
          <Section>
            <div className={styles.prospectEyebrow}>
              <span className={styles.eyebrow}>
                {prospect?.attemptCount >=
                  (queue.config?.removePromptAt || 4) &&
                !prospect?.conversationCount
                  ? `${prospect.attemptCount} attempts, no conversation — remove?`
                  : `Current prospect · attempt ${(prospect?.attemptCount || 0) + 1}`}
              </span>
              <Button
                disabled={busy || Boolean(call?.id) || !prospect?.id || ["Paid", "Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {}))}
                disabledReason={disabledReasons(busy && busyReason, call?.id && "Finish the current call and save its outcome first.", !prospect?.id && "Select a prospect first.", ["Paid", "Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {})) && `This contact is marked ${contactStatus(prospect || {})}.`)}
                onClick={onRemove}
              >
                Remove from list
              </Button>
            </div>
            <Button disabled={Boolean(busy || call?.id || !prospect?.id || prospect?.editCapabilities?.canEdit === false)} disabledReason={disabledReasons(busy && busyReason, call?.id && "Finish the current call and save its outcome before editing.", !prospect?.id && "Select a company first.", prospect?.editCapabilities?.canEdit === false && prospect.editCapabilities.reason)} onClick={() => window.location.assign(`/sales/prospects/${encodeURIComponent(prospect.id)}/edit?returnTo=queue`)}>Edit company</Button>
            <h1>{prospect?.businessName || "No prospects ready to call"}</h1>
            <p className={styles.contact}>
              {[displayContact?.displayName || (call?.id ? "Contact not recorded" : "Choose a contact"), displayContact?.title]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {prospect?.inboundReturn && (
              <span className={styles.pitch}>Returned your call</span>
            )}
            <DisabledHint disabled={Boolean(busy || call?.id)} reason={call?.id ? "Finish the current call and save its outcome before changing contacts." : busyReason}>
              <label className={styles.contactPicker}>Company contact <select aria-label="Company contact" value={selectedContact ? selectedContactId : ""} disabled={Boolean(busy || call?.id)} onChange={event => onCompanyContact?.(event.target.value)}>
                <option value="">Choose a contact</option>
                {(prospect?.contacts || []).map(contact => <option key={contact.id} value={contact.id}>{contact.displayName || "Unnamed contact"}{contact.id === prospect.defaultContactId ? " · default" : ""}</option>)}
              </select></label>
            </DisabledHint>
            <div className={styles.numbers}>
              {numbers.map((number) => (
                <div key={number.id || number.phoneE164}>
                  <span>{number.shared ? "Shared company · " : ""}{number.label || number.type}</span>
                  <HintButton
                    type="button"
                    disabled={!canDial}
                    disabledReason={dialReason}
                    onClick={() => onCall(number)}
                  >
                    {formatPhone(number.phoneE164)}
                  </HintButton>
                  {active && call.dialedNumber === number.phoneE164 ? (
                    <small className={styles.onLine}>on this line</small>
                  ) : number.lastNote ? (
                    <small>{number.lastNote}</small>
                  ) : null}
                </div>
              ))}
            </div>
            <div className={styles.chips}>
              {(prospect?.city || prospect?.region) && (
                <span>{[prospect.city, prospect.region].filter(Boolean).join(' · ')}</span>
              )}
              {prospect?.metro && <span>{prospect.metro}</span>}
              {safeExternalUrl(prospect?.website) && (
                <a
                  href={safeExternalUrl(prospect.website)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {prospect.website
                    .replace(/^https?:\/\//, "")
                    .replace(/\/$/, "")}{" "}
                  ↗
                </a>
              )}
              {(prospect?.pitchFlags || []).map((flag) => (
                <span key={flag} className={styles.pitch}>
                  {flag}
                </span>
              ))}
            </div>
            {!prospect && <p>Prepared prospects appear here automatically.</p>}
          </Section>
          {phase === "WRAPUP" ? (
            <Section>
              <h2>This call</h2>
              <Row label="Length">
                {duration} total · demo {demoDuration}
              </Row>
              <Row label="Your notes">{note || "No notes"}</Row>
              <Row label="Transcript">
                {call.transcript
                  ? "Ready — attached to this call"
                  : `${call.transcriptStatus === "failed" ? "Unavailable" : "Processing"} — Save & next doesn’t wait for it.`}
              </Row>
              {safeExternalUrl(call.recordingUrl) ? (
                <a
                  href={safeExternalUrl(call.recordingUrl)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Recording ↗
                </a>
              ) : (
                <Row label="Recording">
                  {call.recordingUrl ? "Unavailable" : "Processing"}
                </Row>
              )}
            </Section>
          ) : null}
          {phase === "READY" || phase === "DIALING" ? (
            <History prospect={prospect} ready />
          ) : null}
          {phase === "READY" && prospect && <Section>
            <CallbackPicker prospect={prospect} value={prospect.callbackAt} onSet={onCallback} disabled={Boolean(busy)} schedulingReason={callbackReason} canSchedule={!queue.config?.phoneTestMode && !prospect.doNotCall && !prospect.suppressed && !["Removed", "Not interested", "Do not call"].includes(contactStatus(prospect))} saveImmediately now={now} />
          </Section>}
          {phase !== "WRAPUP" && (
            <Section>
              <div className={styles.factsTitle}>
                <h2>Company at a glance</h2>
                <small>from their website</small>
              </div>
              {prospect?.companyBrief?.status === "ready" ? <>
                {prospect.companyBrief.standOut && <Row label="What makes them stand out">{prospect.companyBrief.standOut}</Row>}
                <Row label="Main services"><ul>{prospect.companyBrief.services.map((service, index) => <li key={index}>{service}</li>)}</ul></Row>
                <Row label="Why customers call">{prospect.companyBrief.whyCustomersCall}</Row>
              </> : <>
                <p className={styles.caption} role="status">
                  {briefGenerating || prospect?.companyBrief?.status === "pending"
                    ? "Preparing company brief…"
                    : prospect?.companyBrief?.status === "unavailable"
                      ? companyBriefFailureMessage(prospect.companyBrief)
                      : "Company brief has not been generated yet."}
                </p>
                {!briefGenerating && prospect?.companyBrief?.status === "unavailable" && briefMetadata.attemptRef &&
                  <p className={styles.caption}>Reference: {briefMetadata.attemptRef}
                    {briefMetadata.generatedAt && <> · {briefMetadata.generatedAt}</>}
                  </p>}
                {prospect?.demoStatus === "ready" && onPrepareCompanyBrief && <Button
                  onClick={onPrepareCompanyBrief} disabled={briefGenerating} disabledReason="The company brief is being generated. Wait for it to finish.">
                  {briefGenerating ? "Generating…" : prospect.companyBrief?.status === "pending" ? "Check brief" : "Generate brief"}
                </Button>}
              </>}
            </Section>
          )}
          {["TALK", "DEMO", "WRAPUP"].includes(phase) && (
            <History prospect={prospect} />
          )}
        </aside>
        <main className={styles.callPanel}>
          <Section>
            <div className={styles.callHeader}>
              <ol className={styles.stepper} aria-label="Call phases">
                {["Dial", "Talk", "Demo", "Close"].map((step, index) => (
                  <li
                    key={step}
                    aria-current={index === currentStep ? "step" : undefined}
                    className={
                      index < currentStep
                        ? styles.done
                        : index === currentStep
                          ? styles.current
                          : ""
                    }
                  >
                    <HintButton
                      type="button"
                      aria-label={step}
                      aria-pressed={index === panelStage}
                      onClick={() => setSelectedStage(index)}
                    >
                      <span>{index < currentStep ? "✓" : index + 1}</span>
                      {step}
                    </HintButton>
                  </li>
                ))}
              </ol>
              <span
                className={`${styles.pill} ${phase === "DEMO" ? styles.amberPill : phase === "WRAPUP" ? styles.endedPill : ""}`}
                role="status"
              >
                {pill}
              </span>
            </div>
            {phase === "READY" && browsingContact && prospect?.demoStatus !== "ready" && !["Paid", "Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {})) ? <div className={styles.actions}>
              <Button tone="blue" disabled={Boolean(busy) || !prospect?.preparationEligible || !safeExternalUrl(prospect?.website) || ["queued", "preparing", "building"].includes(prospect?.demoStatus)} disabledReason={disabledReasons(busy && busyReason, !prospect?.preparationEligible && (prospect?.preparationBlockedReason || prospect?.callBlockedReason || "This prospect is not eligible for preparation. Check calling permission, timezone, and contact status."), !safeExternalUrl(prospect?.website) && "Add a valid website before preparing this prospect.", ["queued", "preparing", "building"].includes(prospect?.demoStatus) && "The AI Receptionist is already preparing. Wait for it to finish.")} onClick={onPrepareContact}>{["queued", "preparing", "building"].includes(prospect?.demoStatus) ? "Preparing…" : "Prep now"}</Button>
              <p className={styles.caption}>{prospect?.demoFailure || (!prospect?.website ? "A website is needed before this prospect can be prepared." : "Prepare the AI Receptionist before dialing this prospect.")}</p>
              <Button className={styles.pushRight} disabled={Boolean(busy)} disabledReason={busyReason} onClick={onSkip}>Back to queue</Button>
            </div> : ["READY", "DIALING"].includes(phase) ? (
              <div className={styles.actions}>
                {numbers.slice(0, 2).map((number, index) => (
                  <Button
                    key={number.id || number.phoneE164}
                    tone={index ? "greenOutline" : "green"}
                    large={!index}
                    disabled={!canDial}
                    disabledReason={dialReason}
                    onClick={() => onCall(number)}
                  >
                    Call {number.label?.toLowerCase() || number.type} ·{" "}
                    {formatPhone(number.phoneE164)}
                  </Button>
                ))}
                {phase === "READY" && browsingContact && contactStatus(prospect || {}) === "Removed" && <Button tone="blue" disabled={Boolean(busy) || queue.config?.phoneTestMode} disabledReason={disabledReasons(busy && busyReason, queue.config?.phoneTestMode && "Restoring contacts is disabled during phone test mode.")} onClick={onRestoreContact}>Put back in list</Button>}
                {phase === "DIALING" ? (
                  <Button
                    tone="dangerOutline"
                    onClick={() => onAction("end_call")}
                  >
                    End call
                  </Button>
                ) : (
                  <Button
                    className={styles.pushRight}
                    disabled={busy || !prospect?.id}
                    disabledReason={disabledReasons(busy && busyReason, !prospect?.id && "Select a prospect first.")}
                    onClick={onSkip}
                  >
                    {browsingContact ? "Back to queue" : "Skip for now"}
                  </Button>
                )}
              </div>
            ) : phase !== "WRAPUP" ? (
              <>
                <div className={styles.actions}>
                  <Button
                    tone="amber"
                    large
                    disabled={busy || (phase === "TALK" && !call.aiReady)}
                    disabledReason={disabledReasons(busy && busyReason, phase === "TALK" && !call.aiReady && "Wait for the AI Receptionist standby connection to be ready.")}
                    title={
                      phase === "TALK" && !call.aiReady
                        ? "Waiting for the AI Receptionist standby leg"
                        : ""
                    }
                    onClick={() =>
                      onAction(phase === "DEMO" ? "end_demo" : "start_demo")
                    }
                  >
                    {phase === "DEMO"
                      ? "End demo — put me back on"
                      : "Start demo — hand to the AI Receptionist"}
                  </Button>
                  <Button disabled={busy} disabledReason={busyReason} onClick={onMute}>
                    {phase === "DEMO"
                      ? muted
                        ? "Unmute me"
                        : "Mute me"
                      : muted
                        ? "Unmute"
                        : "Mute"}
                  </Button>
                  <Button
                    tone="dangerOutline"
                    disabled={busy === "end_call"}
                    disabledReason="The call is already ending. Wait for it to finish."
                    onClick={() => onAction("end_call")}
                  >
                    End call
                  </Button>
                </div>
                <p className={styles.caption}>
                  {phase === "DEMO"
                    ? "Ending the demo unmutes you and keeps the call connected. Let it run until he’s asked two or three things."
                    : "Start demo mutes you and puts the AI Receptionist on. Say the hand-off line first, then press it."}
                </p>
              </>
            ) : null}
            {panelStage === 3 && (
              <>
                <div className={styles.closeCards}>
                  <div className={`${styles.card} ${styles.checkout}`}>
                    <h3>1 · Signup link</h3>
                    <h2>
                      Send{" "}
                      {vars.first_name === "there"
                        ? "the prospect"
                        : vars.first_name}{" "}
                      the checkout link
                    </h2>
                    <p>
                      {testCheckout ? "Stripe TEST checkout — no real charge. Delivery goes only to your test phone or account email." : customerPaid ? "This customer has already paid for setup." : `Stripe checkout: ${amountCents ? formatSalesSignupAmount(amountCents) : "enter a valid charge"} setup, first month included. Nothing activates until it’s paid. Stripe marks this call Paid.`}
                    </p>
                    <label className={styles.field}>
                      Signup charge (USD)
                      <HintInput aria-label="Signup charge (USD)" type="number" inputMode="decimal" min="1" max="999999.99" step="0.01" value={checkoutContext ? ((checkoutContext.amountCents ?? 10000) / 100).toFixed(2) : signupCharge} readOnly={Boolean(checkoutContext) || testCheckout || !queue.config?.customSignupAmountEnabled} disabled={Boolean(busy)} disabledReason={checkoutContext ? "The existing checkout amount is fixed. Use its original link." : testCheckout ? "New test signup links are fixed at $100.00." : !queue.config?.customSignupAmountEnabled ? "The signup charge is currently fixed at $100.00." : busy ? busyReason : ""} onChange={event => setSignupCharge(event.target.value)} />
                    </label>
                    <small>{amountCents ? `${formatSalesSignupAmount(amountCents)} USD, first month included. Confirm this amount before sending.` : "Enter $1.00 to $999,999.99, with at most two decimal places."}</small>
                    {checkoutContext && <p role="status">This company's {checkoutContext.isTest ? "test " : ""}signup link is reserved for {checkoutContext.channel === "sms" ? "text" : "email"} to {checkoutContext.recipient}. Charge: {formatSalesSignupAmount(checkoutContext.amountCents)} USD. Status: {checkoutContext.status}.{checkoutContext.url && <> <a href={checkoutContext.url} target="_blank" rel="noreferrer">Open existing checkout</a></>}</p>}
                    <div className={styles.actions}>
                      <Button
                        disabled={busy || Boolean(checkoutContext)}
                        disabledReason={disabledReasons(checkoutContext && "A checkout already exists. Its original recipient is fixed.", busy && busyReason)}
                        aria-pressed={checkoutChannel === "sms"}
                        onClick={() => setChannel("sms")}
                      >
                        Text
                      </Button>
                      <Button
                        disabled={Boolean(checkoutContext)} disabledReason="A checkout already exists. Its original recipient is fixed."
                        aria-pressed={checkoutChannel === "email"}
                        onClick={() => setChannel("email")}
                      >
                        Email
                      </Button>
                    </div>
                    <label>
                      {checkoutChannel === "sms" ? "Text to" : "Email to"}
                      <HintInput
                        disabledReason={checkoutContext ? "The existing checkout recipient is fixed. Use its link above." : testCheckout ? "Phone test mode uses only your configured test destination. Switch delivery channel to use your other test destination." : ""}
                        aria-label={
                          checkoutChannel === "sms" ? "Text to" : "Email to"
                        }
                        type={checkoutChannel === "sms" ? "tel" : "email"}
                        readOnly={Boolean(checkoutContext) || testCheckout}
                        value={
                          checkoutChannel === "sms" ? checkoutPhone : checkoutEmail
                        }
                        onChange={(e) => checkoutChannel === "sms" ? setPhone(e.target.value) : setEmail(e.target.value)}
                      />
                    </label>
                    <small>
                      {cell
                        ? "Use a mobile number that can receive texts. Changes apply only to this signup link."
                        : "No cell on file. Enter a mobile number for Text, or send by Email."}
                    </small>
                    <Button
                      tone="blue"
                      disabled={
                        busy ||
                        !prospect?.id ||
                        (customerPaid && !testCheckout) ||
                        (!amountCents || (Boolean(checkoutContext) && !checkoutRetryable) || !selectedContact || (checkoutChannel === "sms" ? !validCheckoutPhone : !checkoutEmail.trim()))
                      }
                      disabledReason={disabledReasons(!amountCents && "Enter a valid signup charge of at least $1.00.", checkoutContext && !checkoutRetryable && "A checkout already exists for this company and mode. Use its original link above; no second checkout will be created.", !selectedContact && "Choose an active company contact first.", busy && busyReason, !prospect?.id && "Select a prospect first.", customerPaid && !testCheckout && "This customer has already paid for setup.", checkoutChannel === "sms" && !validCheckoutPhone && "Enter a valid mobile number first.", checkoutChannel !== "sms" && !checkoutEmail.trim() && (testCheckout ? "No test email destination is configured for this account. Use Text." : "Enter a recipient email address first."))}
                      onClick={() =>
                        onCheckout({
                          amountCents,
                          channel: checkoutChannel,
                          email: checkoutEmail,
                          ...(checkoutChannel === "sms" ? { phone: validCheckoutPhone } : {}),
                        })
                      }
                    >
                      {checkoutRetryable ? "Retry original delivery" : checkoutContext ? "Checkout already created" : customerPaid && !testCheckout
                        ? "Paid"
                        : call?.linkSentAt || prospect?.signupLinkSent
                          ? "Send link again"
                          : "Send link"}
                    </Button>
                    {!call?.id && <small>Confirm the recipient before sending without a call.</small>}
                  </div>
                  <DisabledReasonContext.Provider value={phase !== "WRAPUP" ? "Setup booking is available after the call ends." : ""}><fieldset className={`${styles.card} ${styles.setupCard}`} disabled={phase !== "WRAPUP"} aria-label="Setup call">
                    <h3>2 · Setup call</h3>
                    <h2>
                      Book 15 minutes with{" "}
                      {availability?.owner ||
                        queue.config?.setupCallOwner ||
                        "Jon"}
                    </h2>
                    <p>
                      {customerPaid ? "Setup is paid. Open slots come live from the calendar." : "Not paid by then? Jon takes the card at the start of the call. Open slots come live from the calendar."}
                    </p>
                    <div className={styles.slotGrid}>
                      {(availability?.slots || []).map((item) => (
                        <Button
                          key={item.start}
                          aria-pressed={slot?.start === item.start}
                          onClick={() => setSlot(item)}
                        >
                          {item.label || new Date(item.start).toLocaleString()}
                        </Button>
                      ))}
                      <Button disabled={busy} disabledReason={busyReason} onClick={onMoreSlots}>
                        More…
                      </Button>
                    </div>
                    {availability?.error ? (
                      <small role="status">{availability.error}</small>
                    ) : !availability?.slots?.length ? (
                      <small>No open slots available. Try More…</small>
                    ) : null}
                    <label>
                      Invite to
                      <HintInput
                        type="email"
                        aria-label="Invite to"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    <Button
                      disabled={busy || !slot || !email.trim()}
                      disabledReason={disabledReasons(busy && busyReason, !slot && "Choose an open setup slot first.", !email.trim() && "Enter an email address for the setup invitation.")}
                      onClick={() => onBook({ ...slot, email })}
                    >
                      {call?.bookedAt
                        ? "Book another time"
                        : slot
                          ? `Book ${slot.label || new Date(slot.start).toLocaleString()}`
                          : "Choose a slot"}
                    </Button>
                  </fieldset></DisabledReasonContext.Provider>
                  <div className={styles.card}>
                    <h3>3 · Introduction email</h3>
                    <h2>Introduce EveryCall by email</h2>
                    <p>Send an editable introduction email to the selected contact. Replies go to you, the rep.</p>
                    <Button onClick={onIntroEmail} disabled={!prospect?.id || !selectedContact || !displayContact?.email || Boolean(busy) || Boolean(queue.config?.phoneTestMode) || Boolean(prospect?.suppressed || prospect?.doNotCall || ["Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {})))} disabledReason={disabledReasons(!prospect?.id && "Select a prospect first.", !selectedContact && "Choose an active company contact first.", !displayContact?.email && "The selected contact has no email address.", busy && busyReason, queue.config?.phoneTestMode && "Introduction emails are unavailable during phone test mode.", (prospect?.suppressed || prospect?.doNotCall || ["Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {}))) && "This contact is suppressed or unavailable.")}>Send email</Button>
                  </div>
                </div>
                {phase !== "WRAPUP" && <p className={styles.caption}>Setup booking is available after the call ends.</p>}
                <ScriptPart label="Script · Close" text={script("close")} />
                <p className={styles.caption}>
                  If he’d rather not do the card now: {script("close_decline")}
                </p>
              </>
            )}
          </Section>
          {panelStage === 0 ? (
            <Section>
              <div className={styles.scriptTitle}>
                <h3>Script · Opener</h3>
                <a href={editUrl}>Edit scripts</a>
              </div>
              <p className={styles.scriptLead}>{script("opener")}</p>
              <ScriptPart
                label="If he's interested"
                text={script("if_interested")}
              />
              <p className={styles.caption}>
                Then press <strong>Start demo</strong>. Your mic mutes on its
                own; the AI Receptionist takes the call.
              </p>
              <ScriptPart label="If voicemail" text={script("if_voicemail")} />
            </Section>
          ) : panelStage === 1 ? (
            <>
              <Section>
                <div className={styles.scriptTitle}>
                  <h3>Script · Talk</h3>
                  <a href={editUrl}>Edit scripts</a>
                </div>
                <p className={styles.scriptLead}>{script("talk_discovery")}</p>
                <ScriptPart label="The hand-off" text={script("handoff")} />
                <div className={styles.twoColumns}>
                  {(scripts.objections || []).map((objection, index) => (
                    <ScriptPart
                      key={index}
                      label={objection.title || objection.label || "Objection"}
                      text={renderScript(
                        objection.response || objection.text || objection,
                        vars,
                      )}
                    />
                  ))}
                </div>
                <div className={styles.twoColumns}>
                  <ScriptPart
                    label="No time right now"
                    text={script("no_time")}
                  />
                  <ScriptPart
                    label="You got the dispatcher"
                    text={script("gatekeeper")}
                  />
                </div>
              </Section>
            </>
          ) : panelStage === 2 ? (
            <Section>
              <div className={styles.scriptTitle}>
                <h3>While you listen</h3>
                <small>Transcript arrives after the call</small>
              </div>
              {script("while_you_listen") && (
                <p className={styles.caption}>{script("while_you_listen")}</p>
              )}
              <div className={styles.scriptPart}>
                <h3>If he stalls, unmute and suggest one</h3>
                <div className={styles.chips}>
                  {suggestedAsks(prospect).map((ask, index) => (
                    <span
                      key={index}
                      className={ask.pitch ? styles.pitch : styles.ask}
                    >
                      {ask.text}
                    </span>
                  ))}
                </div>
                {suggestedAsks(prospect).some((a) => a.pitch) && (
                  <p className={styles.caption}>
                    The after-hours question is the pitch — she’ll take the
                    message instead of losing the call.
                  </p>
                )}
              </div>
              <ScriptPart
                label="When he's heard enough"
                text={script("exit_line")}
              />
            </Section>
          ) : null}
        <Section className={styles.notesActions}>
          <Notes note={note} onNote={onNote} />
          <div className={styles.outcomeControls}>
            {OUTCOMES.map(([value, label]) => (
              <Button
                key={value}
                disabled={!call?.id || Boolean(busy)}
                disabledReason={disabledReasons(!call?.id && "Dial a call before choosing an outcome.", busy && busyReason)}
                aria-pressed={dispositions.includes(value)}
                onClick={() => {
                  onOutcome(value);
                  setPicker(value === "callback_requested" && !dispositions.includes(value) ? "callback_requested" : "");
                }}
              >
                {label}
              </Button>
            ))}
            <span
              className={`${styles.paid} ${call?.paidAt ? styles.paidActive : ""}`}
            >
              {call?.paidAt ? "✓ Paid — set by Stripe" : "Paid — set by Stripe"}
            </span>
            <Button
              tone="blue"
              disabled={
                !call?.terminal ||
                (!dispositions.length && !call?.paidAt) ||
                Boolean(busy) ||
                (selectedOutcome === "callback_requested" && !callbackAt)
              }
              disabledReason={disabledReasons(!call?.terminal && "End the call before saving its outcome.", !dispositions.length && !call?.paidAt && "Choose an outcome first.", busy && busyReason, selectedOutcome === "callback_requested" && !callbackAt && "Set a callback date and time first.")}
              onClick={onSave}
            >
              {busy === "outcome" ? "Saving…" : "Save & next →"}
            </Button>
          </div>
          {picker === "callback_requested" && (
            <div className={styles.picker}>
              <CallbackPicker prospect={prospect} value={callbackAt} onSet={onCallback} disabled={Boolean(busy)} schedulingReason="Dial a call before scheduling a callback outcome." canSchedule={Boolean(call?.id)} now={now} onClose={() => setPicker("")} />
            </div>
          )}
          {dispositions.length > 0 && <p role="status">Selected: {dispositions.map(salesDispositionLabel).join(" · ")}</p>}
          {suppressesCalls && <p role="status">DND and Bad number permanently block calls to this company and its saved phone/domain identities. This overrides Follow up; no callback will be scheduled.</p>}
          <p>Choose one or more dispositions, then Save &amp; next. Customer is a sales label; only Stripe sets Paid.</p>
          <small>
            {phase === "READY"
              ? "Outcomes unlock when a call is dialed. DND and Bad number are permanent."
              : phase === "WRAPUP"
                ? `Save & next doesn’t wait for the transcript.${queue.upcoming?.[0] ? ` Next up: ${queue.upcoming[0].businessName}` : ""}`
                : "Pick an outcome any time. Save & next activates once the call has ended."}
            {callbackAt && selectedOutcome === "callback_requested"
              ? ` Callback: ${new Date(callbackAt).toLocaleString()}`
              : ""}
          </small>
        </Section>
        </main>
      </div>}
    </div>
  );
}
