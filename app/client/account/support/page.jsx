'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../../lib/utils';
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
  if (diffMinutes < 60) return `${diffMinutes} mins ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function ticketLabel(conversationId) {
  return `Ticket #${String(Number(conversationId || 0)).padStart(4, '0')}`;
}

function threadStatusMeta(status) {
  if (status === 'waiting_on_client') {
    return {
      label: 'Waiting On You',
      shortLabel: 'Waiting',
      badgeClass: 'bg-[#d6e4f9] text-[#3a4859]',
      dotClass: 'bg-[#205cb5]'
    };
  }
  if (status === 'resolved') {
    return {
      label: 'Resolved',
      shortLabel: 'Resolved',
      badgeClass: 'bg-slate-200 text-slate-600',
      dotClass: 'bg-slate-500'
    };
  }
  return {
    label: 'Active',
    shortLabel: 'Active',
    badgeClass: 'bg-[#0f1c2c] text-white',
    dotClass: 'bg-emerald-500'
  };
}

function senderMeta(senderType) {
  if (senderType === 'admin') {
    return {
      label: 'EveryCall Support',
      avatarIcon: 'support_agent',
      avatarClass: 'bg-slate-200 text-slate-600',
      rowClass: 'flex-row-reverse',
      alignClass: 'items-end text-right',
      bubbleClass: 'bg-[#e5e9eb] text-slate-800 rounded-2xl rounded-tr-md',
      timeClass: 'text-right'
    };
  }
  return {
    label: 'You',
    avatarIcon: 'person',
    avatarClass: 'bg-[#d8e2ff] text-[#205cb5]',
    rowClass: '',
    alignClass: 'items-start text-left',
    bubbleClass: 'bg-[#d8e2ff] text-[#003576] rounded-2xl rounded-tl-md',
    timeClass: 'text-left'
  };
}

