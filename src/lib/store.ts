import { create } from 'zustand';
import type { Property, Tenant, Payment, Expense, MaintenanceRequest, Message, User } from '@/lib/types';

// ===================== MOCK DATA =====================

const mockProperties: Property[] = [
  {
    id: 'prop-1',
    name: 'The Yellow House',
    address: '123 Elm St, Portland, OR 97201',
    type: 'house',
    units: 1,
    monthlyRent: 2200,
    isOccupied: true,
    beds: 3,
    baths: 2,
    sqft: 1450,
    yearBuilt: 1978,
    photoUrl: undefined,
  },
  {
    id: 'prop-2',
    name: 'Riverside Duplex',
    address: '456 Oak Ave, Portland, OR 97202',
    type: 'duplex',
    units: 2,
    monthlyRent: 1650,
    isOccupied: true,
    beds: 2,
    baths: 1,
    sqft: 980,
    yearBuilt: 1965,
    photoUrl: undefined,
  },
];

const mockTenants: Tenant[] = [
  {
    id: 'tenant-1',
    propertyId: 'prop-1',
    name: 'Marcus Webb',
    email: 'marcus.webb@gmail.com',
    phone: '(503) 555-0142',
    monthlyRent: 2200,
    rentDueDay: 1,
    leaseEnd: '2025-08-31',
    leaseType: 'fixed',
    status: 'current',
  },
  {
    id: 'tenant-2',
    propertyId: 'prop-2',
    name: 'Sofia Reyes',
    email: 'sofia.reyes@outlook.com',
    phone: '(503) 555-0287',
    monthlyRent: 1650,
    rentDueDay: 1,
    leaseEnd: undefined,
    leaseType: 'month-to-month',
    status: 'late',
  },
];

const now = new Date();
const monthAgo = (n: number) => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return d.toISOString().split('T')[0];
};

const mockPayments: Payment[] = [
  {
    id: 'pay-1',
    tenantId: 'tenant-1',
    propertyId: 'prop-1',
    amount: 2200,
    date: monthAgo(0),
    method: 'ach',
    status: 'paid',
  },
  {
    id: 'pay-2',
    tenantId: 'tenant-1',
    propertyId: 'prop-1',
    amount: 2200,
    date: monthAgo(1),
    method: 'ach',
    status: 'paid',
  },
  {
    id: 'pay-3',
    tenantId: 'tenant-1',
    propertyId: 'prop-1',
    amount: 2200,
    date: monthAgo(2),
    method: 'ach',
    status: 'paid',
  },
  {
    id: 'pay-4',
    tenantId: 'tenant-2',
    propertyId: 'prop-2',
    amount: 1650,
    date: monthAgo(1),
    method: 'check',
    status: 'paid',
  },
  {
    id: 'pay-5',
    tenantId: 'tenant-2',
    propertyId: 'prop-2',
    amount: 1650,
    date: monthAgo(0),
    method: 'check',
    status: 'late',
    note: 'Tenant said check is in the mail',
  },
];

const mockExpenses: Expense[] = [
  {
    id: 'exp-1',
    propertyId: 'prop-1',
    amount: 1100,
    date: monthAgo(0),
    category: 'mortgage',
    description: 'Monthly mortgage payment',
    vendor: 'Wells Fargo',
  },
  {
    id: 'exp-2',
    propertyId: 'prop-1',
    amount: 185,
    date: monthAgo(0),
    category: 'insurance',
    description: 'Homeowner insurance premium',
    vendor: 'State Farm',
  },
  {
    id: 'exp-3',
    propertyId: 'prop-1',
    amount: 340,
    date: monthAgo(1),
    category: 'repairs',
    description: 'Fixed leaking kitchen faucet',
    vendor: 'Portland Plumbing Co.',
  },
  {
    id: 'exp-4',
    propertyId: 'prop-2',
    amount: 875,
    date: monthAgo(0),
    category: 'mortgage',
    description: 'Monthly mortgage payment',
    vendor: 'Chase Bank',
  },
  {
    id: 'exp-5',
    propertyId: 'prop-2',
    amount: 210,
    date: monthAgo(2),
    category: 'utilities',
    description: 'Water & sewer bill (common area)',
    vendor: 'Portland Water Bureau',
  },
  {
    id: 'exp-6',
    propertyId: 'prop-2',
    amount: 1250,
    date: monthAgo(3),
    category: 'property_tax',
    description: 'Q1 property tax installment',
    vendor: 'Multnomah County',
  },
];

