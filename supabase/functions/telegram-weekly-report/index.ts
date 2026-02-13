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

async function sendTelegramPhoto(chatId: string, photoUrl: string, caption: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption: caption,
      parse_mode: 'Markdown',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to send photo to ${chatId}:`, error);
    throw new Error(`Telegram API error: ${error}`);
  }

  return await response.json();
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

function generateChartUrl(labels: string[], incomeData: number[], expenseData: number[], title: string): string {
  const chartConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Income',
          data: incomeData,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          tension: 0.1
        },
        {
          label: 'Expense',
          data: expenseData,
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          tension: 0.1
        }
      ]
    },
    options: {
      title: {
        display: true,
        text: title
      },
      scales: {
        yAxes: [{
          ticks: {
            beginAtZero: true
          }
        }]
      }
    }
  };

  const encodedChart = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encodedChart}&width=800&height=400`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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
    
    // Calculate date range for last 7 days
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(today);
    weekEnd.setHours(23, 59, 59, 999);

    const weekStartStr = weekStart.toISOString();
    const weekEndStr = weekEnd.toISOString();

    console.log(`Generating weekly reports from ${weekStart.toDateString()} to ${weekEnd.toDateString()}`);

    // Get profiles with telegram_chat_id
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, telegram_chat_id, role')
      .not('telegram_chat_id', 'is', null)
      .eq('role', 'owner');

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

    console.log(`Found ${profiles.length} profiles to send weekly reports to`);

    const results = [];

    for (const profile of profiles) {
      try {
        // Get branches for this owner
        const { data: branches, error: branchesError } = await supabase
          .from('pharmacy_branches')
          .select('id, name, branch_type')
          .eq('pharmacy_owner_id', profile.id);

        if (branchesError || !branches || branches.length === 0) {
          console.log(`No branches found for ${profile.full_name}`);
          continue;
        }

        // Process each branch
        for (const branch of branches) {
          try {
            const isPharmacy = branch.branch_type === 'pharmacy';
            const topLabel = isPharmacy ? 'Top 3 Medicines' : 'Top 3 Items';
            const botName = isPharmacy ? 'PharmaXpert Bot' : 'StockXpert Bot';
            const reportTitle = isPharmacy ? '📅 *Weekly Pharmacy Summary* 📈' : '📅 *Weekly Inventory Summary* 📈';
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
              .gte('created_at', weekStartStr)
              .lte('created_at', weekEndStr);

            if (salesError) {
              console.error(`Error fetching sales for branch ${branch.name}:`, salesError);
              continue;
            }

            // Get weekly expenses
            const { data: expenses, error: expensesError } = await supabase
              .from('expenses')
              .select('amount, created_at')
              .eq('branch_id', branch.id)
              .gte('created_at', weekStartStr)
              .lte('created_at', weekEndStr);

            if (expensesError) {
              console.error(`Error fetching expenses for branch ${branch.name}:`, expensesError);
              continue;
            }

            // Calculate metrics
            const totalIncome = sales?.reduce((sum, sale) => sum + (sale.total_amount || 0), 0) || 0;
            const totalExpense = expenses?.reduce((sum, expense) => sum + (expense.amount || 0), 0) || 0;
            
            let itemsSoldNumber = 0;
            const medicineSales: { [key: string]: number } = {};
            
            for (const sale of sales || []) {
              if (sale.sale_items) {
                for (const item of sale.sale_items) {
                  const quantity = item.quantity || 0;
                  const medicineName = item.medicines?.name || 'Unknown';
                  
                  itemsSoldNumber += quantity;
                  medicineSales[medicineName] = (medicineSales[medicineName] || 0) + quantity;
                }
              }
            }

            // Get top 3 medicines
            const topMedicines = Object.entries(medicineSales)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 3);

            // Prepare daily data for chart
            const dailyLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const dailyIncome = new Array(7).fill(0);
            const dailyExpense = new Array(7).fill(0);

            for (const sale of sales || []) {
              const saleDate = new Date(sale.created_at);
              const dayIndex = (saleDate.getDay() + 6) % 7; // Convert Sunday=0 to Monday=0
              dailyIncome[dayIndex] += sale.total_amount || 0;
            }

            for (const expense of expenses || []) {
              const expenseDate = new Date(expense.created_at);
              const dayIndex = (expenseDate.getDay() + 6) % 7;
              dailyExpense[dayIndex] += expense.amount || 0;
            }

            // Format report
            const weekRangeStr = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

            let report = `${reportTitle}\n\n`;
            report += `🏪 *Branch:* ${branch.name}\n`;
            report += `📆 *Week:* ${weekRangeStr}\n\n`;
            report += `💊 *Total Items Sold:* ${itemsSoldNumber}\n`;
            report += `💰 *Total Income:* ${formatNumber(totalIncome)} ETB\n`;
            report += `💸 *Total Expense:* ${formatNumber(totalExpense)} ETB\n`;
            
            if (topMedicines.length > 0) {
              report += `🔥 *${topLabel}:*\n`;
              topMedicines.forEach(([name, qty], idx) => {
                report += `${idx + 1}️⃣ ${name} — ${qty} units\n`;
              });
            }
            
            report += `\n✅ _Weekly summary generated automatically by ${botName}_ 🤖`;

            // Send text report
            await sendTelegramMessage(profile.telegram_chat_id, report);

            // Generate and send chart
            const chartUrl = generateChartUrl(
              dailyLabels,
              dailyIncome,
              dailyExpense,
              '📊 Weekly Sales Performance'
            );

            const chartCaption = `📈 *Weekly Sales Trend — ${branch.name}*`;
            await sendTelegramPhoto(profile.telegram_chat_id, chartUrl, chartCaption);

            results.push({
              profile: profile.full_name,
              branch: branch.name,
              chatId: profile.telegram_chat_id,
              status: 'sent',
              items_sold: itemsSoldNumber,
              total_income: parseFloat(totalIncome.toFixed(2)),
              total_expense: parseFloat(totalExpense.toFixed(2))
            });

            console.log(`Weekly report sent successfully for branch: ${branch.name}`);
          } catch (error: any) {
            console.error(`Error processing weekly report for branch ${branch.name}:`, error);
            results.push({
              profile: profile.full_name,
              branch: branch.name,
              status: 'failed',
              error: error.message
            });
          }
        }
      } catch (error: any) {
        console.error(`Error processing reports for ${profile.full_name}:`, error);
        results.push({
          profile: profile.full_name,
          status: 'failed',
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.status === 'sent').length;
    
    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Weekly reports sent successfully: ${successCount} reports delivered`,
        reports_delivered: successCount,
        results 
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('Error in telegram-weekly-report:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
