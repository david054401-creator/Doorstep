'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Receipt,
  Upload,
  ChevronRight,
  FileText,
  Camera,
  Check,
  X,
  Filter,
  Calendar,
  PieChart,
  ChevronLeft,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import type { Expense } from '@/lib/types';

// ─── Brand colors ──────────────────────────────────────────────────────────────

const C = {
  primary: '#C75D3D',
  primaryHover: '#A84A2E',
  primary50: '#FDF1EB',
  primary100: '#F4C9B8',
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

// ─── Expense category config ───────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  repairs: { label: 'Repairs', color: '#C75D3D', bg: '#FAE5DE' },
  insurance: { label: 'Insurance', color: '#4A7C9E', bg: '#E5EEF5' },
  mortgage: { label: 'Mortgage', color: '#1A1714', bg: '#E8E3DC' },
  property_tax: { label: 'Property tax', color: '#D4923B', bg: '#FBF1E0' },
  utilities: { label: 'Utilities', color: '#5C8A3A', bg: '#EEF4E5' },
  other: { label: 'Other', color: '#A8A099', bg: '#F0EDE9' },
};

const CATEGORIES = Object.keys(CATEGORY_CONFIG) as Array<keyof typeof CATEGORY_CONFIG>;

// ─── Method badge ──────────────────────────────────────────────────────────────

const METHOD_LABEL: Record<string, string> = {
  ach: 'ACH',
  card: 'Card',
  check: 'Check',
  cash: 'Cash',
};

// ─── Months ────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── Sparkline data (plausible 12-point wave) ──────────────────────────────────

const SPARKLINE_POINTS = [420, 680, 510, 890, 750, 1100, 940, 1280, 1050, 1420, 1190, 1560];

function buildSparklinePath(points: number[], width: number, height: number): string {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 4;
  const coords = points.map((v, i) => ({
    x: pad + (i / (points.length - 1)) * (width - pad * 2),
    y: pad + (1 - (v - min) / range) * (height - pad * 2),
  }));
  // Smooth cubic bezier
  return coords.reduce((d, pt, i) => {
    if (i === 0) return `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    const prev = coords[i - 1];
    const cpx = (prev.x + pt.x) / 2;
    return `${d} C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${pt.y.toFixed(1)}, ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }, '');
}

// ─── Donut chart ───────────────────────────────────────────────────────────────

