'use client';
// The current bike categories and fees, re-rendering when they load or the
// admin saves Settings. Loaded once per visit.
import { useEffect, useSyncExternalStore } from 'react';
import { getBikeConfig, setBikeConfig, subscribeBikeConfig } from './bikeConfig';
import { isSupabaseConfigured, supabase } from './supabase/client';

let loading: Promise<void> | null = null;
function load() {
  if (loading) return loading;
  loading = (async () => {
    try {
      if (isSupabaseConfigured) {
        const { data } = await supabase().from('app_settings').select('bikes').maybeSingle();
        if (data?.bikes) setBikeConfig(data.bikes);
      } else {
        // Demo mode: Settings are saved in this browser.
        const raw = localStorage.getItem('erp-demo-data-v1');
        const bikes = raw ? JSON.parse(raw)?.settings?.bikes : null;
        if (bikes) setBikeConfig(bikes);
      }
    } catch {
      /* keep the starting categories */
    }
  })();
  return loading;
}

export function useBikeConfig() {
  useEffect(() => {
    load();
  }, []);
  return useSyncExternalStore(subscribeBikeConfig, getBikeConfig, getBikeConfig);
}
