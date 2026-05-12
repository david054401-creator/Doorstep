'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DollarSign,
  Wrench,
  MessageSquare,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

import { useStore } from '@/lib/store';
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import type { Payment, MaintenanceRequest, Message, Tenant } from '@/lib/types';

// ─── Brand colors ─────────────────────────────────────────────────────────────

const C = {
  primary: '#C75D3D',
  primaryHover: '#A84A2E',
  primary100: '#F4C9B8',
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
  honey: '#D4923B',
  honeyBg: '#FBF1E0',
  brick: '#B8442E',
  brickBg: '#FAE5DE',
  sky: '#4A7C9E',
  skyBg: '#E5EEF5',
} as const;

// ─── Section animation wrapper ────────────────────────────────────────────────

function FadeSection({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

// ─── Count-up hook ────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return value;
}

// ─── Utility: format dollar string for count-up (no decimals) ─────────────────

function formatDollarInt(n: number) {
  return '$' + n.toLocaleString('en-US');
}

// ─── Modal base ───────────────────────────────────────────────────────────────

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            backgroundColor: 'rgba(26,23,20,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.93, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            style={{
              background: C.white,
              borderRadius: 24,
              padding: 24,
              width: '100%',
              maxWidth: 480,
              maxHeight: '90vh',
              overflowY: 'auto',
              position: 'relative',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 20,
              }}
            >
              <h2
                style={{
                  fontFamily: '"Fraunces", serif',
                  fontSize: 20,
                  fontWeight: 500,
                  color: C.ink,
                  margin: 0,
                }}
              >
                {title}
              </h2>
              <button
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: C.stone,
                  display: 'flex',
                  alignItems: 'center',
                }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Form field helpers ───────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 13,
        fontWeight: 600,
        color: C.charcoal,
        marginBottom: 6,
        fontFamily: '"Inter", sans-serif',
      }}
    >
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
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
};

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 16 }}>{children}</div>;
}

function SubmitButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        padding: '13px 24px',
        borderRadius: 12,
        background: hovered ? C.primaryHover : C.primary,
        color: C.white,
        fontSize: 15,
        fontWeight: 600,
        fontFamily: '"Inter", sans-serif',
        border: 'none',
        cursor: 'pointer',
        marginTop: 8,
        transition: 'background 150ms',
      }}
    >
      {children}
    </button>
  );
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────

function RecordPaymentModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { tenants, addPayment } = useStore();
  const { showToast } = useToast();
  const [tenantId, setTenantId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [method, setMethod] = useState<'ach' | 'card' | 'check' | 'cash'>('ach');
  const [note, setNote] = useState('');

  const methods: Array<{ value: 'ach' | 'card' | 'check' | 'cash'; label: string }> = [
    { value: 'ach', label: 'ACH' },
    { value: 'card', label: 'Card' },
    { value: 'check', label: 'Check' },
    { value: 'cash', label: 'Cash' },
  ];

  const handleSubmit = () => {
    if (!tenantId || !amount || !date) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) return;
    addPayment({
      id: `pay-${Date.now()}`,
      tenantId,
      propertyId: tenant.propertyId,
      amount: parseFloat(amount),
      date,
      method,
      status: 'paid',
      note: note || undefined,
    });
    showToast('Payment recorded successfully.', 'success');
    onClose();
    setTenantId('');
    setAmount('');
    setNote('');
  };

  return (
    <Modal open={open} onClose={onClose} title="Record Payment">
      <FieldGroup>
        <Label>Tenant *</Label>
        <select
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          style={{ ...inputStyle }}
        >
          <option value="">Select tenant…</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FieldGroup>
      <FieldGroup>
        <Label>Amount ($) *</Label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={inputStyle}
        />
      </FieldGroup>
      <FieldGroup>
        <Label>Date *</Label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={inputStyle}
        />
      </FieldGroup>
      <FieldGroup>
        <Label>Payment Method</Label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {methods.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMethod(m.value)}
              style={{
                padding: '7px 16px',
                borderRadius: 20,
                border: `1.5px solid ${method === m.value ? C.primary : C.linen}`,
                background: method === m.value ? C.primary50 : C.white,
                color: method === m.value ? C.primary : C.charcoal,
                fontWeight: method === m.value ? 600 : 400,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: '"Inter", sans-serif',
                transition: 'all 150ms',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup>
        <Label>Note</Label>
        <input
          type="text"
          placeholder="Optional note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={inputStyle}
        />
      </FieldGroup>
      <SubmitButton onClick={handleSubmit}>Record Payment</SubmitButton>
    </Modal>
  );
}

// ─── Log Expense Modal ────────────────────────────────────────────────────────

type ExpenseCategory = 'repairs' | 'insurance' | 'mortgage' | 'property_tax' | 'utilities' | 'other';

const expenseCategories: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'repairs', label: 'Repairs' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'property_tax', label: 'Property Tax' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'other', label: 'Other' },
];

function LogExpenseModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { properties, addExpense } = useStore();
  const { showToast } = useToast();
  const [propertyId, setPropertyId] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('repairs');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    if (!propertyId || !amount || !date || !description) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }
    addExpense({
      id: `exp-${Date.now()}`,
      propertyId,
      amount: parseFloat(amount),
      date,
      category,
      vendor: vendor || undefined,
      description,
    });
    showToast('Expense logged successfully.', 'success');
    onClose();
    setPropertyId('');
    setAmount('');
    setVendor('');
    setDescription('');
  };

  return (
    <Modal open={open} onClose={onClose} title="Log Expense">
      <FieldGroup>
        <Label>Property *</Label>
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          style={{ ...inputStyle }}
        >
          <option value="">Select property…</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </FieldGroup>
      <FieldGroup>
        <Label>Category</Label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {expenseCategories.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setCategory(cat.value)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: `1.5px solid ${category === cat.value ? C.primary : C.linen}`,
                background: category === cat.value ? C.primary50 : C.white,
                color: category === cat.value ? C.primary : C.charcoal,
                fontWeight: category === cat.value ? 600 : 400,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: '"Inter", sans-serif',
                transition: 'all 150ms',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup>
        <Label>Amount ($) *</Label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={inputStyle}
        />
      </FieldGroup>
      <FieldGroup>
        <Label>Date *</Label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={inputStyle}
        />
      </FieldGroup>
      <FieldGroup>
        <Label>Vendor Name</Label>
        <input
          type="text"
          placeholder="e.g. Portland Plumbing Co."
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          style={inputStyle}
        />
      </FieldGroup>
      <FieldGroup>
        <Label>Description *</Label>
        <input
          type="text"
          placeholder="Brief description…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={inputStyle}
        />
      </FieldGroup>
      <SubmitButton onClick={handleSubmit}>Log Expense</SubmitButton>
    </Modal>
  );
}

// ─── Hero strip ───────────────────────────────────────────────────────────────

