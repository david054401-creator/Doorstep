'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Check, Lock, Shield } from 'lucide-react';
import Link from 'next/link';

// ─── Brand tokens ──────────────────────────────────────────────────────────
const C = {
  hearth: '#C75D3D',
  hearthHover: '#A84A2E',
  hearth100: '#F4C9B8',
  hearth50: '#FDF1EB',
  ink: '#1A1714',
  charcoal: '#3D362F',
  stone: '#6B6058',
  mist: '#A8A099',
  linen: '#E8E3DC',
  cream: '#F5F1EA',
  white: '#FFFFFF',
  moss: '#5C8A3A',
  mossBg: '#EEF4E5',
  honey: '#D4A017',
} as const;

const TOTAL_STEPS = 6;

// ─── Step transition variants ───────────────────────────────────────────────
const stepVariants = {
  initial: { opacity: 0, x: 40 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -40 },
};
const stepTransition = { duration: 0.25 };

// ─── Shared input style ─────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  borderRadius: 12,
  border: `1.5px solid ${C.linen}`,
  backgroundColor: C.white,
  fontSize: 16,
  color: C.ink,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: C.charcoal,
  marginBottom: 6,
  letterSpacing: '0.02em',
};

const optionalLabelStyle: React.CSSProperties = {
  ...labelStyle,
  fontWeight: 400,
  color: C.stone,
};

// ─── Primary button ─────────────────────────────────────────────────────────
function PrimaryButton({
  children,
  onClick,
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        padding: '16px 24px',
        borderRadius: 14,
        border: 'none',
        backgroundColor: hovered ? C.hearthHover : C.hearth,
        color: C.white,
        fontSize: 17,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background-color 0.18s ease',
        letterSpacing: '0.01em',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

// ─── Animated house SVG ─────────────────────────────────────────────────────
function HouseSVG() {
  return (
    <svg
      width={120}
      height={110}
      viewBox="0 0 120 110"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Roof */}
      <polygon points="10,55 60,8 110,55" fill={C.hearth} />
      {/* House body */}
      <rect x={20} y={52} width={80} height={52} rx={4} fill={C.hearth100} />
      {/* Door */}
      <rect x={47} y={72} width={26} height={32} rx={5} fill={C.hearth} />
      {/* Door knob */}
      <circle cx={69} cy={89} r={3} fill={C.hearth100} />
      {/* Left window */}
      <motion.rect
        x={26}
        y={62}
        width={18}
        height={16}
        rx={3}
        fill={C.white}
        animate={{ opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Right window */}
      <motion.rect
        x={76}
        y={62}
        width={18}
        height={16}
        rx={3}
        fill={C.white}
        animate={{ opacity: [1, 0.7, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Chimney */}
      <rect x={80} y={18} width={12} height={22} rx={3} fill={C.charcoal} />
    </svg>
  );
}

// ─── Confetti ───────────────────────────────────────────────────────────────
const CONFETTI_COLORS = [C.hearth, C.honey, C.moss, C.hearth100, C.mossBg];

function Confetti() {
  const pieces = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    x: 5 + (i * 4.5) % 90,
    delay: (i * 0.08),
    isCircle: i % 2 === 0,
    size: 8 + (i % 3) * 4,
  }));

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 260,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          initial={{ y: -20, opacity: 1, rotate: 0 }}
          animate={{ y: 280, opacity: 0, rotate: 360 }}
          transition={{
            duration: 1.8,
            delay: p.delay,
            ease: 'easeIn',
          }}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: 0,
            width: p.size,
            height: p.size,
            borderRadius: p.isCircle ? '50%' : 3,
            backgroundColor: p.color,
          }}
        />
      ))}
    </div>
  );
}

// ─── Animated checkmark list item ──────────────────────────────────────────
function CheckItem({ text, delay }: { text: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 24,
          height: 24,
          borderRadius: '50%',
          backgroundColor: C.mossBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        <Check size={13} color={C.moss} strokeWidth={2.5} />
      </div>
      <span style={{ fontSize: 16, color: C.charcoal, lineHeight: 1.5 }}>{text}</span>
    </motion.div>
  );
}

