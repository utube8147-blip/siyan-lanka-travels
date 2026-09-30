// data/resale-tickets.ts
// Demo listings for the passenger-to-passenger resale page. In a real build
// these would be bookings a passenger has put up for resale (see /dashboard).

import { OPERATOR } from '@/config/operator';
import { addDays, formatDateLabel, todayISO } from '@/lib/trips';

export interface ResaleTicket {
  id: string;
  operator: string;
  operatorInitials: string;
  direction: 'east' | 'west';
  from: string;
  to: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  seats: string;
  busType: string;
  originalPrice: number;
  listedPrice: number;
  sellerHandle: string;
  tag?: 'Save' | 'Featured' | 'Limited';
  featured?: boolean;
}

/** Used by the marketplace's filter dropdown: direction of travel. */
export const FLEET_PARTNERS = [
  { id: 'east', name: 'Colombo → East' },
  { id: 'west', name: 'East → Colombo' },
];

export function genResaleRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return `RS-${result}`;
}

export function findResaleTicket(id: string): ResaleTicket | undefined {
  return RESALE_TICKETS.find((t) => t.id === id);
}

const base = { operator: OPERATOR.name, operatorInitials: OPERATOR.initials, busType: 'Luxury AC' };
const d = (days: number) => formatDateLabel(addDays(todayISO(), days));

export const RESALE_TICKETS: ResaleTicket[] = [
  { ...base, id: 't1', direction: 'east', from: 'Colombo', to: 'Akkaraipattu', date: d(4), departureTime: '09:00 PM', arrivalTime: '05:50 AM', seats: '6C', originalPrice: 2800, listedPrice: 2500, sellerHandle: '@rizvi_m', tag: 'Featured', featured: true },
  { ...base, id: 't2', direction: 'east', from: 'Colombo', to: 'Batticaloa', date: d(6), departureTime: '09:00 PM', arrivalTime: '04:20 AM', seats: '2D', originalPrice: 2400, listedPrice: 2200, sellerHandle: '@kavitha.s', tag: 'Save' },
  { ...base, id: 't3', direction: 'west', from: 'Kalmunai', to: 'Colombo', date: d(5), departureTime: '08:35 PM', arrivalTime: '04:50 AM', seats: '8A', originalPrice: 2600, listedPrice: 2350, sellerHandle: '@fazeel.k', tag: 'Save' },
  { ...base, id: 't4', direction: 'west', from: 'Akkaraipattu', to: 'Colombo', date: d(8), departureTime: '08:00 PM', arrivalTime: '04:50 AM', seats: '10B', originalPrice: 2800, listedPrice: 2600, sellerHandle: '@nuskiya', tag: 'Limited' },
  { ...base, id: 't5', direction: 'east', from: 'Kurunegala', to: 'Kalmunai', date: d(11), departureTime: '11:05 PM', arrivalTime: '05:15 AM', seats: '4B', originalPrice: 1750, listedPrice: 1600, sellerHandle: '@sajith_p', tag: 'Save' },
];
