'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  PencilLine,
  Search,
  ChevronLeft,
  Phone,
  ArrowUp,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { formatRelativeTime, getInitials } from '@/lib/utils';
import type { Message } from '@/lib/types';

/* ─── Brand tokens ─── */
const C = {
  primary: '#C75D3D',
  primary50: '#FDF1EB',
  ink: '#1A1714',
  charcoal: '#3D362F',
  stone: '#6B6058',
  mist: '#A8A099',
  linen: '#E8E3DC',
  cream: '#F5F1EA',
  white: '#FFFFFF',
  moss: '#5C8A3A',
  mossBg: '#EEF4E5',
  sky: '#4A7C9E',
  skyBg: '#E5EEF5',
  honey: '#D4923B',
  honeyBg: '#FBF1E0',
  brick: '#B8442E',
};

/* ─── Avatar colors per tenant index ─── */
const AVATAR_COLORS = [C.primary, C.moss, C.sky, C.honey, C.brick];

/* ─── Template messages ─── */
const TEMPLATES: { label: string; body: string }[] = [
  {
    label: 'Rent reminder',
    body: 'Hi, just a friendly reminder that rent is due on the 1st. Please let me know if you have any questions. Thanks!',
  },
  {
    label: 'Late notice',
    body: "Hi, I noticed rent hasn't been received yet. Please send payment as soon as possible. A late fee may apply. Let me know if there's an issue.",
  },
  {
    label: 'Lease renewal',
    body: "Hi, your lease is coming up for renewal soon. I'd love to continue our rental arrangement — let's connect to discuss the new terms. When works for you?",
  },
  {
    label: 'Maintenance update',
    body: "Hi, I wanted to update you that the maintenance issue you reported is being addressed. I've scheduled a contractor and they'll be in touch shortly.",
  },
];

/* ─── AI Suggested replies ─── */
const AI_SUGGESTIONS = [
  "On it! I'll get a contractor scheduled.",
  'Can you send me a photo of the issue?',
  "I'll check on this tomorrow.",
];