// ─── Form data type ─────────────────────────────────────────────────────────
interface FormData {
  portfolioSize: '' | 'one' | 'few' | 'many';
  address: string;
  propertyType: '' | 'House' | 'Duplex' | 'Condo' | 'Apartment' | 'Other';
  units: number;
  nickname: string;
  hasTenants: boolean | null;
  tenantName: string;
  tenantPhone: string;
  tenantEmail: string;
  monthlyRent: string;
  rentDay: number | null;
  leaseType: 'fixed' | 'month-to-month';
}

const initialFormData: FormData = {
  portfolioSize: '',
  address: '',
  propertyType: '',
  units: 1,
  nickname: '',
  hasTenants: null,
  tenantName: '',
  tenantPhone: '',
  tenantEmail: '',
  monthlyRent: '',
  rentDay: 1,
  leaseType: 'fixed',
};

// ═══════════════════════════════════════════════════════════════════════════
// STEPS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Step 1: Welcome ────────────────────────────────────────────────────────
function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ textAlign: 'center', paddingTop: 16 }}>
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 28,
            fontWeight: 600,
            color: C.hearth,
            letterSpacing: '-0.02em',
            marginBottom: 0,
          }}
        >
          Doorstep
        </h1>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
        <HouseSVG />
      </div>

      <h1
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 36,
          fontWeight: 500,
          color: C.ink,
          lineHeight: 1.2,
          marginBottom: 16,
          letterSpacing: '-0.02em',
        }}
      >
        Hey there. Let's get your rentals organized.
      </h1>

      <p
        style={{
          fontSize: 18,
          color: C.stone,
          lineHeight: 1.5,
          marginBottom: 40,
        }}
      >
        Takes about 4 minutes. We'll guide you the whole way.
      </p>

      <PrimaryButton onClick={onNext}>Let's start</PrimaryButton>

      <div style={{ marginTop: 20 }}>
        <a
          href="/dashboard"
          style={{
            fontSize: 14,
            color: C.stone,
            textDecoration: 'underline',
            textDecorationColor: C.mist,
            textUnderlineOffset: 2,
          }}
        >
          I already have an account
        </a>
      </div>
    </div>
  );
}

