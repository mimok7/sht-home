import { headers } from 'next/headers';
import ShthomeLanding from '@/components/home/ShthomeLanding';
import StayHalongLanding from '@/components/home/StayHalongLanding';

const OFFICIAL_HOME_HOST = 'shthome.stayhalong.com';

export default async function RootPage() {
  const host = (await headers()).get('host')?.split(':')[0].toLowerCase();

  if (host === OFFICIAL_HOME_HOST) {
    return <ShthomeLanding />;
  }

  return <StayHalongLanding />;
}
