'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Home, Layers, LayoutGrid, HelpCircle,
  ChevronLeft, Edit3, MessageSquare, FileText, Cloud,
  BedDouble, Bath, Maximize2, CalendarDays, Plus,
  AlertCircle, Clock, CheckCircle2,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { formatCurrency, formatDate, formatRelativeTime, getInitials } from '@/lib/utils';
import type { Property, Tenant, Payment, Expense, MaintenanceRequest } from '@/lib/types';

/* ─── Brand tokens ─── */
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
};

/* ─── Property type config ─── */
type PropertyType = Property['type'];

const typeConfig: Record<PropertyType, { gradient: string; icon: React.ReactNode }> = {
  house: {
    gradient: 'linear-gradient(135deg, #C75D3D 0%, #A84A2E 100%)',
    icon: <Home size={52} color="#FFFFFF" strokeWidth={1.5} />,
  },
  duplex: {
    gradient: 'linear-gradient(135deg, #D4923B 0%, #B07A2E 100%)',
    icon: <Layers size={52} color="#FFFFFF" strokeWidth={1.5} />,
  },
  condo: {
    gradient: 'linear-gradient(135deg, #4A90C4 0%, #2E6E9E 100%)',
    icon: <Building2 size={52} color="#FFFFFF" strokeWidth={1.5} />,
  },
  apartment: {
    gradient: 'linear-gradient(135deg, #5C8A3A 0%, #3E6025 100%)',
    icon: <LayoutGrid size={52} color="#FFFFFF" strokeWidth={1.5} />,
  },
  other: {
    gradient: 'linear-gradient(135deg, #6B6058 0%, #4D4540 100%)',
    icon: <HelpCircle size={52} color="#FFFFFF" strokeWidth={1.5} />,
  },
};

/* ─── Tab types ─── */
type Tab = 'overview' | 'tenants' | 'money' | 'maintenance' | 'docs';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tenants', label: 'Tenants' },
  { id: 'money', label: 'Money' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'docs', label: 'Docs' },
];

/* ─── Stat Card ─── */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        backgroundColor: C.white,
        borderRadius: 12,
        padding: 16,
        border: `1px solid ${C.linen}`,
      }}
    >
      <p style={{ fontSize: 12, color: C.mist, margin: '0 0 4px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </p>
      <p style={{ fontSize: 20, fontFamily: 'Fraunces, serif', color: C.ink, margin: 0, fontWeight: 500 }}>
        {value}
      </p>
    </div>
  );
}

/* ─── Status badge ─── */
function Badge({
  label,
  bg,
  color,
}: {
  label: string;
  bg: string;
  color: string;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: bg,
        color,
        textTransform: 'capitalize',
      }}
    >
      {label}
    </span>
  );
}

function paymentBadge(status: Payment['status']) {
  if (status === 'paid') return <Badge label="Paid" bg={C.mossBg} color={C.moss} />;
  if (status === 'pending') return <Badge label="Pending" bg={C.honeyBg} color={C.honey} />;
  if (status === 'late') return <Badge label="Late" bg={C.brickBg} color={C.brick} />;
  return <Badge label="Failed" bg={C.brickBg} color={C.brick} />;
}

function tenantStatusBadge(status: Tenant['status']) {
  if (status === 'current') return <Badge label="Current" bg={C.mossBg} color={C.moss} />;
  if (status === 'late') return <Badge label="Late" bg={C.brickBg} color={C.brick} />;
  return <Badge label="Moving out" bg={C.honeyBg} color={C.honey} />;
}

function maintenanceStatusBadge(status: MaintenanceRequest['status']) {
  if (status === 'open') return <Badge label="Open" bg={C.brickBg} color={C.brick} />;
  if (status === 'in_progress') return <Badge label="In progress" bg={C.honeyBg} color={C.honey} />;
  return <Badge label="Resolved" bg={C.mossBg} color={C.moss} />;
}

