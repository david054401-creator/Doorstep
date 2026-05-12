'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Home, Layers, LayoutGrid, HelpCircle, Plus, X,
  ChevronRight, MessageSquare,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { formatCurrency } from '@/lib/utils';
import type { Property } from '@/lib/types';

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
    icon: <Home size={48} color="#FFFFFF" strokeWidth={1.5} />,
  },
  duplex: {
    gradient: 'linear-gradient(135deg, #D4923B 0%, #B07A2E 100%)',
    icon: <Layers size={48} color="#FFFFFF" strokeWidth={1.5} />,
  },
  condo: {
    gradient: 'linear-gradient(135deg, #4A90C4 0%, #2E6E9E 100%)',
    icon: <Building2 size={48} color="#FFFFFF" strokeWidth={1.5} />,
  },
  apartment: {
    gradient: 'linear-gradient(135deg, #5C8A3A 0%, #3E6025 100%)',
    icon: <LayoutGrid size={48} color="#FFFFFF" strokeWidth={1.5} />,
  },
  other: {
    gradient: 'linear-gradient(135deg, #6B6058 0%, #4D4540 100%)',
    icon: <HelpCircle size={48} color="#FFFFFF" strokeWidth={1.5} />,
  },
};

/* ─── Add Property Modal ─── */
const PROPERTY_TYPES: PropertyType[] = ['house', 'duplex', 'condo', 'apartment', 'other'];

function AddPropertyModal({ onClose }: { onClose: () => void }) {
  const addProperty = useStore((s) => s.addProperty);
  const router = useRouter();

  const [form, setForm] = useState({
    name: '',
    address: '',
    type: 'house' as PropertyType,
    units: '1',
    monthlyRent: '',
    beds: '',
    baths: '',
    sqft: '',
    yearBuilt: '',
  });

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.address.trim() || !form.monthlyRent) return;
    addProperty({
      id: `prop-${Date.now()}`,
      name: form.name.trim(),
      address: form.address.trim(),
      type: form.type,
      units: parseInt(form.units) || 1,
      monthlyRent: parseFloat(form.monthlyRent) || 0,
      isOccupied: false,
      beds: form.beds ? parseInt(form.beds) : undefined,
      baths: form.baths ? parseInt(form.baths) : undefined,
      sqft: form.sqft ? parseInt(form.sqft) : undefined,
      yearBuilt: form.yearBuilt ? parseInt(form.yearBuilt) : undefined,
    });
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(26,23,20,0.5)',
          zIndex: 40,
        }}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: 300 }}
        animate={{ y: 0 }}
        exit={{ y: 300 }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          backgroundColor: C.white, borderRadius: '20px 20px 0 0',
          padding: '24px 20px 40px',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        {/* Handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.linen, margin: '0 auto 20px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, color: C.ink, margin: 0 }}>
            Add a property
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.stone, padding: 4 }}
          >
            <X size={22} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Property type */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.charcoal, marginBottom: 8 }}>
              Property type
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PROPERTY_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleChange('type', t)}
                  style={{
                    padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
                    border: `2px solid ${form.type === t ? C.primary : C.linen}`,
                    backgroundColor: form.type === t ? C.primary50 : C.white,
                    color: form.type === t ? C.primary : C.stone,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.charcoal, marginBottom: 6 }}>
              Property name *
            </label>
            <input
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="e.g. The Yellow House"
              required
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 15,
                border: `1.5px solid ${C.linen}`, backgroundColor: C.white, color: C.ink,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Address */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.charcoal, marginBottom: 6 }}>
              Address *
            </label>
            <input
              value={form.address}
              onChange={(e) => handleChange('address', e.target.value)}
              placeholder="123 Elm St, Portland, OR 97201"
              required
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 15,
                border: `1.5px solid ${C.linen}`, backgroundColor: C.white, color: C.ink,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Rent + Units */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.charcoal, marginBottom: 6 }}>
                Monthly rent *
              </label>
              <input
                type="number"
                value={form.monthlyRent}
                onChange={(e) => handleChange('monthlyRent', e.target.value)}
                placeholder="$1,500"
                required
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 15,
                  border: `1.5px solid ${C.linen}`, backgroundColor: C.white, color: C.ink,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.charcoal, marginBottom: 6 }}>
                Units
              </label>
              <input
                type="number"
                value={form.units}
                onChange={(e) => handleChange('units', e.target.value)}
                min="1"
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 15,
                  border: `1.5px solid ${C.linen}`, backgroundColor: C.white, color: C.ink,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Beds / Baths / Sqft / Year */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
            {[
              { field: 'beds', label: 'Bedrooms', placeholder: '3' },
              { field: 'baths', label: 'Bathrooms', placeholder: '2' },
              { field: 'sqft', label: 'Sq ft', placeholder: '1,200' },
              { field: 'yearBuilt', label: 'Year built', placeholder: '1985' },
            ].map(({ field, label, placeholder }) => (
              <div key={field}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.charcoal, marginBottom: 6 }}>
                  {label}
                </label>
                <input
                  type="number"
                  value={form[field as keyof typeof form]}
                  onChange={(e) => handleChange(field, e.target.value)}
                  placeholder={placeholder}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 15,
                    border: `1.5px solid ${C.linen}`, backgroundColor: C.white, color: C.ink,
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
          </div>

          {/* Submit */}
          <button
            type="submit"
            style={{
              width: '100%', padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 600,
              backgroundColor: C.primary, color: C.white, border: 'none', cursor: 'pointer',
            }}
          >
            Add property
          </button>
        </form>
      </motion.div>
    </>
  );
}

