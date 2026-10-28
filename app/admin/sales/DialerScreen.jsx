"use client";
import { useState } from "react";
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
import styles from "./DialerScreen.module.css";
import CallbackPicker from "./CallbackPicker";
import AddContactForm from "./AddContactForm";
import ContactsScreen, { contactStatus } from "./ContactsScreen";

function Button({
  children,
  tone = "",
  large = false,
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      className={`${styles.button} ${tone ? styles[tone] : ""} ${large ? styles.large : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
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
  return (
    <Section>
      <h2>{ready ? "Before you dial" : "History"}</h2>
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
          · {String(item.outcome || item.state || "Call").replaceAll("_", " ")}
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
      <Row label="Last note">
        {history[0]?.outcomeNotes || prospect?.note || "No notes yet"}
      </Row>
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
        <Button disabled={Boolean(busy)} onClick={() => setAdding(true)}>Add website & prepare</Button>
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
  call,
  busy,
  error,
  softphoneState,
  microphoneState = "not_requested",
  pendingWrapups = 0,
  muted,
  note,
  outcome,
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
    numbers = orderNumbers(
      prospect?.numbers?.length
        ? prospect.numbers
        : prospect?.phone
          ? [{ phoneE164: prospect.phone, label: "Phone", type: "other" }]
          : [],
    ),
    cell = numbers.find((n) => n.type === "cell");
  const [picker, setPicker] = useState(""),
    [channel, setChannel] = useState(cell ? "sms" : "email"),
    [email, setEmail] = useState(prospect?.email || ""),
    [slot, setSlot] = useState(null),
    [addingIncoming, setAddingIncoming] = useState("");
  const scripts = queue.scripts || {},
    vars = {
      first_name: prospect?.contactName?.split(" ")[0] || "there",
      business_name: prospect?.businessName || "your business",
      rep_name: queue.operator?.name || "",
      rep_phone: queue.operator?.phone || "",
      cell: cell?.phoneE164 || "",
      shop: numbers.find((n) => n.type === "shop")?.phoneE164 || "",
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
  const customerPaid = Boolean(call?.paidAt) || prospect?.status === "paid";
  const canDial =
      !busy && !call?.id && softphoneState === "ready" && prospect?.eligible && prospect?.demoStatus === "ready" && !["Removed", "Not interested", "Do not call"].includes(contactStatus(prospect || {})),
    editUrl = "/sales/scripts";
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
  return (
    <div className={styles.dialer} data-phase={phase}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span>E</span>EveryCall Sales
          <nav className={styles.navigation} aria-label="Main">
            <button type="button" aria-current={view === "dial" && !browsingContact ? "page" : undefined} onClick={() => onNavigate?.("dial")}>Dial</button>
            <button type="button" aria-current={view === "contacts" || browsingContact ? "page" : undefined} disabled={Boolean(call?.id) || Boolean(busy)} onClick={() => onNavigate?.("contacts")}>Contacts</button>
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
          <button onClick={onSignOut} type="button">
            Sign out
          </button>
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
                >
                  Take call
                </Button>
              )}
              {item.state !== "taken" && (
                <Button
                  onClick={() => onIncoming(item, "receptionist")}
                  disabled={busy || item.state === "receptionist"}
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
              <Button disabled={busy || queue.config?.phoneTestMode} onClick={() => setAddingIncoming(item.incomingId)}>Add as new prospect</Button>
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
                onClick={onRemove}
              >
                Remove from list
              </Button>
            </div>
            <h1>{prospect?.businessName || "No prospects ready to call"}</h1>
            <p className={styles.contact}>
              {[prospect?.contactName, prospect?.contactRole]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {prospect?.inboundReturn && (
              <span className={styles.pitch}>Returned your call</span>
            )}
            <div className={styles.numbers}>
              {numbers.map((number) => (
                <div key={number.phoneE164}>
                  <span>{number.label || number.type}</span>
                  <button
                    type="button"
                    disabled={!canDial}
                    onClick={() => onCall(number.phoneE164)}
                  >
                    {formatPhone(number.phoneE164)}
                  </button>
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
            {prospect?.callOpenerHook && <Row label="Suggested opener (list research)">{prospect.callOpenerHook}</Row>}
            {(prospect?.afterHoursClass || prospect?.postedHours || prospect?.researchNotes) && (
              <details className={styles.research}>
                <summary>List research</summary>
                <p>Rep preparation · not verified receptionist facts</p>
                {prospect.afterHoursClass && <Row label="After-hours classification">{prospect.afterHoursClass}</Row>}
                {prospect.postedHours && <Row label="Posted hours">{prospect.postedHours}</Row>}
                {prospect.researchNotes && <Row label="Research notes">{prospect.researchNotes}</Row>}
              </details>
            )}
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
            <CallbackPicker prospect={prospect} value={prospect.callbackAt} onSet={onCallback} disabled={Boolean(busy)} canSchedule={!queue.config?.phoneTestMode && !prospect.doNotCall && !prospect.suppressed && !["Removed", "Not interested", "Do not call"].includes(contactStatus(prospect))} saveImmediately now={now} />
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
                      ? ["insufficient_website_evidence", "website_evidence_missing"].includes(prospect.companyBrief.reason)
                        ? "The saved website content does not provide enough detail for a company brief."
                        : "Company brief unavailable. You can try again."
                      : "Company brief has not been generated yet."}
                </p>
                {prospect?.demoStatus === "ready" && onPrepareCompanyBrief && <Button
                  onClick={onPrepareCompanyBrief} disabled={briefGenerating}>
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
                    <span>{index < currentStep ? "✓" : index + 1}</span>
                    {step}
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
              <Button tone="blue" disabled={Boolean(busy) || !prospect?.preparationEligible || !safeExternalUrl(prospect?.website) || ["queued", "preparing", "building"].includes(prospect?.demoStatus)} onClick={onPrepareContact}>{["queued", "preparing", "building"].includes(prospect?.demoStatus) ? "Preparing…" : "Prep now"}</Button>
              <p className={styles.caption}>{prospect?.demoFailure || (!prospect?.website ? "A website is needed before this prospect can be prepared." : "Prepare the AI Receptionist before dialing this prospect.")}</p>
              <Button className={styles.pushRight} disabled={Boolean(busy)} onClick={onSkip}>Back to queue</Button>
            </div> : ["READY", "DIALING"].includes(phase) ? (
              <div className={styles.actions}>
                {numbers.slice(0, 2).map((number, index) => (
                  <Button
                    key={number.phoneE164}
                    tone={index ? "greenOutline" : "green"}
                    large={!index}
                    disabled={!canDial}
                    onClick={() => onCall(number.phoneE164)}
                  >
                    Call {number.label?.toLowerCase() || number.type} ·{" "}
                    {formatPhone(number.phoneE164)}
                  </Button>
                ))}
                {phase === "READY" && browsingContact && contactStatus(prospect || {}) === "Removed" && <Button tone="blue" disabled={Boolean(busy) || queue.config?.phoneTestMode} onClick={onRestoreContact}>Put back in list</Button>}
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
                  <Button disabled={busy} onClick={onMute}>
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
            {phase === "WRAPUP" && (
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
                      {customerPaid ? "This customer has already paid for setup." : "Stripe checkout: $100 setup, first month included. Nothing activates until it’s paid. Stripe marks this call Paid."}
                    </p>
                    <div className={styles.actions}>
                      <Button
                        disabled={!cell || busy}
                        aria-pressed={channel === "sms" && Boolean(cell)}
                        onClick={() => setChannel("sms")}
                      >
                        Text
                      </Button>
                      <Button
                        aria-pressed={channel === "email" || !cell}
                        onClick={() => setChannel("email")}
                      >
                        Email
                      </Button>
                    </div>
                    <label>
                      {channel === "sms" && cell ? "Text to" : "Email to"}
                      <input
                        aria-label={
                          channel === "sms" && cell ? "Text to" : "Email to"
                        }
                        type={channel === "sms" && cell ? "text" : "email"}
                        readOnly={channel === "sms" && Boolean(cell)}
                        value={
                          channel === "sms" && cell ? cell.phoneE164 : email
                        }
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    <small>
                      {cell
                        ? "Shop lines usually can’t take texts. Use the cell on record, or switch to Email."
                        : "No cell on file. Text is unavailable; send by Email."}
                    </small>
                    <Button
                      tone="blue"
                      disabled={
                        busy ||
                        customerPaid ||
                        (!(channel === "sms" && cell) && !email.trim())
                      }
                      onClick={() =>
                        onCheckout({
                          channel: channel === "sms" && cell ? "sms" : "email",
                          email,
                        })
                      }
                    >
                      {customerPaid
                        ? "Paid"
                        : call.linkSentAt
                          ? "Send link again"
                          : "Send link"}
                    </Button>
                  </div>
                  <div className={styles.card}>
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
                      <Button disabled={busy} onClick={onMoreSlots}>
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
                      <input
                        type="email"
                        aria-label="Invite to"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    <Button
                      disabled={busy || !slot || !email.trim()}
                      onClick={() => onBook({ ...slot, email })}
                    >
                      {call.bookedAt
                        ? "Book another time"
                        : slot
                          ? `Book ${slot.label || new Date(slot.start).toLocaleString()}`
                          : "Choose a slot"}
                    </Button>
                  </div>
                </div>
                <ScriptPart label="Script · Close" text={script("close")} />
                <p className={styles.caption}>
                  If he’d rather not do the card now: {script("close_decline")}
                </p>
              </>
            )}
          </Section>
          {phase === "READY" || phase === "DIALING" ? (
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
          ) : phase === "TALK" ? (
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
              <Section>
                <Notes note={note} onNote={onNote} />
              </Section>
            </>
          ) : phase === "DEMO" ? (
            <Section>
              <div className={styles.scriptTitle}>
                <h3>While you listen</h3>
                <small>Transcript arrives after the call</small>
              </div>
              {script("while_you_listen") && (
                <p className={styles.caption}>{script("while_you_listen")}</p>
              )}
              <Notes note={note} onNote={onNote} />
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
        </main>
      </div>}
      {view !== "contacts" && <footer className={styles.footer}>
        <div className={styles.footerControls}>
          {OUTCOMES.map(([value, label]) => (
            <Button
              key={value}
              disabled={!call?.id || Boolean(busy)}
              aria-pressed={outcome === value}
              onClick={() => {
                if (["callback_requested", "do_not_call"].includes(value))
                  setPicker(picker === value ? "" : value);
                else {
                  setPicker("");
                  onOutcome(value);
                }
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
          <input
            aria-label="Note for next time"
            disabled={!call?.id}
            maxLength={4000}
            placeholder="Note for next time (optional)"
            value={note}
            onChange={(e) => onNote(e.target.value)}
          />
          <Button
            tone="blue"
            disabled={
              !call?.terminal ||
              (!outcome && !call?.paidAt) ||
              Boolean(busy) ||
              (outcome === "callback_requested" && !callbackAt) ||
              (outcome === "do_not_call" && !dncReason)
            }
            onClick={onSave}
          >
            {busy === "outcome" ? "Saving…" : "Save & next →"}
          </Button>
        </div>
        {picker === "callback_requested" && (
          <div className={styles.picker}>
            <CallbackPicker prospect={prospect} value={callbackAt} onSet={onCallback} disabled={Boolean(busy)} canSchedule={Boolean(call?.id)} now={now} onClose={() => setPicker("")} />
          </div>
        )}
        {picker === "do_not_call" && (
          <div className={styles.picker}>
            <strong>Do not call — reason</strong>
            {[
              ["bad_number", "Bad number"],
              ["asked_not_to_be_called", "Asked not to be called"],
              ["out_of_business", "Out of business"],
            ].map(([reason, label]) => (
              <Button
                key={reason}
                onClick={() => {
                  onDncReason(reason);
                  setPicker("");
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        <small>
          {phase === "READY"
            ? "Outcomes unlock when a call is dialed. Not interested and Do not call are permanent."
            : phase === "WRAPUP"
              ? `Save & next doesn’t wait for the transcript.${queue.upcoming?.[0] ? ` Next up: ${queue.upcoming[0].businessName}` : ""}`
              : "Pick an outcome any time. Save & next activates once the call has ended."}
          {callbackAt && outcome === "callback_requested"
            ? ` Callback: ${new Date(callbackAt).toLocaleString()}`
            : ""}
        </small>
      </footer>}
    </div>
  );
}