/* ─── Overview Tab ─── */
function OverviewTab({
  property,
  tenants,
  payments,
  expenses,
  maintenanceRequests,
}: {
  property: Property;
  tenants: Tenant[];
  payments: Payment[];
  expenses: Expense[];
  maintenanceRequests: MaintenanceRequest[];
}) {
  const currentYear = new Date().getFullYear();
  const yearPayments = payments.filter(
    (p) => new Date(p.date).getFullYear() === currentYear && p.status === 'paid',
  );
  const yearExpenses = expenses.filter(
    (e) => new Date(e.date).getFullYear() === currentYear,
  );
  const incomeTotal = yearPayments.reduce((sum, p) => sum + p.amount, 0);
  const expenseTotal = yearExpenses.reduce((sum, e) => sum + e.amount, 0);
  const netTotal = incomeTotal - expenseTotal;
  const openIssues = maintenanceRequests.filter((r) => r.status !== 'resolved').length;
  const occupiedUnits = tenants.length;

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <StatCard label="Monthly rent" value={formatCurrency(property.monthlyRent)} />
        <StatCard
          label="Net this year"
          value={formatCurrency(netTotal)}
        />
        <StatCard label="Open issues" value={String(openIssues)} />
        <StatCard
          label="Tenants"
          value={`${occupiedUnits} / ${property.units}`}
        />
      </div>

      {/* About */}
      <div
        style={{
          backgroundColor: C.white,
          borderRadius: 16,
          padding: 20,
          border: `1px solid ${C.linen}`,
          marginBottom: 16,
        }}
      >
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, color: C.ink, margin: '0 0 16px', fontWeight: 500 }}>
          About this property
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { icon: <BedDouble size={16} color={C.mist} />, label: 'Beds', value: property.beds != null ? String(property.beds) : '—' },
            { icon: <Bath size={16} color={C.mist} />, label: 'Baths', value: property.baths != null ? String(property.baths) : '—' },
            { icon: <Maximize2 size={16} color={C.mist} />, label: 'Sq ft', value: property.sqft != null ? property.sqft.toLocaleString() : '—' },
            { icon: <CalendarDays size={16} color={C.mist} />, label: 'Year built', value: property.yearBuilt != null ? String(property.yearBuilt) : '—' },
          ].map(({ icon, label, value }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {icon}
              <div>
                <p style={{ fontSize: 11, color: C.mist, margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>
                  {label}
                </p>
                <p style={{ fontSize: 15, color: C.charcoal, margin: 0, fontWeight: 500 }}>
                  {value}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* At a glance */}
      <div
        style={{
          backgroundColor: C.white,
          borderRadius: 16,
          padding: 20,
          border: `1px solid ${C.linen}`,
        }}
      >
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, color: C.ink, margin: '0 0 16px', fontWeight: 500 }}>
          At a glance
        </h3>
        {[
          { label: 'Property type', value: property.type.charAt(0).toUpperCase() + property.type.slice(1) },
          { label: 'Units', value: String(property.units) },
          { label: 'Lease type', value: tenants.length > 0 ? (tenants[0].leaseType === 'month-to-month' ? 'Month-to-month' : 'Fixed term') : 'N/A' },
          { label: 'Pet policy', value: 'N/A' },
          { label: 'Occupied', value: property.isOccupied ? 'Yes' : 'No' },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: `1px solid ${C.linen}`,
            }}
          >
            <span style={{ fontSize: 14, color: C.stone }}>{label}</span>
            <span style={{ fontSize: 14, color: C.charcoal, fontWeight: 500 }}>{value}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ─── Tenants Tab ─── */
function TenantsTab({
  tenants,
  payments,
  propertyId,
}: {
  tenants: Tenant[];
  payments: Payment[];
  propertyId: string;
}) {
  if (tenants.length === 0) {
    return (
      <motion.div
        key="tenants"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        style={{ textAlign: 'center', paddingTop: 60 }}
      >
        <p style={{ fontSize: 40, marginBottom: 12 }}>👤</p>
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 20, color: C.ink, margin: '0 0 8px' }}>
          No tenants yet
        </h3>
        <p style={{ fontSize: 14, color: C.stone }}>Add a tenant to start tracking rent</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="tenants"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      {tenants.map((tenant) => {
        const tenantPayments = payments
          .filter((p) => p.tenantId === tenant.id)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const lastPayment = tenantPayments[0];

        // Compute next due date
        const today = new Date();
        const nextDue = new Date(today.getFullYear(), today.getMonth(), tenant.rentDueDay);
        if (nextDue < today) nextDue.setMonth(nextDue.getMonth() + 1);

        return (
          <div
            key={tenant.id}
            style={{
              backgroundColor: C.white,
              borderRadius: 16,
              padding: 20,
              border: `1px solid ${C.linen}`,
              marginBottom: 16,
            }}
          >
            {/* Tenant header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              {/* Avatar */}
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  backgroundColor: C.primary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: C.white,
                  fontSize: 16,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {getInitials(tenant.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'Fraunces, serif', fontSize: 17, color: C.ink, fontWeight: 500 }}>
                    {tenant.name}
                  </span>
                  {tenantStatusBadge(tenant.status)}
                </div>
                <p style={{ fontSize: 13, color: C.stone, margin: '2px 0 0' }}>
                  Rent: {formatCurrency(tenant.monthlyRent)}/mo
                </p>
              </div>
            </div>

            {/* Lease info */}
            <div
              style={{
                backgroundColor: C.cream,
                borderRadius: 10,
                padding: '12px 14px',
                marginBottom: 14,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: C.stone }}>Lease type</span>
                <span style={{ fontSize: 13, color: C.charcoal, fontWeight: 500 }}>
                  {tenant.leaseType === 'month-to-month' ? 'Month-to-month' : 'Fixed term'}
                </span>
              </div>
              {tenant.leaseEnd && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: C.stone }}>Lease ends</span>
                  <span style={{ fontSize: 13, color: C.charcoal, fontWeight: 500 }}>
                    {formatDate(tenant.leaseEnd)}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: C.stone }}>Last payment</span>
                <span style={{ fontSize: 13, color: C.charcoal, fontWeight: 500 }}>
                  {lastPayment ? formatDate(lastPayment.date) : 'No payments yet'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: C.stone }}>Next due</span>
                <span style={{ fontSize: 13, color: C.charcoal, fontWeight: 500 }}>
                  {formatDate(nextDue)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <Link
                href={`/messages?tenant=${tenant.id}`}
                style={{ textDecoration: 'none', flex: 1 }}
              >
                <button
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    backgroundColor: C.primary50,
                    color: C.primary,
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <MessageSquare size={14} />
                  Message
                </button>
              </Link>
              <button
                disabled
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  backgroundColor: C.cream,
                  color: C.mist,
                  border: `1px solid ${C.linen}`,
                  cursor: 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <FileText size={14} />
                View lease
              </button>
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}

/* ─── Money Tab ─── */
function MoneyTab({
  payments,
  expenses,
}: {
  payments: Payment[];
  expenses: Expense[];
}) {
  const currentYear = new Date().getFullYear();
  const yearPayments = payments.filter(
    (p) => new Date(p.date).getFullYear() === currentYear,
  );
  const yearExpenses = expenses.filter(
    (e) => new Date(e.date).getFullYear() === currentYear,
  );
  const incomeTotal = yearPayments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const expenseTotal = yearExpenses.reduce((s, e) => s + e.amount, 0);
  const net = incomeTotal - expenseTotal;

  const recentPayments = [...payments]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
  const recentExpenses = [...expenses]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  const categoryLabel: Record<string, string> = {
    repairs: 'Repairs',
    insurance: 'Insurance',
    mortgage: 'Mortgage',
    property_tax: 'Property tax',
    utilities: 'Utilities',
    other: 'Other',
  };

  return (
    <motion.div
      key="money"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      {/* Year summary */}
      <div
        style={{
          backgroundColor: C.white,
          borderRadius: 16,
          padding: 20,
          border: `1px solid ${C.linen}`,
          marginBottom: 20,
        }}
      >
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, color: C.ink, margin: '0 0 16px', fontWeight: 500 }}>
          This year
        </h3>
        {[
          { label: 'Income', value: formatCurrency(incomeTotal), color: C.moss },
          { label: 'Expenses', value: formatCurrency(expenseTotal), color: C.brick },
          { label: 'Net', value: formatCurrency(net), color: net >= 0 ? C.moss : C.brick },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: `1px solid ${C.linen}`,
            }}
          >
            <span style={{ fontSize: 14, color: C.stone }}>{label}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Recent payments */}
      <div
        style={{
          backgroundColor: C.white,
          borderRadius: 16,
          padding: 20,
          border: `1px solid ${C.linen}`,
          marginBottom: 20,
        }}
      >
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, color: C.ink, margin: '0 0 16px', fontWeight: 500 }}>
          Recent payments
        </h3>
        {recentPayments.length === 0 ? (
          <p style={{ fontSize: 14, color: C.mist }}>No payments yet</p>
        ) : (
          recentPayments.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: `1px solid ${C.linen}`,
              }}
            >
              <div>
                <p style={{ fontSize: 14, color: C.charcoal, margin: 0, fontWeight: 500 }}>
                  {formatCurrency(p.amount)}
                </p>
                <p style={{ fontSize: 12, color: C.mist, margin: '2px 0 0' }}>
                  {formatDate(p.date)} · {p.method.toUpperCase()}
                </p>
              </div>
              {paymentBadge(p.status)}
            </div>
          ))
        )}
      </div>

      {/* Recent expenses */}
      <div
        style={{
          backgroundColor: C.white,
          borderRadius: 16,
          padding: 20,
          border: `1px solid ${C.linen}`,
        }}
      >
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, color: C.ink, margin: '0 0 16px', fontWeight: 500 }}>
          Recent expenses
        </h3>
        {recentExpenses.length === 0 ? (
          <p style={{ fontSize: 14, color: C.mist }}>No expenses yet</p>
        ) : (
          recentExpenses.map((e) => (
            <div
              key={e.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: `1px solid ${C.linen}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    backgroundColor: C.honeyBg,
                    color: C.honey,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {categoryLabel[e.category] ?? e.category}
                </span>
                <div>
                  <p style={{ fontSize: 14, color: C.charcoal, margin: 0, fontWeight: 500 }}>
                    {formatCurrency(e.amount)}
                  </p>
                  {e.vendor && (
                    <p style={{ fontSize: 12, color: C.mist, margin: '2px 0 0' }}>
                      {e.vendor} · {formatDate(e.date)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}

/* ─── Maintenance Tab ─── */
function MaintenanceTab({
  requests,
}: {
  requests: MaintenanceRequest[];
}) {
  const priorityBorder: Record<string, string> = {
    urgent: C.brick,
    medium: C.honey,
    low: C.moss,
  };

  return (
    <motion.div
      key="maintenance"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 14, color: C.stone }}>
          {requests.length} request{requests.length !== 1 ? 's' : ''}
        </span>
        <Link href="/maintenance" style={{ textDecoration: 'none' }}>
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: C.primary,
              color: C.white,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
            New request
          </button>
        </Link>
      </div>

      {requests.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 48 }}>
          <CheckCircle2 size={40} color={C.moss} style={{ marginBottom: 12 }} />
          <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 20, color: C.ink, margin: '0 0 8px' }}>
            All clear
          </h3>
          <p style={{ fontSize: 14, color: C.stone }}>No maintenance requests for this property</p>
        </div>
      ) : (
        requests.map((req) => (
          <div
            key={req.id}
            style={{
              backgroundColor: C.white,
              borderRadius: 14,
              overflow: 'hidden',
              border: `1px solid ${C.linen}`,
              borderLeft: `4px solid ${priorityBorder[req.priority]}`,
              marginBottom: 12,
              padding: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 15, color: C.ink, margin: '0 0 4px', fontWeight: 600 }}>
                {req.title}
              </p>
              <p style={{ fontSize: 12, color: C.mist, margin: 0 }}>
                {formatRelativeTime(req.createdAt)}
              </p>
            </div>
            <div style={{ flexShrink: 0 }}>
              {maintenanceStatusBadge(req.status)}
            </div>
          </div>
        ))
      )}
    </motion.div>
  );
}

/* ─── Docs Tab ─── */
function DocsTab() {
  return (
    <motion.div
      key="docs"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      {/* Placeholder doc cards */}
      {[
        { label: 'Lease Agreement', hint: 'Signed lease PDF' },
        { label: 'Move-in Checklist', hint: 'Property condition at move-in' },
      ].map(({ label, hint }) => (
        <div
          key={label}
          style={{
            backgroundColor: C.white,
            borderRadius: 14,
            padding: 18,
            border: `1px solid ${C.linen}`,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              backgroundColor: C.brickBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FileText size={22} color={C.brick} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 15, color: C.ink, margin: '0 0 2px', fontWeight: 600 }}>{label}</p>
            <p style={{ fontSize: 12, color: C.mist, margin: 0 }}>{hint}</p>
          </div>
          <button
            disabled
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: C.cream,
              color: C.mist,
              border: `1px solid ${C.linen}`,
              cursor: 'not-allowed',
            }}
          >
            View
          </button>
        </div>
      ))}

      {/* Upload button */}
      <button
        style={{
          width: '100%',
          padding: 20,
          borderRadius: 14,
          border: `2px dashed ${C.linen}`,
          backgroundColor: 'transparent',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          marginTop: 8,
        }}
      >
        <Cloud size={28} color={C.mist} />
        <span style={{ fontSize: 14, color: C.stone, fontWeight: 600 }}>Upload document</span>
        <span style={{ fontSize: 12, color: C.mist }}>PDF, JPG, PNG up to 10MB</span>
      </button>
    </motion.div>
  );
}

/* ─── Main Page ─── */
export default function PropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const { properties, tenants, payments, expenses, maintenanceRequests } = useStore();

  const property = properties.find((p) => p.id === id);
  const propTenants = tenants.filter((t) => t.propertyId === id);
  const propPayments = payments.filter((p) => p.propertyId === id);
  const propExpenses = expenses.filter((e) => e.propertyId === id);
  const propMaintenance = maintenanceRequests.filter((r) => r.propertyId === id);

  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Sticky tab bar
  const [tabsSticky, setTabsSticky] = useState(false);
  const tabSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tabSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setTabsSticky(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-56px 0px 0px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!property) {
    return (
      <div
        style={{
          backgroundColor: C.cream,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
        }}
      >
        <span style={{ fontSize: 56 }}>🏚️</span>
        <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, color: C.ink, margin: 0 }}>
          Property not found
        </h2>
        <p style={{ fontSize: 14, color: C.stone, margin: 0 }}>
          This property doesn&apos;t exist or was removed.
        </p>
        <button
          onClick={() => router.push('/properties')}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 600,
            backgroundColor: C.primary,
            color: C.white,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Back to properties
        </button>
      </div>
    );
  }

  const config = typeConfig[property.type];

  return (
    <div style={{ backgroundColor: C.cream, minHeight: '100vh' }}>
      {/* Hero */}
      <div style={{ position: 'relative', height: 200, background: config.gradient }}>
        {/* Icon centered */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {config.icon}
        </div>

        {/* Back button top-left */}
        <button
          onClick={() => router.push('/properties')}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.2)',
            border: '1px solid rgba(255,255,255,0.4)',
            color: C.white,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
          }}
        >
          <ChevronLeft size={14} />
          Back
        </button>

        {/* Edit button top-right */}
        <button
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.2)',
            border: '1px solid rgba(255,255,255,0.4)',
            color: C.white,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
          }}
        >
          <Edit3 size={14} />
          Edit
        </button>

        {/* Name + address overlay bottom-left */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '24px 20px 16px',
            background: 'linear-gradient(to top, rgba(26,23,20,0.55) 0%, transparent 100%)',
          }}
        >
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 24,
              color: C.white,
              margin: '0 0 2px',
              fontWeight: 500,
              lineHeight: 1.2,
            }}
          >
            {property.name}
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.82)', margin: 0 }}>
            {property.address}
          </p>
        </div>
      </div>

      {/* Sentinel for sticky detection */}
      <div ref={tabSentinelRef} />

      {/* Tab bar */}
      <div
        style={{
          position: 'sticky',
          top: 56,
          zIndex: 20,
          backgroundColor: C.white,
          borderBottom: `1px solid ${C.linen}`,
          boxShadow: tabsSticky ? '0 2px 8px rgba(26,23,20,0.06)' : 'none',
          transition: 'box-shadow 0.2s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            padding: '0 16px',
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '14px 16px',
                fontSize: 14,
                fontWeight: 600,
                color: activeTab === tab.id ? C.primary : C.mist,
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${activeTab === tab.id ? C.primary : 'transparent'}`,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'color 0.2s ease, border-color 0.2s ease',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ padding: '20px 16px 40px', maxWidth: 680, margin: '0 auto' }}>
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <OverviewTab
              key="overview"
              property={property}
              tenants={propTenants}
              payments={propPayments}
              expenses={propExpenses}
              maintenanceRequests={propMaintenance}
            />
          )}
          {activeTab === 'tenants' && (
            <TenantsTab
              key="tenants"
              tenants={propTenants}
              payments={propPayments}
              propertyId={id}
            />
          )}
          {activeTab === 'money' && (
            <MoneyTab
              key="money"
              payments={propPayments}
              expenses={propExpenses}
            />
          )}
          {activeTab === 'maintenance' && (
            <MaintenanceTab
              key="maintenance"
              requests={propMaintenance}
            />
          )}
          {activeTab === 'docs' && <DocsTab key="docs" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
