'use client';
// Staff area → Trips: everything about a day's buses in one place.
import { Armchair, FlaskConical, MapPinned, Ticket, TriangleAlert } from 'lucide-react';
import { mockVerificationOn } from '@/lib/mockVerification';
import TestPassengersPage from '../test-passengers/page';
import { Hub } from '@/components/admin/Hub';
import { useStore } from '@/lib/store';
import { isLive, useRoadReports } from '@/lib/conductor';
import DeparturesPage from '../departures/page';
import BookingsPage from '../bookings/page';
import GpsLogPage from '../gps-log/page';
import RoadReportsPage from '../road-reports/page';

export default function TripsHub() {
  const { data, mode } = useStore();
  // Only where test bookings can be made: demo mode, or test mode on your computer.
  const testing = mode === 'demo' || mockVerificationOn();
  const { reports } = useRoadReports();
  const waiting = data.bookings.filter((b) => b.status === 'held' && b.channel === 'online' && (b.paymentMethod === 'bank' || b.paymentMethod === 'counter')).length;
  return (
    <Hub
      tabs={[
        { id: 'seats', label: 'Seats', Icon: Armchair, tone: 'bg-[#fef3c7] text-[#92400e]', render: () => <DeparturesPage /> },
        { id: 'bookings', label: 'Bookings', Icon: Ticket, tone: 'bg-[#dbeafe] text-[#1e40af]', badge: waiting, render: () => <BookingsPage /> },
        { id: 'gps', label: 'Where it went', Icon: MapPinned, tone: 'bg-[#dcfce7] text-[#166534]', render: () => <GpsLogPage /> },
        { id: 'road', label: 'Road reports', Icon: TriangleAlert, tone: 'bg-[#fee2e2] text-[#991b1b]', badge: reports.filter((r) => isLive(r)).length, render: () => <RoadReportsPage /> },
        ...(testing ? [{ id: 'test', label: 'Test passengers', Icon: FlaskConical, render: () => <TestPassengersPage /> }] : []),
      ]}
    />
  );
}
