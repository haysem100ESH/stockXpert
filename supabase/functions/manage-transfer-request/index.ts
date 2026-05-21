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

      // Fetch approved items (including target mapping)
      const { data: items, error: itemsErr } = await admin
        .from('transfer_request_items')
        .select('id, medicine_id, approved_quantity, requested_quantity, target_medicine_id, target_batch_id, create_new_batch, new_batch_number, new_batch_expiry, new_batch_purchase_price')
        .eq('request_id', requestId);
      if (itemsErr || !items || items.length === 0) {
        return new Response(JSON.stringify({ error: 'No items to fulfill' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Helper: sync branch_items.quantity = SUM(remaining_quantity) of its batches
      const syncBranchItemQty = async (branchItemId: string) => {
        const { data: bs } = await admin
          .from('inventory_batches')
          .select('remaining_quantity')
          .eq('branch_item_id', branchItemId)
          .gt('remaining_quantity', 0);
        const total = (bs || []).reduce((s: number, b: any) => s + Number(b.remaining_quantity), 0);
        const rounded = Math.round(total);
        const qty = Math.abs(total - rounded) < 0.001 ? rounded : Number(total.toFixed(4));
        await admin
          .from('branch_items')
          .update({ quantity: qty, updated_at: new Date().toISOString() })
          .eq('id', branchItemId);
      };

      // Process each item
      for (const item of items) {
        const qty = Number(item.approved_quantity || item.requested_quantity);
        if (qty <= 0) continue;

        // --- Source: locate branch_item for (sourceBranchId, source medicine_id)
        const { data: sourceBI } = await admin
          .from('branch_items')
          .select('id, quantity, selling_price, purchase_price')
          .eq('branch_id', sourceBranchId)
          .eq('medicine_id', item.medicine_id)
          .maybeSingle();

        if (!sourceBI) {
          return new Response(JSON.stringify({ error: `Source branch does not stock this item` }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (Number(sourceBI.quantity || 0) < qty) {
          return new Response(JSON.stringify({ error: `Insufficient stock in source branch` }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: sourceMed } = await admin
          .from('medicines')
          .select('id, name, unit_label')
          .eq('id', item.medicine_id)
          .single();
        if (!sourceMed) continue;

        // --- FIFO deduct from source batches
        const { data: batches } = await admin
          .from('inventory_batches')
          .select('id, remaining_quantity, purchase_price, selling_price, expiry_date, batch_number')
          .eq('branch_item_id', sourceBI.id)
          .gt('remaining_quantity', 0)
          .order('expiry_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true });

        let remaining = qty;
        let totalCost = 0;
        const consumed: Array<{ qty: number; pp: number; sp: number; expiry: string | null; batch_number: string | null }> = [];

        for (const b of (batches || [])) {
          if (remaining <= 0) break;
          const br = Number(b.remaining_quantity);
          const take = Math.min(remaining, br);
          const newRem = Math.max(0, br - take);
          await admin
            .from('inventory_batches')
            .update({ remaining_quantity: newRem, updated_at: new Date().toISOString() })
            .eq('id', b.id);
          consumed.push({
            qty: take,
            pp: Number(b.purchase_price || 0),
            sp: Number(b.selling_price || sourceBI.selling_price || 0),
            expiry: b.expiry_date,
            batch_number: b.batch_number,
          });
          totalCost += take * Number(b.purchase_price || 0);
          remaining -= take;
        }

        await syncBranchItemQty(sourceBI.id);

        const avgPurchasePrice = qty > 0 ? totalCost / qty : Number(sourceBI.purchase_price || 0);

        // --- Destination: use mapped target medicine if provided
        const targetMedicineId: string = (item as any).target_medicine_id || item.medicine_id;

        const { data: existingDestBI } = await admin
          .from('branch_items')
          .select('id, selling_price, purchase_price')
          .eq('branch_id', destBranchId)
          .eq('medicine_id', targetMedicineId)
          .maybeSingle();

        let destBranchItemId: string;
        if (existingDestBI) {
          destBranchItemId = existingDestBI.id;
        } else {
          const { data: newBI, error: biErr } = await admin
            .from('branch_items')
            .insert({
              owner_id: ownerId,
              branch_id: destBranchId,
              medicine_id: targetMedicineId,
              selling_price: consumed[0]?.sp || Number(sourceBI.selling_price || 0),
              purchase_price: avgPurchasePrice,
              quantity: 0,
              expiry_date: consumed[0]?.expiry || null,
            })
            .select('id')
            .single();
          if (biErr || !newBI) throw new Error(biErr?.message || 'Failed to create destination branch_item');
          destBranchItemId = newBI.id;
        }

        // --- Destination batching: per requester's selection
        const targetBatchId: string | null = (item as any).target_batch_id || null;
        const createNewBatch: boolean = !!(item as any).create_new_batch;

        if (!createNewBatch && targetBatchId) {
          // Add ALL consumed quantity to the chosen existing batch
          const { data: tb } = await admin
            .from('inventory_batches')
            .select('id, quantity, remaining_quantity')
            .eq('id', targetBatchId)
            .eq('branch_item_id', destBranchItemId)
            .maybeSingle();
          if (tb) {
            await admin.from('inventory_batches').update({
              quantity: Number(tb.quantity || 0) + qty,
              remaining_quantity: Number(tb.remaining_quantity || 0) + qty,
              updated_at: new Date().toISOString(),
            }).eq('id', tb.id);
          } else {
            // Fallback: target batch missing/invalid — create a single new batch
            await admin.from('inventory_batches').insert({
              branch_id: destBranchId,
              medicine_id: targetMedicineId,
              branch_item_id: destBranchItemId,
              batch_number: consumed[0]?.batch_number || null,
              quantity: qty,
              remaining_quantity: qty,
              purchase_price: avgPurchasePrice,
              selling_price: consumed[0]?.sp || Number(sourceBI.selling_price || 0),
              expiry_date: consumed[0]?.expiry || null,
              created_by: user.id,
            });
          }
        } else if (createNewBatch) {
          // Create a single new batch with user-specified metadata
          const newBatchNumber = (item as any).new_batch_number || consumed[0]?.batch_number || null;
          const newExpiry = (item as any).new_batch_expiry || consumed[0]?.expiry || null;
          const newPP = (item as any).new_batch_purchase_price != null
            ? Number((item as any).new_batch_purchase_price)
            : avgPurchasePrice;
          await admin.from('inventory_batches').insert({
            branch_id: destBranchId,
            medicine_id: targetMedicineId,
            branch_item_id: destBranchItemId,
            batch_number: newBatchNumber,
            quantity: qty,
            remaining_quantity: qty,
            purchase_price: newPP,
            selling_price: consumed[0]?.sp || Number(sourceBI.selling_price || 0),
            expiry_date: newExpiry,
            created_by: user.id,
          });
        } else {
          // Legacy fallback (older requests with no mapping): preserve source batches
          for (const c of consumed) {
            await admin.from('inventory_batches').insert({
              branch_id: destBranchId,
              medicine_id: targetMedicineId,
              branch_item_id: destBranchItemId,
              batch_number: c.batch_number,
              quantity: c.qty,
              remaining_quantity: c.qty,
              purchase_price: c.pp,
              selling_price: c.sp,
              expiry_date: c.expiry,
              created_by: user.id,
            });
          }
        }
        await syncBranchItemQty(destBranchItemId);

        // --- Expenses (paired transfer-out / transfer-in)
        if (totalCost > 0) {
          const unitLabel = (sourceMed.unit_label || 'unit').toUpperCase();
          await admin.from('expenses').insert([
            {
              description: `Transfer Out: ${sourceMed.name} (${qty} ${unitLabel}) to ${destName}`,
              amount: -totalCost,
              branch_id: sourceBranchId,
              category: 'Stock Transfer',
              created_by: user.id,
            },
            {
              description: `Transfer In: ${sourceMed.name} (${qty} ${unitLabel}) from ${sourceName}`,
              amount: totalCost,
              branch_id: destBranchId,
              category: 'Stock Transfer',
              created_by: user.id,
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
