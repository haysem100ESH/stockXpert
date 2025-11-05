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
        JSON.stringify({ 
          success: true,
          message: 'No profiles to send reports to',
          reports_delivered: 0 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${profiles.length} profiles to send reports to`);

    const results = [];

    for (const profile of profiles) {
      try {
        // Get branches for this owner
        const { data: branches, error: branchesError } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);

        if (branchesError) {
          console.error(`Error fetching branches for ${profile.full_name}:`, branchesError);
          continue;
        }

        const branchIds = branches?.map(b => b.id) || [];

        if (branchIds.length === 0) {
          console.log(`No branches found for ${profile.full_name}`);
          continue;
        }

        // Get today's sales with sale items and medicine details
        const { data: sales, error: salesError } = await supabase
          .from('sales')
          .select(`
            id, 
            total_amount, 
            created_at,
            sale_items(
              quantity, 
              total_price,
              medicines(name)
            )
          `)
          .in('branch_id', branchIds)
          .gte('created_at', todayStr)
          .lt('created_at', tomorrowStr);

        if (salesError) {
          console.error(`Error fetching sales for ${profile.full_name}:`, salesError);
          continue;
        }

        // Get today's expenses
        const { data: expenses, error: expensesError } = await supabase
          .from('expenses')
          .select('amount')
          .in('branch_id', branchIds)
          .gte('created_at', todayStr)
          .lt('created_at', tomorrowStr);

        if (expensesError) {
          console.error(`Error fetching expenses for ${profile.full_name}:`, expensesError);
          continue;
        }

        // Calculate daily metrics
        const totalIncome = sales?.reduce((sum, sale) => sum + (sale.total_amount || 0), 0) || 0;
        const totalExpense = expenses?.reduce((sum, expense) => sum + (expense.amount || 0), 0) || 0;
        
        // Calculate total items sold and format sales data
        let itemsSoldNumber = 0;
        const salesDetails: any[] = [];
        
        for (const sale of sales || []) {
          if (sale.sale_items) {
            for (const item of sale.sale_items) {
              itemsSoldNumber += item.quantity || 0;
              
              // Add detailed sale item
              salesDetails.push({
                medicine: item.medicines?.name || 'Unknown',
                quantity: item.quantity || 0,
                total: parseFloat((item.total_price || 0).toFixed(2)),
                date: new Date(sale.created_at).toISOString().split('T')[0]
              });
            }
          }
        }

        // Format the report as JSON with detailed sales data
        const reportData = {
          owner_id: profile.id,
          items_sold_number: itemsSoldNumber,
          total_income: parseFloat(totalIncome.toFixed(2)),
          total_expense: parseFloat(totalExpense.toFixed(2)),
          sales: salesDetails
        };

        const report = `\`\`\`json\n${JSON.stringify(reportData, null, 2)}\n\`\`\``;

        // Send the report
        await sendTelegramMessage(profile.telegram_chat_id, report);
        
        results.push({
          profile: profile.full_name,
          chatId: profile.telegram_chat_id,
          status: 'sent',
          owner_id: profile.id,
          items_sold_number: itemsSoldNumber,
          total_income: parseFloat(totalIncome.toFixed(2)),
          total_expense: parseFloat(totalExpense.toFixed(2)),
          sales_count: salesDetails.length
        });

        console.log(`Sales data sent successfully to Telegram for owner_id: ${profile.id}`);
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

    const successCount = results.filter(r => r.status === 'sent').length;
    
    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Reports sent successfully: ${successCount} reports delivered`,
        reports_delivered: successCount,
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