function HeroStrip() {
  const { payments, tenants } = useStore();
  const [expanded, setExpanded] = useState(false);

  // Current month range
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const currentMonthPayments = payments.filter((p) => p.date >= monthStart && p.date <= monthEnd);
  const totalRent = currentMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  const received = currentMonthPayments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);
  const due = currentMonthPayments.filter((p) => p.status !== 'paid').reduce((sum, p) => sum + p.amount, 0);
  const lateCount = currentMonthPayments.filter((p) => p.status === 'late').length;

  const animatedValue = useCountUp(totalRent, 600);

  // Next due date: find earliest upcoming due based on tenant rentDueDay
  const nextDue = (() => {
    const dueDates = tenants.map((t) => {
      const d = new Date(now.getFullYear(), now.getMonth(), t.rentDueDay);
      if (d < now) d.setMonth(d.getMonth() + 1);
      return d;
    });
    if (dueDates.length === 0) return null;
    return dueDates.sort((a, b) => a.getTime() - b.getTime())[0];
  })();

  // Per-tenant breakdown for expanded view
  const breakdown = tenants.map((tenant) => {
    const tenantPayments = currentMonthPayments.filter((p) => p.tenantId === tenant.id);
    const paid = tenantPayments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const hasLate = tenantPayments.some((p) => p.status === 'late');
    return { tenant, paid, hasLate, total: tenant.monthlyRent };
  });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((v) => !v); }}
      style={{
        background: C.white,
        borderRadius: 20,
        border: `1px solid ${C.linen}`,
        padding: 24,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* Label */}
      <div
        style={{
          fontSize: 14,
          color: C.stone,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 600,
          fontFamily: '"Inter", sans-serif',
          marginBottom: 6,
        }}
      >
        Coming in this month
      </div>

      {/* Giant number */}
      <div
        style={{
          fontFamily: '"Fraunces", serif',
          fontSize: 48,
          fontWeight: 500,
          color: C.ink,
          fontFeatureSettings: '"tnum"',
          lineHeight: 1.1,
          marginBottom: 8,
        }}
      >
        {formatDollarInt(animatedValue)}
      </div>

      {/* Sub-line */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 16, color: C.charcoal, fontFamily: '"Inter", sans-serif' }}>
          {formatCurrency(received)} received · {formatCurrency(due)} due
          {nextDue ? ` ${formatDate(nextDue)}` : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lateCount === 0 ? (
            <Badge variant="moss">On track ✓</Badge>
          ) : (
            <Badge variant="honey">{lateCount} late payment{lateCount > 1 ? 's' : ''}</Badge>
          )}
          {expanded ? (
            <ChevronUp size={16} style={{ color: C.stone }} />
          ) : (
            <ChevronDown size={16} style={{ color: C.stone }} />
          )}
        </div>
      </div>

      {/* Expanded per-tenant breakdown */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: `1px solid ${C.linen}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {breakdown.map(({ tenant, paid, hasLate, total }) => (
                <div
                  key={tenant.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: C.cream,
                    border: `1px solid ${C.linen}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
                      {tenant.name}
                    </div>
                    <div style={{ fontSize: 13, color: C.stone, fontFamily: '"Inter", sans-serif', marginTop: 1 }}>
                      Due {formatCurrency(total)}/mo
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
                      {formatCurrency(paid)}
                    </span>
                    {hasLate ? (
                      <Badge variant="honey" style={{ fontSize: 11, padding: '2px 8px' }}>Late</Badge>
                    ) : paid >= total ? (
                      <Badge variant="moss" style={{ fontSize: 11, padding: '2px 8px' }}>Paid</Badge>
                    ) : (
                      <Badge variant="sky" style={{ fontSize: 11, padding: '2px 8px' }}>Pending</Badge>
                    )}
                  </div>
                </div>
              ))}
              {breakdown.length === 0 && (
                <p style={{ fontSize: 14, color: C.stone, textAlign: 'center', margin: 0, fontFamily: '"Inter", sans-serif' }}>
                  No tenants this month.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Quick Actions ────────────────────────────────────────────────────────────

type QuickActionItem =
  | { kind: 'button'; icon: string; label: string; onClick: () => void }
  | { kind: 'link'; icon: string; label: string; href: string };

function QuickActionCard({ action }: { action: QuickActionItem }) {
  const inner = (
    <motion.div
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={{
        minWidth: 120,
        minHeight: 120,
        width: 120,
        height: 120,
        background: C.white,
        borderRadius: 20,
        border: `1px solid ${C.linen}`,
        boxShadow: '0 1px 2px rgba(26,23,20,0.04)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        cursor: 'pointer',
        textDecoration: 'none',
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: 32, lineHeight: 1 }}>{action.icon}</div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: C.charcoal,
          fontFamily: '"Inter", sans-serif',
          lineHeight: 1.3,
        }}
      >
        {action.label}
      </div>
    </motion.div>
  );

  if (action.kind === 'link') {
    return <Link href={action.href} style={{ textDecoration: 'none' }}>{inner}</Link>;
  }
  return <div onClick={action.onClick}>{inner}</div>;
}