interface DonutSegment {
  category: string;
  amount: number;
  color: string;
  pct: number;
  startAngle: number;
  endAngle: number;
}

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, start: number, end: number): string {
  const s = polarToXY(cx, cy, r, start);
  const e = polarToXY(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function DonutChart({ expenses }: { expenses: Expense[] }) {
  const totals: Record<string, number> = {};
  for (const e of expenses) {
    totals[e.category] = (totals[e.category] ?? 0) + e.amount;
  }
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);

  const segments: DonutSegment[] = [];
  let angle = 0;
  for (const cat of CATEGORIES) {
    if (!totals[cat]) continue;
    const pct = totals[cat] / grandTotal;
    const sweep = pct * 360;
    segments.push({
      category: cat,
      amount: totals[cat],
      color: CATEGORY_CONFIG[cat].color,
      pct,
      startAngle: angle,
      endAngle: angle + sweep,
    });
    angle += sweep;
  }

  const cx = 80;
  const cy = 80;
  const r = 60;
  const ir = 36;

  if (segments.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: C.mist, padding: '24px 0' }}>
        No expenses yet
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <svg width={160} height={160} viewBox="0 0 160 160">
          {segments.map((seg, i) => {
            // Gap between segments
            const gapDeg = 1.5;
            const s = seg.startAngle + gapDeg / 2;
            const e = seg.endAngle - gapDeg / 2;
            if (e <= s) return null;
            const pathD = describeArc(cx, cy, r, s, e);
            return (
              <path
                key={seg.category}
                d={pathD}
                fill="none"
                stroke={seg.color}
                strokeWidth={ir}
                strokeLinecap="round"
              />
            );
          })}
          {/* center hole overlay */}
          <circle cx={cx} cy={cy} r={ir / 2 - 2} fill={C.white} />
          {/* center text */}
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize={9} fill={C.stone} fontFamily="Inter, sans-serif">
            Total
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize={11} fill={C.ink} fontFamily="Inter, sans-serif" fontWeight="600">
            {formatCurrency(grandTotal)}
          </text>
        </svg>
      </div>

      {/* Legend grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
        {segments.map((seg) => (
          <div key={seg.category} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: seg.color,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.stone, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {CATEGORY_CONFIG[seg.category].label}
              </div>
              <div style={{ fontSize: 12, color: C.ink, fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>
                {formatCurrency(seg.amount)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        background: value ? C.primary : C.linen,
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
      aria-pressed={value}
    >
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: C.white,
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

// ─── Add Expense Modal ─────────────────────────────────────────────────────────

interface ExpenseForm {
  category: string;
  propertyId: string;
  amount: string;
  date: string;
  vendor: string;
  description: string;
}

function AddExpenseModal({
  open,
  onClose,
  onSave,
  properties,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (expense: Omit<Expense, 'id'>) => void;
  properties: { id: string; name: string }[];
}) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState<ExpenseForm>({
    category: 'repairs',
    propertyId: properties[0]?.id ?? '',
    amount: '',
    date: today,
    vendor: '',
    description: '',
  });

  const set = (field: keyof ExpenseForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSave = () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) return;
    onSave({
      propertyId: form.propertyId,
      amount,
      date: form.date,
      category: form.category as Expense['category'],
      vendor: form.vendor || undefined,
      description: form.description,
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(26,23,20,0.5)',
              zIndex: 100,
            }}
          />
          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              background: C.white,
              borderRadius: '24px 24px 0 0',
              zIndex: 101,
              padding: '0 20px 40px',
              maxWidth: 600,
              margin: '0 auto',
            }}
          >
            {/* Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 20 }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: C.linen }} />
            </div>

            {/* Title row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontFamily: 'Fraunces, Georgia, serif', color: C.ink, margin: 0 }}>
                Add Expense
              </h2>
              <button
                type="button"
                onClick={onClose}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.stone }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Category pills */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: C.stone, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Category
              </div>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {CATEGORIES.map((cat) => {
                  const conf = CATEGORY_CONFIG[cat];
                  const selected = form.category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, category: cat }))}
                      style={{
                        flexShrink: 0,
                        padding: '6px 14px',
                        borderRadius: 20,
                        border: `1.5px solid ${selected ? conf.color : C.linen}`,
                        background: selected ? conf.bg : C.white,
                        color: selected ? conf.color : C.stone,
                        fontSize: 13,
                        fontWeight: selected ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {conf.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Property */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: C.stone, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Property
              </label>
              <select
                value={form.propertyId}
                onChange={set('propertyId')}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${C.linen}`,
                  background: C.white,
                  fontSize: 15,
                  color: C.ink,
                  outline: 'none',
                  appearance: 'none',
                  cursor: 'pointer',
                }}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: C.stone, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Amount ($)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={set('amount')}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${C.linen}`,
                  background: C.white,
                  fontSize: 32,
                  fontFamily: 'Inter, sans-serif',
                  fontVariantNumeric: 'tabular-nums',
                  color: C.ink,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Date */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: C.stone, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Date
              </label>
              <input
                type="date"
                value={form.date}
                onChange={set('date')}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${C.linen}`,
                  background: C.white,
                  fontSize: 15,
                  color: C.ink,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Vendor */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: C.stone, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Vendor name
              </label>
              <input
                type="text"
                placeholder="e.g. Home Depot"
                value={form.vendor}
                onChange={set('vendor')}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${C.linen}`,
                  background: C.white,
                  fontSize: 15,
                  color: C.ink,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Description */}
            <div style={{ marginBottom: 28 }}>
              <label style={{ fontSize: 11, color: C.stone, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Description
              </label>
              <textarea
                rows={2}
                placeholder="What was this for?"
                value={form.description}
                onChange={set('description') as React.ChangeEventHandler<HTMLTextAreaElement>}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${C.linen}`,
                  background: C.white,
                  fontSize: 15,
                  color: C.ink,
                  outline: 'none',
                  resize: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'Inter, sans-serif',
                }}
              />
            </div>

            {/* Save button */}
            <button
              type="button"
              onClick={handleSave}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: 12,
                background: C.primary,
                color: C.white,
                fontSize: 16,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Save expense
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Receipt scan overlay & pre-fill modal ─────────────────────────────────────

function ScanOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 12,
        overflow: 'hidden',
        background: C.linen,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
      }}
    >
      {/* Shimmer bar */}
      <motion.div
        animate={{ x: ['-100%', '200%'] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
          borderRadius: 12,
        }}
      />
      <Camera size={28} style={{ color: C.primary, zIndex: 1 }} />
      <span style={{ fontSize: 13, color: C.stone, fontWeight: 500, zIndex: 1 }}>
        Scanning receipt…
      </span>
    </motion.div>
  );
}

interface PreFilledFormProps {
  onSave: () => void;
  onCancel: () => void;
}

function PreFilledReceiptForm({ onSave, onCancel }: PreFilledFormProps) {
  const today = new Date().toISOString().split('T')[0];
  const [vendor, setVendor] = useState('Home Depot');
  const [amount, setAmount] = useState('47.82');
  const [category, setCategory] = useState('repairs');
  const [date, setDate] = useState(today);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      style={{
        marginTop: 12,
        background: C.white,
        border: `1.5px solid ${C.linen}`,
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Check size={16} style={{ color: C.moss }} />
        <span style={{ fontSize: 13, color: C.moss, fontWeight: 600 }}>Receipt scanned — confirm details</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: C.stone, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>Vendor</div>
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${C.linen}`, fontSize: 14, color: C.ink, boxSizing: 'border-box', outline: 'none' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.stone, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>Amount</div>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${C.linen}`, fontSize: 14, color: C.ink, boxSizing: 'border-box', outline: 'none' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.stone, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>Category</div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${C.linen}`, fontSize: 14, color: C.ink, boxSizing: 'border-box', outline: 'none', background: C.white }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_CONFIG[c].label}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.stone, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>Date</div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${C.linen}`, fontSize: 14, color: C.ink, boxSizing: 'border-box', outline: 'none' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onSave}
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: 10,
            background: C.primary,
            color: C.white,
            fontSize: 14,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            background: 'none',
            color: C.stone,
            fontSize: 14,
            border: `1.5px solid ${C.linen}`,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function MoneyPage() {
  const { payments, expenses, properties, tenants } = useStore();
  const addExpense = useStore((s) => s.addExpense);
  const { showToast } = useToast();

  // Year / compare
  const [year, setYear] = useState(2024);
  const [compareToggle, setCompareToggle] = useState(false);

  // Month selection (default: current month index 0-based)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(new Date().getMonth());

  // Modals / state
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'prefill'>('idle');

  // ── Derived numbers ──────────────────────────────────────────────────────────

  const paidPayments = payments.filter((p) => p.status === 'paid');
  const totalIncome = paidPayments.reduce((s, p) => s + p.amount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const netIncome = totalIncome - totalExpenses;

  const displayNet = useCountUp(Math.abs(netIncome));

  // ── Payments for selected month ──────────────────────────────────────────────

  const paymentsForMonth = selectedMonth === null
    ? payments
    : payments.filter((p) => {
        const d = new Date(p.date + 'T12:00:00');
        return d.getMonth() === selectedMonth;
      });

  const paymentMonthSet = new Set(
    payments.filter((p) => p.status === 'paid').map((p) => new Date(p.date + 'T12:00:00').getMonth())
  );

  // ── Tenant lookup ────────────────────────────────────────────────────────────

  const tenantById = Object.fromEntries(tenants.map((t) => [t.id, t]));

  // ── Expense save ─────────────────────────────────────────────────────────────

  const handleSaveExpense = useCallback(
    (exp: Omit<Expense, 'id'>) => {
      addExpense({ id: `exp-${Date.now()}`, ...exp });
      setShowAddExpense(false);
      showToast('Expense saved', 'success');
    },
    [addExpense, showToast]
  );

  // ── Receipt scan ─────────────────────────────────────────────────────────────

  const handleDropZoneClick = () => {
    if (scanState === 'idle') setScanState('scanning');
  };

  const handleScanDone = useCallback(() => setScanState('prefill'), []);

  const handleReceiptSave = () => {
    addExpense({
      id: `exp-receipt-${Date.now()}`,
      propertyId: properties[0]?.id ?? '',
      amount: 47.82,
      date: new Date().toISOString().split('T')[0],
      category: 'repairs',
      vendor: 'Home Depot',
      description: 'Receipt scanned via camera',
    });
    setScanState('idle');
    showToast('Receipt expense saved', 'success');
  };

  // ── Sparkline ────────────────────────────────────────────────────────────────

  const sparkW = 280;
  const sparkH = 48;
  const sparkPath = buildSparklinePath(SPARKLINE_POINTS, sparkW, sparkH);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        style={{
          background: C.cream,
          minHeight: '100vh',
          padding: '16px',
          maxWidth: 600,
          margin: '0 auto',
          paddingBottom: 96,
          boxSizing: 'border-box',
        }}
      >
        {/* ── Section 1: Year + Compare toggle ─────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          {/* Year selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.stone, display: 'flex' }}
              aria-label="Previous year"
            >
              <ChevronLeft size={18} />
            </button>
            <span style={{ fontSize: 18, fontWeight: 700, color: C.ink, fontFamily: 'Inter, sans-serif', minWidth: 44, textAlign: 'center' }}>
              {year}
            </span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.stone, display: 'flex' }}
              aria-label="Next year"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Compare toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: C.stone }}>Compare to last year</span>
            <Toggle value={compareToggle} onChange={setCompareToggle} />
          </div>
        </div>

        {/* ── Section 2: Hero summary card ─────────────────────────────────── */}
        <div
          style={{
            background: C.white,
            borderRadius: 20,
            border: `1px solid ${C.linen}`,
            padding: 24,
            marginBottom: 24,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: C.stone,
              marginBottom: 8,
            }}
          >
            What you&apos;ve kept this year
          </div>

          {/* Big net income number */}
          <div
            style={{
              fontSize: 48,
              fontFamily: 'Fraunces, Georgia, serif',
              fontWeight: 700,
              color: netIncome >= 0 ? C.ink : C.brick,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              marginBottom: 16,
            }}
          >
            {netIncome < 0 ? '-' : ''}${displayNet.toLocaleString()}
          </div>

          {/* Three pills */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                background: C.mossBg,
                color: C.moss,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Made: {formatCurrency(totalIncome)}
            </span>
            <span
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                background: C.honeyBg,
                color: C.honey,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Spent: {formatCurrency(totalExpenses)}
            </span>
            <span
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                background: C.primary50,
                color: C.primary,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Kept: {formatCurrency(netIncome)}
            </span>
          </div>

          {/* Sparkline */}
          <div style={{ display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
            <svg
              width={sparkW}
              height={sparkH}
              viewBox={`0 0 ${sparkW} ${sparkH}`}
              style={{ overflow: 'visible' }}
            >
              {/* Month labels */}
              {MONTHS.map((m, i) => (
                <text
                  key={m}
                  x={4 + (i / 11) * (sparkW - 8)}
                  y={sparkH - 2}
                  textAnchor="middle"
                  fontSize={8}
                  fill={C.mist}
                  fontFamily="Inter, sans-serif"
                >
                  {m[0]}
                </text>
              ))}
              <path
                d={buildSparklinePath(SPARKLINE_POINTS, sparkW, sparkH - 12)}
                fill="none"
                stroke={C.primary}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* ── Section 3: Money coming in ───────────────────────────────────── */}
        <div style={{ marginBottom: 28 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 22, fontFamily: 'Fraunces, Georgia, serif', color: C.ink, margin: 0 }}>
              Money coming in
            </h2>
            <button
              type="button"
              onClick={() => setSelectedMonth(null)}
              style={{
                background: selectedMonth === null ? C.primary50 : 'none',
                border: `1px solid ${selectedMonth === null ? C.primary100 : C.linen}`,
                borderRadius: 8,
                padding: '6px 8px',
                cursor: 'pointer',
                color: selectedMonth === null ? C.primary : C.stone,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
              }}
            >
              <Filter size={14} />
              {selectedMonth === null ? 'All' : 'Filter'}
            </button>
          </div>

          {/* Calendar month grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6,
              marginBottom: 16,
            }}
          >
            {MONTHS.map((m, i) => {
              const isSelected = selectedMonth === i;
              const hasPaid = paymentMonthSet.has(i);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMonth(i === selectedMonth ? null : i)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: 10,
                    background: isSelected ? C.primary : C.white,
                    border: `1px solid ${isSelected ? C.primary : C.linen}`,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.15s',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isSelected ? C.white : C.charcoal,
                    }}
                  >
                    {m}
                  </span>
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: hasPaid
                        ? isSelected
                          ? 'rgba(255,255,255,0.7)'
                          : C.moss
                        : 'transparent',
                      border: hasPaid ? 'none' : `1.5px solid ${isSelected ? 'rgba(255,255,255,0.4)' : C.linen}`,
                    }}
                  />
                </button>
              );
            })}
          </div>

          {/* Payment list */}
          <div>
            {paymentsForMonth.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '24px 0',
                  color: C.mist,
                  fontSize: 14,
                }}
              >
                No payments for {selectedMonth !== null ? MONTHS[selectedMonth] : 'this period'}
              </div>
            ) : (
              paymentsForMonth.map((p) => {
                const tenant = tenantById[p.tenantId];
                const statusColor =
                  p.status === 'paid'
                    ? C.moss
                    : p.status === 'pending'
                    ? C.honey
                    : C.brick;

                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      background: C.white,
                      border: `1px solid ${C.linen}`,
                      borderRadius: 12,
                      padding: 16,
                      marginBottom: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      borderLeft: `4px solid ${statusColor}`,
                    }}
                  >
                    {/* Left: tenant + date */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tenant?.name ?? 'Unknown tenant'}
                      </div>
                      <div style={{ fontSize: 12, color: C.stone }}>
                        {formatDate(p.date)}
                      </div>
                    </div>

                    {/* Right: amount + method badge */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span
                        style={{
                          fontSize: 20,
                          fontFamily: 'Fraunces, Georgia, serif',
                          fontWeight: 700,
                          color: C.ink,
                          lineHeight: 1,
                        }}
                      >
                        {formatCurrency(p.amount)}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 20,
                          background: C.linen,
                          color: C.stone,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {METHOD_LABEL[p.method] ?? p.method}
                      </span>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>

          {/* Record payment button */}
          <button
            type="button"
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: 12,
              border: `2px dashed ${C.linen}`,
              background: 'transparent',
              color: C.stone,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = C.primary)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = C.linen)}
          >
            <Camera size={16} style={{ color: C.primary }} />
            + Record a payment
          </button>
        </div>

        {/* ── Section 4: Money going out ───────────────────────────────────── */}
        <div style={{ marginBottom: 28 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 22, fontFamily: 'Fraunces, Georgia, serif', color: C.ink, margin: 0 }}>
              Money going out
            </h2>
            <button
              type="button"
              onClick={() => setShowAddExpense(true)}
              style={{
                padding: '7px 14px',
                borderRadius: 20,
                background: C.primary,
                color: C.white,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Add expense
            </button>
          </div>

          {/* Donut chart */}
          <div
            style={{
              background: C.white,
              border: `1px solid ${C.linen}`,
              borderRadius: 16,
              padding: 20,
              marginBottom: 16,
            }}
          >
            <DonutChart expenses={expenses} />
          </div>

          {/* Expense list (last 8) */}
          <div>
            {expenses.slice(-8).reverse().map((exp) => {
              const conf = CATEGORY_CONFIG[exp.category] ?? CATEGORY_CONFIG.other;
              return (
                <div
                  key={exp.id}
                  style={{
                    background: C.white,
                    border: `1px solid ${C.linen}`,
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    borderLeft: `4px solid ${conf.color}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {exp.vendor ?? exp.description}
                    </div>
                    <div style={{ fontSize: 12, color: C.stone }}>
                      {conf.label} · {formatDate(exp.date)}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 16,
                      fontFamily: 'Fraunces, Georgia, serif',
                      fontWeight: 700,
                      color: C.ink,
                      flexShrink: 0,
                    }}
                  >
                    {formatCurrency(exp.amount)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Drop a receipt zone */}
          <div style={{ position: 'relative' }}>
            <AnimatePresence mode="wait">
              {scanState === 'scanning' ? (
                <div
                  style={{
                    height: 120,
                    borderRadius: 12,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <ScanOverlay key="scan" onDone={handleScanDone} />
                </div>
              ) : scanState === 'prefill' ? (
                <AnimatePresence key="prefill">
                  <PreFilledReceiptForm
                    onSave={handleReceiptSave}
                    onCancel={() => setScanState('idle')}
                  />
                </AnimatePresence>
              ) : (
                <motion.button
                  key="dropzone"
                  type="button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={handleDropZoneClick}
                  style={{
                    width: '100%',
                    height: 120,
                    borderRadius: 12,
                    border: `2px dashed ${C.mist}`,
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = C.primary;
                    e.currentTarget.style.background = C.primary50;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = C.mist;
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <Upload size={32} style={{ color: C.mist }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: C.stone }}>
                      Drop a photo of a receipt or tap to scan
                    </div>
                    <div style={{ fontSize: 12, color: C.mist, marginTop: 2 }}>
                      We&apos;ll read it and fill in the details
                    </div>
                  </div>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Section 5: Tax-ready ─────────────────────────────────────────── */}
        <div
          style={{
            background: C.white,
            border: `1px solid ${C.linen}`,
            borderRadius: 20,
            padding: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <FileText size={18} style={{ color: C.primary }} />
            <h2 style={{ fontSize: 20, fontFamily: 'Fraunces, Georgia, serif', color: C.ink, margin: 0 }}>
              Tax-ready
            </h2>
          </div>

          {/* Progress label */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 14, color: C.charcoal, fontWeight: 500 }}>
              78% of your records have categories
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>78%</span>
          </div>

          {/* Progress bar */}
          <div
            style={{
              height: 8,
              borderRadius: 12,
              background: C.linen,
              overflow: 'hidden',
              marginBottom: 10,
            }}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '78%' }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
              style={{ height: '100%', background: C.primary, borderRadius: 12 }}
            />
          </div>

          {/* Link */}
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: C.primary,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
              marginBottom: 16,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            Let&apos;s finish that
          </button>

          {/* Generate Schedule E */}
          <button
            type="button"
            onClick={() => showToast('Coming soon in Pro plan', 'warning')}
            style={{
              width: '100%',
              padding: '13px',
              borderRadius: 12,
              border: `1.5px solid ${C.linen}`,
              background: 'transparent',
              color: C.charcoal,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = C.primary)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = C.linen)}
          >
            <FileText size={16} style={{ color: C.primary }} />
            Generate Schedule E
          </button>
        </div>
      </div>

      {/* ── Add Expense Modal ─────────────────────────────────────────────── */}
      <AddExpenseModal
        open={showAddExpense}
        onClose={() => setShowAddExpense(false)}
        onSave={handleSaveExpense}
        properties={properties}
      />
    </>
  );
}