// ─── Step 2: Portfolio size ─────────────────────────────────────────────────
function StepPortfolioSize({
  value,
  onChange,
}: {
  value: FormData['portfolioSize'];
  onChange: (v: FormData['portfolioSize']) => void;
}) {
  const options: { id: FormData['portfolioSize']; emoji: string; label: string; sub: string }[] = [
    { id: 'one', emoji: '🏡', label: 'I just have one rental', sub: 'Just starting out' },
    { id: 'few', emoji: '🏘️', label: 'I have a few rentals', sub: '2–10 properties' },
    { id: 'many', emoji: '🏢', label: 'I manage many rentals', sub: '10+ properties' },
  ];

  return (
    <div>
      <h2
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 28,
          fontWeight: 500,
          color: C.ink,
          lineHeight: 1.25,
          marginBottom: 28,
          letterSpacing: '-0.02em',
        }}
      >
        Quick question — which sounds like you?
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <motion.div
              key={opt.id}
              whileTap={{ scale: 1.02 }}
              onClick={() => onChange(opt.id)}
              style={{
                padding: 24,
                borderRadius: 20,
                border: `2px solid ${selected ? C.hearth : C.linen}`,
                backgroundColor: selected ? C.hearth50 : C.white,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                transition: 'border-color 0.15s ease, background-color 0.15s ease',
              }}
            >
              <span style={{ fontSize: 32, lineHeight: 1 }}>{opt.emoji}</span>
              <div>
                <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, marginBottom: 2 }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: 14, color: C.stone }}>{opt.sub}</div>
              </div>
              {selected && (
                <div style={{ marginLeft: 'auto' }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      backgroundColor: C.hearth,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Check size={12} color={C.white} strokeWidth={3} />
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 3: Property details ────────────────────────────────────────────────
function StepProperty({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (updates: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const types = ['House', 'Duplex', 'Condo', 'Apartment', 'Other'] as const;

  const canProceed = data.address.trim().length > 0;

  return (
    <div>
      <h2
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 28,
          fontWeight: 500,
          color: C.ink,
          lineHeight: 1.25,
          marginBottom: 8,
          letterSpacing: '-0.02em',
        }}
      >
        Tell us about your first property.
      </h2>
      <p style={{ fontSize: 15, color: C.stone, marginBottom: 28, lineHeight: 1.5 }}>
        Don't worry, you can change anything later.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Address */}
        <div>
          <label style={labelStyle}>Address</label>
          <input
            style={inputStyle}
            placeholder="123 Main St, Phoenix AZ"
            value={data.address}
            onChange={(e) => onChange({ address: e.target.value })}
          />
        </div>

        {/* Property type pills */}
        <div>
          <label style={labelStyle}>Property type</label>
          <div
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              paddingBottom: 4,
              scrollbarWidth: 'none',
            }}
          >
            {types.map((t) => {
              const sel = data.propertyType === t;
              return (
                <motion.button
                  key={t}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => onChange({ propertyType: t })}
                  style={{
                    flexShrink: 0,
                    padding: '10px 18px',
                    borderRadius: 99,
                    border: `1.5px solid ${sel ? C.hearth : C.linen}`,
                    backgroundColor: sel ? C.hearth : C.white,
                    color: sel ? C.white : C.charcoal,
                    fontSize: 14,
                    fontWeight: sel ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    fontFamily: 'inherit',
                  }}
                >
                  {t}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Unit stepper */}
        <div>
          <label style={labelStyle}>Number of units</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => onChange({ units: Math.max(1, data.units - 1) })}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                border: `1.5px solid ${C.linen}`,
                backgroundColor: C.white,
                fontSize: 22,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.charcoal,
                fontFamily: 'inherit',
              }}
            >
              –
            </motion.button>
            <span
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 28,
                fontWeight: 500,
                color: C.ink,
                minWidth: 32,
                textAlign: 'center',
              }}
            >
              {data.units}
            </span>
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => onChange({ units: data.units + 1 })}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                border: `1.5px solid ${C.linen}`,
                backgroundColor: C.white,
                fontSize: 22,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.charcoal,
                fontFamily: 'inherit',
              }}
            >
              +
            </motion.button>
          </div>
        </div>

        {/* Nickname */}
        <div>
          <label style={optionalLabelStyle}>
            Nickname <span style={{ color: C.mist }}>(optional)</span>
          </label>
          <input
            style={inputStyle}
            placeholder="e.g., 'The yellow house on Elm'"
            value={data.nickname}
            onChange={(e) => onChange({ nickname: e.target.value })}
          />
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <PrimaryButton onClick={canProceed ? onNext : undefined} style={{ opacity: canProceed ? 1 : 0.45 }}>
          Next
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Step 4: Tenants ─────────────────────────────────────────────────────────
function StepTenants({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (updates: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const days = Array.from({ length: 28 }, (_, i) => i + 1);

  return (
    <div>
      <h2
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 28,
          fontWeight: 500,
          color: C.ink,
          lineHeight: 1.25,
          marginBottom: 28,
          letterSpacing: '-0.02em',
        }}
      >
        Anyone living there right now?
      </h2>

      {/* Tenant presence cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {/* Yes */}
        <motion.div
          whileTap={{ scale: 1.01 }}
          onClick={() => onChange({ hasTenants: true })}
          style={{
            padding: '18px 24px',
            borderRadius: 16,
            backgroundColor: data.hasTenants === true ? C.hearth : C.white,
            border: `2px solid ${data.hasTenants === true ? C.hearth : C.linen}`,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: data.hasTenants === true ? C.white : C.ink,
            }}
          >
            Yes, I have tenants
          </div>
        </motion.div>

        {/* No */}
        <motion.div
          whileTap={{ scale: 1.01 }}
          onClick={() => onChange({ hasTenants: false })}
          style={{
            padding: '18px 24px',
            borderRadius: 16,
            backgroundColor: 'transparent',
            border: `2px solid ${data.hasTenants === false ? C.hearth : C.linen}`,
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
        >
          <div
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: data.hasTenants === false ? C.hearth : C.charcoal,
            }}
          >
            It's empty / I'm just getting set up
          </div>
        </motion.div>
      </div>

      {/* Expandable tenant form */}
      <AnimatePresence>
        {data.hasTenants === true && (
          <motion.div
            key="tenant-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
              {/* Tenant name */}
              <div>
                <label style={labelStyle}>
                  Tenant name <span style={{ color: C.hearth }}>*</span>
                </label>
                <input
                  style={inputStyle}
                  placeholder="Sarah Johnson"
                  value={data.tenantName}
                  onChange={(e) => onChange({ tenantName: e.target.value })}
                />
              </div>

              {/* Phone */}
              <div>
                <label style={labelStyle}>
                  Phone <span style={{ color: C.hearth }}>*</span>
                </label>
                <input
                  style={inputStyle}
                  placeholder="(555) 000-0000"
                  type="tel"
                  value={data.tenantPhone}
                  onChange={(e) => onChange({ tenantPhone: e.target.value })}
                />
                <p style={{ fontSize: 12, color: C.stone, marginTop: 5 }}>
                  For rent reminder texts
                </p>
              </div>

              {/* Email */}
              <div>
                <label style={optionalLabelStyle}>
                  Email <span style={{ color: C.mist }}>(optional)</span>
                </label>
                <input
                  style={inputStyle}
                  placeholder="sarah@email.com"
                  type="email"
                  value={data.tenantEmail}
                  onChange={(e) => onChange({ tenantEmail: e.target.value })}
                />
              </div>

              {/* Monthly rent */}
              <div>
                <label style={labelStyle}>Monthly rent</label>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 14,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 16,
                      color: C.stone,
                      fontWeight: 500,
                    }}
                  >
                    $
                  </span>
                  <input
                    style={{ ...inputStyle, paddingLeft: 28 }}
                    placeholder="1,400"
                    type="number"
                    value={data.monthlyRent}
                    onChange={(e) => onChange({ monthlyRent: e.target.value })}
                  />
                </div>
              </div>

              {/* Rent due day */}
              <div>
                <label style={labelStyle}>Which day of the month is rent due?</label>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    overflowX: 'auto',
                    paddingBottom: 4,
                    scrollbarWidth: 'none',
                  }}
                >
                  {days.map((d) => {
                    const sel = data.rentDay === d;
                    return (
                      <motion.button
                        key={d}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => onChange({ rentDay: d })}
                        style={{
                          flexShrink: 0,
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          border: `1.5px solid ${sel ? C.hearth : C.linen}`,
                          backgroundColor: sel ? C.hearth : C.white,
                          color: sel ? C.white : C.charcoal,
                          fontSize: 14,
                          fontWeight: sel ? 600 : 400,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          transition: 'all 0.12s ease',
                        }}
                      >
                        {d}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Lease type toggle */}
              <div>
                <label style={labelStyle}>Lease type</label>
                <div
                  style={{
                    display: 'flex',
                    borderRadius: 12,
                    border: `1.5px solid ${C.linen}`,
                    overflow: 'hidden',
                    backgroundColor: C.white,
                  }}
                >
                  {(['fixed', 'month-to-month'] as const).map((lt) => {
                    const sel = data.leaseType === lt;
                    return (
                      <button
                        key={lt}
                        onClick={() => onChange({ leaseType: lt })}
                        style={{
                          flex: 1,
                          padding: '12px 8px',
                          border: 'none',
                          backgroundColor: sel ? C.hearth : 'transparent',
                          color: sel ? C.white : C.charcoal,
                          fontSize: 14,
                          fontWeight: sel ? 600 : 400,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          fontFamily: 'inherit',
                        }}
                      >
                        {lt === 'fixed' ? 'Fixed term' : 'Month-to-month'}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p
                style={{
                  fontSize: 13,
                  color: C.stone,
                  lineHeight: 1.5,
                  padding: '10px 14px',
                  backgroundColor: C.hearth50,
                  borderRadius: 10,
                  marginBottom: 4,
                }}
              >
                We'll text them rent reminders so you don't have to.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ marginTop: 24 }}>
        <PrimaryButton
          onClick={data.hasTenants !== null ? onNext : undefined}
          style={{ opacity: data.hasTenants !== null ? 1 : 0.45 }}
        >
          Next
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Step 5: Connect bank ────────────────────────────────────────────────────
function StepBank({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <h2
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 28,
          fontWeight: 500,
          color: C.ink,
          lineHeight: 1.25,
          marginBottom: 12,
          letterSpacing: '-0.02em',
        }}
      >
        Where should the rent go?
      </h2>
      <p style={{ fontSize: 16, color: C.stone, lineHeight: 1.5, marginBottom: 36 }}>
        Securely connect your bank. Powered by Plaid — same tech your bank uses.
      </p>

      {/* Trust strip */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '10px 20px',
          marginBottom: 36,
          padding: '16px 12px',
          backgroundColor: C.cream,
          borderRadius: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={14} color={C.stone} />
          <span style={{ fontSize: 13, color: C.stone }}>Bank-level encryption</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={14} color={C.stone} />
          <span style={{ fontSize: 13, color: C.stone }}>256-bit security</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Check size={14} color={C.stone} />
          <span style={{ fontSize: 13, color: C.stone }}>Never stored</span>
        </div>
      </div>

      <PrimaryButton onClick={onNext}>Connect bank</PrimaryButton>

      <div style={{ marginTop: 18 }}>
        <button
          onClick={onSkip}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 14,
            color: C.stone,
            cursor: 'pointer',
            textDecoration: 'underline',
            textDecorationColor: C.mist,
            fontFamily: 'inherit',
          }}
        >
          Skip for now, I'll do it later
        </button>
      </div>
    </div>
  );
}

// ─── Step 6: All set ─────────────────────────────────────────────────────────
function StepAllSet() {
  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <Confetti />

      <div style={{ paddingTop: 60 }}>
        <h1
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 36,
            fontWeight: 500,
            color: C.ink,
            lineHeight: 1.2,
            marginBottom: 16,
            letterSpacing: '-0.02em',
          }}
        >
          You're all set, Linda.
        </h1>

        <p
          style={{
            fontSize: 17,
            color: C.stone,
            marginBottom: 32,
            fontWeight: 500,
          }}
        >
          Here's what happens next:
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            textAlign: 'left',
            marginBottom: 40,
          }}
        >
          <CheckItem
            text="We'll text your tenant on the 1st with a payment link"
            delay={0.1}
          />
          <CheckItem
            text="When they pay, money lands in your bank in 2 days"
            delay={0.3}
          />
          <CheckItem
            text="We'll quietly track everything for tax time"
            delay={0.5}
          />
        </div>

        <Link href="/dashboard" style={{ display: 'block', textDecoration: 'none' }}>
          <PrimaryButton>Take me to my dashboard</PrimaryButton>
        </Link>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);

  const updateFormData = (updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
  const goBack = () => setCurrentStep((s) => Math.max(s - 1, 1));

  // Step 2 auto-advances on card tap
  const handlePortfolioSelect = (v: FormData['portfolioSize']) => {
    updateFormData({ portfolioSize: v });
    setTimeout(() => setCurrentStep(3), 260);
  };

  const progressPct = (currentStep / TOTAL_STEPS) * 100;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: C.cream,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* ── Progress bar ── */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: C.linen,
          zIndex: 50,
        }}
      >
        <motion.div
          style={{
            height: '100%',
            backgroundColor: C.hearth,
            borderRadius: '0 2px 2px 0',
          }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>

      {/* ── Content area ── */}
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          padding: '24px 24px 48px',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── Back button (steps 2+) ── */}
        <div style={{ minHeight: 52, display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          {currentStep >= 2 && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={goBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: C.stone,
                fontSize: 15,
                padding: '8px 0',
                fontFamily: 'inherit',
              }}
            >
              <ChevronLeft size={20} strokeWidth={2} />
              Back
            </motion.button>
          )}
        </div>

        {/* ── Step content ── */}
        <div style={{ flex: 1 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={stepTransition}
            >
              {currentStep === 1 && <StepWelcome onNext={goNext} />}
              {currentStep === 2 && (
                <StepPortfolioSize
                  value={formData.portfolioSize}
                  onChange={handlePortfolioSelect}
                />
              )}
              {currentStep === 3 && (
                <StepProperty data={formData} onChange={updateFormData} onNext={goNext} />
              )}
              {currentStep === 4 && (
                <StepTenants data={formData} onChange={updateFormData} onNext={goNext} />
              )}
              {currentStep === 5 && <StepBank onNext={goNext} onSkip={goNext} />}
              {currentStep === 6 && <StepAllSet />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
