"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSalesJson,
  isDemoReady,
  normalizeCall,
  normalizeProspect,
  normalizeWebrtc,
} from "./salesApi";
import { useSalesQueue } from "./useSalesQueue";
import { connectTelnyxBrowserClient } from "./telnyxBrowserClient";
import { createLocalRingback } from "./localRingback.mjs";
import { initialCompanyContactId, companyContactTarget } from "./dialerState.mjs";
import DialerScreen from "./DialerScreen";
import SalesIntroEmailModal from "./SalesIntroEmailModal";
import { companyBriefRequestFailure, normalizeCompanyBrief } from "../../../lib/salesCompanyBriefDiagnostics.js";

import { canonicalSalesOutcome, callDispositions } from '../../../lib/salesDispositions.js';
import { DEFAULT_SALES_SIGNUP_AMOUNT_CENTS, formatSalesSignupAmount, validSalesSignupAmount } from '../../../lib/salesSignupAmount.js';
import { normalizeSalesCheckoutPhone } from "../../../lib/salesCheckoutRecipient.js";

const BASE = "/api/v1/admin/sales";
export default function CallerWorkspace() {
  const { queue, queueLoading, queueError, loadQueue } = useSalesQueue({
    repMode: true,
  });
  const [contactSelection, setContactSelection] = useState({ companyId: null, contactId: "" });
  const [checkoutContext, setCheckoutContext] = useState(null);
  const [introEmail, setIntroEmail] = useState(null);
  const [introEmailSent, setIntroEmailSent] = useState(false);
  const [prospect, setProspect] = useState(null),
    [view, setView] = useState("dial"),
    [browsingContact, setBrowsingContact] = useState(false),
    [briefGeneratingId, setBriefGeneratingId] = useState(""),
    [call, setCall] = useState(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [softphoneState, setSoftphoneState] = useState("connecting"),
    [muted, setMuted] = useState(false),
    [microphoneState, setMicrophoneState] = useState("not_requested"),
    [pendingWrapups, setPendingWrapups] = useState(0),
    [note, setNote] = useState(""),
    [dispositions, setDispositions] = useState([]),
    [callbackAt, setCallbackAt] = useState(""),
    [dncReason, setDncReason] = useState(""),
    [now, setNow] = useState(Date.now()),
    [availability, setAvailability] = useState({ slots: [] }),
    [incoming, setIncoming] = useState([]),
    [searchResults, setSearchResults] = useState([]);
  const outcome = canonicalSalesOutcome(dispositions);
  const remoteAudioRef = useRef(null),
    softphone = useRef(null),
    microphone = useRef(null),
    generation = useRef(0),
    callRef = useRef(null),
    prospectRef = useRef(null),
    noteRef = useRef(""),
    savedNote = useRef(""),
    createAttempt = useRef(null),
    searchGeneration = useRef(0),
    actionPending = useRef(null),
    endingCallIds = useRef(new Set()),
    wrapupDrafts = useRef([]),
    incomingTaken = useRef("");
  const browsingContactRef = useRef(false);
  const ringback = useRef(null);
  if (!ringback.current) ringback.current = createLocalRingback();
  const selectedContactId = call?.id ? call.contactId || call.contactSnapshot?.contactId || "" : contactSelection.companyId === prospect?.id ? (prospect?.callbackTarget?.requiresSelection && !contactSelection.explicit ? "" : contactSelection.contactId) : initialCompanyContactId(prospect);
  const selectedTarget = companyContactTarget(prospect, selectedContactId);
  const returnHandled = useRef(false);
  useEffect(() => {
    if (returnHandled.current) return;
    returnHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "contacts") setView("contacts");
    const id = params.get("prospectId");
    if (!id) return;
    browsingContactRef.current = true;
    setBrowsingContact(true);
    void fetchSalesJson(`${BASE}/prospects/${encodeURIComponent(id)}`).then(result => {
      if (!callRef.current?.id) setProspect(normalizeProspect(result.prospect));
    }).catch(err => setError(err.message));
  }, []);
  useEffect(() => {
    setContactSelection(previous => previous.companyId === prospect?.id ? previous : { companyId: prospect?.id, contactId: initialCompanyContactId(prospect) });
  }, [prospect?.id]);
  const viewRef = useRef(view);
  viewRef.current = view;
  callRef.current = call;
  prospectRef.current = prospect;
  noteRef.current = note;
  useEffect(() => {
    let active = true;
    setCheckoutContext(null);
    if (prospect?.id) void fetchSalesJson(`${BASE}/prospects/${encodeURIComponent(prospect.id)}/checkout${call?.id ? `?salesCallId=${encodeURIComponent(call.id)}` : ""}`).then(result => { if (active) setCheckoutContext(result.checkout || null); }).catch(() => {});
    return () => { active = false; };
  }, [prospect?.id, call?.id, selectedContactId, queue.config?.phoneTestMode]);
  const releaseMic = useCallback(() => {
    microphone.current?.getTracks?.().forEach((track) => track.stop());
    microphone.current = null;
    setMuted(false);
    setMicrophoneState("released");
  }, []);
  const mute = useCallback((value) => {
    const next = softphone.current?.setMuted(value);
    if (typeof next !== "boolean")
      throw new Error("There is no active browser call to mute.");
    setMuted(next);
  }, []);
  const ensureMicrophone = async () => {
    if (microphone.current?.active) return microphone.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneState("unavailable");
      throw new Error("This browser does not provide microphone access.");
    }
    setMicrophoneState("requesting");
    try {
      microphone.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const stream = microphone.current;
      const tracks = stream.getAudioTracks?.() || stream.getTracks?.() || [];
      if (
        !stream.active ||
        !tracks.some((track) => track.readyState !== "ended")
      )
        throw new Error("Microphone is not live.");
      setMicrophoneState("live");
      for (const track of tracks)
        track.addEventListener?.("ended", () => {
          if (microphone.current === stream) setMicrophoneState("ended");
        });
      return stream;
    } catch {
      setMicrophoneState("denied");
      throw new Error("Microphone permission is required for browser calling.");
    }
  };
  const initializeSoftphone = useCallback(async () => {
    ringback.current.stop();
    const current = ++generation.current;
    setSoftphoneState("connecting");
    setError("");
    const previous = softphone.current;
    softphone.current = null;
    await previous?.disconnect();
    try {
      const config = normalizeWebrtc(
        await fetchSalesJson(`${BASE}/webrtc-token`),
      );
      if (current !== generation.current) return;
      const client = await connectTelnyxBrowserClient({
        token: config.token,
        remoteElement: remoteAudioRef.current,
        onState: (state) => {
          if (current === generation.current) {
            if (state !== "ready") ringback.current.stop();
            setSoftphoneState(state);
          }
        },
        onError: (message) => {
          if (current === generation.current) {
            ringback.current.stop();
            setError(message);
          }
        },
        onCallUpdate: (update) => {
          if (current !== generation.current) return;
          if (["destroy", "hangup", "purge", "ended"].includes(update.state)) {
            ringback.current.stop();
            releaseMic();
            const currentCall = callRef.current;
            if (currentCall?.id && !currentCall.terminal)
              void fetchSalesJson(
                `${BASE}/calls/${encodeURIComponent(currentCall.id)}`,
              )
                .then((payload) => {
                  const next = normalizeCall(payload);
                  if (next.terminal) endingCallIds.current.add(next.id);
                  if (
                    callRef.current?.id === next.id &&
                    (next.terminal || !endingCallIds.current.has(next.id))
                  )
                    setCall(next);
                })
                .catch(() => {});
          }
        },
      });
      if (current !== generation.current) {
        await client.disconnect();
        return;
      }
      softphone.current = client;
      setSoftphoneState("ready");
    } catch (err) {
      if (current === generation.current) {
        setSoftphoneState("error");
        setError(err.message || "Browser calling could not connect.");
      }
    }
  }, [releaseMic]);
  useEffect(() => {
    void initializeSoftphone();
    return () => {
      ringback.current.stop();
      generation.current++;
      void softphone.current?.disconnect();
      releaseMic();
    };
  }, [initializeSoftphone, releaseMic]);
  useEffect(() => {
    const silence = () => ringback.current.stop();
    window.addEventListener("pagehide", silence);
    window.addEventListener("offline", silence);
    return () => {
      window.removeEventListener("pagehide", silence);
      window.removeEventListener("offline", silence);
      silence();
    };
  }, []);
  useEffect(() => {
    ringback.current.update(call);
  }, [call]);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    // Queue polling must never replace the record under a live call or its unsaved wrap-up.
    if (callRef.current?.id || browsingContactRef.current || viewRef.current === "contacts") return;
    const next = queue.current;
    if (next?.id === prospectRef.current?.id) { setProspect(next); return; }
    setProspect(next);
    setNote("");
    savedNote.current = "";
    setDispositions([]);
    setCallbackAt("");
    setDncReason("");
    setAvailability({ slots: [] });
  }, [queue.current]);
  useEffect(() => {
    const live = queue.incoming || [];
    setIncoming((previous) => {
      const taken = previous.find(
        (item) => item.incomingId === incomingTaken.current && !item.prospectId,
      );
      return taken && !live.some((item) => item.incomingId === taken.incomingId)
        ? [taken, ...live]
        : live;
    });
  }, [queue.incoming]);
  useEffect(() => {
    if (!call?.id) return;
    let active = true;
    const refresh = async () => {
      try {
        const payload = await fetchSalesJson(
          `${BASE}/calls/${encodeURIComponent(call.id)}`,
        );
        if (!active) return;
        const next = normalizeCall(payload);
        if (endingCallIds.current.has(next.id) && !next.terminal) return;
        if (next.terminal) endingCallIds.current.add(next.id);
        ringback.current.update(next);
        setCall(next);

        if (next.terminal) await loadQueue({ quiet: true });
      } catch (err) {
        if (active) {
          ringback.current.stop();
          setError(err.message || "Call status could not be refreshed.");
        }
      }
    };
    const interval = setInterval(refresh, call.terminal ? 4000 : 1500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [call?.id, call?.terminal, loadQueue]);
  useEffect(() => {
    if (!call?.terminal) return;
    void softphone.current?.hangup();
    releaseMic();
  }, [call?.terminal, releaseMic]);
  useEffect(() => {
    if (!call?.id || note === savedNote.current) return;
    const timer = setTimeout(() => {
      void fetchSalesJson(`${BASE}/calls/${encodeURIComponent(call.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ liveNotes: note }),
      })
        .then(() => {
          savedNote.current = note;
        })
        .catch((err) => setError(err.message || "Notes have not synced yet."));
    }, 650);
    return () => clearTimeout(timer);
  }, [note, call?.id]);
  const run = async (name, action) => {
    if (actionPending.current && name !== "end_call") return;
    const operation = {};
    actionPending.current = operation;
    setBusy(name);
    setError("");
    try {
      return await action();
    } catch (err) {
      if (actionPending.current === operation)
        setError(err.message || "The action could not be completed.");
      return null;
    } finally {
      if (actionPending.current === operation) {
        actionPending.current = null;
        setBusy("");
      }
    }
  };
  const loadSlots = useCallback(async (after = "") => {
    try {
      const response = await fetchSalesJson(
        `${BASE}/availability${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      );
      setAvailability(response);
    } catch (err) {
      setAvailability({
        slots: [],
        error: err.message || "Calendar is unavailable.",
      });
    }
  }, []);
  useEffect(() => {
    if (call?.terminal) void loadSlots();
  }, [call?.id, call?.terminal, loadSlots]);
  const startCall = (number) =>
    run("call", async () => {
      if (!prospect?.id || call?.id) return;
      if (!selectedTarget.contact || !selectedTarget.numbers.some(item => item.id === number.id)) throw new Error("Choose an active contact and one of their numbers.");
      if (!isDemoReady(prospect) || !prospect.eligible)
        throw new Error(
          prospect.callBlockedReason || "This prospect is not ready to call.",
        );
      if (!softphone.current?.isReady())
        throw new Error("Reconnect browser calling before starting a call.");
      const ringbackAttempt = ringback.current.prepare();
      try {
        await ensureMicrophone();
      } catch (err) {
        ringback.current.stop();
        throw err;
      }
      if (
        !createAttempt.current ||
        createAttempt.current.prospectId !== prospect.id ||
        createAttempt.current.numberId !== number.id ||
        createAttempt.current.contactId !== selectedContactId
      )
        createAttempt.current = {
          prospectId: prospect.id,
          numberId: number.id,
          contactId: selectedContactId,
          key: crypto.randomUUID(),
        };
      let created = null;
      try {
        created = normalizeCall(
          await fetchSalesJson(`${BASE}/calls`, {
            method: "POST",
            idempotencyKey: createAttempt.current.key,
            body: JSON.stringify({
              prospectId: prospect.id,
              phoneE164: number.phoneE164,
              contactId: selectedContactId,
              numberId: number.id,
              expectedRowVersion: prospect.rowVersion,
            }),
          }),
        );
        if (!created.id)
          throw new Error("The server did not return a call ID.");
        ringback.current.bind(ringbackAttempt, created.id);
        setCall(created);
        setDispositions([]);
        setNote("");
        savedNote.current = "";
        setMuted(false);
        if (created.terminal || !created.webrtc?.callOptions?.destinationNumber) {
          ringback.current.stop();
          releaseMic();
          createAttempt.current = null;
          await loadQueue({ quiet: true });
          return;
        }
        softphone.current.placeCall(
          created.webrtc.callOptions,
          microphone.current,
        );
        createAttempt.current = null;
        await loadQueue({ quiet: true });
      } catch (err) {
        ringback.current.stop();
        if (created?.id) {
          try {
            setCall(
              normalizeCall(
                await fetchSalesJson(
                  `${BASE}/calls/${encodeURIComponent(created.id)}/actions`,
                  {
                    method: "POST",
                    body: JSON.stringify({ action: "end_call" }),
                  },
                ),
              ),
            );
          } catch {}
        } else releaseMic();
        throw err;
      }
    });
  const callAction = (action) => {
    const activeCall = callRef.current;
    if (!activeCall?.id) return;
    if (action === "end_call") {
      ringback.current.stop();
      if (endingCallIds.current.has(activeCall.id)) return;
      endingCallIds.current.add(activeCall.id);
      void softphone.current?.hangup();
      releaseMic();
    }
    return run(action, async () => {
      const callId = activeCall.id;
      const wasMuted = muted;
      try {
        if (action === "start_demo") {
          mute(true);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (endingCallIds.current.has(callId)) return;
        }
        const next = normalizeCall(
          await fetchSalesJson(
            `${BASE}/calls/${encodeURIComponent(callId)}/actions`,
            { method: "POST", body: JSON.stringify({ action }) },
          ),
        );
        if (action !== "end_call" && endingCallIds.current.has(callId)) {
          // An already submitted demo action may finish after the first hangup.
          // Reassert hangup, and never display its stale live state.
          if (!next.terminal)
            await fetchSalesJson(
              `${BASE}/calls/${encodeURIComponent(callId)}/actions`,
              { method: "POST", body: JSON.stringify({ action: "end_call" }) },
            );
          return;
        }
        if (callRef.current?.id !== callId) return;
        setCall(next);
        if (action === "end_demo") mute(false);
        if (action === "end_call" || next.terminal) {
          await softphone.current?.hangup();
          releaseMic();
          await loadQueue({ quiet: true });
        }
      } catch (err) {
        if (action === "end_call") endingCallIds.current.delete(callId);
        if (
          action === "start_demo" &&
          !wasMuted &&
          !endingCallIds.current.has(callId)
        ) {
          try {
            mute(false);
          } catch {}
        }
        throw err;
      }
    });
  };
  const save = (selected) =>
    run("outcome", async () => {
      if (!call?.terminal)
        throw new Error("End the call before saving its outcome.");
      const choices = dispositions.length ? dispositions : call.paidAt ? ['signup_link_sent'] : [];
      const choice = canonicalSalesOutcome(choices);
      if (!choice) throw new Error("Select an outcome.");
      await fetchSalesJson(
        `${BASE}/calls/${encodeURIComponent(call.id)}/outcome`,
        {
          method: "POST",
          idempotencyKey: `sales-outcome-${call.id}`,
          body: JSON.stringify({
            outcome: choice,
            dispositions: choices,
            notes: noteRef.current,
            liveNotes: noteRef.current,
            callbackAt:
              choice === "callback_requested" ? callbackAt : undefined,
            dncReason: choice === "do_not_call" ? dncReason : undefined,
          }),
        },
      );
      const next = await loadQueue({ quiet: true });
      const draft = wrapupDrafts.current.pop();
      browsingContactRef.current = false;
      setBrowsingContact(false);
      setPendingWrapups(wrapupDrafts.current.length);
      setCall(draft?.call || null);
      callRef.current = draft?.call || null;
      setProspect(draft?.prospect || next?.current || null);
      setDispositions(draft?.dispositions || callDispositions(draft?.call));
      setNote(draft?.note || "");
      savedNote.current = draft?.savedNote || "";
      setCallbackAt(draft?.callbackAt || "");
      setDncReason(draft?.dncReason || "");
      incomingTaken.current = draft?.incomingId || "";
      setIncoming((current) => current.filter((i) => i.state !== "taken"));
    });
  const chooseOutcome = (value) => {
    if (value === "do_not_call") setDncReason("asked_not_to_be_called");
    setDispositions(current => current.includes(value) ? current.filter(key => key !== value) : [...current, value]);
  };
  const queueAction = (action) =>
    run(action, async () => {
      if (call?.id && !call.terminal) return;
      await fetchSalesJson(
        `${BASE}/prospects/${encodeURIComponent(prospect.id)}/${action}`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: action === "skip" ? "Skip for now" : undefined,
            expectedRowVersion: prospect.rowVersion,
          }),
        },
      );
      setCall(null);
      callRef.current = null;
      browsingContactRef.current = false;
      setBrowsingContact(false);
      const next = await loadQueue({ quiet: true });
      setProspect(next?.current || null);
      setNote("");
      setDispositions([]);
      savedNote.current = "";
      setCallbackAt("");
      setDncReason("");
      setAvailability({ slots: [] });
    });
  const navigate = (destination) => {
    if (callRef.current?.id || actionPending.current) return;
    ringback.current.stop();
    setView(destination);
    if (destination === "dial") {
      browsingContactRef.current = false;
      setBrowsingContact(false);
      setProspect(queue.current || null);
      setNote("");
      savedNote.current = "";
      setDispositions([]);
      setCallbackAt("");
      setDncReason("");
    }
  };
  const selectContact = (selected) => run("contact", async () => {
    if (callRef.current?.id) return;
    const result = await fetchSalesJson(`${BASE}/prospects/${encodeURIComponent(selected.id)}`);
    // A ringing caller can become active while the detail request is in flight.
    if (callRef.current?.id) return;
    const detail = normalizeProspect(result.prospect || selected.raw || selected);
    if (Array.isArray(result.prospect?.calls)) detail.history = result.prospect.calls.map(normalizeCall);
    if (Array.isArray(result.prospect?.notes)) detail.note = result.prospect.notes[0]?.body || "";
    browsingContactRef.current = true;
    setBrowsingContact(true);
    setProspect(detail);
    setView("dial");
    setNote("");
    savedNote.current = "";
    setDispositions([]);
    setCallbackAt("");
    setDncReason("");
    setAvailability({ slots: [] });
  });
  const mutateContact = async (selected, action, body) => {
    try {
      return await fetchSalesJson(`${BASE}/prospects/${encodeURIComponent(selected.id)}/${action}`, {
        method: "POST", body: JSON.stringify({ ...body, expectedRowVersion: selected.rowVersion }),
      });
    } catch (err) {
      if (err.status === 409 && !callRef.current?.id) {
        const latest = await fetchSalesJson(`${BASE}/prospects/${encodeURIComponent(selected.id)}`).catch(() => null);
        if (latest?.prospect && prospectRef.current?.id === selected.id && !callRef.current?.id) {
          const updated = normalizeProspect(latest.prospect);
          if (Array.isArray(latest.prospect.calls)) updated.history = latest.prospect.calls.map(normalizeCall);
          setProspect(updated);
        }
      }
      throw err;
    }
  };
  const updateCallback = async (value) => {
    if (callRef.current?.id) {
      setCallbackAt(value || "");
      setDispositions(current => value ? [...new Set([...current, "callback_requested"])] : current.filter(key => key !== "callback_requested"));
      return true;
    }
    const result = await run("callback", async () => {
      const selected = prospectRef.current;
      if (!selected?.id || callRef.current?.id) return false;
      const response = await mutateContact(selected, "callback", { callbackAt: value, contactId: selectedContactId, numberId: selectedTarget.numbers.find(item => item.id === selected.callbackTarget?.numberId)?.id || selectedTarget.numbers[0]?.id });
      if (prospectRef.current?.id === selected.id && !callRef.current?.id) {
        browsingContactRef.current = true;
        setBrowsingContact(true);
        setProspect({ ...selected, ...normalizeProspect(response.prospect), history: selected.history, savedNotes: selected.savedNotes, savedCallNotes: selected.savedCallNotes, note: selected.note });
      }
      await loadQueue({ quiet: true });
      return true;
    });
    return result === true;
  };
  const restoreContact = () => run("restore-contact", async () => {
    const selected = prospectRef.current;
    if (!selected?.id || callRef.current?.id) return;
    const response = await mutateContact(selected, "restore", {});
    if (prospectRef.current?.id === selected.id && !callRef.current?.id) setProspect({ ...selected, ...normalizeProspect(response.prospect), history: selected.history, savedNotes: selected.savedNotes, savedCallNotes: selected.savedCallNotes, note: selected.note });
    await loadQueue({ quiet: true });
  });
  const addContact = async (details) => {
    const response = await run("add-contact", async () => {
      if (callRef.current?.id) throw new Error("Finish the call before adding a contact here.");
      const result = await fetchSalesJson(`${BASE}/prospects`, { method: "POST", body: JSON.stringify({ ...details, contactsView: true }) });
      await loadQueue({ quiet: true });
      return result;
    });
    if (!response) throw new Error("Could not add this prospect. Check the details and try again.");
    return response;
  };
  const prepareContact = () => run("prepare-contact", async () => {
    const selected = prospectRef.current;
    if (!selected?.id || callRef.current?.id) return;
    await fetchSalesJson(`${BASE}/prospects/${encodeURIComponent(selected.id)}/demo`, {
      method: "POST", body: JSON.stringify({ force: Boolean(selected.demoFailure) }),
    });
    setProspect((current) => current?.id === selected.id ? { ...current, demoStatus: "queued" } : current);
    await loadQueue({ quiet: true });
  });
  useEffect(() => {
    if (!browsingContact || !prospect?.id || !["queued", "preparing", "building"].includes(prospect.demoStatus)) return;
    let current = true;
    const id = prospect.id;
    const interval = window.setInterval(async () => {
      try {
        const result = await fetchSalesJson(`${BASE}/prospects/${encodeURIComponent(id)}`);
        if (!current || callRef.current?.id || !browsingContactRef.current) return;
        const updated = normalizeProspect(result.prospect);
        if (Array.isArray(result.prospect?.calls)) updated.history = result.prospect.calls.map(normalizeCall);
        if (Array.isArray(result.prospect?.notes)) updated.note = result.prospect.notes[0]?.body || "";
        setProspect((selected) => selected?.id === id ? updated : selected);
      } catch { /* A refresh failure leaves the existing detail available. */ }
    }, 5000);
    return () => { current = false; window.clearInterval(interval); };
  }, [browsingContact, prospect?.id, prospect?.demoStatus]);
  const checkout = (details) =>
    run("checkout", async () => {
      const selected = prospectRef.current;
      const currentCall = callRef.current;
      if (!selected?.id) throw new Error("Choose a prospect before sending a signup link.");
      const withoutCall = !currentCall?.id;
      const testCheckout = withoutCall ? Boolean(queue.config?.phoneTestMode) : Boolean(currentCall.phoneTestMode);
      const deliveryContactId = checkoutContext?.contactSnapshot?.contactId || currentCall?.contactId || selectedContactId;
      const phone = details.channel === "sms" ? normalizeSalesCheckoutPhone(checkoutContext?.recipient || (testCheckout ? queue.config?.checkoutTestPhone || "+14256154640" : details.phone)) : undefined;
      if (details.channel === "sms" && !phone) throw new Error("Enter a valid mobile number first.");
      const deliveryNumberId = checkoutContext ? checkoutContext.contactSnapshot?.numberId || undefined : selectedTarget.numbers.find(number => number.phoneE164 === phone)?.id;
      const amountCents = checkoutContext?.amountCents ?? details.amountCents ?? DEFAULT_SALES_SIGNUP_AMOUNT_CENTS;
      if (!validSalesSignupAmount(amountCents)) throw new Error("Enter a signup charge from $1.00 to $999,999.99.");
      let confirmedRecipient;
      if (withoutCall) {
        const recipient = checkoutContext?.recipient || (details.channel === "sms"
          ? phone
          : details.email?.trim());
        confirmedRecipient = recipient;
        if (!recipient) throw new Error("Choose a signup link recipient.");

      }
      const recipient = checkoutContext?.recipient || (details.channel === "sms" ? phone : details.email?.trim());
      if (!window.confirm(`Send the ${testCheckout ? "TEST signup link (no real charge)" : "signup link"} for ${formatSalesSignupAmount(amountCents)} USD by ${details.channel === "sms" ? "text" : "email"} to ${recipient}${withoutCall ? " without an associated call" : ""}?`)) return;
      const context = withoutCall
        ? `prospects/${encodeURIComponent(selected.id)}`
        : `calls/${encodeURIComponent(currentCall.id)}`;
      let result;
      try {
        result = await fetchSalesJson(`${BASE}/${context}/checkout`, {
          method: "POST",
          idempotencyKey: `sales-checkout-${withoutCall ? `prospect-${selected.id}` : currentCall.id}-${details.channel}-${testCheckout ? "test" : "live"}`,
          body: JSON.stringify({ ...details, amountCents, ...(phone ? { phone } : {}), contactId: deliveryContactId, numberId: deliveryNumberId, expectedRowVersion: selected.rowVersion, expectedIsTest: testCheckout, ...(withoutCall ? { confirmedWithoutCall: true, confirmedRecipient } : {}) }),
        });
      } catch (error) {
        // A failed provider operation may already have reserved the recipient.
        // Reload that identity before offering a retry or another destination.
        const existing = await fetchSalesJson(`${BASE}/prospects/${encodeURIComponent(selected.id)}/checkout${currentCall?.id ? `?salesCallId=${encodeURIComponent(currentCall.id)}` : ""}`).catch(() => null);
        if (existing && prospectRef.current?.id === selected.id && callRef.current?.id === currentCall?.id) setCheckoutContext(existing.checkout || null);
        throw error;
      }
      if (prospectRef.current?.id === selected.id && callRef.current?.id === currentCall?.id) setCheckoutContext(result.checkout || null);
      if (!result.checkout || !["sent", "delivered", "paid", "test_complete"].includes(result.checkout.status))
        throw new Error("Checkout delivery was not confirmed.");
      if (!withoutCall && callRef.current?.id === currentCall.id) {
        if (!result.call) throw new Error("Checkout call was not returned.");
        setCall(normalizeCall(result));
        if (!result.checkout.isTest) setDispositions(current => current.length ? current : ["signup_link_sent"]);
      }
      if (withoutCall && prospectRef.current?.id === selected.id)
        setProspect((current) => current?.id === selected.id ? { ...current, signupLinkSent: true } : current);
      await loadQueue({ quiet: true });
    });
  const book = (details) =>
    run("booking", async () => {
      const result = await fetchSalesJson(
        `${BASE}/calls/${encodeURIComponent(call.id)}/booking`,
        {
          method: "POST",
          idempotencyKey: `sales-booking-${call.id}-${details.start}`,
          body: JSON.stringify({ ...details, contactId: call.contactId || selectedContactId, expectedRowVersion: prospect.rowVersion }),
        },
      );
      if (!result.booking)
        throw new Error("The calendar did not confirm a booking.");
      if (result.call) setCall(normalizeCall(result));
      await loadSlots();
    });
  const incomingAction = (item, action, details = {}) =>
    run("incoming", async () => {
      if (
        ["match", "create"].includes(action) &&
        (!incomingTaken.current || item.incomingId !== incomingTaken.current)
      )
        throw new Error("Take this incoming call before finding or adding its prospect.");
      if (action === "take") {
        if (call?.id && !call.terminal)
          throw new Error("Finish the current call first.");
        if (!softphone.current?.isReady())
          throw new Error("Reconnect browser calling before taking a call.");
        await ensureMicrophone();
      }
      const result = await fetchSalesJson(`${BASE}/incoming`, {
        method: "POST",
        body: JSON.stringify({
          ...details,
          ...(action === "create" && prospectRef.current?.id ? { expectedRowVersion: prospectRef.current.rowVersion } : {}),
          incomingId: item.incomingId,
          action,
          interruptedProspectId: prospect?.id,
        }),
      });
      if (action === "take" && !result.call)
        throw new Error(
          "The incoming call was not confirmed. Your wrap-up is unchanged.",
        );
      if (action === "take" && callRef.current?.terminal) {
        wrapupDrafts.current.push({
          prospect: prospectRef.current,
          call: callRef.current,
          note: noteRef.current,
          dispositions,
          callbackAt,
          dncReason,
          savedNote: savedNote.current,
          incomingId: incomingTaken.current,
        });
        setPendingWrapups(wrapupDrafts.current.length);
      }
      if (Object.prototype.hasOwnProperty.call(result, "prospect")) {
        setProspect(
          result.prospect
            ? normalizeProspect(result.prospect)
            : normalizeProspect({
                businessName: "Unknown caller",
                phone: item.phoneE164,
                numbers: [
                  { phoneE164: item.phoneE164, label: "Caller", type: "other" },
                ],
                eligible: false,
                coreFacts: [],
              }),
        );
      }
      if (result.call) {
        const next = normalizeCall(result);
        setCall(next);
        if (action === "take") {
          setNote(next.liveNotes || "");
          setDispositions([]);
          setCallbackAt("");
          setDncReason("");
          savedNote.current = next.liveNotes || "";
          incomingTaken.current = item.incomingId;
          if (softphone.current.hasIncomingCall?.())
            await softphone.current.answerIncoming(microphone.current);
          else if (next.webrtc?.callOptions?.destinationNumber)
            softphone.current.placeCall(
              next.webrtc.callOptions,
              microphone.current,
            );
          else
            throw new Error(
              "The incoming browser audio leg is not available yet.",
            );
        }
      }
      if (action === "take" && !item.prospectId)
        setIncoming((current) =>
          current.map((i) =>
            i.incomingId === item.incomingId ? { ...i, state: "taken" } : i,
          ),
        );
      else
        setIncoming((current) =>
          current.filter((i) => i.incomingId !== item.incomingId),
        );
      if (["create", "match"].includes(action)) incomingTaken.current = "";
      if (action === "take") {
        setView("dial");
        browsingContactRef.current = false;
        setBrowsingContact(false);
      }
      await loadQueue({ quiet: true });
      return true;
    });
  const prepareReturn = (item, details) =>
    run("prepare-return", async () => {
      await fetchSalesJson(`${BASE}/incoming`, {
        method: "POST",
        body: JSON.stringify({ ...details, incomingId: item.incomingId, action: "create", businessName: details.business_name, contactName: details.contact_name, websiteUrl: details.website, expectedRowVersion: item.rowVersion }),
      });
      await loadQueue({ quiet: true });
      return true;
    });
  const prepareCompanyBrief = async () => {
    const id = prospectRef.current?.id;
    if (!id || briefGeneratingId) return;
    setBriefGeneratingId(id);
    try {
      const result = await fetchSalesJson(`${BASE}/prospects/${encodeURIComponent(id)}/company-brief`, {
        method: "POST", body: "{}",
      });
      setProspect((current) => current?.id === id
        ? { ...current, companyBrief: normalizeCompanyBrief(result.companyBrief) } : current);
    } catch (error) {
      setProspect((current) => current?.id === id
        ? { ...current, companyBrief: companyBriefRequestFailure(error) } : current);
    } finally { setBriefGeneratingId(""); }
  };
  const search = async (query) => {
    const current = ++searchGeneration.current;
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const result = await fetchSalesJson(
        `${BASE}/prospects?contactsView=true&limit=5&search=${encodeURIComponent(query)}`,
      );
      if (current === searchGeneration.current)
        setSearchResults(
          (result.prospects || []).map(normalizeProspect).slice(0, 5),
        );
    } catch {
      if (current === searchGeneration.current) setSearchResults([]);
    }
  };
  const signOut = async () => {
    ringback.current.stop();
    await Promise.allSettled([
      fetch("/api/v1/sales/auth/logout", { method: "POST" }),
      fetch("/api/v1/auth/logout", { method: "POST" }),
    ]);
    window.location.assign("/sales/login");
  };
  return (
    <>
      {queue.config?.phoneTestMode ? <div role="status" className="mx-4 mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><strong>Phone test mode is on.</strong> Calls use the owner’s desk or cell. Original numbers are saved. Outcomes stay on test calls; checkout, bookings, follow-ups, and incoming Sales calls are unavailable.</div> : null}
      <audio
        id="sales-console-remote-audio"
        ref={remoteAudioRef}
        autoPlay
        playsInline
        hidden
        aria-label="Remote call audio"
      />
      {introEmailSent && <div role="status" className="mx-4 mt-3">Introduction email sent.</div>}
      {introEmail && <SalesIntroEmailModal {...introEmail} currentIdentity={`${prospect?.id}:${selectedContactId}:${call?.id || ""}`} onClose={(sent) => { setIntroEmail(null); if (sent === true) setIntroEmailSent(true); }} />}
      <DialerScreen
        key={`${prospect?.id || "empty"}:${incomingTaken.current || ""}`}
        queue={queue}
        view={view}
        browsingContact={browsingContact}
        onNavigate={navigate}
        onSelectContact={selectContact}
        onPrepareContact={prepareContact}
        onRestoreContact={restoreContact}
        onAddContact={addContact}
        prospect={prospect}
        checkoutContext={checkoutContext}
        selectedContactId={selectedContactId}
        onCompanyContact={(contactId) => { if (!callRef.current?.id && !actionPending.current) setContactSelection({ companyId: prospect.id, contactId, explicit: true }); }}
        call={call}
        busy={busy}
        error={[error, call?.providerError, queueError]
          .filter(Boolean)
          .join(" · ")}
        microphoneState={microphoneState}
        pendingWrapups={pendingWrapups}
        softphoneState={softphoneState}
        muted={muted}
        note={note}
        outcome={outcome}
        dispositions={dispositions}
        callbackAt={callbackAt}
        dncReason={dncReason}
        now={now}
        onNote={setNote}
        onOutcome={chooseOutcome}
        onCallback={updateCallback}
        onDncReason={(value) => {
          setDncReason(value);
          setDispositions(current => [...new Set([...current, "do_not_call"])]);
        }}
        onCall={startCall}
        onAction={callAction}
        onMute={() => {
          try {
            mute(!muted);
          } catch (err) {
            setError(err.message);
          }
        }}
        onReconnect={initializeSoftphone}
        onSkip={() => browsingContact ? navigate("dial") : queueAction("skip")}
        onRemove={() => queueAction("remove")}
        onSave={() => save()}
        onCheckout={checkout}
        onIntroEmail={() => { setIntroEmailSent(false); setIntroEmail({ prospectId: prospect.id, contactId: selectedContactId, salesCallId: call?.id }); }}
        onBook={book}
        availability={availability}
        onMoreSlots={() => loadSlots(availability.nextAfter || "")}
        incoming={incoming}
        onIncoming={incomingAction}
        onPrepareReturn={prepareReturn}
        onPrepareCompanyBrief={prepareCompanyBrief}
        briefGenerating={briefGeneratingId === prospect?.id}
        searchResults={searchResults}
        onSearch={search}
        onSignOut={signOut}
      />
    </>
  );
}
