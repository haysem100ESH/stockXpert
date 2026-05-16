/**
 * usePackaging
 * ----------------------------------------------------------------------------
 * Fetch the medicine_packaging row for a single medicine, or batch-fetch
 * many at once. Falls back to defaultPackaging() when missing.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { Packaging, defaultPackaging } from '@/lib/packaging';

export function usePackaging(medicineId?: string | null) {
  const q = useQuery({
    queryKey: ['medicine_packaging', medicineId],
    queryFn: async (): Promise<Packaging | null> => {
      if (!medicineId) return null;
      const { data } = await (supabase as any)
        .from('medicine_packaging')
        .select('*')
        .eq('medicine_id', medicineId)
        .maybeSingle();
      return (data as Packaging) || null;
    },
    enabled: !!medicineId,
    staleTime: 60_000,
  });
  return { packaging: q.data ?? null, loading: q.isLoading, refetch: q.refetch };
}

export function usePackagingMap(medicineIds: string[]) {
  const ids = [...new Set(medicineIds || [])].filter(Boolean).sort();
  const key = ids.join(',');
  return useQuery({
    queryKey: ['medicine_packaging_map', key],
    queryFn: async (): Promise<Record<string, Packaging>> => {
      if (ids.length === 0) return {};
      const { data } = await (supabase as any)
        .from('medicine_packaging')
        .select('*')
        .in('medicine_id', ids);
      const map: Record<string, Packaging> = {};
      (data || []).forEach((row: any) => { map[row.medicine_id] = row as Packaging; });
      return map;
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
}

/** Resolve an effective packaging — using a fetched row or defaults. */
export const effectivePackaging = (p?: Packaging | null): Packaging =>
  p ?? defaultPackaging();
