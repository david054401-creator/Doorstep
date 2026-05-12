import { create } from 'zustand';

export interface Property {
  id: string;
  name: string;
  address: string;
}

interface PropertyStore {
  properties: Property[];
  selectedPropertyId: string | null;
  hasNotifications: boolean;
  setSelectedPropertyId: (id: string) => void;
  setProperties: (properties: Property[]) => void;
  setHasNotifications: (value: boolean) => void;
}

export const usePropertyStore = create<PropertyStore>((set) => ({
  properties: [
    { id: '1', name: '123 Maple Street', address: '123 Maple St, Portland, OR 97201' },
    { id: '2', name: '456 Oak Avenue', address: '456 Oak Ave, Portland, OR 97202' },
  ],
  selectedPropertyId: '1',
  hasNotifications: true,
  setSelectedPropertyId: (id) => set({ selectedPropertyId: id }),
  setProperties: (properties) => set({ properties }),
  setHasNotifications: (value) => set({ hasNotifications: value }),
}));
