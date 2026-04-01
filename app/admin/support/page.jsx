'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

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

function supportStatusMeta(status) {
  if (status === 'waiting_on_client') {
    return {
      label: 'Waiting on client',
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

function callLeadLabel(call) {
  if (call?.lead_is_billable) return 'Billable lead';
  if (call?.lead_is_valid) return 'Valid lead';
  return 'Non-lead call';
}

function senderMeta(senderType) {
  if (senderType === 'tenant_user') {
    return {
      fallbackLabel: 'Client',
      bubbleClass: 'border-slate-200 bg-white text-slate-800'
    };
  }
  return {
    fallbackLabel: 'Support',
    bubbleClass: 'border-blue-200 bg-blue-50 text-slate-800'
  };
}

function FilterChip({ active, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
        active
          ? 'border-[#004ac6]/20 bg-[#eff4ff] text-[#004ac6]'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      )}
    >
      <span>{label}</span>
      <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-slate-600">{count}</span>
    </button>
  );
}

function ConversationCard({ conversation, selected, onSelect }) {
  const statusMeta = supportStatusMeta(conversation.status);
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
          <div className="truncate text-sm font-semibold text-slate-900">
            {conversation.subject}
          </div>
          <div className="mt-1 truncate text-xs text-slate-500">
            {conversation.tenantKey}
          </div>
        </div>
        {conversation.adminUnreadCount > 0 ? (
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[#004ac6] px-2 py-1 text-[11px] font-semibold text-white">
            {conversation.adminUnreadCount}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold', statusMeta.toneClass)}>
          {statusMeta.label}
        </span>
        {conversation.assignedAdminEmail ? (
          <span className="text-[11px] text-slate-500">Assigned to {conversation.assignedAdminName || conversation.assignedAdminEmail}</span>
        ) : (
          <span className="text-[11px] text-slate-500">Unassigned</span>
        )}
      </div>
      <div className="mt-3 line-clamp-2 text-sm leading-5 text-slate-600">
        {conversation.lastMessagePreview || 'No messages yet.'}
      </div>
      <div className="mt-2 text-[11px] text-slate-500">{formatRelative(conversation.lastMessageAt)}</div>
    </button>
  );
}

export default function AdminSupportPage() {
  const [viewer, setViewer] = useState({ id: null, email: '', role: '' });
  const [counts, setCounts] = useState({ all: 0, unread: 0, unassigned: 0, mine: 0, resolved: 0 });
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [activeFilter, setActiveFilter] = useState('unread');
  const [search, setSearch] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [status, setStatus] = useState('Loading support inbox...');
  const selectedConversationIdRef = useRef(null);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const loadInbox = async ({ silent = false } = {}) => {
    if (!silent) {
      setLoadingList(true);
      setStatus('Loading support inbox...');
    }
    try {
      const data = await fetchJson('/api/v1/admin/support');
      const nextConversations = Array.isArray(data?.conversations) ? data.conversations : [];
      setViewer(data?.viewer || { id: null, email: '', role: '' });
      setCounts(data?.counts || { all: 0, unread: 0, unassigned: 0, mine: 0, resolved: 0 });
      setConversations(nextConversations);
      const currentSelected = selectedConversationIdRef.current;
      const nextSelected = nextConversations.some((item) => item.id === currentSelected)
        ? currentSelected
        : (nextConversations[0]?.id || null);
      if (nextSelected !== currentSelected) {
        setSelectedConversationId(nextSelected);
      }
      if (!silent) {
        setStatus(nextConversations.length ? 'Support inbox loaded.' : 'No support conversations yet.');
      }
    } catch (error) {
      if (!silent) {
        setStatus(error?.message || 'Could not load support inbox.');
      }
    } finally {
      if (!silent) {
        setLoadingList(false);
      }
    }
  };

  const markRead = async (conversationId) => {
    await fetchJson(`/api/v1/admin/support/${conversationId}/read`, { method: 'POST' });
    setConversations((current) => current.map((item) => (
      item.id === conversationId
        ? { ...item, adminUnreadCount: 0 }
        : item
    )));
    setDetail((current) => (
      current?.conversation?.id === conversationId
        ? {
            ...current,
            conversation: {
              ...current.conversation,
              adminUnreadCount: 0
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
      const data = await fetchJson(`/api/v1/admin/support/${conversationId}`);
      const nextDetail = {
        conversation: data?.conversation || null,
        messages: Array.isArray(data?.messages) ? data.messages : [],
        tenantContext: data?.tenantContext || null
      };
      setDetail(nextDetail);
      if (Number(nextDetail.conversation?.adminUnreadCount || 0) > 0) {
        await markRead(conversationId);
      }
    } catch (error) {
      if (!silent) {
        setStatus(error?.message || 'Could not load support conversation.');
      }
      setDetail(null);
    } finally {
      if (!silent) {
        setLoadingDetail(false);
      }
    }
  };

  useEffect(() => {
    void loadInbox();
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
      void loadInbox({ silent: true });
      if (selectedConversationIdRef.current) {
        void loadDetail(selectedConversationIdRef.current, { silent: true });
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  const filteredConversations = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (activeFilter === 'unread' && Number(conversation.adminUnreadCount || 0) <= 0) return false;
      if (activeFilter === 'unassigned' && (conversation.assignedAdminUserId || conversation.status === 'resolved')) return false;
      if (activeFilter === 'mine' && Number(conversation.assignedAdminUserId || 0) !== Number(viewer.id || 0)) return false;
      if (activeFilter === 'resolved' && conversation.status !== 'resolved') return false;
      if (activeFilter === 'open' && conversation.status === 'resolved') return false;
      if (!searchTerm) return true;
      const haystack = [
        conversation.subject,
        conversation.tenantKey,
        conversation.createdByName,
        conversation.createdByEmail,
        conversation.lastMessagePreview
      ].join(' ').toLowerCase();
      return haystack.includes(searchTerm);
    });
  }, [activeFilter, conversations, search, viewer.id]);

  useEffect(() => {
    if (!filteredConversations.length) {
      return;
    }
    if (!filteredConversations.some((item) => item.id === selectedConversationId)) {
      setSelectedConversationId(filteredConversations[0].id);
    }
  }, [filteredConversations, selectedConversationId]);

  const sendReply = async () => {
    if (!selectedConversationId) return;
    setSending(true);
    setStatus('Sending support reply...');
    try {
      await fetchJson(`/api/v1/admin/support/${selectedConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyBody })
      });
      setReplyBody('');
      await Promise.all([
        loadInbox({ silent: true }),
        loadDetail(selectedConversationId, { silent: true })
      ]);
      setStatus('Support reply sent.');
    } catch (error) {
      setStatus(error?.message || 'Could not send support reply.');
    } finally {
      setSending(false);
    }
  };

  const assignToCurrentAdmin = async () => {
    if (!selectedConversationId) return;
    setAssignBusy(true);
    setStatus('Assigning conversation...');
    try {
      await fetchJson(`/api/v1/admin/support/${selectedConversationId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUserId: viewer.id })
      });
      await Promise.all([
        loadInbox({ silent: true }),
        loadDetail(selectedConversationId, { silent: true })
      ]);
      setStatus('Conversation assigned.');
    } catch (error) {
      setStatus(error?.message || 'Could not assign conversation.');
    } finally {
      setAssignBusy(false);
    }
  };

  const clearAssignment = async () => {
    if (!selectedConversationId) return;
    setAssignBusy(true);
    setStatus('Clearing assignment...');
    try {
      await fetchJson(`/api/v1/admin/support/${selectedConversationId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true })
      });
      await Promise.all([
        loadInbox({ silent: true }),
        loadDetail(selectedConversationId, { silent: true })
      ]);
      setStatus('Assignment cleared.');
    } catch (error) {
      setStatus(error?.message || 'Could not clear assignment.');
    } finally {
      setAssignBusy(false);
    }
  };

  const updateConversationStatus = async (nextStatus) => {
    if (!selectedConversationId) return;
    setStatusBusy(true);
    setStatus(nextStatus === 'resolved' ? 'Resolving conversation...' : 'Reopening conversation...');
    try {
      await fetchJson(`/api/v1/admin/support/${selectedConversationId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      await Promise.all([
        loadInbox({ silent: true }),
        loadDetail(selectedConversationId, { silent: true })
      ]);
      setStatus(nextStatus === 'resolved' ? 'Conversation resolved.' : 'Conversation reopened.');
    } catch (error) {
      setStatus(error?.message || 'Could not update support status.');
    } finally {
      setStatusBusy(false);
    }
  };

  const conversationMeta = supportStatusMeta(detail?.conversation?.status);
  const assignedToCurrentAdmin = Number(detail?.conversation?.assignedAdminUserId || 0) === Number(viewer.id || 0);

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Support</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Manage tenant support conversations, reply from the admin inbox, and keep assignment and status current.
          </p>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
          {viewer.email || 'Admin'}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {status}
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip active={activeFilter === 'unread'} label="Unread" count={counts.unread || 0} onClick={() => setActiveFilter('unread')} />
        <FilterChip active={activeFilter === 'open'} label="Open" count={(counts.all || 0) - (counts.resolved || 0)} onClick={() => setActiveFilter('open')} />
        <FilterChip active={activeFilter === 'unassigned'} label="Unassigned" count={counts.unassigned || 0} onClick={() => setActiveFilter('unassigned')} />
        <FilterChip active={activeFilter === 'mine'} label="Assigned to me" count={counts.mine || 0} onClick={() => setActiveFilter('mine')} />
        <FilterChip active={activeFilter === 'resolved'} label="Resolved" count={counts.resolved || 0} onClick={() => setActiveFilter('resolved')} />
        <FilterChip active={activeFilter === 'all'} label="All" count={counts.all || 0} onClick={() => setActiveFilter('all')} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-lg font-semibold">Inbox</h2>
            {loadingList ? <span className="text-xs text-slate-500">Refreshing...</span> : null}
          </div>
          <div className="mt-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search subject, tenant, or message preview"
            />
          </div>
          <div className="mt-3 grid gap-3">
            {filteredConversations.length ? (
              filteredConversations.map((conversation) => (
                <ConversationCard
                  key={conversation.id}
                  conversation={conversation}
                  selected={conversation.id === selectedConversationId}
                  onSelect={() => setSelectedConversationId(conversation.id)}
                />
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No conversations match this filter.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          {detail?.conversation ? (
            <>
              <div className="border-b border-slate-200 pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {detail.conversation.tenantKey}
                    </div>
                    <h2 className="m-0 mt-2 text-xl font-semibold text-slate-950">{detail.conversation.subject}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                      <span>Created {formatDateTime(detail.conversation.createdAt)}</span>
                      <span>&middot;</span>
                      <span>Last activity {formatRelative(detail.conversation.lastMessageAt)}</span>
                    </div>
                  </div>
                  <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-semibold', conversationMeta.toneClass)}>
                    {conversationMeta.label}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={assignedToCurrentAdmin ? 'secondary' : 'outline'}
                    onClick={assignToCurrentAdmin}
                    disabled={assignBusy}
                  >
                    {assignBusy ? 'Saving...' : assignedToCurrentAdmin ? 'Assigned to You' : 'Assign to Me'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={clearAssignment}
                    disabled={assignBusy || !detail.conversation.assignedAdminUserId}
                  >
                    Clear Assignment
                  </Button>
                  <Button
                    type="button"
                    variant={detail.conversation.status === 'resolved' ? 'outline' : 'secondary'}
                    onClick={() => updateConversationStatus(detail.conversation.status === 'resolved' ? 'waiting_on_support' : 'resolved')}
                    disabled={statusBusy}
                  >
                    {statusBusy ? 'Saving...' : detail.conversation.status === 'resolved' ? 'Reopen' : 'Resolve'}
                  </Button>
                </div>
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
                          {message.senderName || meta.fallbackLabel}
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
                    placeholder="Reply to the tenant from the support inbox."
                    rows={5}
                    maxLength={4000}
                  />
                  <div className="flex justify-end">
                    <Button type="button" onClick={sendReply} disabled={sending || !replyBody.trim()}>
                      {sending ? 'Sending...' : 'Send Reply'}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
              {loadingDetail ? 'Loading conversation...' : 'Select a support conversation from the inbox.'}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="m-0 text-lg font-semibold">Tenant context</h2>
          {detail?.tenantContext ? (
            <div className="mt-4 grid gap-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Tenant</div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {detail.tenantContext.name || detail.tenantContext.tenant_key || '-'}
                </div>
                <div className="mt-1 text-sm text-slate-500">{detail.tenantContext.tenant_key || '-'}</div>
              </div>
              <div className="grid gap-2 text-sm md:grid-cols-[120px_1fr] xl:grid-cols-1">
                <div className="text-slate-500">Owner</div><div>{detail.tenantContext.owner_name || detail.tenantContext.owner_email || '-'}</div>
                <div className="text-slate-500">Billing</div><div>{detail.tenantContext.billing_status || '-'}</div>
                <div className="text-slate-500">App access</div><div>{detail.tenantContext.app_access_status || '-'}</div>
                <div className="text-slate-500">Service access</div><div>{detail.tenantContext.service_access_status || '-'}</div>
                <div className="text-slate-500">Receptionist number</div><div>{detail.tenantContext.telnyx_voice_number || '-'}</div>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Recent calls</div>
                <div className="mt-2 grid gap-2">
                  {(Array.isArray(detail.tenantContext.recentCalls) ? detail.tenantContext.recentCalls : []).length ? (
                    detail.tenantContext.recentCalls.map((call) => (
                      <div key={call.call_sid} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs text-slate-500">{formatDateTime(call.created_at)}</div>
                          <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                            {callLeadLabel(call)}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-slate-700">{call.summary || 'No summary yet.'}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      No recent calls for this tenant.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Select a conversation to load tenant context.
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
