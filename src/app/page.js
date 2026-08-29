import { headers } from 'next/headers';
import ShthomeLanding from '@/components/home/ShthomeLanding';
import StayHalongLanding from '@/components/home/StayHalongLanding';

const OFFICIAL_HOME_HOSTS = new Set(['shthome.stayhalong.com', 'localhost', '127.0.0.1']);

export default async function RootPage() {
  const host = (await headers()).get('host')?.split(':')[0].toLowerCase();

  if (host && OFFICIAL_HOME_HOSTS.has(host)) {
    return <ShthomeLanding />;
  }

  return <StayHalongLanding />;
}
