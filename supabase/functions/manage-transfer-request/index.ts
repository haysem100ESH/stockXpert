import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    const { action, requestId } = body;

    if (!requestId || !['approve', 'reject', 'fulfill'].includes(action)) {
      return new Response(JSON.stringify({ error: 'Invalid action or requestId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the request
    const { data: trReq, error: trErr } = await admin
      .from('transfer_requests')
      .select('*')
      .eq('id', requestId)
      .single();
    if (trErr || !trReq) {
      return new Response(JSON.stringify({ error: 'Request not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user is owner
    const { data: profile } = await admin.from('profiles').select('id, role').eq('id', user.id).single();
    if (!profile || profile.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Only owners can manage transfer requests' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // APPROVE
    if (action === 'approve') {
      if (trReq.status !== 'pending') {
        return new Response(JSON.stringify({ error: 'Can only approve pending requests' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await admin.from('transfer_requests').update({
        status: 'approved', approved_by: user.id, updated_at: new Date().toISOString(),
      }).eq('id', requestId);

      // Set approved_quantity = requested_quantity for all items
      const { data: items } = await admin.from('transfer_request_items').select('*').eq('request_id', requestId);
      if (items) {
        for (const item of items) {
          await admin.from('transfer_request_items').update({
            approved_quantity: item.requested_quantity,
          }).eq('id', item.id);
        }
      }

      return new Response(JSON.stringify({ success: true, message: 'Request approved' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // REJECT
    if (action === 'reject') {
      if (trReq.status !== 'pending') {
        return new Response(JSON.stringify({ error: 'Can only reject pending requests' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await admin.from('transfer_requests').update({
        status: 'rejected', approved_by: user.id, updated_at: new Date().toISOString(),
      }).eq('id', requestId);

      return new Response(JSON.stringify({ success: true, message: 'Request rejected' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // FULFILL
    if (action === 'fulfill') {
      if (trReq.status !== 'approved') {
        return new Response(JSON.stringify({ error: 'Can only fulfill approved requests' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Resolve location IDs to branch IDs
      const locIds = [trReq.requesting_location_id, trReq.source_location_id].filter(Boolean);
      const { data: locs } = await admin.from('locations').select('id, branch_id').in('id', locIds);
      const locToBranch: Record<string, string> = {};
      (locs || []).forEach((l: any) => { if (l.branch_id) locToBranch[l.id] = l.branch_id; });

      const destBranchId = locToBranch[trReq.requesting_location_id];
      const sourceBranchId = trReq.source_location_id ? locToBranch[trReq.source_location_id] : null;

      if (!destBranchId) {
        return new Response(JSON.stringify({ error: 'Could not resolve destination branch' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!sourceBranchId) {
        return new Response(JSON.stringify({ error: 'Could not resolve source branch' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Resolve branch names for expense descriptions
      const { data: branches } = await admin.from('pharmacy_branches').select('id, name, pharmacy_owner_id').in('id', [destBranchId, sourceBranchId]);
      const branchMap: Record<string, any> = {};
      (branches || []).forEach((b: any) => { branchMap[b.id] = b; });

      const destName = branchMap[destBranchId]?.name || 'Unknown';
      const sourceName = branchMap[sourceBranchId]?.name || 'Unknown';
      const ownerId = branchMap[destBranchId]?.pharmacy_owner_id || branchMap[sourceBranchId]?.pharmacy_owner_id;

      // Fetch approved items
      const { data: items, error: itemsErr } = await admin
        .from('transfer_request_items')
        .select('id, medicine_id, approved_quantity, requested_quantity')
        .eq('request_id', requestId);
      if (itemsErr || !items || items.length === 0) {
        return new Response(JSON.stringify({ error: 'No items to fulfill' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Process each item
      for (const item of items) {
        const qty = Number(item.approved_quantity || item.requested_quantity);
        if (qty <= 0) continue;

        // Get source medicine
        const { data: sourceMed } = await admin
          .from('medicines')
          .select('*')
          .eq('id', item.medicine_id)
          .single();
        if (!sourceMed) continue;

        // Deduct from source
        await admin.from('medicines').update({
          stock_quantity: Math.max(0, sourceMed.stock_quantity - qty),
        }).eq('id', sourceMed.id);

        // Add to destination - find existing or clone
        const { data: destMed } = await admin
          .from('medicines')
          .select('*')
          .eq('branch_id', destBranchId)
          .eq('name', sourceMed.name)
          .maybeSingle();

        if (destMed) {
          await admin.from('medicines').update({
            stock_quantity: destMed.stock_quantity + qty,
          }).eq('id', destMed.id);
        } else {
          // Clone medicine to destination branch
          const { id, stock_quantity, location_id, branch_id, created_at, updated_at, ...rest } = sourceMed as any;
          await admin.from('medicines').insert({
            ...rest,
            stock_quantity: qty,
            branch_id: destBranchId,
            created_by: user.id,
          });
        }

        // Transfer expenses
        const expenseAmount = qty * (sourceMed.purchase_price || 0);
        if (expenseAmount > 0) {
          const unitLabel = (sourceMed.unit_label || 'unit').toUpperCase();
          await admin.from('expenses').insert([
            {
              description: `Transfer Out: ${sourceMed.name} (${qty} ${unitLabel}) to ${destName}`,
              amount: -expenseAmount,
              branch_id: sourceBranchId,
              category: 'Stock Transfer',
              pharmacy_owner_id: ownerId,
            },
            {
              description: `Transfer In: ${sourceMed.name} (${qty} ${unitLabel}) from ${sourceName}`,
              amount: expenseAmount,
              branch_id: destBranchId,
              category: 'Stock Transfer',
              pharmacy_owner_id: ownerId,
            },
          ]);
        }
      }

      // Mark as fulfilled
      await admin.from('transfer_requests').update({
        status: 'fulfilled', updated_at: new Date().toISOString(),
      }).eq('id', requestId);

      return new Response(JSON.stringify({ success: true, message: 'Transfer fulfilled — stock and expenses updated' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Unexpected error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
