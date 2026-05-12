'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell, ChevronDown, User } from 'lucide-react';
import { usePropertyStore } from '@/store/property-store';
import { cn } from '@/lib/utils';

export function TopBar() {
  const { properties, selectedPropertyId, hasNotifications, setSelectedPropertyId } =
    usePropertyStore();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedProperty = properties.find((p) => p.id === selectedPropertyId) ?? properties[0];

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const hasMultiple = properties.length > 1;

  return (
    <header
      className="sticky top-0 z-40 w-full"
      style={{
        height: '56px',
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E8E3DC',
      }}
    >
      <div className="mx-auto flex h-full max-w-3xl items-center justify-between px-4">
        {/* Wordmark */}
        <span
          className="shrink-0 select-none"
          style={{
            fontFamily: '"Fraunces", serif',
            fontWeight: 500,
            fontSize: '22px',
            color: '#C75D3D',
            lineHeight: 1,
          }}
        >
          Doorstep
        </span>

        {/* Property switcher */}
        <div className="relative flex-1 flex justify-center" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => hasMultiple && setDropdownOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              hasMultiple ? 'cursor-pointer hover:bg-[#FDF1EB]' : 'cursor-default'
            )}
            style={{ color: '#3D362F', maxWidth: '220px' }}
            aria-haspopup={hasMultiple ? 'listbox' : undefined}
            aria-expanded={hasMultiple ? dropdownOpen : undefined}
          >
            <span className="truncate" style={{ fontSize: '14px', fontWeight: 600 }}>
              {selectedProperty?.name ?? 'No property'}
            </span>
            {hasMultiple && (
              <ChevronDown
                size={16}
                style={{
                  color: '#6B6058',
                  flexShrink: 0,
                  transition: 'transform 200ms ease',
                  transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            )}
          </button>

          {/* Dropdown */}
          {hasMultiple && dropdownOpen && (
            <ul
              role="listbox"
              className="absolute top-full mt-1 w-56 overflow-hidden rounded-xl border shadow-lg"
              style={{
                backgroundColor: '#FFFFFF',
                borderColor: '#E8E3DC',
                boxShadow: '0 4px 12px rgba(26,23,20,0.10)',
              }}
            >
              {properties.map((prop) => {
                const isSelected = prop.id === selectedPropertyId;
                return (
                  <li key={prop.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setSelectedPropertyId(prop.id);
                        setDropdownOpen(false);
                      }}
                      className="w-full px-4 py-3 text-left text-sm transition-colors hover:bg-[#FDF1EB]"
                      style={{
                        color: isSelected ? '#C75D3D' : '#3D362F',
                        fontWeight: isSelected ? 600 : 400,
                      }}
                    >
                      <span className="block truncate">{prop.name}</span>
                      <span
                        className="block truncate"
                        style={{ fontSize: '12px', color: '#A8A099', marginTop: '1px' }}
                      >
                        {prop.address}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right actions */}
        <div className="shrink-0 flex items-center gap-2">
          {/* Bell */}
          <button
            type="button"
            className="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[#FDF1EB]"
            aria-label="Notifications"
          >
            <Bell size={20} style={{ color: '#3D362F' }} />
            {hasNotifications && (
              <span
                className="absolute right-1.5 top-1.5 block rounded-full"
                style={{
                  width: '8px',
                  height: '8px',
                  backgroundColor: '#C75D3D',
                  border: '1.5px solid #FFFFFF',
                }}
              />
            )}
          </button>

          {/* Avatar */}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#F4C9B8' }}
            aria-label="Account"
          >
            <User size={16} style={{ color: '#C75D3D' }} strokeWidth={2} />
          </button>
        </div>
      </div>
    </header>
  );
}
