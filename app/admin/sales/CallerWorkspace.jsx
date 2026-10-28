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
import { mayQuickAdvance } from "./dialerState.mjs";
import DialerScreen from "./DialerScreen";

const BASE = "/api/v1/admin/sales";
export default function CallerWorkspace() {
  const { queue, queueLoading, queueError, loadQueue } = useSalesQueue({
    repMode: true,
  });
  const [prospect, setProspect] = useState(null),
    [briefGeneratingId, setBriefGeneratingId] = useState(""),
    [call, setCall] = useState(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [softphoneState, setSoftphoneState] = useState("connecting"),
    [muted, setMuted] = useState(false),
    [microphoneState, setMicrophoneState] = useState("not_requested"),
    [pendingWrapups, setPendingWrapups] = useState(0),
    [note, setNote] = useState(""),
    [outcome, setOutcome] = useState(""),
    [callbackAt, setCallbackAt] = useState(""),
    [dncReason, setDncReason] = useState(""),
    [now, setNow] = useState(Date.now()),
    [availability, setAvailability] = useState({ slots: [] }),
    [incoming, setIncoming] = useState([]),
    [searchResults, setSearchResults] = useState([]);
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
  callRef.current = call;
  prospectRef.current = prospect;
  noteRef.current = note;
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
          if (current === generation.current) setSoftphoneState(state);
        },
        onError: (message) => {
          if (current === generation.current) setError(message);
        },
        onCallUpdate: (update) => {
          if (current !== generation.current) return;
          if (["destroy", "hangup", "purge", "ended"].includes(update.state)) {
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
      generation.current++;
      void softphone.current?.disconnect();
      releaseMic();
    };
  }, [initializeSoftphone, releaseMic]);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    // Queue polling must never replace the record under a live call or its unsaved wrap-up.
    if (callRef.current?.id) return;
    const next = queue.current;
    if (next?.id === prospectRef.current?.id) return;
    setProspect(next);
    setNote("");
    savedNote.current = "";
    setOutcome("");
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
        setCall(next);
        if (next.paidAt) setOutcome("paid");
        if (next.terminal) await loadQueue({ quiet: true });
      } catch (err) {
        if (active)
          setError(err.message || "Call status could not be refreshed.");
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
      if (!isDemoReady(prospect) || !prospect.eligible)
        throw new Error(
          prospect.callBlockedReason || "This prospect is not ready to call.",
        );
      if (!softphone.current?.isReady())
        throw new Error("Reconnect browser calling before starting a call.");
      await ensureMicrophone();
      if (
        !createAttempt.current ||
        createAttempt.current.prospectId !== prospect.id ||
        createAttempt.current.number !== number
      )
        createAttempt.current = {
          prospectId: prospect.id,
          number,
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
              phoneE164: number,
            }),
          }),
        );
        if (!created.id)
          throw new Error("The server did not return a call ID.");
        setCall(created);
        setOutcome("");
        setNote("");
        savedNote.current = "";
        setMuted(false);
        softphone.current.placeCall(
          created.webrtc?.callOptions || {},
          microphone.current,
        );
        createAttempt.current = null;
        await loadQueue({ quiet: true });
      } catch (err) {
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
      const choice =
        (selected || outcome) === "paid"
          ? "signup_link_sent"
          : selected || outcome;
      if (!choice) throw new Error("Select an outcome.");
      await fetchSalesJson(
        `${BASE}/calls/${encodeURIComponent(call.id)}/outcome`,
        {
          method: "POST",
          idempotencyKey: `sales-outcome-${call.id}`,
          body: JSON.stringify({
            outcome: choice,
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
      setPendingWrapups(wrapupDrafts.current.length);
      setCall(draft?.call || null);
      callRef.current = draft?.call || null;
      setProspect(draft?.prospect || next?.current || null);
      setOutcome(draft?.outcome || "");
      setNote(draft?.note || "");
      savedNote.current = draft?.savedNote || "";
      setCallbackAt(draft?.callbackAt || "");
      setDncReason(draft?.dncReason || "");
      incomingTaken.current = draft?.incomingId || "";
      setIncoming((current) => current.filter((i) => i.state !== "taken"));
    });
  const chooseOutcome = (value) => {
    setOutcome(value);
    if (mayQuickAdvance({ call, outcome: value, note: noteRef.current }))
      void save(value);
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
          }),
        },
      );
      setCall(null);
      callRef.current = null;
      const next = await loadQueue({ quiet: true });
      setProspect(next?.current || null);
      setNote("");
      setOutcome("");
    });
  const checkout = (details) =>
    run("checkout", async () => {
      const result = await fetchSalesJson(
        `${BASE}/calls/${encodeURIComponent(call.id)}/checkout`,
        {
          method: "POST",
          idempotencyKey: `sales-checkout-${call.id}-${details.channel}`,
          body: JSON.stringify(details),
        },
      );
      if (!result.call) throw new Error("Checkout delivery was not confirmed.");
      setCall(normalizeCall(result));
      setOutcome("signup_link_sent");
      await loadQueue({ quiet: true });
    });
  const book = (details) =>
    run("booking", async () => {
      const result = await fetchSalesJson(
        `${BASE}/calls/${encodeURIComponent(call.id)}/booking`,
        {
          method: "POST",
          idempotencyKey: `sales-booking-${call.id}-${details.start}`,
          body: JSON.stringify(details),
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
          outcome,
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
          setOutcome("");
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
      await loadQueue({ quiet: true });
    });
  const prepareReturn = (item, websiteUrl) =>
    run("prepare-return", async () => {
      await fetchSalesJson(`${BASE}/incoming`, {
        method: "POST",
        body: JSON.stringify({ incomingId: item.incomingId, action: "create", websiteUrl }),
      });
      await loadQueue({ quiet: true });
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
        ? { ...current, companyBrief: result.companyBrief } : current);
    } catch {
      setProspect((current) => current?.id === id
        ? { ...current, companyBrief: { status: "unavailable", reason: "request_failed" } } : current);
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
        `${BASE}/prospects?search=${encodeURIComponent(query)}`,
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
    await Promise.allSettled([
      fetch("/api/v1/sales/auth/logout", { method: "POST" }),
      fetch("/api/v1/auth/logout", { method: "POST" }),
    ]);
    window.location.assign("/sales/login");
  };
  return (
    <>
      <audio
        id="sales-console-remote-audio"
        ref={remoteAudioRef}
        autoPlay
        playsInline
        hidden
        aria-label="Remote call audio"
      />
      <DialerScreen
        key={`${prospect?.id || "empty"}:${incomingTaken.current || ""}`}
        queue={queue}
        prospect={prospect}
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
        callbackAt={callbackAt}
        dncReason={dncReason}
        now={now}
        onNote={setNote}
        onOutcome={chooseOutcome}
        onCallback={(value) => {
          setCallbackAt(value);
          setOutcome("callback_requested");
        }}
        onDncReason={(value) => {
          setDncReason(value);
          setOutcome("do_not_call");
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
        onSkip={() => queueAction("skip")}
        onRemove={() => queueAction("remove")}
        onSave={() => save()}
        onCheckout={checkout}
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
