'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  displayStatus,
  fetchSalesJson,
  isDemoReady,
  normalizeCall,
  normalizeInvitation,
  normalizeWebrtc
} from './salesApi';
import { useSalesQueue } from './useSalesQueue';
import { connectTelnyxBrowserClient } from './telnyxBrowserClient';
import { Card, StatusPill, ActionButton, Field, TextInput, ErrorNotice, Detail } from './SalesUi';

const RECEPTIONIST_MUTE_SETTLE_MS = 1000;

const OUTCOMES = [
  ['no_answer', 'No answer'],
  ['voicemail', 'Voicemail'],
  ['wrong_number', 'Wrong number'],
  ['callback_requested', 'Callback requested'],
  ['not_interested', 'Not interested'],
  ['do_not_call', 'Do not call'],
  ['connected_no_demo', 'Connected, no demo'],
  ['demo_completed', 'Demo completed'],
  ['signup_link_sent', 'Signup link sent'],
  ['signup_completed', 'Signup completed']
];

const SIGNUP_STEPS = [
  { key: 'sent', label: 'Link sent' },
  { key: 'opened', label: 'Opened' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'provisioning', label: 'Number provisioning' },
  { key: 'ready', label: 'Account ready' }
];

function demoStatusTone(status) {
  if (['ready', 'demo_ready', 'ready_to_call'].includes(status)) return 'good';
  if (['failed', 'build_failed', 'error'].includes(status)) return 'bad';
  return 'warn';
}

function demoStatusLabel(status) {
  return status === 'stale' ? 'Demo needs rebuilding' : status;
}

function permissionLabel(prospect) {
  if (prospect?.permission === true) return 'Permission: Yes';
  if (prospect?.permission === false) return 'Permission: No';
  return 'Permission: Unknown';
}

function callDisableReason({ prospect, call, busy, softphoneState }) {
  if (busy) return 'Another action is still in progress.';
  if (!prospect) return 'There is no current prospect.';
  if (!prospect.eligible) {
    return prospect.callBlockedReason
      || prospect.suppressionReason
      || 'This prospect is not eligible to call.';
  }
  if (!isDemoReady(prospect)) return 'The company demo must be ready before calling.';
  if (softphoneState !== 'ready') return 'The Telnyx browser softphone must be ready before calling.';
  if (call?.id && !call.terminal) return 'A call is already active.';
  return '';
}

function startDemoDisableReason({ call, busy }) {
  if (busy) return 'Another action is still in progress.';
  if (!call?.id || call.terminal) return 'Start a call first.';
  if (!call.prospectConnected) return 'The prospect must be connected.';
  if (!call.aiReady) return 'The AI standby leg is not ready.';
  if (call.aiLive) return 'The AI demo is already in the conference.';
  return '';
}

function invitationProgress(invitation) {
  if (!invitation?.id) return -1;
  const status = invitation.status;
  const delivery = invitation.deliveryStatus;
  if (['account_ready', 'ready', 'completed', 'signup_completed'].includes(status)
    || ['account_ready', 'ready'].includes(invitation.accountStatus)) return 4;
  if (['provisioning', 'number_provisioning'].includes(status)
    || ['provisioning', 'running', 'pending', 'failed'].includes(invitation.provisioningStatus)
    || invitation.attentionRequired) return 3;
  if (['submitted', 'intake_submitted'].includes(status) || invitation.submittedAt) return 2;
  if (['opened', 'viewed'].includes(status) || invitation.openedAt) return 1;
  if (['sent', 'delivered'].includes(status) || ['sent', 'delivered'].includes(delivery) || invitation.sentAt) return 0;
  return -1;
}