function QuickActions({
  onRecordPayment,
  onLogExpense,
  onComingSoon,
}: {
  onRecordPayment: () => void;
  onLogExpense: () => void;
  onComingSoon: () => void;
}) {
  const actions: QuickActionItem[] = [
    { kind: 'button', icon: '📥', label: 'Record payment', onClick: onRecordPayment },
    { kind: 'button', icon: '💸', label: 'Log expense', onClick: onLogExpense },
    { kind: 'link', icon: '🔧', label: 'Maintenance', href: '/maintenance' },
    { kind: 'link', icon: '💬', label: 'Message tenant', href: '/messages' },
    { kind: 'button', icon: '📄', label: 'Add document', onClick: onComingSoon },
    { kind: 'link', icon: '🏠', label: 'Add property', href: '/properties' },
  ];

  return (
    <div>
      <h2
        style={{
          fontFamily: '"Fraunces", serif',
          fontSize: 20,
          fontWeight: 500,
          color: C.ink,
          margin: '0 0 12px 0',
        }}
      >
        Quick actions
      </h2>
      <div
        className="hide-scrollbar"
        style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 4,
        }}
      >
        {actions.map((action) => (
          <QuickActionCard key={action.label} action={action} />
        ))}
      </div>
    </div>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────

type ActivityItem =
  | { kind: 'payment'; data: Payment; sortKey: string }
  | { kind: 'maintenance'; data: MaintenanceRequest; sortKey: string }
  | { kind: 'message'; data: Message; sortKey: string };