const mockMaintenanceRequests: MaintenanceRequest[] = [
  {
    id: 'maint-1',
    propertyId: 'prop-1',
    tenantId: 'tenant-1',
    title: 'Leaking bathroom ceiling',
    description:
      'Water is dripping from the bathroom ceiling near the light fixture after rain. Needs urgent inspection.',
    priority: 'urgent',
    status: 'in_progress',
    createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    cost: undefined,
  },
  {
    id: 'maint-2',
    propertyId: 'prop-2',
    tenantId: 'tenant-2',
    title: 'Broken garage door spring',
    description: 'The garage door spring snapped. Door cannot be opened manually.',
    priority: 'medium',
    status: 'open',
    createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    cost: undefined,
  },
];

const mockMessages: Message[] = [
  {
    id: 'msg-1',
    tenantId: 'tenant-1',
    content: 'Hi Linda, just confirming rent was sent via ACH this morning.',
    sender: 'tenant',
    sentAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    read: true,
    channel: 'app',
  },
  {
    id: 'msg-2',
    tenantId: 'tenant-1',
    content: 'Got it, thanks Marcus! Payment confirmed on our end.',
    sender: 'landlord',
    sentAt: new Date(now.getTime() - 1.5 * 60 * 60 * 1000).toISOString(),
    read: true,
    channel: 'app',
  },
  {
    id: 'msg-3',
    tenantId: 'tenant-2',
    content: "Hey, I know I'm a few days late. Check is going out today, sorry for the delay!",
    sender: 'tenant',
    sentAt: new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString(),
    read: false,
    channel: 'sms',
  },
  {
    id: 'msg-4',
    tenantId: 'tenant-2',
    content:
      'Hi Sofia, no worries — just wanted to make sure everything was okay. Please send it today if possible.',
    sender: 'landlord',
    sentAt: new Date(now.getTime() - 17 * 60 * 60 * 1000).toISOString(),
    read: true,
    channel: 'sms',
  },
];

const mockUser: User = {
  id: '1',
  name: 'Linda Morrison',
  email: 'linda@example.com',
  phone: '(503) 555-0199',
  plan: 'starter',
};

// ===================== STORE TYPES =====================

type DoorstepStore = {
  properties: Property[];
  tenants: Tenant[];
  payments: Payment[];
  expenses: Expense[];
  maintenanceRequests: MaintenanceRequest[];
  messages: Message[];
  currentUser: User;
  selectedPropertyId: string | null;

  // Actions
  setSelectedProperty: (id: string | null) => void;
  addProperty: (property: Property) => void;
  updateProperty: (id: string, updates: Partial<Property>) => void;
  addTenant: (tenant: Tenant) => void;
  updateTenant: (id: string, updates: Partial<Tenant>) => void;
  addPayment: (payment: Payment) => void;
  addExpense: (expense: Expense) => void;
  addMaintenanceRequest: (request: MaintenanceRequest) => void;
  updateMaintenanceRequest: (id: string, updates: Partial<MaintenanceRequest>) => void;
  addMessage: (message: Message) => void;
  markMessageRead: (id: string) => void;
};

// ===================== STORE =====================

export const useStore = create<DoorstepStore>((set) => ({
  properties: mockProperties,
  tenants: mockTenants,
  payments: mockPayments,
  expenses: mockExpenses,
  maintenanceRequests: mockMaintenanceRequests,
  messages: mockMessages,
  currentUser: mockUser,
  selectedPropertyId: null,

  setSelectedProperty: (id) => set({ selectedPropertyId: id }),

  addProperty: (property) =>
    set((state) => ({ properties: [...state.properties, property] })),

  updateProperty: (id, updates) =>
    set((state) => ({
      properties: state.properties.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),

  addTenant: (tenant) =>
    set((state) => ({ tenants: [...state.tenants, tenant] })),

  updateTenant: (id, updates) =>
    set((state) => ({
      tenants: state.tenants.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  addPayment: (payment) =>
    set((state) => ({ payments: [...state.payments, payment] })),

  addExpense: (expense) =>
    set((state) => ({ expenses: [...state.expenses, expense] })),

  addMaintenanceRequest: (request) =>
    set((state) => ({
      maintenanceRequests: [...state.maintenanceRequests, request],
    })),

  updateMaintenanceRequest: (id, updates) =>
    set((state) => ({
      maintenanceRequests: state.maintenanceRequests.map((r) =>
        r.id === id ? { ...r, ...updates } : r,
      ),
    })),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  markMessageRead: (id) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, read: true } : m)),
    })),
}));
