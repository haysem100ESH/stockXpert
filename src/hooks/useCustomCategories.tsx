import { useState, useEffect } from 'react';
import { supabase } from '@/lib/db';

export function useCustomCategories(systemType: 'pharmacy' | 'general') {
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);

      const { data } = await supabase
        .from('custom_categories')
        .select('name')
        .eq('system_type', systemType)
        .order('name');

      const customNames = (data || []).map((c: { name: string }) => c.name);
      setCategories(customNames);
      setLoading(false);
    };
    fetch();
  }, [systemType]);

  return { categories, loading };
}

