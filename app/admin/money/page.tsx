'use client';
// Staff area → Money: counting the cash, what was spent, and what is owed back.
import { Banknote, HandCoins, Receipt } from 'lucide-react';
import { Hub } from '@/components/admin/Hub';
import { usePayouts } from '@/lib/money';
import CashPage from '../cash/page';
import ExpensesPage from '../expenses/page';
import PayoutsPage from '../payouts/page';

export default function MoneyHub() {
  const { payouts } = usePayouts('all');
  return (
    <Hub
      tabs={[
        { id: 'cash', label: 'Count cash', Icon: Banknote, tone: 'bg-[#dcfce7] text-[#166534]', render: () => <CashPage /> },
        { id: 'spent', label: 'Spent', Icon: Receipt, tone: 'bg-[#ffedd5] text-[#9a3412]', render: () => <ExpensesPage /> },
        { id: 'payback', label: 'Pay back', Icon: HandCoins, tone: 'bg-[#ede9fe] text-[#5b21b6]', badge: payouts.filter((p) => p.status === 'pending').length, render: () => <PayoutsPage /> },
      ]}
    />
  );
}
