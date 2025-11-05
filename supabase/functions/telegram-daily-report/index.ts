import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sendTelegramMessage(chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to send message to ${chatId}:`, error);
    throw new Error(`Telegram API error: ${error}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Check for required environment variables
    if (!TELEGRAM_BOT_TOKEN) {
      console.error('TELEGRAM_BOT_TOKEN is not set');
      return new Response(
        JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN environment variable is not configured' }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Get optional owner IDs from request body
    const requestBody = await req.text();
    let ownerIds: string[] | null = null;
    
    if (requestBody) {
      try {
        const parsed = JSON.parse(requestBody);
        ownerIds = parsed.ownerIds || null;
      } catch (e) {
        console.log('No JSON body or invalid JSON, sending to all owners');
      }
    }

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayStr = today.toISOString();
    const tomorrowStr = tomorrow.toISOString();

    console.log(`Generating reports for ${today.toDateString()}`);

    // Get profiles with telegram_chat_id (optionally filtered by owner IDs)
    let query = supabase
      .from('profiles')
      .select('id, full_name, telegram_chat_id, role')
      .not('telegram_chat_id', 'is', null)
      .eq('role', 'owner');
    
    if (ownerIds && ownerIds.length > 0) {
      query = query.in('id', ownerIds);
    }
    
    const { data: profiles, error: profilesError } = await query;

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      throw profilesError;
    }

    if (!profiles || profiles.length === 0) {
      console.log('No profiles with Telegram linked found');
      return new Response(
        JSON.stringify({ message: 'No profiles to send reports to' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${profiles.length} profiles to send reports to`);

    const results = [];

    for (const profile of profiles) {
      try {
        // Get branches for this owner
        const { data: branches, error: branchesError } = await supabase
          .from('branches')
          .select('id')
          .eq('owner_id', profile.id);

        if (branchesError) {
          console.error(`Error fetching branches for ${profile.full_name}:`, branchesError);
          continue;
        }

        const branchIds = branches?.map(b => b.id) || [];

        if (branchIds.length === 0) {
          console.log(`No branches found for ${profile.full_name}`);
          continue;
        }

        // Get today's sales
        const { data: sales, error: salesError } = await supabase
          .from('sales')
          .select('id, total_amount, payment_method, medicines:sale_items(quantity, medicine_id)')
          .in('branch_id', branchIds)
          .gte('created_at', todayStr)
          .lt('created_at', tomorrowStr);

        if (salesError) {
          console.error(`Error fetching sales for ${profile.full_name}:`, salesError);
          continue;
        }

        // Calculate statistics
        const totalSales = sales?.length || 0;
        const totalIncome = sales?.reduce((sum, sale) => sum + (sale.total_amount || 0), 0) || 0;

        // Payment methods breakdown
        const paymentBreakdown = sales?.reduce((acc, sale) => {
          const method = sale.payment_method || 'unknown';
          acc[method] = (acc[method] || 0) + (sale.total_amount || 0);
          return acc;
        }, {} as Record<string, number>) || {};

        // Get medicine details for top sellers
        const medicineQuantities = new Map<string, number>();
        
        for (const sale of sales || []) {
          if (sale.medicines) {
            for (const item of sale.medicines) {
              const current = medicineQuantities.get(item.medicine_id) || 0;
              medicineQuantities.set(item.medicine_id, current + (item.quantity || 0));
            }
          }
        }

        // Get top 3 medicines
        const topMedicineIds = Array.from(medicineQuantities.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([id]) => id);

        let topMedicinesText = '';
        if (topMedicineIds.length > 0) {
          const { data: medicines } = await supabase
            .from('medicines')
            .select('name')
            .in('id', topMedicineIds);

          if (medicines && medicines.length > 0) {
            topMedicinesText = medicines
              .map((med, idx) => `${idx + 1}. ${med.name} (${medicineQuantities.get(topMedicineIds[idx])} units)`)
              .join('\n');
          }
        }

        // Get low stock alerts
        const { data: lowStock, error: lowStockError } = await supabase
          .from('medicines')
          .select('id')
          .in('branch_id', branchIds)
          .lt('quantity', 10);

        const lowStockCount = lowStock?.length || 0;

        // Format the report
        const dateFormatted = today.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });

        let report = `📊 *Daily Pharmacy Report*\n`;
        report += `📅 ${dateFormatted}\n\n`;

        if (totalSales === 0) {
          report += `📦 No sales were recorded today.`;
        } else {
          report += `💰 *Total Income:* ${totalIncome.toFixed(2)} ETB\n`;
          report += `🧾 *Transactions:* ${totalSales}\n\n`;

          if (topMedicinesText) {
            report += `💊 *Top Medicines:*\n${topMedicinesText}\n\n`;
          }

          report += `💳 *Payment Breakdown:*\n`;
          Object.entries(paymentBreakdown).forEach(([method, amount]) => {
            const icon = method === 'cash' ? '💵' : method === 'card' ? '💳' : '📝';
            report += `${icon} ${method.charAt(0).toUpperCase() + method.slice(1)}: ${amount.toFixed(2)} ETB\n`;
          });
        }

        if (lowStockCount > 0) {
          report += `\n⚠️ *Stock Alerts:* ${lowStockCount} items running low`;
        }

        // Send the report
        await sendTelegramMessage(profile.telegram_chat_id, report);
        
        results.push({
          profile: profile.full_name,
          chatId: profile.telegram_chat_id,
          status: 'sent',
          totalSales,
          totalIncome
        });

        console.log(`Report sent to ${profile.full_name}`);
      } catch (error: any) {
        console.error(`Error processing report for ${profile.full_name}:`, error);
        results.push({
          profile: profile.full_name,
          chatId: profile.telegram_chat_id,
          status: 'failed',
          error: error.message
        });
      }
    }

    return new Response(
      JSON.stringify({ 
        message: 'Daily reports sent',
        results 
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('Error in telegram-daily-report:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});