/* ─── Helpers ─── */
function dateSeparatorLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDay.getTime() === today.getTime()) return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatBubbleTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/* ─── Thread List View ─── */
function ThreadList({
  onSelectTenant,
  searchQuery,
  onSearchChange,
  onCompose,
}: {
  onSelectTenant: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onCompose: () => void;
}) {
  const tenants = useStore((s) => s.tenants);
  const messages = useStore((s) => s.messages);
  const properties = useStore((s) => s.properties);

  /* Build thread summaries: one per tenant that has messages */
  const threads = tenants
    .map((tenant, idx) => {
      const tenantMsgs = messages
        .filter((m) => m.tenantId === tenant.id)
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
      const lastMsg = tenantMsgs[0] ?? null;
      const unreadCount = tenantMsgs.filter((m) => !m.read && m.sender === 'tenant').length;
      const property = properties.find((p) => p.id === tenant.propertyId);
      return { tenant, lastMsg, unreadCount, property, avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length] };
    })
    .filter(({ lastMsg, tenant }) => {
      if (!lastMsg) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        tenant.name.toLowerCase().includes(q) ||
        (lastMsg?.content ?? '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const ta = a.lastMsg ? new Date(a.lastMsg.sentAt).getTime() : 0;
      const tb = b.lastMsg ? new Date(b.lastMsg.sentAt).getTime() : 0;
      return tb - ta;
    });

  return (
    <div style={{ backgroundColor: C.cream, minHeight: '100vh', paddingBottom: 96 }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 16px 12px',
          }}
        >
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 28,
              color: C.ink,
              margin: 0,
              fontWeight: 500,
            }}
          >
            Messages
          </h1>
          <button
            onClick={onCompose}
            aria-label="Compose new message"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.primary,
              padding: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PencilLine size={22} strokeWidth={1.8} />
          </button>
        </div>

        {/* Search bar */}
        <div style={{ padding: '0 16px 12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: C.cream,
              border: `1.5px solid ${C.linen}`,
              borderRadius: 12,
              height: 40,
              paddingLeft: 12,
              paddingRight: 12,
            }}
          >
            <Search size={16} color={C.mist} strokeWidth={2} style={{ flexShrink: 0 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search messages"
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: 15,
                color: C.ink,
              }}
            />
          </div>
        </div>

        {/* Thread list */}
        {threads.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 80,
              gap: 12,
              textAlign: 'center',
              color: C.stone,
            }}
          >
            <MessageSquare size={48} color={C.mist} strokeWidth={1.2} />
            <p style={{ fontSize: 16, margin: 0, fontWeight: 500, color: C.charcoal }}>
              {searchQuery ? 'No results found' : 'Your conversations will appear here'}
            </p>
            {!searchQuery && (
              <p style={{ fontSize: 14, margin: 0, color: C.stone }}>
                Start messaging your tenants to get started.
              </p>
            )}
          </div>
        ) : (
          <div
            style={{
              backgroundColor: C.white,
              borderRadius: 0,
            }}
          >
            {threads.map(({ tenant, lastMsg, unreadCount, property, avatarColor }, i) => (
              <button
                key={tenant.id}
                onClick={() => onSelectTenant(tenant.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  minHeight: 72,
                  padding: '12px 16px',
                  gap: 12,
                  background: 'none',
                  border: 'none',
                  borderBottom: i < threads.length - 1 ? `1px solid ${C.linen}` : 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  boxSizing: 'border-box',
                }}
              >
                {/* Avatar */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      backgroundColor: avatarColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: C.white,
                      fontFamily: 'Fraunces, serif',
                      fontSize: 18,
                      fontWeight: 500,
                    }}
                  >
                    {getInitials(tenant.name)}
                  </div>
                  {unreadCount > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: C.brick,
                        border: `2px solid ${C.white}`,
                      }}
                    />
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: unreadCount > 0 ? 700 : 400,
                        color: C.ink,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 160,
                      }}
                    >
                      {tenant.name}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, color: C.stone }}>
                        {lastMsg ? formatRelativeTime(lastMsg.sentAt) : ''}
                      </span>
                      {unreadCount > 0 && (
                        <div
                          style={{
                            backgroundColor: C.primary,
                            color: C.white,
                            borderRadius: 10,
                            minWidth: 18,
                            height: 18,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '0 5px',
                          }}
                        >
                          {unreadCount}
                        </div>
                      )}
                    </div>
                  </div>
                  <p
                    style={{
                      fontSize: 14,
                      color: C.stone,
                      margin: '0 0 2px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {lastMsg?.content ?? ''}
                  </p>
                  <p style={{ fontSize: 12, color: C.mist, margin: 0 }}>
                    {property?.name ?? ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Single Thread View ─── */
function ThreadView({
  tenantId,
  onBack,
}: {
  tenantId: string;
  onBack: () => void;
}) {
  const tenants = useStore((s) => s.tenants);
  const properties = useStore((s) => s.properties);
  const messages = useStore((s) => s.messages);
  const addMessage = useStore((s) => s.addMessage);
  const markMessageRead = useStore((s) => s.markMessageRead);

  const tenant = tenants.find((t) => t.id === tenantId);
  const property = properties.find((p) => p.id === tenant?.propertyId);
  const tenantIndex = tenants.findIndex((t) => t.id === tenantId);
  const avatarColor = AVATAR_COLORS[tenantIndex % AVATAR_COLORS.length];

  const threadMessages: Message[] = messages
    .filter((m) => m.tenantId === tenantId)
    .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

  const [inputText, setInputText] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [maintenanceBanner, setMaintenanceBanner] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const templatesRef = useRef<HTMLDivElement>(null);

  // Combine store messages with locally added messages
  const allMessages: Message[] = [
    ...threadMessages,
    ...localMessages,
  ].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

  // Mark unread tenant messages as read on mount
  useEffect(() => {
    threadMessages.forEach((m) => {
      if (!m.read && m.sender === 'tenant') {
        markMessageRead(m.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Check for maintenance keywords in most recent tenant message
  useEffect(() => {
    const lastTenantMsg = [...allMessages]
      .reverse()
      .find((m) => m.sender === 'tenant');
    if (lastTenantMsg) {
      const content = lastTenantMsg.content.toLowerCase();
      setMaintenanceBanner(content.includes('heater') || content.includes('heat'));
    } else {
      setMaintenanceBanner(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMessages.length]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages.length]);

  // Close templates popover on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) {
        setShowTemplates(false);
      }
    }
    if (showTemplates) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTemplates]);

  // Auto-resize textarea
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputText(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
  }

  function applyTemplate(body: string) {
    setInputText(body);
    setShowTemplates(false);
    textareaRef.current?.focus();
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height =
          Math.min(textareaRef.current.scrollHeight, 80) + 'px';
      }
    }, 0);
  }

  function applySuggestion(text: string) {
    setInputText(text);
    textareaRef.current?.focus();
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height =
          Math.min(textareaRef.current.scrollHeight, 80) + 'px';
      }
    }, 0);
  }

  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;
    const newMsg: Message = {
      id: `msg-local-${Date.now()}`,
      tenantId,
      content: inputText.trim(),
      sender: 'landlord',
      sentAt: new Date().toISOString(),
      read: true,
      channel: 'app',
    };
    addMessage(newMsg);
    setLocalMessages((prev) => [...prev, newMsg]);
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [inputText, tenantId, addMessage]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Determine if we should show AI suggestions
  const lastMsg = allMessages[allMessages.length - 1];
  const showSuggestions = lastMsg?.sender === 'tenant';

  if (!tenant) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: C.stone }}>
        Tenant not found.
      </div>
    );
  }

  /* Build grouped messages with date separators */
  type RenderedItem =
    | { type: 'separator'; label: string; key: string }
    | { type: 'message'; message: Message; key: string };

  const renderedItems: RenderedItem[] = [];
  allMessages.forEach((msg, idx) => {
    const prevMsg = allMessages[idx - 1];
    if (!prevMsg || !isSameDay(prevMsg.sentAt, msg.sentAt)) {
      renderedItems.push({
        type: 'separator',
        label: dateSeparatorLabel(msg.sentAt),
        key: `sep-${msg.sentAt}-${idx}`,
      });
    }
    renderedItems.push({ type: 'message', message: msg, key: msg.id });
  });

  return (
    <div
      style={{
        backgroundColor: C.cream,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      {/* Sticky header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: C.white,
          borderBottom: `1px solid ${C.linen}`,
          display: 'flex',
          alignItems: 'center',
          padding: '10px 12px',
          gap: 8,
          minHeight: 60,
        }}
      >
        {/* Back button */}
        <button
          onClick={onBack}
          aria-label="Back to messages"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: C.primary,
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ChevronLeft size={32} strokeWidth={1.8} />
        </button>

        {/* Avatar + name (centered) */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: avatarColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.white,
                fontFamily: 'Fraunces, serif',
                fontSize: 13,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {getInitials(tenant.name)}
            </div>
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: C.ink,
                fontFamily: 'Fraunces, serif',
              }}
            >
              {tenant.name}
            </span>
          </div>
          {property && (
            <span style={{ fontSize: 12, color: C.mist }}>{property.name}</span>
          )}
        </div>

        {/* Phone button */}
        <a
          href={`tel:${tenant.phone}`}
          aria-label={`Call ${tenant.name}`}
          style={{
            color: C.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 4,
            flexShrink: 0,
          }}
        >
          <Phone size={22} strokeWidth={1.8} />
        </a>
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 16px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          paddingBottom: showSuggestions ? 220 : 160,
        }}
      >
        {/* Maintenance banner */}
        {maintenanceBanner && (
          <div
            style={{
              backgroundColor: C.honeyBg,
              border: `1px solid ${C.honey}`,
              borderRadius: 10,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: C.charcoal,
              marginBottom: 4,
            }}
          >
            <Wrench size={15} color={C.honey} strokeWidth={2} style={{ flexShrink: 0 }} />
            <span>Maintenance request created</span>
          </div>
        )}

        {renderedItems.map((item) => {
          if (item.type === 'separator') {
            return (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '8px 0 4px',
                }}
              >
                <span style={{ fontSize: 12, color: C.stone }}>{item.label}</span>
              </div>
            );
          }

          const msg = item.message;
          const isLandlord = msg.sender === 'landlord';

          return (
            <div
              key={item.key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isLandlord ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '75%',
                  backgroundColor: isLandlord ? C.primary : C.cream,
                  color: isLandlord ? C.white : C.charcoal,
                  padding: '10px 14px',
                  borderRadius: 16,
                  borderBottomRightRadius: isLandlord ? 0 : 16,
                  borderBottomLeftRadius: isLandlord ? 16 : 0,
                  fontSize: 14,
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}
              >
                {msg.content}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: C.stone,
                  marginTop: 3,
                  paddingLeft: isLandlord ? 0 : 4,
                  paddingRight: isLandlord ? 4 : 0,
                }}
              >
                {formatBubbleTime(msg.sentAt)}
              </span>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Fixed input area */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: C.white,
          borderTop: `1px solid ${C.linen}`,
          zIndex: 20,
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        }}
      >
        {/* AI Suggestions */}
        {showSuggestions && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '10px 12px 0',
              overflowX: 'auto',
              scrollbarWidth: 'none',
            }}
          >
            {AI_SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => applySuggestion(s)}
                style={{
                  flexShrink: 0,
                  backgroundColor: C.white,
                  border: `1.5px solid ${C.linen}`,
                  borderRadius: 10,
                  padding: '6px 12px',
                  fontSize: 13,
                  color: C.stone,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.4,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: '10px 12px 16px',
            position: 'relative',
          }}
        >
          {/* Templates button */}
          <div ref={templatesRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowTemplates((v) => !v)}
              style={{
                height: 40,
                padding: '0 12px',
                borderRadius: 10,
                border: `1.5px solid ${C.linen}`,
                backgroundColor: showTemplates ? C.primary50 : C.white,
                color: showTemplates ? C.primary : C.stone,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              Templates
              <span style={{ fontSize: 10, marginTop: 1 }}>▾</span>
            </button>

            {/* Templates popover */}
            {showTemplates && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 48,
                  left: 0,
                  backgroundColor: C.white,
                  border: `1px solid ${C.linen}`,
                  borderRadius: 12,
                  boxShadow: '0 4px 20px rgba(26,23,20,0.12)',
                  zIndex: 30,
                  minWidth: 200,
                  overflow: 'hidden',
                }}
              >
                {TEMPLATES.map((tmpl, i) => (
                  <button
                    key={tmpl.label}
                    onClick={() => applyTemplate(tmpl.body)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '12px 16px',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      borderBottom: i < TEMPLATES.length - 1 ? `1px solid ${C.linen}` : 'none',
                      fontSize: 14,
                      color: C.charcoal,
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {tmpl.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Text area */}
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              border: `1.5px solid ${C.linen}`,
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 15,
              color: C.ink,
              backgroundColor: C.cream,
              outline: 'none',
              lineHeight: 1.5,
              overflowY: 'hidden',
              minHeight: 40,
              maxHeight: 80,
              fontFamily: 'inherit',
            }}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            aria-label="Send message"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              backgroundColor: inputText.trim() ? C.primary : C.linen,
              border: 'none',
              cursor: inputText.trim() ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background-color 0.15s ease',
            }}
          >
            <ArrowUp size={18} color={inputText.trim() ? C.white : C.mist} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ─── */
export default function MessagesPage() {
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  function handleSelectTenant(id: string) {
    setSelectedTenantId(id);
    setSearchQuery('');
  }

  function handleBack() {
    setSelectedTenantId(null);
  }

  function handleCompose() {
    // Placeholder: could open a new-conversation sheet in future
  }

  if (selectedTenantId) {
    return <ThreadView tenantId={selectedTenantId} onBack={handleBack} />;
  }

  return (
    <ThreadList
      onSelectTenant={handleSelectTenant}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onCompose={handleCompose}
    />
  );
}