function ActivityFeedItem({ item, tenants }: { item: ActivityItem; tenants: Tenant[] }) {
  const getTenantName = (tenantId: string) =>
    tenants.find((t) => t.id === tenantId)?.name ?? 'Unknown';

  if (item.kind === 'payment') {
    const p = item.data;
    return (
      <div
        style={{
          background: C.white,
          borderRadius: 12,
          border: `1px solid ${C.linen}`,
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {/* Icon circle */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: C.mossBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <DollarSign size={16} color={C.moss} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
            {getTenantName(p.tenantId)} paid rent
          </div>
          <div style={{ fontSize: 12, color: C.stone, fontFamily: '"Inter", sans-serif', marginTop: 1 }}>
            {formatRelativeTime(p.date)}
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.moss, fontFamily: '"Inter", sans-serif', flexShrink: 0 }}>
          +{formatCurrency(p.amount)}
        </div>
      </div>
    );
  }

  if (item.kind === 'maintenance') {
    const m = item.data;
    return (
      <div
        style={{
          background: C.white,
          borderRadius: 12,
          border: `1px solid ${C.linen}`,
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: C.honeyBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Wrench size={16} color={C.honey} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
            {m.title}
          </div>
          <div style={{ fontSize: 12, color: C.stone, fontFamily: '"Inter", sans-serif', marginTop: 1 }}>
            {formatRelativeTime(m.createdAt)}
          </div>
        </div>
        <Badge variant={m.status === 'open' ? 'honey' : m.status === 'resolved' ? 'moss' : 'sky'} style={{ fontSize: 11 }}>
          {m.status === 'in_progress' ? 'In progress' : m.status.charAt(0).toUpperCase() + m.status.slice(1)}
        </Badge>
      </div>
    );
  }

  // message
  const msg = item.data;
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 12,
        border: `1px solid ${C.linen}`,
        padding: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: C.skyBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <MessageSquare size={16} color={C.sky} strokeWidth={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
          {getTenantName(msg.tenantId)}{' '}
          <span style={{ fontWeight: 400, color: C.stone }}>sent a message</span>
        </div>
        <div style={{ fontSize: 12, color: C.stone, fontFamily: '"Inter", sans-serif', marginTop: 1 }}>
          {formatRelativeTime(msg.sentAt)}
        </div>
      </div>
      {!msg.read && <Badge variant="sky" style={{ fontSize: 11 }}>New</Badge>}
    </div>
  );
}

function ActivityFeed() {
  const { payments, maintenanceRequests, messages, tenants } = useStore();

  // Combine and sort by most recent, take last 6
  const items: ActivityItem[] = [
    ...payments.map((p): ActivityItem => ({ kind: 'payment', data: p, sortKey: p.date })),
    ...maintenanceRequests.map((m): ActivityItem => ({ kind: 'maintenance', data: m, sortKey: m.createdAt })),
    ...messages
      .filter((msg) => msg.sender === 'tenant')
      .map((msg): ActivityItem => ({ kind: 'message', data: msg, sortKey: msg.sentAt })),
  ]
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    .slice(0, 6);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            fontFamily: '"Fraunces", serif',
            fontSize: 22,
            fontWeight: 500,
            color: C.ink,
            margin: 0,
          }}
        >
          What&apos;s happening
        </h2>
        <Link
          href="/money"
          style={{
            fontSize: 14,
            color: C.stone,
            textDecoration: 'none',
            fontFamily: '"Inter", sans-serif',
            fontWeight: 500,
          }}
        >
          See all
        </Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 ? (
          <div
            style={{
              background: C.white,
              borderRadius: 12,
              border: `1px solid ${C.linen}`,
              padding: 32,
              textAlign: 'center',
              color: C.stone,
              fontSize: 14,
              fontFamily: '"Inter", sans-serif',
            }}
          >
            No recent activity.
          </div>
        ) : (
          items.map((item, i) => (
            <ActivityFeedItem key={`${item.kind}-${i}`} item={item} tenants={tenants} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Properties summary ───────────────────────────────────────────────────────

function PropertiesSummary() {
  const { properties } = useStore();

  return (
    <div>
      <h2
        style={{
          fontFamily: '"Fraunces", serif',
          fontSize: 20,
          fontWeight: 500,
          color: C.ink,
          margin: '0 0 12px 0',
        }}
      >
        Your properties
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {properties.map((property) => (
          <Link
            key={property.id}
            href={`/properties/${property.id}`}
            style={{ textDecoration: 'none' }}
          >
            <motion.div
              whileHover={{ scale: 1.01 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              style={{
                background: C.white,
                borderRadius: 16,
                border: `1px solid ${C.linen}`,
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: C.ink,
                    fontFamily: '"Inter", sans-serif',
                    marginBottom: 2,
                  }}
                >
                  {property.name}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: C.stone,
                    fontFamily: '"Inter", sans-serif',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {property.address}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {/* Occupancy dot */}
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: property.isOccupied ? C.moss : 'transparent',
                    border: property.isOccupied ? `2px solid ${C.moss}` : `2px solid ${C.brick}`,
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    color: C.stone,
                    fontFamily: '"Inter", sans-serif',
                  }}
                >
                  View details →
                </span>
              </div>
            </motion.div>
          </Link>
        ))}
        {properties.length === 0 && (
          <div
            style={{
              background: C.white,
              borderRadius: 16,
              border: `1px solid ${C.linen}`,
              padding: 32,
              textAlign: 'center',
              color: C.stone,
              fontSize: 14,
              fontFamily: '"Inter", sans-serif',
            }}
          >
            No properties yet.{' '}
            <Link href="/properties" style={{ color: C.primary, fontWeight: 600, textDecoration: 'none' }}>
              Add one
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { showToast } = useToast();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);

  const handleComingSoon = useCallback(() => {
    showToast('Document upload coming soon!', 'warning');
  }, [showToast]);

  return (
    <>
      <div
        style={{
          backgroundColor: C.cream,
          minHeight: '100%',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          maxWidth: 600,
          margin: '0 auto',
        }}
      >
        {/* Hero strip */}
        <FadeSection delay={0}>
          <HeroStrip />
        </FadeSection>

        {/* Quick actions */}
        <FadeSection delay={0.08}>
          <QuickActions
            onRecordPayment={() => setPaymentModalOpen(true)}
            onLogExpense={() => setExpenseModalOpen(true)}
            onComingSoon={handleComingSoon}
          />
        </FadeSection>

        {/* Activity feed */}
        <FadeSection delay={0.14}>
          <ActivityFeed />
        </FadeSection>

        {/* Properties summary */}
        <FadeSection delay={0.2}>
          <PropertiesSummary />
        </FadeSection>
      </div>

      {/* Modals */}
      <RecordPaymentModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
      />
      <LogExpenseModal
        open={expenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
      />
    </>
  );
}
