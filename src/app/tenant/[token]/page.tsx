'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign,
  CreditCard,
  FileText,
  Check,
  Wrench,
  Home,
  Receipt,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

// ─── Brand colors ─────────────────────────────────────────────────────────────

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
} as const;

// ─── Mock tenant data ─────────────────────────────────────────────────────────

const mockTenant = {
  name: 'Sarah Johnson',
  landlordName: 'Linda Morrison',
  property: '123 Elm St, Apt 2',
  rent: 1200,
  dueDate: 'March 1, 2024',
  status: 'due' as 'due' | 'paid',
};

// ─── Mock payment history ─────────────────────────────────────────────────────

const mockHistory = [
  { id: 'h1', amount: 1200, date: '2024-02-01', label: 'February 2024' },
  { id: 'h2', amount: 1200, date: '2024-01-01', label: 'January 2024' },
  { id: 'h3', amount: 1200, date: '2023-12-01', label: 'December 2023' },
];

// ─── Confetti dots ────────────────────────────────────────────────────────────

const confettiColors = ['#C75D3D', '#5C8A3A', '#D4923B', '#4A7C9E', '#9B59B6'];

function Confetti({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 50,
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: '-10px',
            left: `${5 + (i * 5) % 90}%`,
            width: 10,
            height: 10,
            borderRadius: i % 2 === 0 ? '50%' : '2px',
            background: confettiColors[i % confettiColors.length],
            animation: `confettiFall ${0.8 + (i % 5) * 0.2}s ease-in ${(i % 4) * 0.1}s forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes confettiFall {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Loading shimmer ──────────────────────────────────────────────────────────

function ProcessingState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        padding: '32px 0',
      }}
    >
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          border: `4px solid ${C.linen}`,
          borderTopColor: C.primary,
          animation: 'spin 0.9s linear infinite',
        }}
      />
      <div
        style={{
          fontSize: 16,
          color: C.stone,
          fontFamily: '"Inter", sans-serif',
        }}
      >
        Processing your payment…
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ─── Success state ────────────────────────────────────────────────────────────

function SuccessState({ method }: { method: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '24px 0',
        textAlign: 'center',
      }}
    >
      {/* Big green checkmark */}
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: C.mossBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Check size={32} color={C.moss} strokeWidth={2.5} />
      </div>

      <div
        style={{
          fontFamily: '"Fraunces", serif',
          fontSize: 28,
          fontWeight: 500,
          color: C.ink,
        }}
      >
        Payment sent! 🎉
      </div>

      <div
        style={{
          fontSize: 16,
          color: C.stone,
          fontFamily: '"Inter", sans-serif',
        }}
      >
        Your landlord has been notified.
      </div>

      <div
        style={{
          fontSize: 14,
          color: C.ink,
          fontFamily: '"Inter", sans-serif',
          fontWeight: 500,
        }}
      >
        Paid {formatCurrency(mockTenant.rent)} via {method}
      </div>
    </div>
  );
}

// ─── Maintenance tab ──────────────────────────────────────────────────────────

function MaintenanceTab() {
  const [issue, setIssue] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'urgent'>('medium');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!issue.trim()) return;
    setSubmitted(true);
    setIssue('');
    setTimeout(() => setSubmitted(false), 3000);
  };

  const priorities: Array<{ value: 'low' | 'medium' | 'urgent'; label: string }> = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'urgent', label: 'Urgent' },
  ];

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          fontFamily: '"Fraunces", serif',
          fontSize: 20,
          fontWeight: 500,
          color: C.ink,
        }}
      >
        Report an issue
      </div>

      <div>
        <label
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            color: C.charcoal,
            fontFamily: '"Inter", sans-serif',
            marginBottom: 6,
          }}
        >
          What&apos;s the issue?
        </label>
        <textarea
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder="Describe the problem…"
          rows={4}
          style={{
            width: '100%',
            border: `1.5px solid ${C.linen}`,
            borderRadius: 12,
            padding: '10px 14px',
            fontSize: 15,
            color: C.ink,
            backgroundColor: C.white,
            fontFamily: '"Inter", sans-serif',
            outline: 'none',
            boxSizing: 'border-box',
            resize: 'vertical',
          }}
        />
      </div>

      <div>
        <label
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            color: C.charcoal,
            fontFamily: '"Inter", sans-serif',
            marginBottom: 8,
          }}
        >
          Priority
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {priorities.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPriority(p.value)}
              style={{
                padding: '7px 18px',
                borderRadius: 20,
                border: `1.5px solid ${priority === p.value ? C.primary : C.linen}`,
                background: priority === p.value ? C.primary50 : C.white,
                color: priority === p.value ? C.primary : C.stone,
                fontWeight: priority === p.value ? 600 : 400,
                fontSize: 14,
                fontFamily: '"Inter", sans-serif',
                cursor: 'pointer',
                transition: 'all 150ms',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {submitted && (
        <div
          style={{
            background: C.mossBg,
            color: C.moss,
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: '"Inter", sans-serif',
            textAlign: 'center',
          }}
        >
          ✓ Request sent to your landlord
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        style={{
          width: '100%',
          padding: '14px',
          borderRadius: 12,
          background: C.primary,
          color: C.white,
          fontSize: 16,
          fontWeight: 700,
          fontFamily: '"Inter", sans-serif',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Submit request
      </button>
    </div>
  );
}

// ─── Documents tab ────────────────────────────────────────────────────────────

function DocumentsTab() {
  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          fontFamily: '"Fraunces", serif',
          fontSize: 20,
          fontWeight: 500,
          color: C.ink,
        }}
      >
        Your documents
      </div>

      {/* Lease Agreement */}
      <div
        style={{
          background: C.white,
          border: `1px solid ${C.linen}`,
          borderRadius: 16,
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: C.primary50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FileText size={20} color={C.primary} strokeWidth={2} />
          </div>
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: C.ink,
                fontFamily: '"Inter", sans-serif',
              }}
            >
              Lease Agreement
            </div>
            <div
              style={{
                fontSize: 13,
                color: C.stone,
                fontFamily: '"Inter", sans-serif',
                marginTop: 2,
              }}
            >
              PDF · Signed Jan 2024
            </div>
          </div>
        </div>
        <button
          type="button"
          style={{
            background: C.primary,
            color: C.white,
            border: 'none',
            borderRadius: 20,
            padding: '6px 16px',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: '"Inter", sans-serif',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          View
        </button>
      </div>

      {/* Payment history */}
      <div
        style={{
          background: C.white,
          border: `1px solid ${C.linen}`,
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${C.linen}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Receipt size={18} color={C.primary} strokeWidth={2} />
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: C.ink,
              fontFamily: '"Inter", sans-serif',
            }}
          >
            Payment history
          </span>
        </div>
        {mockHistory.map((item, idx) => (
          <div
            key={item.id}
            style={{
              padding: '13px 16px',
              borderBottom: idx < mockHistory.length - 1 ? `1px solid ${C.linen}` : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: C.ink,
                  fontFamily: '"Inter", sans-serif',
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: C.stone,
                  fontFamily: '"Inter", sans-serif',
                  marginTop: 1,
                }}
              >
                {formatDate(item.date)}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: C.moss,
                  fontFamily: '"Inter", sans-serif',
                }}
              >
                {formatCurrency(item.amount)}
              </span>
              <span
                style={{
                  background: C.mossBg,
                  color: C.moss,
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: '"Inter", sans-serif',
                  padding: '2px 8px',
                  borderRadius: 20,
                }}
              >
                Paid
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tenant portal page ───────────────────────────────────────────────────────

type Tab = 'pay' | 'maintenance' | 'documents';
type PayState = 'idle' | 'processing' | 'success';

export default function TenantPortalPage() {
  const [activeTab, setActiveTab] = useState<Tab>('pay');
  const [selectedMethod, setSelectedMethod] = useState<'bank' | 'card'>('bank');
  const [payState, setPayState] = useState<PayState>('idle');
  const [showConfetti, setShowConfetti] = useState(false);

  const tenant = mockTenant;

  const handlePay = () => {
    setPayState('processing');
    setTimeout(() => {
      setPayState('success');
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
    }, 1500);
  };

  const paymentMethods = [
    {
      id: 'bank' as const,
      icon: <DollarSign size={20} color={selectedMethod === 'bank' ? C.primary : C.stone} strokeWidth={2} />,
      label: 'Bank transfer',
      badge: 'Free',
      desc: '2 business days',
    },
    {
      id: 'card' as const,
      icon: <CreditCard size={20} color={selectedMethod === 'card' ? C.primary : C.stone} strokeWidth={2} />,
      label: 'Credit or debit card',
      badge: '2.9% fee',
      desc: 'Instant',
    },
  ];

  const tabs: Array<{ id: Tab; emoji: string; label: string }> = [
    { id: 'pay', emoji: '🏠', label: 'Pay rent' },
    { id: 'maintenance', emoji: '🔧', label: 'Maintenance' },
    { id: 'documents', emoji: '📄', label: 'Documents' },
  ];

  return (
    <>
      <Confetti visible={showConfetti} />

      <div
        style={{
          background: C.white,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Inner width container */}
        <div
          style={{
            width: '100%',
            maxWidth: 480,
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
          }}
        >
          {/* ─── Top bar ─────────────────────────────────────────────────── */}
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              borderBottom: `1px solid ${C.linen}`,
            }}
          >
            <span
              style={{
                fontFamily: '"Fraunces", serif',
                fontSize: 22,
                fontWeight: 600,
                color: C.primary,
              }}
            >
              Doorstep
            </span>
          </div>

          {/* ─── Scroll content ───────────────────────────────────────────── */}
          <div style={{ flex: 1, padding: '0 16px 100px', overflowY: 'auto' }}>
            {/* Greeting */}
            <div
              style={{
                fontFamily: '"Fraunces", serif',
                fontSize: 32,
                fontWeight: 500,
                color: C.ink,
                textAlign: 'center',
                padding: '28px 0 20px',
              }}
            >
              Hi {tenant.name.split(' ')[0]} 👋
            </div>

            {/* ─── Tab content ─────────────────────────────────────────────── */}
            {activeTab === 'pay' && (
              <>
                {/* Payment card */}
                <div
                  style={{
                    background: C.primary,
                    borderRadius: 24,
                    padding: 24,
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      color: 'rgba(255,255,255,0.8)',
                      fontFamily: '"Inter", sans-serif',
                    }}
                  >
                    Your rent for March
                  </div>

                  <div
                    style={{
                      fontFamily: '"Fraunces", serif',
                      fontSize: 48,
                      fontWeight: 500,
                      color: C.white,
                      fontFeatureSettings: '"tnum"',
                      lineHeight: 1.1,
                    }}
                  >
                    {formatCurrency(tenant.rent)}
                  </div>

                  <div
                    style={{
                      fontSize: 14,
                      color: 'rgba(255,255,255,0.8)',
                      fontFamily: '"Inter", sans-serif',
                      marginBottom: 8,
                    }}
                  >
                    Due {tenant.dueDate}
                  </div>

                  {payState === 'idle' && tenant.status === 'due' && (
                    <div style={{ width: '100%', marginTop: 4 }}>
                      {/* Payment method selection */}
                      <div
                        style={{
                          display: 'flex',
                          gap: 10,
                          marginBottom: 12,
                        }}
                      >
                        {paymentMethods.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setSelectedMethod(m.id)}
                            style={{
                              flex: 1,
                              background: C.white,
                              border: `2px solid ${selectedMethod === m.id ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.25)'}`,
                              borderRadius: 16,
                              padding: '12px 10px',
                              cursor: 'pointer',
                              textAlign: 'center',
                              transition: 'all 150ms',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'center',
                                marginBottom: 4,
                              }}
                            >
                              {m.icon}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: C.ink,
                                fontFamily: '"Inter", sans-serif',
                                marginBottom: 2,
                              }}
                            >
                              {m.label}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: selectedMethod === m.id ? C.primary : C.stone,
                                fontFamily: '"Inter", sans-serif',
                                fontWeight: selectedMethod === m.id ? 700 : 400,
                              }}
                            >
                              {m.badge}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: C.mist,
                                fontFamily: '"Inter", sans-serif',
                              }}
                            >
                              {m.desc}
                            </div>
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={handlePay}
                        style={{
                          width: '100%',
                          background: C.white,
                          color: C.primary,
                          border: 'none',
                          borderRadius: 12,
                          padding: '15px',
                          fontSize: 16,
                          fontWeight: 700,
                          fontFamily: '"Inter", sans-serif',
                          cursor: 'pointer',
                        }}
                      >
                        Pay now
                      </button>
                    </div>
                  )}

                  {payState === 'processing' && <ProcessingState />}

                  {payState === 'success' && (
                    <SuccessState
                      method={selectedMethod === 'bank' ? 'Bank Transfer' : 'Credit Card'}
                    />
                  )}

                  {tenant.status === 'paid' && payState === 'idle' && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        color: C.mossBg,
                        fontSize: 15,
                        fontFamily: '"Inter", sans-serif',
                        fontWeight: 600,
                      }}
                    >
                      <Check size={18} color={C.mossBg} strokeWidth={2.5} />
                      Paid on Feb 28 ✓
                    </div>
                  )}
                </div>

                {/* Property info strip */}
                <div
                  style={{
                    background: C.cream,
                    borderRadius: 14,
                    padding: '12px 16px',
                    fontSize: 14,
                    color: C.stone,
                    fontFamily: '"Inter", sans-serif',
                    textAlign: 'center',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontWeight: 600, color: C.charcoal }}>{tenant.property}</span>
                  {' · '}
                  Managed by {tenant.landlordName}
                </div>
              </>
            )}

            {activeTab === 'maintenance' && <MaintenanceTab />}
            {activeTab === 'documents' && <DocumentsTab />}
          </div>

          {/* ─── Bottom tabs ─────────────────────────────────────────────── */}
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              background: C.white,
              borderTop: `1px solid ${C.linen}`,
              display: 'flex',
              justifyContent: 'center',
              zIndex: 20,
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 480,
                display: 'flex',
              }}
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      flex: 1,
                      padding: '12px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      borderTop: isActive ? `2px solid ${C.primary}` : '2px solid transparent',
                      transition: 'border-color 150ms',
                    }}
                  >
                    <span style={{ fontSize: 20, lineHeight: 1 }}>{tab.emoji}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: '"Inter", sans-serif',
                        fontWeight: isActive ? 700 : 400,
                        color: isActive ? C.primary : C.stone,
                        transition: 'color 150ms',
                      }}
                    >
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
