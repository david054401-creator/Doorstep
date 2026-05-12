'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Wrench,
  ChevronLeft,
  Camera,
  Image as ImageIcon,
  Send,
  X,
  Check,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { formatDate, formatRelativeTime } from '@/lib/utils';
import type { MaintenanceRequest } from '@/lib/types';

/* ─── Brand tokens ─── */
const C = {
  primary: '#C75D3D',
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
  skyBg: '#E3F0FA',
  sky: '#3A7CB8',
};

/* ─── Helpers ─── */
function priorityBorderColor(priority: MaintenanceRequest['priority']): string {
  if (priority === 'urgent') return C.brick;
  if (priority === 'medium') return C.honey;
  return C.moss;
}

function priorityPillStyle(priority: MaintenanceRequest['priority']): React.CSSProperties {
  if (priority === 'urgent')
    return { backgroundColor: C.brickBg, color: C.brick };
  if (priority === 'medium')
    return { backgroundColor: C.honeyBg, color: C.honey };
  return { backgroundColor: C.mossBg, color: C.moss };
}

function statusPillStyle(status: MaintenanceRequest['status']): React.CSSProperties {
  if (status === 'resolved')
    return { backgroundColor: C.mossBg, color: C.moss };
  if (status === 'in_progress')
    return { backgroundColor: C.honeyBg, color: C.honey };
  return { backgroundColor: C.primary50, color: C.primary };
}

function statusLabel(status: MaintenanceRequest['status']): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'resolved') return 'Resolved';
  return 'Open';
}

function daysDiff(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/* ─── Pill style shared ─── */
const pillBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.02em',
};

/* ─── Toast ─── */
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      onAnimationComplete={() => {
        setTimeout(onDone, 2000);
      }}
      style={{
        position: 'fixed',
        bottom: 100,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: C.ink,
        color: C.white,
        padding: '10px 20px',
        borderRadius: 24,
        fontSize: 14,
        fontWeight: 500,
        zIndex: 999,
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <Check size={14} />
      {message}
    </motion.div>
  );
}

/* ─── Close-out inline form ─── */
function CloseOutForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (cost: number | undefined, notes: string) => void;
  onCancel: () => void;
}) {
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      style={{
        overflow: 'hidden',
        borderTop: `1px solid ${C.linen}`,
        padding: '16px 20px',
        backgroundColor: C.cream,
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 600, color: C.charcoal, marginBottom: 12 }}>
        Close out this request
      </p>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: C.stone, marginBottom: 4 }}>
          Final cost ($)
        </label>
        <input
          type="number"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="0.00"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: `1.5px solid ${C.linen}`,
            fontSize: 14,
            color: C.ink,
            backgroundColor: C.white,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: C.stone, marginBottom: 4 }}>
          Resolution notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What was done to resolve this?"
          rows={3}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: `1.5px solid ${C.linen}`,
            fontSize: 14,
            color: C.ink,
            backgroundColor: C.white,
            outline: 'none',
            resize: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      {/* Photo placeholder */}
      <div
        style={{
          border: `1.5px dashed ${C.mist}`,
          borderRadius: 8,
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          color: C.mist,
          fontSize: 13,
          marginBottom: 16,
          cursor: 'pointer',
        }}
      >
        <Camera size={16} />
        Add final photo (optional)
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: 10,
            border: `1.5px solid ${C.linen}`,
            backgroundColor: C.white,
            color: C.stone,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() =>
            onSubmit(cost ? parseFloat(cost) : undefined, notes)
          }
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: 10,
            border: 'none',
            backgroundColor: C.moss,
            color: C.white,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Mark resolved
        </button>
      </div>
    </motion.div>
  );
}

