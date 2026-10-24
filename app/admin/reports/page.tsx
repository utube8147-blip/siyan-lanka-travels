'use client';
// Staff area → Reports (owner): profit and loss, and the charts.
import { BarChart3, Wallet } from 'lucide-react';
import { Hub } from '@/components/admin/Hub';
import FinancePage from '../finance/page';
import AnalyticsPage from '../analytics/page';

export default function ReportsHub() {
  return (
    <Hub
      tabs={[
        { id: 'money', label: 'Money in & out', Icon: Wallet, tone: 'bg-[#dcfce7] text-[#166534]', render: () => <FinancePage /> },
        { id: 'charts', label: 'Charts', Icon: BarChart3, tone: 'bg-[#dbeafe] text-[#1e40af]', render: () => <AnalyticsPage /> },
      ]}
    />
  );
}
