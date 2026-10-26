'use client';
// Staff area → Reports (owner): profit and loss, and the charts.
import { BarChart3, PieChart, Wallet } from 'lucide-react';
import { Hub } from '@/components/admin/Hub';
import FinancePage from '../finance/page';
import AnalyticsPage from '../analytics/page';
import MoneySplit from './MoneySplit';

export default function ReportsHub() {
  return (
    <Hub
      tabs={[
        { id: 'money', label: 'Money in & out', Icon: Wallet, tone: 'bg-[#dcfce7] text-[#166534]', render: () => <FinancePage /> },
        { id: 'split', label: 'Where the money goes', Icon: PieChart, tone: 'bg-[#fff3cc] text-[#7c5800]', render: () => <MoneySplit /> },
        { id: 'charts', label: 'Charts', Icon: BarChart3, tone: 'bg-[#dbeafe] text-[#1e40af]', render: () => <AnalyticsPage /> },
      ]}
    />
  );
}
