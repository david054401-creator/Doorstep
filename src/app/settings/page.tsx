'use client';

import { useState } from 'react';
import {
  ChevronRight,
  ExternalLink,
  Plus,
  Check,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { getInitials } from '@/lib/utils';

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
  brick: '#B8442E',
} as const;

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: on ? C.primary : C.mist,
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 200ms',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: C.white,
          transition: 'left 200ms',
          display: 'block',
          boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
        }}
      />
    </button>
  );
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function Section({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 20,
        border: `1px solid ${C.linen}`,
        boxShadow: '0 1px 3px rgba(26,23,20,0.05)',
        marginBottom: 12,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          padding: '14px 16px 10px 16px',
          borderBottom: `1px solid ${C.linen}`,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: C.stone,
            fontFamily: '"Inter", sans-serif',
          }}
        >
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

// ─── Tappable row ─────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  right,
  showChevron = true,
  last = false,
  onClick,
}: {
  label: string;
  value?: React.ReactNode;
  right?: React.ReactNode;
  showChevron?: boolean;
  last?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '15px 16px',
        borderBottom: last ? 'none' : `1px solid ${C.linen}`,
        cursor: onClick ? 'pointer' : 'default',
        gap: 12,
      }}
    >
      <span
        style={{
          fontSize: 15,
          color: C.ink,
          fontFamily: '"Inter", sans-serif',
          fontWeight: 400,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
        }}
      >
        {value && (
          <span
            style={{
              fontSize: 15,
              color: C.stone,
              fontFamily: '"Inter", sans-serif',
              textAlign: 'right' as const,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {value}
          </span>
        )}
        {right}
        {showChevron && (
          <ChevronRight size={16} color={C.mist} strokeWidth={2} style={{ flexShrink: 0 }} />
        )}
      </div>
    </div>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { currentUser } = useStore();

  // Notification toggles
  const [rentDayReminders, setRentDayReminders] = useState(true);
  const [latePaymentAlerts, setLatePaymentAlerts] = useState(true);
  const [maintenanceUpdates, setMaintenanceUpdates] = useState(true);
  const [monthlySummary, setMonthlySummary] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);

  // Referral copy state
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText('https://app.doorstep.com/refer/linda2024').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const initials = getInitials(currentUser.name);

  return (
    <div
      style={{
        backgroundColor: C.cream,
        minHeight: '100%',
        paddingBottom: 96,
      }}
    >
      <div
        style={{
          maxWidth: 600,
          margin: '0 auto',
          padding: '24px 16px 0',
        }}
      >
        {/* ─── Profile header ─────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingBottom: 28,
            gap: 10,
          }}
        >
          {/* Avatar */}
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: C.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: '"Fraunces", serif',
                fontSize: 28,
                fontWeight: 500,
                color: C.white,
                lineHeight: 1,
              }}
            >
              {initials}
            </span>
          </div>

          {/* Name */}
          <div
            style={{
              fontFamily: '"Fraunces", serif',
              fontSize: 24,
              fontWeight: 500,
              color: C.ink,
              textAlign: 'center',
              lineHeight: 1.2,
            }}
          >
            {currentUser.name}
          </div>

          {/* Email */}
          <div
            style={{
              fontSize: 16,
              color: C.stone,
              fontFamily: '"Inter", sans-serif',
              textAlign: 'center',
            }}
          >
            {currentUser.email}
          </div>

          {/* Plan pill + upgrade button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 2,
            }}
          >
            <span
              style={{
                background: C.primary50,
                color: C.primary,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: '"Inter", sans-serif',
                padding: '4px 12px',
                borderRadius: 20,
              }}
            >
              Starter plan
            </span>
            <button
              type="button"
              style={{
                background: C.primary,
                color: C.white,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: '"Inter", sans-serif',
                border: 'none',
                borderRadius: 20,
                padding: '5px 14px',
                cursor: 'pointer',
              }}
            >
              Upgrade
            </button>
          </div>
        </div>

        {/* ─── About me ───────────────────────────────────────────────────── */}
        <Section title="About me">
          <Row label="My name" value={currentUser.name} onClick={() => {}} />
          <Row label="Phone number" value={currentUser.phone ?? 'Add phone'} onClick={() => {}} />
          <Row label="Email" value={currentUser.email} onClick={() => {}} />
          <Row label="Change password" last onClick={() => {}} />
        </Section>

        {/* ─── How I get paid ─────────────────────────────────────────────── */}
        <Section title="How I get paid">
          <Row
            label="Chase checking ···4821"
            right={
              <span
                style={{
                  background: C.mossBg,
                  color: C.moss,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: '"Inter", sans-serif',
                  padding: '3px 10px',
                  borderRadius: 20,
                  flexShrink: 0,
                }}
              >
                Connected
              </span>
            }
            onClick={() => {}}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '14px 16px',
              cursor: 'pointer',
            }}
          >
            <Plus size={15} color={C.primary} strokeWidth={2.5} />
            <span
              style={{
                fontSize: 15,
                color: C.primary,
                fontFamily: '"Inter", sans-serif',
                fontWeight: 500,
              }}
            >
              Connect another bank
            </span>
          </div>
        </Section>

        {/* ─── Who else can see this ──────────────────────────────────────── */}
        <Section title="Who else can see this">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '15px 16px',
              borderBottom: `1px solid ${C.linen}`,
              gap: 12,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 15,
                  color: C.ink,
                  fontFamily: '"Inter", sans-serif',
                  marginBottom: 2,
                }}
              >
                Add your spouse or accountant
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: C.stone,
                  fontFamily: '"Inter", sans-serif',
                }}
              >
                Give read-only access
              </div>
            </div>
            <button
              type="button"
              style={{
                background: 'transparent',
                color: C.primary,
                border: `1.5px solid ${C.primary}`,
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: '"Inter", sans-serif',
                padding: '5px 14px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Invite
            </button>
          </div>
          <div
            style={{
              padding: '13px 16px',
              fontSize: 14,
              color: C.stone,
              fontFamily: '"Inter", sans-serif',
              fontStyle: 'italic',
            }}
          >
            No co-owners yet
          </div>
        </Section>

        {/* ─── Reminders & notifications ──────────────────────────────────── */}
        <Section title="Reminders & notifications">
          {[
            { label: 'Rent day reminders', value: rentDayReminders, set: setRentDayReminders },
            { label: 'Late payment alerts', value: latePaymentAlerts, set: setLatePaymentAlerts },
            { label: 'Maintenance updates', value: maintenanceUpdates, set: setMaintenanceUpdates },
            { label: 'Monthly summary email', value: monthlySummary, set: setMonthlySummary },
            { label: 'SMS notifications', value: smsNotifications, set: setSmsNotifications, last: true },
          ].map(({ label, value, set, last }) => (
            <div
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '15px 16px',
                borderBottom: last ? 'none' : `1px solid ${C.linen}`,
              }}
            >
              <span
                style={{
                  fontSize: 15,
                  color: C.ink,
                  fontFamily: '"Inter", sans-serif',
                }}
              >
                {label}
              </span>
              <Toggle on={value} onToggle={() => set((v) => !v)} />
            </div>
          ))}
        </Section>

        {/* ─── My subscription ────────────────────────────────────────────── */}
        <Section title="My subscription">
          <div
            style={{
              padding: '15px 16px',
              borderBottom: `1px solid ${C.linen}`,
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: C.ink,
                fontFamily: '"Inter", sans-serif',
                marginBottom: 3,
              }}
            >
              Starter — $12/mo per unit
            </div>
            <div
              style={{
                fontSize: 14,
                color: C.stone,
                fontFamily: '"Inter", sans-serif',
              }}
            >
              Units: 2
            </div>
          </div>
          <Row label="Manage subscription" onClick={() => {}} />
          <Row label="View billing history" last onClick={() => {}} />
        </Section>

        {/* ─── Help & support ─────────────────────────────────────────────── */}
        <Section title="Help & support">
          <Row
            label="Help center"
            showChevron={false}
            right={<ExternalLink size={15} color={C.mist} strokeWidth={2} />}
            onClick={() => {}}
          />
          <Row
            label="Contact us"
            showChevron={false}
            right={<ExternalLink size={15} color={C.mist} strokeWidth={2} />}
            onClick={() => {}}
          />
          <Row label="What's new" last onClick={() => {}} />
        </Section>

        {/* ─── Refer a friend ─────────────────────────────────────────────── */}
        <div
          style={{
            background: C.primary,
            borderRadius: 20,
            border: `1px solid ${C.primary}`,
            boxShadow: '0 1px 3px rgba(26,23,20,0.05)',
            marginBottom: 12,
            padding: '22px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              fontFamily: '"Fraunces", serif',
              fontSize: 20,
              fontWeight: 500,
              color: C.white,
            }}
          >
            Get a free month
          </div>
          <div
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.85)',
              fontFamily: '"Inter", sans-serif',
              lineHeight: 1.5,
            }}
          >
            Share your referral link and both of you get a free month when they sign up.
          </div>
          <button
            type="button"
            onClick={handleCopyLink}
            style={{
              background: C.white,
              color: C.primary,
              border: 'none',
              borderRadius: 12,
              padding: '11px 20px',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: '"Inter", sans-serif',
              cursor: 'pointer',
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 2,
              transition: 'opacity 150ms',
            }}
          >
            {copied ? (
              <>
                <Check size={14} strokeWidth={2.5} />
                Link copied! ✓
              </>
            ) : (
              'Copy referral link'
            )}
          </button>
        </div>

        {/* ─── Sign out ───────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '20px 0 8px',
          }}
        >
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: C.brick,
              fontSize: 16,
              fontFamily: '"Inter", sans-serif',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '8px 24px',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
