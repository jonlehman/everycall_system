import { redirect } from 'next/navigation';

export default function OverviewRedirectPage() {
  redirect('/client/get-started');
}
