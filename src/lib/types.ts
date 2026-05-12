// ===================== DOORSTEP TYPE DEFINITIONS =====================

export type Property = {
  id: string;
  name: string;
  address: string;
  type: 'house' | 'duplex' | 'condo' | 'apartment' | 'other';
  units: number;
  photoUrl?: string;
  monthlyRent: number;
  isOccupied: boolean;
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
};

export type Tenant = {
  id: string;
  propertyId: string;
  name: string;
  email?: string;
  phone: string;
  monthlyRent: number;
  rentDueDay: number;
  leaseEnd?: string;
  leaseType: 'fixed' | 'month-to-month';
  status: 'current' | 'late' | 'moving-out';
};

export type Payment = {
  id: string;
  tenantId: string;
  propertyId: string;
  amount: number;
  date: string;
  method: 'ach' | 'card' | 'check' | 'cash';
  status: 'paid' | 'pending' | 'late' | 'failed';
  note?: string;
};

export type Expense = {
  id: string;
  propertyId: string;
  amount: number;
  date: string;
  category: 'repairs' | 'insurance' | 'mortgage' | 'property_tax' | 'utilities' | 'other';
  vendor?: string;
  description: string;
  receiptUrl?: string;
};

export type MaintenanceRequest = {
  id: string;
  propertyId: string;
  tenantId?: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved';
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
  cost?: number;
};

export type Message = {
  id: string;
  tenantId: string;
  content: string;
  sender: 'landlord' | 'tenant';
  sentAt: string;
  read: boolean;
  channel: 'sms' | 'app';
};

export type User = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  plan: 'free' | 'starter' | 'pro' | 'plus';
};
