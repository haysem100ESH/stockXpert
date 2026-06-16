import { supabase } from '@/integrations/supabase/client';

export type ActivityType =
  | 'create_item'
  | 'edit_item'
  | 'delete_item'
  | 'adjust_stock'
  | 'create_medicine_code'
  | 'edit_medicine_code'
  | 'delete_medicine_code'
  | 'assign_item_to_code'
  | 'unassign_item_from_code'
  | 'create_category'
  | 'edit_category'
  | 'delete_category'
  | 'sell_item'
  | 'request_stock_transfer'
  | 'create_customer'
  | 'edit_customer'
  | 'delete_customer'
  | 'record_payment'
  | 'create_supplier'
  | 'edit_supplier'
  | 'edit_batch'
  | 'create_batch'
  | 'delete_batch';

export interface LogActivityInput {
  type: ActivityType;
  entityType?: string;
  entityId?: string;
  previous?: any;
  next?: any;
  metadata?: Record<string, any>;
}

/**
 * Log a user activity. Failures are swallowed so logging never breaks UX.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await (supabase as any).rpc('log_activity', {
      p_activity_type: input.type,
      p_entity_type: input.entityType ?? null,
      p_entity_id: input.entityId ?? null,
      p_previous: input.previous ?? null,
      p_new: input.next ?? null,
      p_metadata: input.metadata ?? null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[activity] failed to log', input.type, err);
  }
}

/** Diff two flat objects to a list of changed fields. */
export function diffFields(prev: Record<string, any> | null | undefined, next: Record<string, any>) {
  if (!prev) return Object.keys(next);
  return Object.keys(next).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}