/* ─── Request Detail Overlay ─── */
function RequestDetail({
  request,
  propertyName,
  onClose,
  onResolve,
}: {
  request: MaintenanceRequest;
  propertyName: string;
  onClose: () => void;
  onResolve: (id: string, cost?: number) => void;
}) {
  const [updateText, setUpdateText] = useState('');
  const [showCloseOut, setShowCloseOut] = useState(false);

  const priorityBg =
    request.priority === 'urgent'
      ? C.brickBg
      : request.priority === 'medium'
      ? C.honeyBg
      : C.mossBg;
  const priorityColor =
    request.priority === 'urgent'
      ? C.brick
      : request.priority === 'medium'
      ? C.honey
      : C.moss;

  const mockTimeline = [
    { type: 'tenant', text: request.description },
    {
      type: 'landlord',
      text: "Thanks for letting me know. I'll look into it right away.",
    },
    { type: 'system', text: `Request opened · ${formatDate(request.createdAt)}` },
    { type: 'vendor', text: "Vendor assigned: Mike's HVAC" },
  ];

  function handleCloseOut(cost: number | undefined) {
    onResolve(request.id, cost);
    onClose();
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 32, stiffness: 320 }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        backgroundColor: C.white,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'hidden',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 16px 12px',
          borderBottom: `1px solid ${C.linen}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: C.stone,
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <ChevronLeft size={22} />
        </button>
        <h2
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 18,
            color: C.ink,
            margin: 0,
            fontWeight: 500,
            flex: 1,
            textAlign: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '0 8px',
          }}
        >
          {request.title}
        </h2>
        <span style={{ ...pillBase, ...statusPillStyle(request.status) }}>
          {statusLabel(request.status)}
        </span>
      </div>

      {/* Priority banner */}
      <div
        style={{
          backgroundColor: priorityBg,
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: priorityColor,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {request.priority} priority
        </span>
        <span style={{ fontSize: 12, color: C.stone }}>· {propertyName}</span>
        {request.status !== 'resolved' && (
          <button
            onClick={() => setShowCloseOut((v) => !v)}
            style={{
              marginLeft: 'auto',
              padding: '4px 12px',
              borderRadius: 20,
              border: `1.5px solid ${priorityColor}`,
              backgroundColor: 'transparent',
              color: priorityColor,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {showCloseOut ? 'Cancel' : 'Close out'}
          </button>
        )}
      </div>

      {/* Close-out form */}
      <AnimatePresence>
        {showCloseOut && (
          <CloseOutForm
            onSubmit={(cost) => handleCloseOut(cost)}
            onCancel={() => setShowCloseOut(false)}
          />
        )}
      </AnimatePresence>

      {/* Timeline */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mockTimeline.map((item, i) => {
          if (item.type === 'tenant') {
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '75%',
                    backgroundColor: C.cream,
                    borderRadius: '18px 18px 18px 4px',
                    padding: '10px 14px',
                    fontSize: 14,
                    color: C.charcoal,
                    lineHeight: 1.5,
                  }}
                >
                  {item.text}
                  <div style={{ fontSize: 11, color: C.mist, marginTop: 4 }}>Tenant</div>
                </div>
              </div>
            );
          }
          if (item.type === 'landlord') {
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div
                  style={{
                    maxWidth: '75%',
                    backgroundColor: C.primary,
                    borderRadius: '18px 18px 4px 18px',
                    padding: '10px 14px',
                    fontSize: 14,
                    color: C.white,
                    lineHeight: 1.5,
                  }}
                >
                  {item.text}
                  <div style={{ fontSize: 11, color: C.primary100, marginTop: 4 }}>You</div>
                </div>
              </div>
            );
          }
          if (item.type === 'vendor') {
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'center' }}>
                <span
                  style={{
                    backgroundColor: C.skyBg,
                    color: C.sky,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '4px 14px',
                    borderRadius: 20,
                  }}
                >
                  {item.text}
                </span>
              </div>
            );
          }
          // system
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'center' }}>
              <span style={{ fontSize: 12, color: C.stone }}>{item.text}</span>
            </div>
          );
        })}
      </div>

      {/* Text input */}
      <div
        style={{
          borderTop: `1px solid ${C.linen}`,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
          backgroundColor: C.white,
        }}
      >
        <input
          value={updateText}
          onChange={(e) => setUpdateText(e.target.value)}
          placeholder="Add an update..."
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 20,
            border: `1.5px solid ${C.linen}`,
            fontSize: 14,
            color: C.ink,
            outline: 'none',
            backgroundColor: C.cream,
          }}
        />
        <button
          onClick={() => setUpdateText('')}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            backgroundColor: updateText.trim() ? C.primary : C.linen,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background-color 0.15s',
          }}
        >
          <Send size={15} color={updateText.trim() ? C.white : C.mist} />
        </button>
      </div>
    </motion.div>
  );
}

/* ─── New Request Modal ─── */
function NewRequestModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) {
  const properties = useStore((s) => s.properties);
  const addMaintenanceRequest = useStore((s) => s.addMaintenanceRequest);

  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<MaintenanceRequest['priority']>('medium');
  const [notifyTenant, setNotifyTenant] = useState(true);
  const [findContractor, setFindContractor] = useState(false);

  function handleSubmit() {
    if (!selectedPropertyId || !description.trim()) return;
    addMaintenanceRequest({
      id: `maint-${Date.now()}`,
      propertyId: selectedPropertyId,
      title: description.trim().slice(0, 60),
      description: description.trim(),
      priority,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    onSubmit();
  }

  const priorityOptions: { value: MaintenanceRequest['priority']; label: string; bg: string; color: string }[] = [
    { value: 'low', label: 'Low', bg: C.mossBg, color: C.moss },
    { value: 'medium', label: 'Medium', bg: C.honeyBg, color: C.honey },
    { value: 'urgent', label: 'Urgent', bg: C.brickBg, color: C.brick },
  ];

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(26,23,20,0.5)',
          zIndex: 100,
        }}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 110,
          backgroundColor: C.white,
          borderRadius: '24px 24px 0 0',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Handle */}
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: C.linen,
            margin: '16px auto 0',
          }}
        />

        {/* Title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 20px 4px',
          }}
        >
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 22,
              color: C.ink,
              margin: 0,
              fontWeight: 500,
            }}
          >
            New maintenance request
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.stone,
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 20px 32px' }}>

          {/* 1. Property */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: C.charcoal,
                marginBottom: 8,
              }}
            >
              Property *
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {properties.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPropertyId(p.id)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    fontSize: 13,
                    fontWeight: 500,
                    border: `2px solid ${selectedPropertyId === p.id ? C.primary : C.linen}`,
                    backgroundColor: selectedPropertyId === p.id ? C.primary50 : C.white,
                    color: selectedPropertyId === p.id ? C.primary : C.stone,
                    cursor: 'pointer',
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Description */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: C.charcoal,
                marginBottom: 8,
              }}
            >
              What&apos;s the issue?
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the problem..."
              rows={4}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 10,
                border: `1.5px solid ${C.linen}`,
                fontSize: 14,
                color: C.ink,
                backgroundColor: C.white,
                outline: 'none',
                resize: 'none',
                boxSizing: 'border-box',
                lineHeight: 1.5,
              }}
            />
          </div>

          {/* 3. Priority */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: C.charcoal,
                marginBottom: 8,
              }}
            >
              Priority
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {priorityOptions.map((opt) => {
                const isSelected = priority === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setPriority(opt.value)}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      border: `2px solid ${isSelected ? opt.color : C.linen}`,
                      backgroundColor: isSelected ? opt.bg : C.white,
                      color: isSelected ? opt.color : C.stone,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Photo */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: C.charcoal,
                marginBottom: 8,
              }}
            >
              Photo
            </label>
            <div
              style={{
                border: `2px dashed ${C.mist}`,
                borderRadius: 10,
                height: 80,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                color: C.mist,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <Camera size={18} />
              Add a photo (optional)
            </div>
          </div>

          {/* 5. Notify tenant toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 14, color: C.charcoal, fontWeight: 500 }}>
              Send SMS to tenant
            </span>
            <button
              onClick={() => setNotifyTenant((v) => !v)}
              style={{
                width: 44,
                height: 26,
                borderRadius: 13,
                backgroundColor: notifyTenant ? C.primary : C.linen,
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background-color 0.2s',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  left: notifyTenant ? 21 : 3,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  backgroundColor: C.white,
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </button>
          </div>

          {/* 6. Find contractor toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, color: C.charcoal, fontWeight: 500 }}>
                Request from vendor network
              </span>
              <span
                style={{
                  ...pillBase,
                  backgroundColor: C.honeyBg,
                  color: C.honey,
                  fontSize: 10,
                }}
              >
                Premium
              </span>
            </div>
            <button
              onClick={() => setFindContractor((v) => !v)}
              style={{
                width: 44,
                height: 26,
                borderRadius: 13,
                backgroundColor: findContractor ? C.primary : C.linen,
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background-color 0.2s',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  left: findContractor ? 21 : 3,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  backgroundColor: C.white,
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </button>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!selectedPropertyId || !description.trim()}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 600,
              backgroundColor:
                selectedPropertyId && description.trim() ? C.primary : C.linen,
              color:
                selectedPropertyId && description.trim() ? C.white : C.mist,
              border: 'none',
              cursor:
                selectedPropertyId && description.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            Submit request
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ─── Request Card ─── */
function RequestCard({
  request,
  propertyName,
  isResolved,
  onViewDetails,
  onCloseOut,
}: {
  request: MaintenanceRequest;
  propertyName: string;
  isResolved: boolean;
  onViewDetails: () => void;
  onCloseOut: () => void;
}) {
  const days = daysDiff(request.createdAt);

  return (
    <div
      style={{
        backgroundColor: C.white,
        borderRadius: 12,
        border: `1px solid ${C.linen}`,
        marginBottom: 8,
        overflow: 'hidden',
        borderLeft: `4px solid ${isResolved ? C.mist : priorityBorderColor(request.priority)}`,
        opacity: isResolved ? 0.85 : 1,
      }}
    >
      <div style={{ padding: 16 }}>
        {/* Row 1: title + pills */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: isResolved ? C.stone : C.charcoal,
              flex: 1,
              lineHeight: 1.3,
            }}
          >
            {request.title}
          </span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginTop: 2 }}>
            {!isResolved && (
              <span style={{ ...pillBase, ...priorityPillStyle(request.priority) }}>
                {request.priority}
              </span>
            )}
            <span style={{ ...pillBase, ...statusPillStyle(request.status) }}>
              {statusLabel(request.status)}
            </span>
          </div>
        </div>

        {/* Row 2: property + time */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: request.photoUrl ? 10 : 12,
          }}
        >
          <span style={{ fontSize: 13, color: C.stone }}>
            {propertyName}
            <span style={{ color: C.mist, margin: '0 4px' }}>·</span>
            {days === 0 ? 'today' : `${days} day${days !== 1 ? 's' : ''} ago`}
          </span>
          {isResolved && request.cost !== undefined && (
            <span style={{ fontSize: 13, color: C.stone, fontWeight: 500 }}>
              Cost: ${request.cost.toLocaleString()}
            </span>
          )}
        </div>

        {/* Row 3: photo placeholder (if photoUrl present) */}
        {request.photoUrl && (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 6,
              backgroundColor: C.linen,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <ImageIcon size={20} color={C.mist} />
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onViewDetails}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: C.primary,
              padding: 0,
            }}
          >
            View details
          </button>
          {!isResolved && (
            <>
              <span style={{ color: C.linen }}>|</span>
              <button
                onClick={onCloseOut}
                style={{
                  padding: '4px 12px',
                  borderRadius: 20,
                  border: `1.5px solid ${C.linen}`,
                  backgroundColor: 'transparent',
                  color: C.stone,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Close out
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Page ─── */
type FilterTab = 'all' | 'open' | 'resolved';

export default function MaintenancePage() {
  const maintenanceRequests = useStore((s) => s.maintenanceRequests);
  const properties = useStore((s) => s.properties);
  const updateMaintenanceRequest = useStore((s) => s.updateMaintenanceRequest);

  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<MaintenanceRequest | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [closeOutRequestId, setCloseOutRequestId] = useState<string | null>(null);

  function getPropertyName(propertyId: string): string {
    return properties.find((p) => p.id === propertyId)?.name ?? 'Unknown property';
  }

  // Filter
  const filtered = maintenanceRequests.filter((r) => {
    if (activeTab === 'open') return r.status !== 'resolved';
    if (activeTab === 'resolved') return r.status === 'resolved';
    return true;
  });

  const openRequests = filtered.filter((r) => r.status !== 'resolved');
  const resolvedRequests = filtered.filter((r) => r.status === 'resolved');

  function handleNewRequestSubmit() {
    setShowNewRequest(false);
    setToastMessage('Request submitted');
  }

  function handleResolve(id: string, cost?: number) {
    updateMaintenanceRequest(id, {
      status: 'resolved',
      cost,
      updatedAt: new Date().toISOString(),
    });
    setCloseOutRequestId(null);
    setToastMessage('Request closed out');
  }

  function handleCloseOut(requestId: string) {
    // Open detail view with close-out form already shown
    const req = maintenanceRequests.find((r) => r.id === requestId) ?? null;
    setSelectedRequest(req);
    setCloseOutRequestId(requestId);
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'resolved', label: 'Resolved' },
  ];

  const isEmpty = openRequests.length === 0 && resolvedRequests.length === 0;

  return (
    <div
      style={{
        backgroundColor: C.cream,
        minHeight: '100vh',
        padding: 16,
        paddingBottom: 96,
      }}
    >
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
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
            Maintenance
          </h1>
          <button
            onClick={() => setShowNewRequest(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 12px',
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
        </div>

        {/* Filter tabs */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 24,
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '7px 18px',
                borderRadius: 20,
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: activeTab === tab.key ? C.primary : C.white,
                color: activeTab === tab.key ? C.white : C.stone,
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Empty state */}
        {isEmpty ? (
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
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                backgroundColor: C.linen,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Wrench size={32} color={C.mist} />
            </div>
            <h2
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 22,
                color: C.ink,
                margin: 0,
                fontWeight: 500,
              }}
            >
              No maintenance requests yet
            </h2>
            <p style={{ fontSize: 15, color: C.stone, margin: 0 }}>
              Track repairs and issues across your properties
            </p>
            <button
              onClick={() => setShowNewRequest(true)}
              style={{
                marginTop: 8,
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
              Add your first one
            </button>
          </motion.div>
        ) : (
          <>
            {/* Open requests section */}
            {openRequests.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.stone,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginBottom: 12,
                    margin: '0 0 12px',
                  }}
                >
                  Open
                </p>
                {openRequests.map((req) => (
                  <RequestCard
                    key={req.id}
                    request={req}
                    propertyName={getPropertyName(req.propertyId)}
                    isResolved={false}
                    onViewDetails={() => setSelectedRequest(req)}
                    onCloseOut={() => handleCloseOut(req.id)}
                  />
                ))}
              </div>
            )}

            {/* Resolved requests section */}
            {resolvedRequests.length > 0 && (
              <div
                style={{
                  borderTop: `1px solid ${C.mist}`,
                  paddingTop: 20,
                }}
              >
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.stone,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    margin: '0 0 12px',
                  }}
                >
                  Resolved
                </p>
                {resolvedRequests.map((req) => (
                  <RequestCard
                    key={req.id}
                    request={req}
                    propertyName={getPropertyName(req.propertyId)}
                    isResolved={true}
                    onViewDetails={() => setSelectedRequest(req)}
                    onCloseOut={() => {}}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* New Request Modal */}
      <AnimatePresence>
        {showNewRequest && (
          <NewRequestModal
            onClose={() => setShowNewRequest(false)}
            onSubmit={handleNewRequestSubmit}
          />
        )}
      </AnimatePresence>

      {/* Request Detail Overlay */}
      <AnimatePresence>
        {selectedRequest && (
          <RequestDetail
            request={selectedRequest}
            propertyName={getPropertyName(selectedRequest.propertyId)}
            onClose={() => {
              setSelectedRequest(null);
              setCloseOutRequestId(null);
            }}
            onResolve={handleResolve}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toastMessage && (
          <Toast message={toastMessage} onDone={() => setToastMessage(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
