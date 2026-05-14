'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Home, Layers, LayoutGrid, HelpCircle, Plus, X,
  ChevronRight, MessageSquare, BedDouble, Bath, Ruler,
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

const typeConfig: Record<PropertyType, { gradient: string; icon: React.ReactNode; label: string }> = {
  house: {
    gradient: 'linear-gradient(145deg, #C75D3D 0%, #D4823B 100%)',
    icon: <Home size={44} color="#FFFFFF" strokeWidth={1.5} />,
    label: 'House',
  },
  duplex: {
    gradient: 'linear-gradient(145deg, #D4923B 0%, #C47A2E 100%)',
    icon: <Layers size={44} color="#FFFFFF" strokeWidth={1.5} />,
    label: 'Duplex',
  },
  condo: {
    gradient: 'linear-gradient(145deg, #4A90C4 0%, #2E6E9E 100%)',
    icon: <Building2 size={44} color="#FFFFFF" strokeWidth={1.5} />,
    label: 'Condo',
  },
  apartment: {
    gradient: 'linear-gradient(145deg, #5C8A3A 0%, #3E6025 100%)',
    icon: <LayoutGrid size={44} color="#FFFFFF" strokeWidth={1.5} />,
    label: 'Apartment',
  },
  other: {
    gradient: 'linear-gradient(145deg, #6B6058 0%, #4D4540 100%)',
    icon: <HelpCircle size={44} color="#FFFFFF" strokeWidth={1.5} />,
    label: 'Other',
  },
};

/* ─── Input style ─── */
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 15,
  border: `1.5px solid #E8E3DC`, backgroundColor: '#FFFFFF', color: '#1A1714',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif',
};

/* ─── Add Property Modal ─── */
const PROPERTY_TYPES: PropertyType[] = ['house', 'duplex', 'condo', 'apartment', 'other'];

