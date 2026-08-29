import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import StayHalongLanding from '@/components/home/StayHalongLanding';

const STAY_HALONG_HOSTS = new Set(['stayhalong.com', 'www.stayhalong.com']);

export default async function RootPage() {
  const host = (await headers()).get('host')?.split(':')[0].toLowerCase();

  if (host && STAY_HALONG_HOSTS.has(host)) {
    return <StayHalongLanding />;
  }

  permanentRedirect('/home');
}
