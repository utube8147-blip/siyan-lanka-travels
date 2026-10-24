'use client';
// Staff area → People (owner): crew and pay, who can sign in, and the branches.
import { Store, UserCog, Users } from 'lucide-react';
import { Hub } from '@/components/admin/Hub';
import CrewPage from '../crew/page';
import AccountsPage from '../accounts/page';
import BranchesPage from '../branches/page';

export default function PeopleHub() {
  return (
    <Hub
      tabs={[
        { id: 'crew', label: 'Crew & pay', Icon: Users, tone: 'bg-[#fef3c7] text-[#92400e]', render: () => <CrewPage /> },
        { id: 'signins', label: 'Sign-ins', Icon: UserCog, tone: 'bg-[#dbeafe] text-[#1e40af]', render: () => <AccountsPage /> },
        { id: 'branches', label: 'Branches', Icon: Store, tone: 'bg-[#dcfce7] text-[#166534]', render: () => <BranchesPage /> },
      ]}
    />
  );
}
