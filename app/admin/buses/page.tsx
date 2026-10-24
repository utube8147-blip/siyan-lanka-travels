'use client';
// Staff area → Buses: the buses, their routes and times, their health and their odometer.
import { Bus, Gauge, Route as RouteIcon, Wrench } from 'lucide-react';
import { Hub } from '@/components/admin/Hub';
import FleetPage from '../fleet/page';
import RoutesPage from '../routes/page';
import FleetHealthPage from '../fleet-health/page';
import OdometerPage from '../odometer/page';

export default function BusesHub() {
  return (
    <Hub
      tabs={[
        { id: 'buses', label: 'Buses', Icon: Bus, tone: 'bg-[#fef3c7] text-[#92400e]', render: () => <FleetPage /> },
        { id: 'routes', label: 'Routes & times', Icon: RouteIcon, tone: 'bg-[#dbeafe] text-[#1e40af]', render: () => <RoutesPage /> },
        { id: 'health', label: 'Service & papers', Icon: Wrench, tone: 'bg-[#fee2e2] text-[#991b1b]', adminOnly: true, render: () => <FleetHealthPage /> },
        { id: 'odometer', label: 'Odometer', Icon: Gauge, tone: 'bg-[#e0f2fe] text-[#075985]', render: () => <OdometerPage /> },
      ]}
    />
  );
}
