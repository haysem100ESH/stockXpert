import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    const { action, requestId } = body;
    if (!requestId || !['approve', 'reject', 'fulfill'].includes(action)) {
      return json({ error: 'Invalid action or requestId' }, 400);
    }

    const { data: trReq, error: trErr } = await admin
      .from('transfer_requests').select('*').eq('id', requestId).single();
    if (trErr || !trReq) return json({ error: 'Request not found' }, 404);

    const { data: profile } = await admin
      .from('profiles').select('id, role').eq('id', user.id).single();
    if (!profile || profile.role !== 'owner') {
      return json({ error: 'Only owners can manage transfer requests' }, 403);
    }

    // -------- APPROVE --------
    if (action === 'approve') {
      if (trReq.status !== 'pending') return json({ error: 'Can only approve pending requests' }, 400);

      const { error: updErr } = await admin
        .from('transfer_requests')
        .update({ status: 'approved', approved_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', requestId);
      if (updErr) return json({ error: updErr.message }, 500);

      const { data: items, error: itemsErr } = await admin
        .from('transfer_request_items').select('*').eq('request_id', requestId);
      if (itemsErr) return json({ error: itemsErr.message }, 500);

      for (const item of items || []) {
        const { error: itErr } = await admin
          .from('transfer_request_items')
          .update({ approved_quantity: item.requested_quantity })
          .eq('id', item.id);
        if (itErr) return json({ error: itErr.message }, 500);
      }

      return json({ success: true, message: 'Request approved' });
    }

    // -------- REJECT --------
    if (action === 'reject') {
      if (trReq.status !== 'pending') return json({ error: 'Can only reject pending requests' }, 400);

      const { error: updErr } = await admin
        .from('transfer_requests')
        .update({ status: 'rejected', approved_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', requestId);
      if (updErr) return json({ error: updErr.message }, 500);

      return json({ success: true, message: 'Request rejected' });
    }

    // -------- FULFILL (atomic via RPC) --------
    if (action === 'fulfill') {
      if (trReq.status !== 'approved') {
        return json({ error: 'Can only fulfill approved requests' }, 400);
      }

      const { error: rpcErr } = await admin.rpc('fulfill_transfer_request', {
        p_request_id: requestId,
        p_user_id: user.id,
      });
      if (rpcErr) {
        return json({ error: rpcErr.message || 'Transfer fulfillment failed' }, 500);
      }

      return json({ success: true, message: 'Transfer fulfilled — stock and expenses updated' });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error: any) {
    return json({ error: error?.message || 'Unexpected error' }, 500);
  }
});