function AddPropertyModal({ onClose }: { onClose: () => void }) {
  const addProperty = useStore((s) => s.addProperty);
  const router = useRouter();

  const [form, setForm] = useState({
    name: '', address: '', type: 'house' as PropertyType,
    units: '1', monthlyRent: '', beds: '', baths: '', sqft: '', yearBuilt: '',
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
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(26,23,20,0.55)', zIndex: 40, backdropFilter: 'blur(4px)' }}
      />
      <motion.div
        initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          backgroundColor: C.white, borderRadius: '24px 24px 0 0',
          padding: '0 20px 40px', maxHeight: '92vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 14, paddingBottom: 20 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.linen }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, color: C.ink, margin: 0, fontWeight: 500 }}>
            Add a property
          </h2>
          <button onClick={onClose} style={{ background: C.cream, border: 'none', cursor: 'pointer', color: C.stone, padding: 8, borderRadius: 8, display: 'flex', alignItems: 'center' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.stone, marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Property type
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PROPERTY_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => handleChange('type', t)} style={{
                  padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                  border: `2px solid ${form.type === t ? C.primary : C.linen}`,
                  backgroundColor: form.type === t ? C.primary50 : C.white,
                  color: form.type === t ? C.primary : C.stone,
                  cursor: 'pointer', textTransform: 'capitalize', transition: 'all 150ms',
                }}>
                  {typeConfig[t].label}
                </button>
              ))}
            </div>
          </div>

          {[
            { field: 'name', label: 'Property name *', placeholder: 'e.g. The Yellow House', required: true },
            { field: 'address', label: 'Address *', placeholder: '123 Elm St, Portland, OR 97201', required: true },
          ].map(({ field, label, placeholder, required }) => (
            <div key={field} style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.stone, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</label>
              <input value={form[field as keyof typeof form]} onChange={(e) => handleChange(field, e.target.value)} placeholder={placeholder} required={required} style={inputStyle} />
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.stone, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Monthly rent *</label>
              <input type="number" value={form.monthlyRent} onChange={(e) => handleChange('monthlyRent', e.target.value)} placeholder="$1,500" required style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.stone, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Units</label>
              <input type="number" value={form.units} onChange={(e) => handleChange('units', e.target.value)} min="1" style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
            {[
              { field: 'beds', label: 'Bedrooms', placeholder: '3' },
              { field: 'baths', label: 'Bathrooms', placeholder: '2' },
              { field: 'sqft', label: 'Sq ft', placeholder: '1,200' },
              { field: 'yearBuilt', label: 'Year built', placeholder: '1985' },
            ].map(({ field, label, placeholder }) => (
              <div key={field}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.stone, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</label>
                <input type="number" value={form[field as keyof typeof form]} onChange={(e) => handleChange(field, e.target.value)} placeholder={placeholder} style={inputStyle} />
              </div>
            ))}
          </div>

          <motion.button
            type="submit"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            style={{
              width: '100%', padding: '15px', borderRadius: 12, fontSize: 16, fontWeight: 700,
              backgroundColor: C.primary, color: C.white, border: 'none', cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(199,93,61,0.28)',
            }}
          >
            Add property
          </motion.button>
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
      whileHover={{ scale: 1.01, y: -2 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: C.white,
        borderRadius: 20,
        border: `1px solid ${C.linen}`,
        boxShadow: hovered ? '0 12px 36px rgba(26,23,20,0.12)' : '0 2px 10px rgba(26,23,20,0.06)',
        overflow: 'hidden',
        marginBottom: 16,
        transition: 'box-shadow 0.2s ease',
      }}
    >
      {/* Banner */}
      <div style={{
        height: 200,
        background: config.gradient,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}>
        {/* Subtle pattern overlay */}
        <div style={{ opacity: 0.12, position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 25% 25%, white 0%, transparent 50%), radial-gradient(circle at 75% 75%, white 0%, transparent 50%)' }} />
        {config.icon}

        {/* Occupancy badge */}
        <div style={{
          position: 'absolute', top: 14, right: 14,
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'rgba(255,255,255,0.2)',
          backdropFilter: 'blur(8px)',
          borderRadius: 999, padding: '5px 12px',
          border: '1px solid rgba(255,255,255,0.3)',
        }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: property.isOccupied ? '#A8F0B8' : '#FFB5A8' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.white }}>
            {property.isOccupied ? 'Occupied' : 'Vacant'}
          </span>
        </div>

        {/* Type badge */}
        <div style={{
          position: 'absolute', top: 14, left: 14,
          background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
          borderRadius: 999, padding: '5px 12px',
          border: '1px solid rgba(255,255,255,0.3)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.white, textTransform: 'capitalize' }}>
            {config.label}
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '18px 20px 20px' }}>
        {/* Name */}
        <h2 style={{
          fontFamily: 'Fraunces, serif', fontSize: 22, color: C.ink,
          fontWeight: 500, lineHeight: 1.2, marginBottom: 4, margin: '0 0 4px',
        }}>
          {property.name}
        </h2>

        {/* Address */}
        <p style={{ fontSize: 14, color: C.stone, margin: '0 0 14px', lineHeight: 1.4 }}>
          {property.address}
        </p>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: 'Inter, sans-serif' }}>
              {formatCurrency(property.monthlyRent)}
            </span>
            <span style={{ fontSize: 12, color: C.stone, fontFamily: 'Inter, sans-serif' }}>/mo</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {property.units > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: C.stone }}>
                <Building2 size={13} color={C.stone} strokeWidth={1.75} />
                <span>{property.units} units</span>
              </div>
            )}
            {property.beds && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: C.stone }}>
                <BedDouble size={13} color={C.stone} strokeWidth={1.75} />
                <span>{property.beds} bed</span>
              </div>
            )}
            {property.baths && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: C.stone }}>
                <Bath size={13} color={C.stone} strokeWidth={1.75} />
                <span>{property.baths} bath</span>
              </div>
            )}
            {property.sqft && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: C.stone }}>
                <Ruler size={13} color={C.stone} strokeWidth={1.75} />
                <span>{property.sqft.toLocaleString()} sqft</span>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={`/properties/${property.id}`} style={{ textDecoration: 'none', flex: 1 }}>
            <button style={{
              width: '100%', padding: '10px 16px', borderRadius: 12,
              fontSize: 14, fontWeight: 700, border: 'none',
              backgroundColor: C.primary, color: C.white, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: '0 2px 8px rgba(199,93,61,0.22)',
            }}>
              View details <ChevronRight size={15} />
            </button>
          </Link>
          <Link href="/messages" style={{ textDecoration: 'none' }}>
            <button style={{
              padding: '10px 14px', borderRadius: 12,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              border: `1.5px solid ${C.linen}`, backgroundColor: C.white, color: C.charcoal,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 150ms',
            }}>
              <MessageSquare size={16} color={C.stone} />
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
    <div style={{ backgroundColor: C.cream, minHeight: '100vh', padding: '16px 16px 24px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingTop: 8 }}>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, color: C.ink, margin: '0 0 4px', fontWeight: 500 }}>
              Properties
            </h1>
            {properties.length > 0 && (
              <p style={{ fontSize: 14, color: C.stone, margin: 0, fontFamily: 'Inter, sans-serif' }}>
                {properties.length} {properties.length === 1 ? 'property' : 'properties'} · {properties.filter(p => p.isOccupied).length} occupied
              </p>
            )}
          </div>
          <motion.button
            onClick={() => setShowModal(true)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px',
              borderRadius: 12, fontSize: 14, fontWeight: 700,
              backgroundColor: C.primary, color: C.white, border: 'none', cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(199,93,61,0.28)',
            }}
          >
            <Plus size={16} />
            Add property
          </motion.button>
        </div>

        {/* Property list or empty state */}
        {properties.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 80, textAlign: 'center', gap: 16 }}
          >
            <div style={{ width: 88, height: 88, borderRadius: 24, background: C.primary50, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(199,93,61,0.15)' }}>
              <Building2 size={40} color={C.primary} strokeWidth={1.5} />
            </div>
            <div>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 24, color: C.ink, margin: '0 0 8px', fontWeight: 500 }}>
                No properties yet
              </h2>
              <p style={{ fontSize: 16, color: C.stone, margin: 0 }}>
                Add your first property to get started
              </p>
            </div>
            <Link href="/onboarding" style={{ textDecoration: 'none', marginTop: 8 }}>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                style={{
                  padding: '13px 28px', borderRadius: 14, fontSize: 16, fontWeight: 700,
                  backgroundColor: C.primary, color: C.white, border: 'none', cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(199,93,61,0.28)',
                }}
              >
                Add your first property
              </motion.button>
            </Link>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.08 }}>
            {properties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {showModal && <AddPropertyModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </div>
  );
}
