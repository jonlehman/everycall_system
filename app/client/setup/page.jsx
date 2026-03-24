import { redirect } from 'next/navigation';

export default function SetupRedirectPage() {
  redirect('/client/receptionist/go-live');
}
