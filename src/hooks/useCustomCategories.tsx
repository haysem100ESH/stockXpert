import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const DEFAULT_PHARMACY = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler', 'other'];
const DEFAULT_GENERAL = ['other'];

export function useCustomCategories(systemType: 'pharmacy' | 'general') {
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const defaults = systemType === 'pharmacy' ? DEFAULT_PHARMACY : DEFAULT_GENERAL;

      const { data } = await supabase
        .from('custom_categories')
        .select('name')
        .eq('system_type', systemType)
        .order('name');

      const customNames = (data || []).map(c => c.name.toLowerCase());
      const merged = [...new Set([...defaults, ...customNames])].sort();
      setCategories(merged);
      setLoading(false);
    };
    fetch();
  }, [systemType]);

  return { categories, loading };
}