function ProspectPanel({ prospect }) {
  if (!prospect) {
    return (
      <Card>
        <h2 className="m-0 text-base font-semibold text-slate-950">Prospect details</h2>
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
          Refresh prospects, or ask an administrator to add prospects you can call.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 break-words text-base font-semibold text-slate-950">Prospect details</h2>
          <p className="mt-1 text-sm text-slate-500">{prospect.localTime || prospect.timezone || 'Local time unavailable'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill status={demoStatusLabel(prospect.demoStatus)} tone={demoStatusTone(prospect.demoStatus)} />
          <StatusPill
            status={permissionLabel(prospect)}
            tone={prospect.permission === true ? 'good' : 'bad'}
          />
          {prospect.suppressed ? <StatusPill status="Suppressed" tone="bad" /> : null}
        </div>
      </div>



      {prospect.callBlockedReason ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-semibold">Calling blocked: </span>{prospect.callBlockedReason}
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="m-0 text-sm font-semibold text-slate-900">Talking points</h3>
        {prospect.talkingPoints.length ? (
          <ul className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            {prospect.talkingPoints.map((point, index) => (
              <li key={`${point}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                {point}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No talking points are available yet.</p>
        )}
      </div>
      <details className="mt-4 text-sm text-slate-600">
        <summary className="cursor-pointer font-semibold">Contact & call history</summary>
      <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
        <Detail label="Phone" value={prospect.phone} />
        <Detail label="Local time" value={prospect.localTime || prospect.timezone} />
        <Detail label="Business type" value={prospect.businessCategory} />
        <Detail
          label="Last call outcome"
          value={prospect.outcome
            ? `${displayStatus(prospect.outcome)}${prospect.lastOutcomeAt
              ? ` · ${new Date(prospect.lastOutcomeAt).toLocaleString()}`
              : ''}`
            : 'No prior call outcome'}
        />
        <Detail label="Contact email" value={prospect.email} />
        <Detail label="Lead-delivery email" value={prospect.leadDeliveryEmail} />
        <Detail label="Website">
          {prospect.website ? (
            <a
              href={prospect.website}
              target="_blank"
              rel="noreferrer"
              className="break-all text-[#004ac6] underline decoration-[#004ac6]/30 underline-offset-2"
            >
              {prospect.website}
            </a>
          ) : '—'}
        </Detail>
      </div>
      </details>
    </Card>
  );
}

function CallPanel({
  prospect,
  call,
  busyAction,
  microphoneState,
  operatorMuted,
  softphoneState,
  softphoneError,
  browserCallState,
  remoteAudioRef,
  onCall,
  onAction,
  onToggleMute,
  onReconnect
}) {
  const callBlocked = callDisableReason({
    prospect,
    call,
    busy: Boolean(busyAction),
    softphoneState
  });
  const callBlockedMessage = callBlocked === 'The Telnyx browser softphone must be ready before calling.'
    ? 'Reconnect browser calling before starting a call.'
    : callBlocked;
  const demoBlocked = startDemoDisableReason({ call, busy: Boolean(busyAction) });
  const providerError = call?.providerError;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-slate-950">Call & demo</h2>
          <p className="mt-1 text-sm text-slate-500">You stay connected while the receptionist demonstrates the call.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill status={call?.state || 'Not started'} tone={call?.prospectConnected ? 'blue' : undefined} />
          <StatusPill status={`Receptionist: ${displayStatus(call?.aiState || 'Not started')}`} tone={call?.aiReady ? 'good' : 'warn'} />
        </div>
      </div>

      <audio
        id="sales-console-remote-audio"
        ref={remoteAudioRef}
        autoPlay
        playsInline
        className="hidden"
        aria-label="Remote call audio"
      />



      <ErrorNotice title="Calling unavailable" message={softphoneError ? (/credential|not_configured|configuration|api_key|caller_id|operator_inactive/i.test(softphoneError) ? 'Calling is not set up for your account. Ask an administrator to finish phone setup.' : 'Browser calling needs attention. Reconnect, check microphone access, or open Calling status below.') : ''} />
      <ErrorNotice title="Call error" message={providerError} />

      {softphoneState === 'error' || softphoneState === 'disconnected' ? (
        <div className="mt-3">
          <ActionButton tone="secondary" onClick={onReconnect} disabled={Boolean(busyAction)}>
            Reconnect browser calling
          </ActionButton>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton
          onClick={onCall}
          disabled={Boolean(callBlocked)}
          title={callBlockedMessage}
        >
          {busyAction === 'call' ? 'Calling…' : 'Call'}
        </ActionButton>
        <ActionButton
          onClick={onToggleMute}
          disabled={Boolean(busyAction) || !call?.id || call?.terminal}
          title={!call?.id || call?.terminal ? 'There is no active call to mute.' : ''}
          tone={operatorMuted ? 'amber' : 'secondary'}
          ariaPressed={operatorMuted}
        >
          {operatorMuted ? 'Unmute' : 'Mute'}
        </ActionButton>
        <ActionButton
          onClick={() => onAction('start_demo')}
          disabled={Boolean(demoBlocked)}
          title={demoBlocked}
          tone="amber"
        >
          {busyAction === 'start_demo' ? 'Starting receptionist…' : 'Start Receptionist'}
        </ActionButton>
        <ActionButton
          onClick={() => onAction('end_demo')}
          disabled={Boolean(busyAction) || !call?.aiLive || call?.terminal}
          title={!call?.aiLive ? 'The AI has not joined this call.' : ''}
          tone="secondary"
        >
          {busyAction === 'end_demo' ? 'Ending receptionist…' : 'End Receptionist'}
        </ActionButton>
        <ActionButton
          onClick={() => onAction('end_call')}
          disabled={Boolean(busyAction) || !call?.id || call?.terminal}
          title={!call?.id || call?.terminal ? 'There is no active call to end.' : ''}
          tone="danger"
        >
          {busyAction === 'end_call' ? 'Ending call…' : 'End Call'}
        </ActionButton>
      </div>

      {callBlocked && prospect ? (
        <p className="mt-3 text-xs text-slate-500">Call unavailable: {callBlockedMessage}</p>
      ) : null}
      {demoBlocked && call?.id && !call?.aiLive ? (
        <p className="mt-1 text-xs text-slate-500">Start Receptionist unavailable: {demoBlocked}</p>
      ) : null}

      <details className="mt-4 text-sm text-slate-600">
        <summary className="cursor-pointer font-semibold">Calling status</summary>
        {callBlocked !== callBlockedMessage ? <p className="mt-2 text-xs">{callBlocked}</p> : null}
        {softphoneError ? <p className="mt-2 break-words text-xs text-red-700">{softphoneError}</p> : null}
      <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
        <Detail label="Browser calling" value={displayStatus(softphoneState)} />
        <Detail label="Microphone" value={displayStatus(microphoneState)} />
        <Detail label="Browser call" value={displayStatus(browserCallState)} />
        <Detail label="Prospect" value={call?.prospectConnected ? 'Connected' : displayStatus(call?.state || 'Not started')} />
        <Detail label="Receptionist" value={call?.aiReady ? 'Ready' : displayStatus(call?.aiState || 'Not started')} />
      </div>
      </details>

      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <span className="font-semibold">Your microphone mutes automatically.</span> Starting the receptionist mutes your microphone; ending the demo restores it. Use Mute or Unmute to override.
      </div>
    </Card>
  );
}

function ConversionPanel({
  prospect,
  call,
  invitation,
  busyAction,
  setupOpen,
  setSetupOpen,
  contactFields,
  setContactFields,
  outcome,
  setOutcome,
  note,
  setNote,
  onSendInvitation,
  onSaveOutcome
}) {
  const progress = invitationProgress(invitation);
  const signupStatus = invitation?.attentionRequired
    ? 'attention_required'
    : invitation?.accountStatus === 'account_ready'
      ? 'account_ready'
      : invitation?.provisioningStatus || invitation?.status;
  const canStartSetup = Boolean(prospect?.id && call?.id && call.prospectConnected && !call.terminal);
  const canSend = canStartSetup
    && Boolean(contactFields.email.trim())
    && Boolean(contactFields.leadDeliveryEmail.trim());
  const outcomeBlocked = Boolean(outcome) && (!call?.id || !call.terminal);

  return (
    <Card className="h-fit">
      <h2 className="m-0 text-base font-semibold text-slate-950">Wrap up</h2>
      <p className="mt-1 text-sm text-slate-500">End the call, save the outcome, and move to the next prospect.</p>

      <div className="mt-4">
        <ActionButton
          className="w-full"
          tone="secondary"
          onClick={() => setSetupOpen((current) => !current)}
          disabled={!canStartSetup && !setupOpen}
          title={!canStartSetup ? 'Connect the prospect before starting assisted setup.' : ''}
        >
          {setupOpen ? 'Hide signup' : 'Help prospect sign up'}
        </ActionButton>
      </div>

      {setupOpen ? (
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
          <Field label="Confirmed contact name">
            <TextInput
              value={contactFields.contactName}
              onChange={(event) => setContactFields((current) => ({ ...current, contactName: event.target.value }))}
              autoComplete="name"
            />
          </Field>
          <Field label="Confirmed login email">
            <TextInput
              type="email"
              value={contactFields.email}
              onChange={(event) => setContactFields((current) => ({ ...current, email: event.target.value }))}
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Confirmed lead-delivery email">
            <TextInput
              type="email"
              value={contactFields.leadDeliveryEmail}
              onChange={(event) => setContactFields((current) => ({ ...current, leadDeliveryEmail: event.target.value }))}
              autoComplete="email"
              required
            />
          </Field>
          <ActionButton
            className="w-full"
            onClick={onSendInvitation}
            disabled={Boolean(busyAction) || !canSend}
            title={!canSend ? 'Confirm both email addresses while the prospect is connected.' : ''}
          >
            {busyAction === 'invitation' ? 'Sending…' : 'Send Signup Link'}
          </ActionButton>
          <p className="m-0 text-xs text-slate-500">
            The prospect reviews the prefilled intake, creates their own password, and accepts the required terms.
          </p>
        </div>
      ) : null}

      {invitation?.id ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900">Signup status</div>
            <StatusPill
              status={signupStatus}
              tone={invitation.attentionRequired ? 'bad' : progress >= 0 ? 'blue' : 'warn'}
            />
          </div>
          <ol className="mt-3 grid gap-2">
            {SIGNUP_STEPS.map((step, index) => {
              const reached = index <= progress;
              const current = index === progress;
              return (
                <li key={step.key} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-full ${reached ? 'bg-[#004ac6]' : 'bg-slate-300'} ${current ? 'ring-4 ring-blue-100' : ''}`}
                  />
                  <span className={reached ? 'font-semibold text-slate-900' : 'text-slate-500'}>{step.label}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 text-xs text-slate-500">
            Delivery: {displayStatus(invitation.deliveryStatus)}
            {invitation.expiresAt ? ` · Expires ${new Date(invitation.expiresAt).toLocaleString()}` : ''}
            {invitation.provisionedNumber ? ` · Number ${invitation.provisionedNumber}` : ''}
          </div>
          {invitation.attentionRequired ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {invitation.provisioningErrorMessage
                || invitation.provisioningStatusDetail
                || 'Number setup needs attention.'}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4">
        <Field label="Call outcome">
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/15"
          >
            <option value="">Select an outcome</option>
            {OUTCOMES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Call notes">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="What should you know before the next call?"
            className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/15"
          />
        </Field>
        <ActionButton
          className="w-full"
          tone="secondary"
          onClick={onSaveOutcome}
          disabled={Boolean(busyAction) || !prospect?.id || (!outcome && !note.trim()) || outcomeBlocked}
          title={outcomeBlocked ? 'End the live call before recording its outcome.' : ''}
        >
          {busyAction === 'outcome' ? 'Saving…' : outcome ? 'Save & next prospect' : 'Save notes'}
        </ActionButton>
      </div>
    </Card>
  );
}

export default function CallerWorkspace() {
  const { queue, queueLoading, queueError, loadQueue, warmQueue } = useSalesQueue({ autoWarm: true });
  const [call, setCall] = useState(null);
  const [invitation, setInvitation] = useState(null);
  const [busyAction, setBusyAction] = useState('');
  const [operationError, setOperationError] = useState('');
  const [callRefreshError, setCallRefreshError] = useState('');
  const [microphoneState, setMicrophoneState] = useState('Not requested');
  const [operatorMuted, setOperatorMuted] = useState(false);
  const [softphoneState, setSoftphoneState] = useState('Loading token');
  const [softphoneError, setSoftphoneError] = useState('');
  const [browserCallState, setBrowserCallState] = useState('Not started');
  const [setupOpen, setSetupOpen] = useState(false);
  const [contactFields, setContactFields] = useState({
    contactName: '',
    email: '',
    leadDeliveryEmail: ''
  });
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const remoteAudioRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const softphoneRef = useRef(null);
  const browserCallRef = useRef(null);
  const softphoneGenerationRef = useRef(0);
  const lastTerminalCallRef = useRef('');
  const callCreateAttemptRef = useRef({ prospectId: '', idempotencyKey: '' });
  const noteCreateAttemptRef = useRef({
    prospectId: '',
    salesCallId: '',
    body: '',
    idempotencyKey: ''
  });

  const releaseMicrophone = useCallback(() => {
    microphoneStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    setMicrophoneState('Released');
    setOperatorMuted(false);
  }, []);

  const setBrowserCallMuted = useCallback((muted) => {
    const nextMuted = softphoneRef.current?.setMuted(Boolean(muted));
    if (typeof nextMuted !== 'boolean') {
      throw new Error('There is no active browser call to mute.');
    }
    setOperatorMuted(nextMuted);
    setMicrophoneState(nextMuted ? 'Muted' : 'Live');
    return nextMuted;
  }, []);

  useEffect(() => {
    const prospect = queue.current;
    setContactFields({
      contactName: prospect?.contactName || '',
      email: prospect?.email || '',
      leadDeliveryEmail: prospect?.leadDeliveryEmail || prospect?.email || ''
    });
    setOutcome(prospect?.outcome || '');
    setNote(prospect?.note || '');
    setSetupOpen(false);
    setInvitation(null);
    noteCreateAttemptRef.current = {
      prospectId: '',
      salesCallId: '',
      body: '',
      idempotencyKey: ''
    };
    setCall((current) => (
      current?.prospectId && current.prospectId !== prospect?.id ? null : current
    ));
  }, [queue.current?.id]);

  const initializeSoftphone = useCallback(async () => {
    const generation = softphoneGenerationRef.current + 1;
    softphoneGenerationRef.current = generation;
    setSoftphoneState('Loading token');
    setSoftphoneError('');
    const previous = softphoneRef.current;
    softphoneRef.current = null;
    browserCallRef.current = null;
    if (previous) await previous.disconnect();

    try {
      const payload = await fetchSalesJson('/api/v1/admin/sales/webrtc-token');
      const config = normalizeWebrtc(payload);
      if (!config.token) throw new Error('The server did not provide a Telnyx WebRTC token.');
      if (generation !== softphoneGenerationRef.current) return;
      const client = await connectTelnyxBrowserClient({
        token: config.token,
        remoteElement: remoteAudioRef.current,
        onState: (state) => {
          if (generation === softphoneGenerationRef.current) setSoftphoneState(state);
        },
        onError: (message) => {
          if (generation !== softphoneGenerationRef.current) return;
          setSoftphoneError(message);
          if (browserCallRef.current) setBrowserCallState('Error');
        },
        onCallUpdate: (update) => {
          if (generation !== softphoneGenerationRef.current) return;
          browserCallRef.current = update.call || browserCallRef.current;
          setBrowserCallState(update.state || 'unknown');
          if (update.cause && !['normal_clearing', 'originator_cancel'].includes(update.cause.toLowerCase())) {
            setSoftphoneError(`${update.cause}${update.causeCode ? ` (${update.causeCode})` : ''}`);
          }
          if (['destroy', 'hangup', 'purge', 'ended'].includes(update.state)) {
            releaseMicrophone();
          }
        }
      });
      if (generation !== softphoneGenerationRef.current) {
        await client.disconnect();
        return;
      }
      softphoneRef.current = client;
      setSoftphoneState('ready');
    } catch (error) {
      if (generation !== softphoneGenerationRef.current) return;
      setSoftphoneState('error');
      setSoftphoneError(error?.message || 'Telnyx browser calling could not connect.');
    }
  }, [releaseMicrophone]);

  useEffect(() => {
    void initializeSoftphone();
    return () => {
      softphoneGenerationRef.current += 1;
      const client = softphoneRef.current;
      softphoneRef.current = null;
      if (client) void client.disconnect();
    };
  }, [initializeSoftphone]);

  const pollCall = useCallback(async () => {
    if (!call?.id) return;
    try {
      const payload = await fetchSalesJson(`/api/v1/admin/sales/calls/${encodeURIComponent(call.id)}`);
      const nextCall = normalizeCall(payload);
      setCallRefreshError('');
      setCall(nextCall);
      if (nextCall.signup) setInvitation(normalizeInvitation(nextCall.signup));
      if (nextCall.terminal && lastTerminalCallRef.current !== nextCall.id) {
        lastTerminalCallRef.current = nextCall.id;
        await loadQueue({ quiet: true });
      }
    } catch (error) {
      setCallRefreshError(error?.message || 'Could not refresh the call state.');
    }
  }, [call?.id, loadQueue]);

  useEffect(() => {
    if (!call?.id) return undefined;
    const invitationComplete = invitation && (
      ['account_ready', 'ready', 'completed', 'expired', 'failed', 'revoked'].includes(invitation.status)
      || ['account_ready', 'ready', 'attention_required'].includes(invitation.accountStatus)
    );
    if (call.terminal && (!invitation || invitationComplete)) return undefined;
    const interval = window.setInterval(() => { void pollCall(); }, call.terminal ? 3000 : 1500);
    return () => window.clearInterval(interval);
  }, [call?.id, call?.terminal, invitation?.id, invitation?.status, invitation?.accountStatus, pollCall]);

  useEffect(() => () => {
    microphoneStreamRef.current?.getTracks?.().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!call?.terminal) return;
    if (softphoneRef.current) void softphoneRef.current.hangup();
    browserCallRef.current = null;
    releaseMicrophone();
  }, [call?.terminal, releaseMicrophone]);

  const ensureMicrophone = async () => {
    if (microphoneStreamRef.current?.active) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not provide microphone access.');
    }
    setMicrophoneState('Requesting permission');
    try {
      microphoneStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      setMicrophoneState('Permission granted');
    } catch (error) {
      setMicrophoneState('Permission denied');
      throw new Error(error?.name === 'NotAllowedError'
        ? 'Microphone permission is required for browser calling.'
        : 'The browser microphone could not be opened.');
    }
  };

  const startCall = async () => {
    const prospect = queue.current;
    if (!prospect?.id) return;
    setBusyAction('call');
    setOperationError('');
    setCallRefreshError('');
    setSoftphoneError('');
    setBrowserCallState('Starting');
    let createdCall = null;
    if (callCreateAttemptRef.current.prospectId !== prospect.id
      || !callCreateAttemptRef.current.idempotencyKey) {
      callCreateAttemptRef.current = {
        prospectId: prospect.id,
        idempotencyKey: globalThis.crypto?.randomUUID?.()
          || `sales-call-${prospect.id}-${Date.now()}`
      };
    }
    try {
      if (!softphoneRef.current?.isReady()) {
        throw new Error('Telnyx browser calling is not ready.');
      }
      await ensureMicrophone();
      const payload = await fetchSalesJson('/api/v1/admin/sales/calls', {
        method: 'POST',
        idempotencyKey: callCreateAttemptRef.current.idempotencyKey,
        body: JSON.stringify({ prospectId: prospect.id })
      });
      const nextCall = normalizeCall(payload);
      if (!nextCall.id) throw new Error('The server did not return a sales call ID.');
      createdCall = nextCall;
      setCall(nextCall);
      setInvitation(nextCall.signup ? normalizeInvitation(nextCall.signup) : null);
      setSetupOpen(false);
      setOutcome('');
      setNote('');
      callCreateAttemptRef.current = { prospectId: '', idempotencyKey: '' };
      const callOptions = nextCall.webrtc?.callOptions || {};
      browserCallRef.current = softphoneRef.current.placeCall(
        callOptions,
        microphoneStreamRef.current
      );
      setOperatorMuted(false);
      setMicrophoneState('Live');
    } catch (error) {
      setOperationError(error?.message || 'The call could not be started.');
      setBrowserCallState('Failed');
      if (createdCall?.id) {
        try {
          const cleanupPayload = await fetchSalesJson(`/api/v1/admin/sales/calls/${encodeURIComponent(createdCall.id)}/actions`, {
            method: 'POST',
            body: JSON.stringify({ action: 'end_call' })
          });
          setCall(normalizeCall(cleanupPayload));
          callCreateAttemptRef.current = { prospectId: '', idempotencyKey: '' };
        } catch {
          // The original browser-call error remains primary; polling can still reconcile this call.
        }
      }
    } finally {
      setBusyAction('');
    }
  };

  const performCallAction = async (action) => {
    if (!call?.id) return;
    setBusyAction(action);
    setOperationError('');
    const wasOperatorMuted = operatorMuted;
    try {
      if (action === 'start_demo') {
        setBrowserCallMuted(true);
        await new Promise((resolve) => window.setTimeout(resolve, RECEPTIONIST_MUTE_SETTLE_MS));
      }
      const payload = await fetchSalesJson(`/api/v1/admin/sales/calls/${encodeURIComponent(call.id)}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      const nextCall = normalizeCall(payload);
      if (!nextCall.id) throw new Error('The server did not return the updated call state.');
      setCall(nextCall);
      if (nextCall.signup) setInvitation(normalizeInvitation(nextCall.signup));
      if (action === 'end_demo') setBrowserCallMuted(false);
      if (nextCall.terminal || action === 'end_call') {
        await softphoneRef.current?.hangup();
        browserCallRef.current = null;
        releaseMicrophone();
        await loadQueue({ quiet: true });
      }
    } catch (error) {
      if (action === 'start_demo' && !wasOperatorMuted) {
        try {
          setBrowserCallMuted(false);
        } catch {
          // Keep the original receptionist-start failure as the actionable error.
        }
      }
      setOperationError(error?.message || `${displayStatus(action)} failed.`);
    } finally {
      setBusyAction('');
    }
  };

  const toggleOperatorMute = () => {
    setSoftphoneError('');
    try {
      setBrowserCallMuted(!operatorMuted);
    } catch (error) {
      setSoftphoneError(error?.message || 'The browser microphone could not be muted.');
    }
  };

  const sendInvitation = async () => {
    const prospect = queue.current;
    if (!prospect?.id || !call?.id) return;
    setBusyAction('invitation');
    setOperationError('');
    try {
      const payload = await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}/signup-invitations`, {
        method: 'POST',
        idempotencyKey: `sales-signup-${call.id}`,
        body: JSON.stringify({
          salesCallId: call.id,
          contactEmail: contactFields.email.trim(),
          leadDeliveryEmail: contactFields.leadDeliveryEmail.trim(),
        })
      });
      const nextInvitation = normalizeInvitation(payload);
      if (!nextInvitation.id) throw new Error('The server did not return a signup invitation ID.');
      setInvitation(nextInvitation);
      await pollCall();
    } catch (error) {
      setOperationError(error?.message || 'The signup link could not be sent.');
    } finally {
      setBusyAction('');
    }
  };

  const saveOutcome = async () => {
    const prospect = queue.current;
    if (!prospect?.id) return;
    setBusyAction('outcome');
    setOperationError('');
    try {
      await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          contactName: contactFields.contactName.trim(),
          contactEmail: contactFields.email.trim(),
          leadDeliveryEmail: contactFields.leadDeliveryEmail.trim()
        })
      });
      if (outcome) {
        if (!call?.id) throw new Error('A sales call is required before recording an outcome.');
        const outcomePayload = await fetchSalesJson(`/api/v1/admin/sales/calls/${encodeURIComponent(call.id)}/outcome`, {
          method: 'POST',
          idempotencyKey: `sales-outcome-${call.id}`,
          body: JSON.stringify({ outcome, notes: note.trim() })
        });
        setCall(normalizeCall(outcomePayload));
      } else if (note.trim()) {
        const noteRequest = {
          prospectId: prospect.id,
          salesCallId: call?.id || '',
          body: note.trim()
        };
        const previousAttempt = noteCreateAttemptRef.current;
        if (
          previousAttempt.prospectId !== noteRequest.prospectId
          || previousAttempt.salesCallId !== noteRequest.salesCallId
          || previousAttempt.body !== noteRequest.body
          || !previousAttempt.idempotencyKey
        ) {
          noteCreateAttemptRef.current = {
            ...noteRequest,
            idempotencyKey: globalThis.crypto?.randomUUID?.()
              || `sales-note-${prospect.id}-${Date.now()}`
          };
        }
        await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospect.id)}/notes`, {
          method: 'POST',
          idempotencyKey: noteCreateAttemptRef.current.idempotencyKey,
          body: JSON.stringify({
            salesCallId: call?.id || null,
            body: note.trim()
          })
        });
        noteCreateAttemptRef.current = {
          prospectId: '',
          salesCallId: '',
          body: '',
          idempotencyKey: ''
        };
      }
      const loadedQueue = await loadQueue({ quiet: true });
      await warmQueue({
        quiet: true,
        currentProspectId: loadedQueue?.currentProspectId || ''
      });
    } catch (error) {
      setOperationError(error?.message || 'The outcome and note could not be saved.');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="grid gap-4 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-slate-950">Sales calls</h1>
          <p className="mt-1 text-sm text-slate-500">Call your prospect, introduce the receptionist, then save the outcome to move on.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-600" aria-live="polite">{queue.prospects.length} in your queue</span>
          <ActionButton tone="secondary" onClick={() => { void loadQueue(); }} disabled={queueLoading}>
            {queueLoading ? 'Refreshing…' : 'Refresh prospects'}
          </ActionButton>
        </div>
      </header>
      <ErrorNotice title="Action failed" message={operationError} />
      <ErrorNotice title="Call status unavailable" message={callRefreshError} />
      <ErrorNotice title="Prospects unavailable" message={queueError} />

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <p className="m-0 text-xs font-semibold uppercase tracking-wider text-blue-700">Current prospect</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">{queue.current?.businessName || (queueLoading ? 'Loading prospects…' : 'No prospects to call')}</h2>
        <p className="mt-1 text-sm text-slate-700">{queue.current ? [queue.current.contactName, queue.current.phone].filter(Boolean).join(' · ') : 'An administrator can add prospects and prepare them for calling.'}</p>
      </div>
      <ProspectPanel prospect={queue.current} />
      <CallPanel
        prospect={queue.current}
        call={call}
        busyAction={busyAction}
        microphoneState={microphoneState}
        operatorMuted={operatorMuted}
        softphoneState={softphoneState}
        softphoneError={softphoneError}
        browserCallState={browserCallState}
        remoteAudioRef={remoteAudioRef}
        onCall={() => { void startCall(); }}
        onAction={(action) => { void performCallAction(action); }}
        onToggleMute={toggleOperatorMute}
        onReconnect={() => { void initializeSoftphone(); }}
      />
      <ConversionPanel
        prospect={queue.current}
        call={call}
        invitation={invitation}
        busyAction={busyAction}
        setupOpen={setupOpen}
        setSetupOpen={setSetupOpen}
        contactFields={contactFields}
        setContactFields={setContactFields}
        outcome={outcome}
        setOutcome={setOutcome}
        note={note}
        setNote={setNote}
        onSendInvitation={() => { void sendInvitation(); }}
        onSaveOutcome={() => { void saveOutcome(); }}
      />
    </div>
  );
}
