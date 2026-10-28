import { Redirect } from 'expo-router';

import { useAppStore } from '@/store/app-store';

export default function Index() {
  const { state } = useAppStore();
  if (!state.booted) return null;
  if (!state.onboarded) return <Redirect href="/welcome" />;
  return <Redirect href={state.me?.pro ? '/pro' : '/today'} />;
}
