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

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
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
          .select('id, name')
          .eq('pharmacy_owner_id', profile.id);

        if (branchesError) {
          console.error(`Error fetching branches for ${profile.full_name}:`, branchesError);
          continue;
        }

        if (!branches || branches.length === 0) {
          console.log(`No branches found for ${profile.full_name}`);
          continue;
        }

        // Process each branch separately
        for (const branch of branches) {
          try {
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
              .eq('branch_id', branch.id)
              .gte('created_at', todayStr)
              .lt('created_at', tomorrowStr);

            if (salesError) {
              console.error(`Error fetching sales for branch ${branch.name}:`, salesError);
              continue;
            }

            // Get today's expenses
            const { data: expenses, error: expensesError } = await supabase
              .from('expenses')
              .select('amount')
              .eq('branch_id', branch.id)
              .gte('created_at', todayStr)
              .lt('created_at', tomorrowStr);

            if (expensesError) {
              console.error(`Error fetching expenses for branch ${branch.name}:`, expensesError);
              continue;
            }

            // Calculate daily metrics
            const totalIncome = sales?.reduce((sum, sale) => sum + (sale.total_amount || 0), 0) || 0;
            const totalExpense = expenses?.reduce((sum, expense) => sum + (expense.amount || 0), 0) || 0;
            
            // Calculate total items sold and track medicine sales
            let itemsSoldNumber = 0;
            const medicineSales: { [key: string]: { quantity: number, total: number } } = {};
            const salesSummary: string[] = [];
            
            for (const sale of sales || []) {
              if (sale.sale_items) {
                for (const item of sale.sale_items) {
                  const quantity = item.quantity || 0;
                  const total = item.total_price || 0;
                  const medicineName = item.medicines?.name || 'Unknown';
                  
                  itemsSoldNumber += quantity;
                  
                  if (!medicineSales[medicineName]) {
                    medicineSales[medicineName] = { quantity: 0, total: 0 };
                  }
                  medicineSales[medicineName].quantity += quantity;
                  medicineSales[medicineName].total += total;
                }
              }
            }

            // Find top-selling medicine
            let topMedicine = 'N/A';
            let maxQuantity = 0;
            for (const [name, data] of Object.entries(medicineSales)) {
              if (data.quantity > maxQuantity) {
                maxQuantity = data.quantity;
                topMedicine = name;
              }
            }

            // Build sales summary
            for (const [name, data] of Object.entries(medicineSales)) {
              salesSummary.push(`• ${name} — ${data.quantity} unit${data.quantity > 1 ? 's' : ''} — ${formatNumber(data.total)} ETB`);
            }

            // Format the readable report
            const dateStr = today.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });

            let report = `📊 *Daily Pharmacy Report* 🧾\n\n`;
            report += `🏪 *Branch:* ${branch.name}\n`;
            report += `📅 *Date:* ${dateStr}\n\n`;
            report += `💊 *Items Sold:* ${itemsSoldNumber}\n`;
            report += `💰 *Total Income:* ${formatNumber(totalIncome)} ETB\n`;
            report += `💸 *Total Expense:* ${formatNumber(totalExpense)} ETB\n`;
            report += `🔥 *Top-Selling Medicine:* ${topMedicine}\n\n`;
            
            if (salesSummary.length > 0) {
              report += `🧾 *Sales Summary:*\n${salesSummary.join('\n')}\n\n`;
            }
            
            report += `✅ _Report generated automatically by PharmaXpert Bot_ 🤖`;

            // Send the report
            await sendTelegramMessage(profile.telegram_chat_id, report);
            
            results.push({
              profile: profile.full_name,
              branch: branch.name,
              chatId: profile.telegram_chat_id,
              status: 'sent',
              items_sold_number: itemsSoldNumber,
              total_income: parseFloat(totalIncome.toFixed(2)),
              total_expense: parseFloat(totalExpense.toFixed(2)),
              sales_count: salesSummary.length
            });

            console.log(`Readable daily report sent successfully for branch: ${branch.name}`);
          } catch (error: any) {
            console.error(`Error processing daily report for branch ${branch.name}:`, error);
            results.push({
              profile: profile.full_name,
              branch: branch.name,
              chatId: profile.telegram_chat_id,
              status: 'failed',
              error: error.message
            });
          }
        }
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