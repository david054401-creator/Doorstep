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
  ArrowDownToLine,
  Receipt,
  FileText,
  PlusCircle,
  BadgeCheck,
  TrendingUp,
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

const propTypeGradients: Record<string, string> = {
  house:     'linear-gradient(90deg, #C75D3D 0%, #D4823B 100%)',
  duplex:    'linear-gradient(90deg, #D4923B 0%, #C47A2E 100%)',
  condo:     'linear-gradient(90deg, #4A7C9E 0%, #3A6A8E 100%)',
  apartment: 'linear-gradient(90deg, #5C8A3A 0%, #4A7A2A 100%)',
  other:     'linear-gradient(90deg, #6B6058 0%, #5A5048 100%)',
};

// ─── Section animation wrapper ────────────────────────────────────────────────

function FadeSection({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
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
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return value;
}

function formatDollarInt(n: number) {
  return '$' + n.toLocaleString('en-US');
}

// ─── Modal base ───────────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            backgroundColor: 'rgba(26,23,20,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
            backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.93, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            style={{
              background: C.white, borderRadius: 24, padding: 28,
              width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
              boxShadow: '0 24px 64px rgba(26,23,20,0.18)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontFamily: '"Fraunces", serif', fontSize: 22, fontWeight: 500, color: C.ink, margin: 0 }}>
                {title}
              </h2>
              <button onClick={onClose} style={{
                background: C.cream, border: 'none', cursor: 'pointer',
                padding: 8, borderRadius: 8, color: C.stone, display: 'flex', alignItems: 'center',
              }} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      display: 'block', fontSize: 12, fontWeight: 700, color: C.stone,
      marginBottom: 6, fontFamily: '"Inter", sans-serif',
      letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', border: `1.5px solid ${C.linen}`, borderRadius: 10,
  padding: '11px 14px', fontSize: 15, color: C.ink, backgroundColor: C.white,
  fontFamily: '"Inter", sans-serif', outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 150ms',
};

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 18 }}>{children}</div>;
}

function SubmitButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      style={{
        width: '100%', padding: '14px 24px', borderRadius: 12,
        background: C.primary, color: C.white,
        fontSize: 15, fontWeight: 600, fontFamily: '"Inter", sans-serif',
        border: 'none', cursor: 'pointer', marginTop: 8,
      }}
    >
      {children}
    </motion.button>
  );
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────

function RecordPaymentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tenants, addPayment } = useStore();
  const { showToast } = useToast();
  const [tenantId, setTenantId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [method, setMethod] = useState<'ach' | 'card' | 'check' | 'cash'>('ach');
  const [note, setNote] = useState('');

  const methods: Array<{ value: 'ach' | 'card' | 'check' | 'cash'; label: string }> = [
    { value: 'ach', label: 'ACH' }, { value: 'card', label: 'Card' },
    { value: 'check', label: 'Check' }, { value: 'cash', label: 'Cash' },
  ];

  const handleSubmit = () => {
    if (!tenantId || !amount || !date) { showToast('Please fill in all required fields.', 'error'); return; }
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) return;
    addPayment({ id: `pay-${Date.now()}`, tenantId, propertyId: tenant.propertyId, amount: parseFloat(amount), date, method, status: 'paid', note: note || undefined });
    showToast('Payment recorded successfully.', 'success');
    onClose(); setTenantId(''); setAmount(''); setNote('');
  };

  return (
    <Modal open={open} onClose={onClose} title="Record Payment">
      <FieldGroup>
        <Label>Tenant *</Label>
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ ...inputStyle }}>
          <option value="">Select tenant…</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </FieldGroup>
      <FieldGroup>
        <Label>Amount ($) *</Label>
        <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
      </FieldGroup>
      <FieldGroup>
        <Label>Date *</Label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
      </FieldGroup>
      <FieldGroup>
        <Label>Payment Method</Label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {methods.map((m) => (
            <button key={m.value} type="button" onClick={() => setMethod(m.value)} style={{
              padding: '7px 16px', borderRadius: 20,
              border: `1.5px solid ${method === m.value ? C.primary : C.linen}`,
              background: method === m.value ? C.primary50 : C.white,
              color: method === m.value ? C.primary : C.charcoal,
              fontWeight: method === m.value ? 600 : 400,
              fontSize: 13, cursor: 'pointer', fontFamily: '"Inter", sans-serif', transition: 'all 150ms',
            }}>
              {m.label}
            </button>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup>
        <Label>Note</Label>
        <input type="text" placeholder="Optional note…" value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
      </FieldGroup>
      <SubmitButton onClick={handleSubmit}>Record Payment</SubmitButton>
    </Modal>
  );
}

// ─── Log Expense Modal ────────────────────────────────────────────────────────

type ExpenseCategory = 'repairs' | 'insurance' | 'mortgage' | 'property_tax' | 'utilities' | 'other';

const expenseCategories: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'repairs', label: 'Repairs' }, { value: 'insurance', label: 'Insurance' },
  { value: 'mortgage', label: 'Mortgage' }, { value: 'property_tax', label: 'Property Tax' },
  { value: 'utilities', label: 'Utilities' }, { value: 'other', label: 'Other' },
];

function LogExpenseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { properties, addExpense } = useStore();
  const { showToast } = useToast();
  const [propertyId, setPropertyId] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('repairs');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    if (!propertyId || !amount || !date || !description) { showToast('Please fill in all required fields.', 'error'); return; }
    addExpense({ id: `exp-${Date.now()}`, propertyId, amount: parseFloat(amount), date, category, vendor: vendor || undefined, description });
    showToast('Expense logged successfully.', 'success');
    onClose(); setPropertyId(''); setAmount(''); setVendor(''); setDescription('');
  };

  return (
    <Modal open={open} onClose={onClose} title="Log Expense">
      <FieldGroup>
        <Label>Property *</Label>
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={{ ...inputStyle }}>
          <option value="">Select property…</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </FieldGroup>
      <FieldGroup>
        <Label>Category</Label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {expenseCategories.map((cat) => (
            <button key={cat.value} type="button" onClick={() => setCategory(cat.value)} style={{
              padding: '6px 14px', borderRadius: 20,
              border: `1.5px solid ${category === cat.value ? C.primary : C.linen}`,
              background: category === cat.value ? C.primary50 : C.white,
              color: category === cat.value ? C.primary : C.charcoal,
              fontWeight: category === cat.value ? 600 : 400,
              fontSize: 13, cursor: 'pointer', fontFamily: '"Inter", sans-serif', transition: 'all 150ms',
            }}>
              {cat.label}
            </button>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup>
        <Label>Amount ($) *</Label>
        <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
      </FieldGroup>
      <FieldGroup>
        <Label>Date *</Label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
      </FieldGroup>
      <FieldGroup>
        <Label>Vendor Name</Label>
        <input type="text" placeholder="e.g. Portland Plumbing Co." value={vendor} onChange={(e) => setVendor(e.target.value)} style={inputStyle} />
      </FieldGroup>
      <FieldGroup>
        <Label>Description *</Label>
        <input type="text" placeholder="Brief description…" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
      </FieldGroup>
      <SubmitButton onClick={handleSubmit}>Log Expense</SubmitButton>
    </Modal>
  );
}

// ─── Hero strip ───────────────────────────────────────────────────────────────

function HeroStrip() {
  const { payments, tenants } = useStore();
  const [expanded, setExpanded] = useState(false);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const currentMonthPayments = payments.filter((p) => p.date >= monthStart && p.date <= monthEnd);
  const totalRent = currentMonthPayments.reduce((sum, p) => sum + p.amount, 0);
  const received = currentMonthPayments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);
  const due = currentMonthPayments.filter((p) => p.status !== 'paid').reduce((sum, p) => sum + p.amount, 0);
  const lateCount = currentMonthPayments.filter((p) => p.status === 'late').length;

  const animatedValue = useCountUp(totalRent, 700);

  const nextDue = (() => {
    const dueDates = tenants.map((t) => {
      const d = new Date(now.getFullYear(), now.getMonth(), t.rentDueDay);
      if (d < now) d.setMonth(d.getMonth() + 1);
      return d;
    });
    if (dueDates.length === 0) return null;
    return dueDates.sort((a, b) => a.getTime() - b.getTime())[0];
  })();

  const breakdown = tenants.map((tenant) => {
    const tenantPayments = currentMonthPayments.filter((p) => p.tenantId === tenant.id);
    const paid = tenantPayments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const hasLate = tenantPayments.some((p) => p.status === 'late');
    return { tenant, paid, hasLate, total: tenant.monthlyRent };
  });

  return (
    <div
      role="button" tabIndex={0}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((v) => !v); }}
      style={{
        background: 'linear-gradient(145deg, #FEF7F4 0%, #FFFCFA 45%, #FFFFFF 100%)',
        borderRadius: 20,
        border: '1px solid rgba(199,93,61,0.2)',
        padding: '22px 24px 20px',
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 2px 16px rgba(199,93,61,0.08), 0 1px 4px rgba(26,23,20,0.04)',
      }}
    >
      {/* Decorative glow */}
      <div style={{
        position: 'absolute', top: -50, right: -50, width: 200, height: 200,
        borderRadius: '50%', background: '#F4C9B8', opacity: 0.3,
        filter: 'blur(50px)', pointerEvents: 'none',
      }} />

      {/* Label + toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, position: 'relative' }}>
        <span style={{
          fontSize: 11, color: C.primary, letterSpacing: '0.1em',
          textTransform: 'uppercase', fontWeight: 700, fontFamily: '"Inter", sans-serif',
        }}>
          Coming in this month
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.stone }}>
          <span style={{ fontSize: 12, fontFamily: '"Inter", sans-serif' }}>Breakdown</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {/* Big number */}
      <div style={{
        fontFamily: '"Fraunces", serif',
        fontSize: 54,
        fontWeight: 500,
        color: C.ink,
        lineHeight: 1.05,
        marginBottom: 14,
        fontFeatureSettings: '"tnum"',
        position: 'relative',
      }}>
        {formatDollarInt(animatedValue)}
      </div>

      {/* Stat pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', position: 'relative' }}>
        {received > 0 && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: C.mossBg, borderRadius: 8, padding: '5px 11px',
          }}>
            <TrendingUp size={12} color={C.moss} strokeWidth={2.5} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.moss, fontFamily: '"Inter", sans-serif' }}>
              {formatCurrency(received)} received
            </span>
          </div>
        )}
        {due > 0 && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: C.honeyBg, borderRadius: 8, padding: '5px 11px',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.honey }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.honey, fontFamily: '"Inter", sans-serif' }}>
              {formatCurrency(due)} due
            </span>
          </div>
        )}
        {lateCount === 0 ? (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: C.mossBg, borderRadius: 8, padding: '5px 11px',
          }}>
            <BadgeCheck size={12} color={C.moss} strokeWidth={2.5} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.moss, fontFamily: '"Inter", sans-serif' }}>On track</span>
          </div>
        ) : (
          <Badge variant="honey" style={{ fontSize: 12 }}>{lateCount} late</Badge>
        )}
      </div>

      {/* Next due date */}
      {nextDue && (
        <div style={{ fontSize: 12, color: C.stone, fontFamily: '"Inter", sans-serif', marginTop: 10, position: 'relative' }}>
          Next due {formatDate(nextDue)}
        </div>
      )}

      {/* Expanded breakdown */}
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
                marginTop: 16, paddingTop: 16,
                borderTop: '1px solid rgba(199,93,61,0.15)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {breakdown.map(({ tenant, paid, hasLate, total }) => (
                <div key={tenant.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.85)',
                  border: '1px solid rgba(199,93,61,0.1)',
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
                      {tenant.name}
                    </div>
                    <div style={{ fontSize: 12, color: C.stone, fontFamily: '"Inter", sans-serif', marginTop: 1 }}>
                      Due {formatCurrency(total)}/mo
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
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
  | { kind: 'button'; icon: React.ElementType; iconBg: string; iconColor: string; label: string; onClick: () => void }
  | { kind: 'link';   icon: React.ElementType; iconBg: string; iconColor: string; label: string; href: string };

function QuickActionCard({ action }: { action: QuickActionItem }) {
  const Icon = action.icon;

  const inner = (
    <motion.div
      whileHover={{ scale: 1.02, y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      style={{
        background: C.white,
        borderRadius: 14,
        border: `1px solid ${C.linen}`,
        boxShadow: '0 1px 4px rgba(26,23,20,0.06)',
        padding: '13px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        textDecoration: 'none',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: action.iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={19} color={action.iconColor} strokeWidth={1.75} />
      </div>
      <span style={{
        fontSize: 13, fontWeight: 600, color: C.ink,
        fontFamily: '"Inter", sans-serif', lineHeight: '18px',
      }}>
        {action.label}
      </span>
    </motion.div>
  );

  if (action.kind === 'link') {
    return <Link href={action.href} style={{ textDecoration: 'none' }}>{inner}</Link>;
  }
  return <div onClick={action.onClick}>{inner}</div>;
}

function QuickActions({ onRecordPayment, onLogExpense, onComingSoon }: {
  onRecordPayment: () => void; onLogExpense: () => void; onComingSoon: () => void;
}) {
  const actions: QuickActionItem[] = [
    { kind: 'button', icon: ArrowDownToLine, iconBg: C.mossBg,   iconColor: C.moss,   label: 'Record payment',  onClick: onRecordPayment },
    { kind: 'button', icon: Receipt,         iconBg: C.honeyBg,  iconColor: C.honey,  label: 'Log expense',     onClick: onLogExpense },
    { kind: 'link',   icon: Wrench,          iconBg: C.brickBg,  iconColor: C.brick,  label: 'Maintenance',     href: '/maintenance' },
    { kind: 'link',   icon: MessageSquare,   iconBg: C.skyBg,    iconColor: C.sky,    label: 'Message tenant',  href: '/messages' },
    { kind: 'button', icon: FileText,        iconBg: C.linen,    iconColor: C.stone,  label: 'Add document',    onClick: onComingSoon },
    { kind: 'link',   icon: PlusCircle,      iconBg: C.primary50, iconColor: C.primary, label: 'Add property', href: '/properties' },
  ];

  return (
    <div>
      <h2 style={{
        fontFamily: '"Fraunces", serif', fontSize: 20, fontWeight: 500,
        color: C.ink, margin: '0 0 12px 0',
      }}>
        Quick actions
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {actions.map((action) => (
          <QuickActionCard key={action.label} action={action} />
        ))}
      </div>
    </div>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────

type ActivityItem =
  | { kind: 'payment';     data: Payment;            sortKey: string }
  | { kind: 'maintenance'; data: MaintenanceRequest; sortKey: string }
  | { kind: 'message';     data: Message;            sortKey: string };

function ActivityFeedItem({ item, tenants }: { item: ActivityItem; tenants: Tenant[] }) {
  const getTenantName = (tenantId: string) =>
    tenants.find((t) => t.id === tenantId)?.name ?? 'Unknown';

  if (item.kind === 'payment') {
    const p = item.data;
    return (
      <div style={{
        background: C.white, borderRadius: 12,
        border: `1px solid ${C.linen}`,
        borderLeft: `3px solid ${C.moss}`,
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: C.mossBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <DollarSign size={17} color={C.moss} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
            {getTenantName(p.tenantId)} paid rent
          </div>
          <div style={{ fontSize: 12, color: C.stone, fontFamily: '"Inter", sans-serif', marginTop: 2 }}>
            {formatRelativeTime(p.date)}
          </div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.moss, fontFamily: '"Inter", sans-serif', flexShrink: 0 }}>
          +{formatCurrency(p.amount)}
        </div>
      </div>
    );
  }

  if (item.kind === 'maintenance') {
    const m = item.data;
    return (
      <div style={{
        background: C.white, borderRadius: 12,
        border: `1px solid ${C.linen}`,
        borderLeft: `3px solid ${C.honey}`,
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: C.honeyBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Wrench size={17} color={C.honey} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.title}
          </div>
          <div style={{ fontSize: 12, color: C.stone, fontFamily: '"Inter", sans-serif', marginTop: 2 }}>
            {formatRelativeTime(m.createdAt)}
          </div>
        </div>
        <Badge
          variant={m.status === 'open' ? 'honey' : m.status === 'resolved' ? 'moss' : 'sky'}
          style={{ fontSize: 11, flexShrink: 0 }}
        >
          {m.status === 'in_progress' ? 'In progress' : m.status.charAt(0).toUpperCase() + m.status.slice(1)}
        </Badge>
      </div>
    );
  }

  const msg = item.data;
  return (
    <div style={{
      background: C.white, borderRadius: 12,
      border: `1px solid ${C.linen}`,
      borderLeft: `3px solid ${C.sky}`,
      padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%', background: C.skyBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <MessageSquare size={17} color={C.sky} strokeWidth={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
          {getTenantName(msg.tenantId)}{' '}
          <span style={{ fontWeight: 400, color: C.stone }}>sent a message</span>
        </div>
        <div style={{ fontSize: 12, color: C.stone, fontFamily: '"Inter", sans-serif', marginTop: 2 }}>
          {formatRelativeTime(msg.sentAt)}
        </div>
      </div>
      {!msg.read && <Badge variant="sky" style={{ fontSize: 11, flexShrink: 0 }}>New</Badge>}
    </div>
  );
}

function ActivityFeed() {
  const { payments, maintenanceRequests, messages, tenants } = useStore();

  const items: ActivityItem[] = [
    ...payments.map((p): ActivityItem => ({ kind: 'payment', data: p, sortKey: p.date })),
    ...maintenanceRequests.map((m): ActivityItem => ({ kind: 'maintenance', data: m, sortKey: m.createdAt })),
    ...messages.filter((msg) => msg.sender === 'tenant').map((msg): ActivityItem => ({ kind: 'message', data: msg, sortKey: msg.sentAt })),
  ]
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    .slice(0, 6);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontFamily: '"Fraunces", serif', fontSize: 20, fontWeight: 500, color: C.ink, margin: 0 }}>
          What&apos;s happening
        </h2>
        <Link href="/money" style={{ fontSize: 13, color: C.primary, textDecoration: 'none', fontFamily: '"Inter", sans-serif', fontWeight: 600 }}>
          See all
        </Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 ? (
          <div style={{
            background: C.white, borderRadius: 12, border: `1px solid ${C.linen}`,
            padding: 32, textAlign: 'center', color: C.stone, fontSize: 14, fontFamily: '"Inter", sans-serif',
          }}>
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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontFamily: '"Fraunces", serif', fontSize: 20, fontWeight: 500, color: C.ink, margin: 0 }}>
          Your properties
        </h2>
        <Link href="/properties" style={{ fontSize: 13, color: C.primary, textDecoration: 'none', fontFamily: '"Inter", sans-serif', fontWeight: 600 }}>
          Manage
        </Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {properties.map((property) => (
          <Link key={property.id} href={`/properties/${property.id}`} style={{ textDecoration: 'none' }}>
            <motion.div
              whileHover={{ scale: 1.01, y: -1 }}
              whileTap={{ scale: 0.99 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              style={{
                background: C.white,
                borderRadius: 16,
                border: `1px solid ${C.linen}`,
                overflow: 'hidden',
                boxShadow: '0 1px 4px rgba(26,23,20,0.05)',
              }}
            >
              {/* Property type gradient strip */}
              <div style={{ height: 4, background: propTypeGradients[property.type ?? 'other'] }} />

              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, fontFamily: '"Inter", sans-serif', marginBottom: 2 }}>
                    {property.name}
                  </div>
                  <div style={{
                    fontSize: 13, color: C.stone, fontFamily: '"Inter", sans-serif',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {property.address}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: '"Inter", sans-serif' }}>
                    {formatCurrency(property.monthlyRent)}<span style={{ fontSize: 11, fontWeight: 400, color: C.stone }}>/mo</span>
                  </div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, fontFamily: '"Inter", sans-serif', marginTop: 2,
                    color: property.isOccupied ? C.moss : C.brick,
                  }}>
                    {property.isOccupied ? '● Occupied' : '○ Vacant'}
                  </div>
                </div>
              </div>
            </motion.div>
          </Link>
        ))}
        {properties.length === 0 && (
          <div style={{
            background: C.white, borderRadius: 16, border: `1px solid ${C.linen}`,
            padding: 32, textAlign: 'center', color: C.stone, fontSize: 14, fontFamily: '"Inter", sans-serif',
          }}>
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
      <div style={{
        backgroundColor: C.cream,
        minHeight: '100%',
        padding: '16px 16px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        maxWidth: 600,
        margin: '0 auto',
      }}>
        <FadeSection delay={0}>
          <HeroStrip />
        </FadeSection>

        <FadeSection delay={0.08}>
          <QuickActions
            onRecordPayment={() => setPaymentModalOpen(true)}
            onLogExpense={() => setExpenseModalOpen(true)}
            onComingSoon={handleComingSoon}
          />
        </FadeSection>

        <FadeSection delay={0.14}>
          <ActivityFeed />
        </FadeSection>

        <FadeSection delay={0.2}>
          <PropertiesSummary />
        </FadeSection>
      </div>

      <RecordPaymentModal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} />
      <LogExpenseModal open={expenseModalOpen} onClose={() => setExpenseModalOpen(false)} />
    </>
  );
}
