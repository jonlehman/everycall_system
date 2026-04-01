'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';
import GuidePanel from '../../_components/GuidePanel';
import SectionPage from '../../_components/SectionPage';
import { accountNavItems } from '../../_components/navigation';

const POLL_INTERVAL_MS = 5000;

function fetchJson(url, options) {
  return fetch(url, options).then(async (resp) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || data?.error || 'request_failed');
    }
    return data;
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function formatRelative(value) {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function conversationStatusMeta(status) {
  if (status === 'waiting_on_client') {
    return {
      label: 'Waiting on you',
      toneClass: 'border-emerald-200 bg-emerald-50 text-emerald-800'
    };
  }
  if (status === 'resolved') {
    return {
      label: 'Resolved',
      toneClass: 'border-slate-200 bg-slate-100 text-slate-700'
    };
  }
  return {
    label: 'Waiting on support',
    toneClass: 'border-amber-200 bg-amber-50 text-amber-800'
  };
}

function senderMeta(senderType) {
  if (senderType === 'admin') {
    return {
      label: 'Support',
      bubbleClass: 'border-blue-200 bg-blue-50 text-slate-800'
    };
  }
  return {
    label: 'You',
    bubbleClass: 'border-slate-200 bg-white text-slate-800'
  };
}

function ConversationListItem({ conversation, selected, onSelect }) {
  const statusMeta = conversationStatusMeta(conversation.status);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-3 text-left shadow-sm transition-colors',
        selected
          ? 'border-[#004ac6]/25 bg-[#eff4ff]'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{conversation.subject}</div>
          <div className="mt-1 text-xs text-slate-500">
            Started by {conversation.createdByName || conversation.createdByEmail || 'Client'}
          </div>
        </div>
        {conversation.clientUnreadCount > 0 ? (
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[#004ac6] px-2 py-1 text-[11px] font-semibold text-white">
            {conversation.clientUnreadCount}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold', statusMeta.toneClass)}>
          {statusMeta.label}
        </span>
        <span className="text-[11px] text-slate-500">{formatRelative(conversation.lastMessageAt)}</span>
      </div>
      <div className="mt-3 line-clamp-2 text-sm leading-5 text-slate-600">
        {conversation.lastMessagePreview || 'No messages yet.'}
      </div>
    </button>
  );
}

export default function AccountSupportPage() {
  const [viewer, setViewer] = useState({ tenantUserId: null, name: '', email: '', role: '' });
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState({ tone: 'warn', message: 'Loading support conversations...' });
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const selectedConversationIdRef = useRef(null);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const loadConversations = async ({ silent = false } = {}) => {
    if (!silent) {
      setLoadingList(true);
      setStatus({ tone: 'warn', message: 'Loading support conversations...' });
    }
    try {
      const data = await fetchJson('/api/v1/support/conversations');
      const nextConversations = Array.isArray(data?.conversations) ? data.conversations : [];
      setViewer(data?.viewer || { tenantUserId: null, name: '', email: '', role: '' });
      setConversations(nextConversations);
      const currentSelected = selectedConversationIdRef.current;
      const nextSelected = nextConversations.some((item) => item.id === currentSelected)
        ? currentSelected
        : (nextConversations[0]?.id || null);
      if (nextSelected !== currentSelected) {
        setSelectedConversationId(nextSelected);
      }
      if (!silent) {
        setStatus({
          tone: 'ok',
          message: nextConversations.length
            ? 'Support inbox loaded.'
            : 'No support conversations yet. Start one below when you need help.'
        });
      }
    } catch (error) {
      if (!silent) {
        setStatus({ tone: 'bad', message: error?.message || 'Could not load support conversations.' });
      }
    } finally {
      if (!silent) {
        setLoadingList(false);
      }
    }
  };

  const markRead = async (conversationId) => {
    await fetchJson(`/api/v1/support/conversations/${conversationId}/read`, { method: 'POST' });
    setConversations((current) => current.map((item) => (
      item.id === conversationId
        ? { ...item, clientUnreadCount: 0 }
        : item
    )));
    setDetail((current) => (
      current?.conversation?.id === conversationId
        ? {
            ...current,
            conversation: {
              ...current.conversation,
              clientUnreadCount: 0
            }
          }
        : current
    ));
  };

  const loadDetail = async (conversationId, { silent = false } = {}) => {
    if (!conversationId) {
      setDetail(null);
      return;
    }
    if (!silent) {
      setLoadingDetail(true);
    }
    try {
      const data = await fetchJson(`/api/v1/support/conversations/${conversationId}`);
      setDetail({
        conversation: data?.conversation || null,
        messages: Array.isArray(data?.messages) ? data.messages : []
      });
      if (Number(data?.conversation?.clientUnreadCount || 0) > 0) {
        await markRead(conversationId);
      }
    } catch (error) {
      if (!silent) {
        setStatus({ tone: 'bad', message: error?.message || 'Could not load support conversation.' });
      }
      setDetail(null);
    } finally {
      if (!silent) {
        setLoadingDetail(false);
      }
    }
  };

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    if (!selectedConversationId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedConversationId);
  }, [selectedConversationId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadConversations({ silent: true });
      if (selectedConversationIdRef.current) {
        void loadDetail(selectedConversationIdRef.current, { silent: true });
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  const createConversation = async () => {
    setCreating(true);
    setStatus({ tone: 'warn', message: 'Starting support conversation...' });
    try {
      const data = await fetchJson('/api/v1/support/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: newSubject, body: newBody })
      });
      setNewSubject('');
      setNewBody('');
      await loadConversations({ silent: true });
      if (data?.conversationId) {
        setSelectedConversationId(data.conversationId);
        await loadDetail(data.conversationId);
      }
      setStatus({ tone: 'ok', message: 'Support conversation started.' });
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not start support conversation.' });
    } finally {
      setCreating(false);
    }
  };

  const sendReply = async () => {
    if (!selectedConversationId) return;
    setSending(true);
    setStatus({ tone: 'warn', message: 'Sending reply...' });
    try {
      await fetchJson(`/api/v1/support/conversations/${selectedConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyBody })
      });
      setReplyBody('');
      await Promise.all([
        loadConversations({ silent: true }),
        loadDetail(selectedConversationId, { silent: true })
      ]);
      setStatus({ tone: 'ok', message: 'Reply sent.' });
    } catch (error) {
      setStatus({ tone: 'bad', message: error?.message || 'Could not send reply.' });
    } finally {
      setSending(false);
    }
  };

  const selectedStatusMeta = conversationStatusMeta(detail?.conversation?.status);
  const openConversations = useMemo(
    () => conversations.filter((item) => item.status !== 'resolved'),
    [conversations]
  );

  return (
    <SectionPage
      tabs={accountNavItems}
      title="Support"
      subtitle="Start a conversation with EveryCall support, track replies, and keep everything tied to your tenant."
      status={status}
    >
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(320px,.95fr)_minmax(0,1.25fr)]">
        <div className="grid gap-3">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Start a conversation</h2>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  Include the call time, caller number if known, and what you expected the system to do.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {viewer.name || viewer.email || 'Tenant user'}
              </span>
            </div>
            <div className="mt-4 grid gap-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-900">Subject</label>
                <input
                  value={newSubject}
                  onChange={(event) => setNewSubject(event.target.value)}
                  placeholder="Example: Lead alert email missing for a completed call"
                  maxLength={160}
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-900">Message</label>
                <textarea
                  value={newBody}
                  onChange={(event) => setNewBody(event.target.value)}
                  placeholder="Describe the issue, when it happened, and what you expected."
                  rows={5}
                  maxLength={4000}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={createConversation}
                  disabled={creating || !newSubject.trim() || !newBody.trim()}
                >
                  {creating ? 'Starting...' : 'Start Conversation'}
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold">Your conversations</h2>
                <p className="m-0 mt-1 text-sm text-slate-500">
                  {openConversations.length} open · {conversations.length} total
                </p>
              </div>
              {loadingList ? (
                <span className="text-xs text-slate-500">Refreshing...</span>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3">
              {conversations.length ? (
                conversations.map((conversation) => (
                  <ConversationListItem
                    key={conversation.id}
                    conversation={conversation}
                    selected={conversation.id === selectedConversationId}
                    onSelect={() => setSelectedConversationId(conversation.id)}
                  />
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No support conversations yet.
                </div>
              )}
            </div>
          </section>

          <GuidePanel title="Support Guide" eyebrow="What to include" icon="help">
            <div>Support can move faster when the first message includes the call time, caller number, and what you expected to happen.</div>
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <div className="font-semibold text-slate-900">Best first checks</div>
              <div className="mt-1 text-sm text-slate-600">Review Calls for the summary and transcript, Billing for lead classification, and Knowledge for the current published build.</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <div className="font-semibold text-slate-900">Response flow</div>
              <div className="mt-1 text-sm text-slate-600">When support replies, the conversation moves to waiting on you. Your next reply automatically reopens it for the support queue.</div>
            </div>
          </GuidePanel>
        </div>

        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          {detail?.conversation ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Conversation</div>
                  <h2 className="m-0 mt-2 text-xl font-semibold text-slate-950">{detail.conversation.subject}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                    <span>Created {formatDateTime(detail.conversation.createdAt)}</span>
                    <span>&middot;</span>
                    <span>Last activity {formatRelative(detail.conversation.lastMessageAt)}</span>
                  </div>
                </div>
                <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-semibold', selectedStatusMeta.toneClass)}>
                  {selectedStatusMeta.label}
                </span>
              </div>

              <div className="mt-4 grid gap-3">
                {(Array.isArray(detail.messages) ? detail.messages : []).map((message) => {
                  const meta = senderMeta(message.senderType);
                  return (
                    <article
                      key={message.id}
                      className={cn(
                        'rounded-xl border p-4 shadow-sm',
                        meta.bubbleClass
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {message.senderName || meta.label}
                        </div>
                        <div className="text-xs text-slate-500">{formatDateTime(message.createdAt)}</div>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.body}</div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-900">Reply</label>
                  <textarea
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    placeholder="Add more detail or answer the latest support question."
                    rows={5}
                    maxLength={4000}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={sendReply}
                      disabled={sending || !replyBody.trim()}
                    >
                      {sending ? 'Sending...' : 'Send Reply'}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
              {loadingDetail ? 'Loading conversation...' : 'Select a conversation or start a new one to speak with support.'}
            </div>
          )}
        </section>
      </div>
    </SectionPage>
  );
}