function ConversationRailItem({ conversation, selected, onSelect }) {
  const meta = threadStatusMeta(conversation.status);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-2xl px-4 py-4 text-left transition-all',
        selected
          ? 'border-l-4 border-[#205cb5] bg-white shadow-sm'
          : 'bg-[#ebeef0] hover:bg-[#e5e9eb]'
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
          {ticketLabel(conversation.id)}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em]', meta.badgeClass)}>
          {meta.shortLabel}
        </span>
      </div>
      <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{conversation.subject}</h3>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
        {conversation.lastMessagePreview || 'No messages yet.'}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-slate-400">
          <span className="material-symbols-outlined text-[12px]">schedule</span>
          {formatRelative(conversation.lastMessageAt)}
        </p>
        {conversation.clientUnreadCount > 0 ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#205cb5] px-1.5 py-0.5 text-[10px] font-bold text-white">
            {conversation.clientUnreadCount}
          </span>
        ) : null}
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
  const startConversationRef = useRef(null);

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

  const selectedStatusMeta = threadStatusMeta(detail?.conversation?.status);
  const openConversations = useMemo(
    () => conversations.filter((item) => item.status !== 'resolved'),
    [conversations]
  );

  const scrollToNewConversation = () => {
    startConversationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <SectionPage
      tabs={accountNavItems}
      title="Support"
      subtitle="Start a conversation with EveryCall support, review your active threads, and reply in one workspace."
      status={status}
    >
      <div className="overflow-hidden rounded-[1.35rem] border border-slate-200/70 bg-[#f7fafc] shadow-[0_16px_40px_rgba(18,28,42,0.08)] xl:grid xl:grid-cols-[320px_minmax(0,1fr)] xl:min-h-[calc(100vh-14rem)]">
        <section className="flex flex-col border-b border-slate-200/70 bg-[#f1f4f6] xl:border-b-0 xl:border-r">
          <div className="border-b border-slate-200/70 px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-xl font-semibold tracking-[-0.02em] text-slate-900">Your Conversations</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {openConversations.length} open {openConversations.length === 1 ? 'thread' : 'threads'}
                </p>
              </div>
              <button
                type="button"
                onClick={scrollToNewConversation}
                className="inline-flex items-center gap-2 rounded-lg bg-[#205cb5] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition-opacity hover:opacity-90"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                New
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-3">
              {conversations.length ? (
                conversations.map((conversation) => (
                  <ConversationRailItem
                    key={conversation.id}
                    conversation={conversation}
                    selected={conversation.id === selectedConversationId}
                    onSelect={() => setSelectedConversationId(conversation.id)}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                  No conversations yet. Start one from the workspace to the right.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="relative flex min-h-[70vh] flex-col bg-[#f7fafc]">
          <div ref={startConversationRef} className="border-b border-slate-200/70 px-5 py-6 md:px-8">
            <div className="mx-auto max-w-4xl">
              <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm md:p-8">
                <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[#205cb5]/5" />
                <div className="relative">
                  <h3 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em] text-slate-900">
                    <span className="material-symbols-outlined text-[#205cb5]">add_box</span>
                    Start A New Conversation
                  </h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Describe the issue clearly. Include the call time, caller number if known, and what behavior you expected.
                  </p>

                  <div className="mt-6 grid gap-6">
                    <div className="grid gap-2">
                      <label>Subject</label>
                      <input
                        value={newSubject}
                        onChange={(event) => setNewSubject(event.target.value)}
                        placeholder="Example: Lead alert email missing for a completed call"
                        maxLength={160}
                        className="bg-[#f1f4f6] ring-0 focus:bg-white focus:ring-2 focus:ring-[#205cb5]/20"
                      />
                    </div>
                    <div className="grid gap-2">
                      <label>Detailed Message</label>
                      <textarea
                        value={newBody}
                        onChange={(event) => setNewBody(event.target.value)}
                        placeholder="Explain the issue, what happened, and what you expected instead."
                        rows={4}
                        maxLength={4000}
                        className="bg-[#f1f4f6] ring-0 focus:bg-white focus:ring-2 focus:ring-[#205cb5]/20"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={createConversation}
                        disabled={creating || !newSubject.trim() || !newBody.trim()}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#205cb5] px-6 py-3 text-sm font-semibold text-white transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {creating ? 'Starting...' : 'Submit Ticket'}
                        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-36 pt-6 md:px-8">
            <div className="mx-auto max-w-4xl space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-8 w-px bg-slate-200" />
                  <div>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-slate-900">
                      {detail?.conversation ? `Active Conversation: ${detail.conversation.subject}` : 'Conversation Transcript'}
                    </h3>
                    {detail?.conversation ? (
                      <p className="mt-1 text-sm text-slate-500">
                        {ticketLabel(detail.conversation.id)} · Started {formatDateTime(detail.conversation.createdAt)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <span className={cn('h-2.5 w-2.5 rounded-full', detail?.conversation ? selectedStatusMeta.dotClass : 'bg-slate-300')} />
                  {detail?.conversation ? selectedStatusMeta.label : 'No thread selected'}
                </span>
              </div>

              {detail?.conversation ? (
                (Array.isArray(detail.messages) ? detail.messages : []).map((message) => {
                  const meta = senderMeta(message.senderType);
                  return (
                    <div key={message.id} className={cn('flex gap-4', meta.rowClass)}>
                      <div className="flex-shrink-0">
                        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', meta.avatarClass)}>
                          <span className="material-symbols-outlined text-[20px]">{meta.avatarIcon}</span>
                        </div>
                      </div>
                      <div className={cn('flex flex-1 flex-col gap-2', meta.alignClass)}>
                        <div className="flex items-center gap-3">
                          {meta.rowClass ? (
                            <>
                              <span className={cn('text-[10px] uppercase tracking-[0.18em] text-slate-400', meta.timeClass)}>{formatDateTime(message.createdAt)}</span>
                              <span className="text-sm font-semibold text-slate-900">{message.senderName || meta.label}</span>
                            </>
                          ) : (
                            <>
                              <span className="text-sm font-semibold text-slate-900">{message.senderName || meta.label}</span>
                              <span className={cn('text-[10px] uppercase tracking-[0.18em] text-slate-400', meta.timeClass)}>{formatDateTime(message.createdAt)}</span>
                            </>
                          )}
                        </div>
                        <div className={cn('max-w-2xl whitespace-pre-wrap px-5 py-4 text-sm leading-7 shadow-sm', meta.bubbleClass)}>
                          {message.body}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
                  {loadingDetail
                    ? 'Loading conversation...'
                    : 'Select a conversation from the left or start a new one to begin chatting with support.'}
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 px-5 pb-5 pt-0 md:px-8">
            <div className="mx-auto max-w-4xl">
              <div className="flex items-end gap-4 rounded-t-[1.35rem] border border-slate-200/70 bg-white/90 p-4 shadow-[0_-8px_28px_rgba(18,28,42,0.08)] backdrop-blur-xl">
                <div className="flex-1">
                  <textarea
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    placeholder={detail?.conversation ? 'Type your reply to support...' : 'Select a conversation to reply.'}
                    rows={1}
                    maxLength={4000}
                    disabled={!detail?.conversation || sending}
                    className="min-h-[3.5rem] resize-none border-0 bg-transparent px-0 py-2 shadow-none ring-0 focus:ring-0 disabled:cursor-not-allowed disabled:text-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={sendReply}
                  disabled={sending || !detail?.conversation || !replyBody.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#205cb5] px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? 'Sending...' : 'Send Reply'}
                  <span className="material-symbols-outlined text-[16px]">send</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </SectionPage>
  );
}
