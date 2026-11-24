/**
 * Root index: /setup on a fresh install, the enterprise sign-in once setup is
 * done.
 */
import { setupNeeded } from '../lib/setupLock';

export default function Index() {
  return null;
}

export async function getServerSideProps() {
  const needed = setupNeeded(process.env, { cwd: process.cwd() });
  return {
    redirect: {
      destination: needed ? '/setup' : '/enterprise/login',
      permanent: false,
    },
  };
}