/* ─── Property Card ─── */
function PropertyCard({ property }: { property: Property }) {
  const [hovered, setHovered] = useState(false);
  const config = typeConfig[property.type];

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.15 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: C.white,
        borderRadius: 20,
        border: `1px solid ${C.linen}`,
        boxShadow: hovered
          ? '0 8px 30px rgba(26,23,20,0.12)'
          : '0 2px 8px rgba(26,23,20,0.06)',
        overflow: 'hidden',
        marginBottom: 16,
        transition: 'box-shadow 0.2s ease',
      }}
    >
      {/* Banner */}
      <div
        style={{
          height: 180,
          background: config.gradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {config.icon}
      </div>

      {/* Content */}
      <div style={{ padding: 16 }}>
        {/* Name + occupancy */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 20,
              color: C.ink,
              fontWeight: 500,
              lineHeight: 1.2,
            }}
          >
            {property.name}
          </span>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: property.isOccupied ? '#5C8A3A' : '#B8442E',
              flexShrink: 0,
            }}
          />
        </div>

        {/* Address */}
        <p style={{ fontSize: 14, color: C.stone, margin: '0 0 12px', lineHeight: 1.4 }}>
          {property.address}
        </p>

        {/* Stats */}
        <p style={{ fontSize: 14, color: C.stone, margin: '0 0 16px' }}>
          <span>Monthly rent: {formatCurrency(property.monthlyRent)}</span>
          <span style={{ margin: '0 8px', color: C.mist }}>·</span>
          <span>Units: {property.units}</span>
        </p>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/properties/${property.id}`} style={{ textDecoration: 'none', flex: 1 }}>
            <button
              style={{
                width: '100%',
                padding: '8px 14px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                border: `1.5px solid ${C.linen}`,
                backgroundColor: 'transparent',
                color: C.charcoal,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              View details
              <ChevronRight size={14} />
            </button>
          </Link>
          <Link href="/messages" style={{ textDecoration: 'none', flex: 1 }}>
            <button
              style={{
                width: '100%',
                padding: '8px 14px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                backgroundColor: C.primary50,
                color: C.primary,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <MessageSquare size={14} />
              Message
            </button>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Page ─── */
export default function PropertiesPage() {
  const properties = useStore((s) => s.properties);
  const [showModal, setShowModal] = useState(false);

  return (
    <div
      style={{
        backgroundColor: C.cream,
        minHeight: '100vh',
        padding: 16,
      }}
    >
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
            paddingTop: 8,
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
            Your Properties
          </h1>
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              backgroundColor: C.primary,
              color: C.white,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Plus size={16} />
            Add property
          </button>
        </div>

        {/* Property list or empty state */}
        {properties.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 80,
              textAlign: 'center',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 80 }}>🏡</span>
            <h2
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 22,
                color: C.ink,
                margin: 0,
                fontWeight: 500,
              }}
            >
              No properties yet
            </h2>
            <p style={{ fontSize: 15, color: C.stone, margin: 0 }}>
              Add your first property to get started
            </p>
            <Link href="/onboarding" style={{ textDecoration: 'none', marginTop: 8 }}>
              <button
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
                Add property
              </button>
            </Link>
          </motion.div>
        ) : (
          <div>
            {properties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && <AddPropertyModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </div>
  );
}
