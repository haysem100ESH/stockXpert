import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");

    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAuth
      .from("profiles")
      .select("role, branch_id, full_name")
      .eq("id", user.id)
      .single();
    if (!profile) throw new Error("Profile not found");

    const { messages, branchIds, branchType } = await req.json();

    const db = createClient(supabaseUrl, supabaseServiceKey);

    // Determine the pharmacy owner ID for branch fetching
    let pharmacyOwnerId = user.id;
    if (profile.role === 'staff' && profile.branch_id) {
      const { data: ownerBranch } = await db
        .from("pharmacy_branches")
        .select("pharmacy_owner_id")
        .eq("id", profile.branch_id)
        .single();
      if (ownerBranch) pharmacyOwnerId = ownerBranch.pharmacy_owner_id;
    }

    const branchFilter = branchIds?.length
      ? (query: any) => query.in("branch_id", branchIds)
      : (query: any) => query;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const today = now.toISOString().split("T")[0];

    // Fetch branch names for mapping - filtered by owner
    const branchesRes = await db.from("pharmacy_branches").select("id, name, branch_type, is_main_branch").eq("pharmacy_owner_id", pharmacyOwnerId);
    const branchMap: Record<string, string> = {};
    for (const b of (branchesRes.data || [])) {
      branchMap[b.id] = b.name;
    }
    const getBranchName = (id: string) => branchMap[id] || id;

    const [
      inventoryRes,
      todaySalesRes,
      recentSalesRes,
      suppliersRes,
      customersRes,
      customerCreditsRes,
      expiringSoonRes,
      expiringMonthRes,
      saleItemsRes,
      supplierDebtsRes,
      supplierPurchasesRes,
      supplierPaymentsRes,
      customerPaymentsRes,
      expensesRes,
      stockAdjustmentsRes,
      transfersRes,
      locationsRes,
    ] = await Promise.all([
      // 1. Full inventory
      branchFilter(db.from("medicines").select("id, name, generic_name, category, manufacturer, batch_number, purchase_price, selling_price, stock_quantity, minimum_stock_level, expiry_date, branch_id, units_per_pack, open_pack_units, unit_label, item_type, location_id, country_name"))
        .order("stock_quantity", { ascending: true })
        .limit(1000),

      // 2. Today's sales
      branchFilter(db.from("sales").select("id, total_amount, payment_method, created_at, branch_id, customer_id, amount_paid, payment_status, discount_amount, extra_profit"))
        .gte("created_at", `${today}T00:00:00`)
        .lte("created_at", `${today}T23:59:59`),

      // 3. Last 30 days sales
      branchFilter(db.from("sales").select("id, total_amount, created_at, branch_id, payment_method, payment_status, discount_amount"))
        .gte("created_at", thirtyDaysAgo.toISOString()),

      // 4. Suppliers
      branchFilter(db.from("suppliers").select("id, name, contact_person, phone, email, address, branch_id")).limit(100),

      // 5. All customers
      branchFilter(db.from("customers").select("id, name, phone, credit_score, branch_id, notes")).limit(200),

      // 6. Customer credits (debts)
      db.from("customer_credits").select("id, customer_id, branch_id, total_debt, last_updated")
        .gt("total_debt", 0)
        .order("total_debt", { ascending: false })
        .limit(50),

      // 7. Expiring within 7 days
      branchType === "pharmacy"
        ? branchFilter(db.from("medicines").select("id, name, stock_quantity, expiry_date, branch_id"))
            .lte("expiry_date", sevenDaysFromNow.toISOString().split("T")[0])
            .gte("expiry_date", today)
            .gt("stock_quantity", 0)
            .limit(50)
        : Promise.resolve({ data: [], error: null }),

      // 8. Expiring within 30 days
      branchType === "pharmacy"
        ? branchFilter(db.from("medicines").select("id, name, stock_quantity, expiry_date, branch_id"))
            .lte("expiry_date", thirtyDaysFromNow.toISOString().split("T")[0])
            .gte("expiry_date", today)
            .gt("stock_quantity", 0)
            .limit(100)
        : Promise.resolve({ data: [], error: null }),

      // 9. Sale items (last 30 days for top sellers)
      db.from("sale_items").select("id, medicine_id, quantity, unit_price, total_price, sale_id, sale_type")
        .order("created_at", { ascending: false })
        .limit(500),

      // 10. Supplier debts
      db.from("supplier_debts").select("id, supplier_id, branch_id, total_debt, last_updated")
        .gt("total_debt", 0),

      // 11. Supplier purchases (last 90 days)
      branchFilter(db.from("supplier_purchases").select("id, supplier_id, item_name, quantity, unit_cost, total_cost, payment_type, branch_id, created_at"))
        .gte("created_at", ninetyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(200),

      // 12. Supplier payments (last 90 days)
      db.from("supplier_payments").select("id, supplier_id, amount, payment_method, branch_id, created_at")
        .gte("created_at", ninetyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(100),

      // 13. Customer payments (last 30 days)
      db.from("customer_payments").select("id, customer_id, amount, payment_method, branch_id, created_at")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(100),

      // 14. Expenses (last 30 days)
      branchFilter(db.from("expenses").select("id, description, amount, category, created_at, branch_id"))
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(100),

      // 15. Stock adjustments (last 30 days)
      branchFilter(db.from("inventory_stock_adjustments").select("id, medicine_id, adjustment_type, quantity, reason, branch_id, created_at"))
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(50),

      // 16. Medicine transfers (last 30 days)
      db.from("medicine_transfers").select("id, medicine_id, from_branch_id, to_branch_id, quantity, created_at, notes")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(50),

      // 17. Locations
      db.from("locations").select("id, name, type, address, branch_id").limit(50),
    ]);

    const inventory = inventoryRes.data || [];
    const lowStock = inventory.filter((i: any) => i.stock_quantity > 0 && i.stock_quantity <= i.minimum_stock_level);
    const outOfStock = inventory.filter((i: any) => i.stock_quantity <= 0);
    const todaySales = todaySalesRes.data || [];
    const recentSales = recentSalesRes.data || [];
    const suppliers = suppliersRes.data || [];
    const customers = customersRes.data || [];
    const customerCredits = customerCreditsRes.data || [];
    const expiringSoon = expiringSoonRes.data || [];
    const expiringMonth = expiringMonthRes.data || [];
    const saleItems = saleItemsRes.data || [];
    const supplierDebts = supplierDebtsRes.data || [];
    const supplierPurchases = supplierPurchasesRes.data || [];
    const supplierPayments = supplierPaymentsRes.data || [];
    const customerPayments = customerPaymentsRes.data || [];
    const expenses = expensesRes.data || [];
    const stockAdjustments = stockAdjustmentsRes.data || [];
    const transfers = transfersRes.data || [];
    const locations = locationsRes.data || [];

    const todayRevenue = todaySales.reduce((s: number, sale: any) => s + Number(sale.total_amount || 0), 0);
    const monthlyRevenue = recentSales.reduce((s: number, sale: any) => s + Number(sale.total_amount || 0), 0);
    const totalCustomerDebt = customerCredits.reduce((s: number, c: any) => s + Number(c.total_debt || 0), 0);
    const totalSupplierDebt = supplierDebts.reduce((s: number, d: any) => s + Number(d.total_debt || 0), 0);
    const totalExpenses = expenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const todayDiscount = todaySales.reduce((s: number, sale: any) => s + Number(sale.discount_amount || 0), 0);
    const todayExtraProfit = todaySales.reduce((s: number, sale: any) => s + Number(sale.extra_profit || 0), 0);

    // Build customer name map
    const customerMap: Record<string, string> = {};
    for (const c of customers) customerMap[c.id] = c.name;

    // Build supplier name map
    const supplierMap: Record<string, string> = {};
    for (const s of suppliers) supplierMap[s.id] = s.name;

    // Build medicine name map
    const medicineMap: Record<string, string> = {};
    for (const m of inventory) medicineMap[m.id] = m.name;

    // Top selling items
    const itemSalesCount: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const si of saleItems) {
      const name = medicineMap[si.medicine_id] || si.medicine_id;
      if (!itemSalesCount[si.medicine_id]) itemSalesCount[si.medicine_id] = { name, qty: 0, revenue: 0 };
      itemSalesCount[si.medicine_id].qty += Number(si.quantity);
      itemSalesCount[si.medicine_id].revenue += Number(si.total_price);
    }
    const topSellers = Object.values(itemSalesCount).sort((a, b) => b.qty - a.qty).slice(0, 10);

    // Credit sales today
    const creditSalesToday = todaySales.filter((s: any) => s.payment_status === 'credit' || s.payment_status === 'partial');

    const ItemLabel = branchType === "pharmacy" ? "Medicine" : "Item";

    const systemContext = `
You are StockXpert AI, a Smart Assistant for ${branchType === "pharmacy" ? "PharmaXpert (Pharmacy Management)" : "StockXpert (Inventory Management)"}.
User: ${profile.full_name} (Role: ${profile.role})
${profile.role === "staff" ? "Note: This user is staff with limited access. Do not reveal owner-only financial details like profit margins or purchase prices." : ""}

Branch IDs being queried: ${branchIds?.length ? branchIds.map((id: string) => `${getBranchName(id)} (${id})`).join(", ") : "All branches"}

🏪 ALL BRANCHES (${(branchesRes.data || []).length} total):
${(branchesRes.data || []).map((b: any) => `  • ${b.name} (Type: ${b.branch_type}, Main: ${b.is_main_branch ? "Yes" : "No"}, ID: ${b.id})`).join("\n")}

CURRENT SYSTEM DATA:
═══════════════════

📦 INVENTORY SUMMARY:
- Total ${ItemLabel}s in system: ${inventory.length}
- Low Stock (stock ≤ minimum level): ${lowStock.length}
${lowStock.length > 0 ? lowStock.slice(0, 30).map((i: any) => `  • ${i.name}: ${i.stock_quantity} units (min: ${i.minimum_stock_level}, price: ${i.selling_price}, branch: ${getBranchName(i.branch_id)})`).join("\n") : "  None"}
- Out of Stock (0 units): ${outOfStock.length}
${outOfStock.length > 0 ? outOfStock.slice(0, 20).map((i: any) => `  • ${i.name} (branch: ${getBranchName(i.branch_id)})`).join("\n") : "  None"}

📋 FULL INVENTORY LIST (first 50):
${inventory.slice(0, 50).map((i: any) => `  • ${i.name} | Qty: ${i.stock_quantity} | Min: ${i.minimum_stock_level} | Price: ${i.selling_price} | Category: ${i.category} | Branch: ${getBranchName(i.branch_id)}${i.expiry_date ? ` | Exp: ${i.expiry_date}` : ""}`).join("\n")}

💰 SALES SUMMARY:
- Today: ${todaySales.length} transactions, Revenue: ${todayRevenue.toFixed(2)}, Discounts: ${todayDiscount.toFixed(2)}, Extra Profit: ${todayExtraProfit.toFixed(2)}
- Today's Payment Methods: ${Object.entries(todaySales.reduce((acc: any, s: any) => { acc[s.payment_method || 'unknown'] = (acc[s.payment_method || 'unknown'] || 0) + 1; return acc; }, {})).map(([k, v]) => `${k}: ${v}`).join(", ") || "None"}
- Credit Sales Today: ${creditSalesToday.length} (${creditSalesToday.reduce((s: number, sale: any) => s + Number(sale.total_amount || 0), 0).toFixed(2)})
- Last 30 Days: ${recentSales.length} transactions, Revenue: ${monthlyRevenue.toFixed(2)}

🏆 TOP SELLING ${ItemLabel.toUpperCase()}S (Last 30 days):
${topSellers.length > 0 ? topSellers.map((t, i) => `  ${i + 1}. ${t.name}: ${t.qty} units sold, Revenue: ${t.revenue.toFixed(2)}`).join("\n") : "  No sales data"}

${branchType === "pharmacy" ? `
⏰ EXPIRING SOON (within 7 days): ${expiringSoon.length}
${expiringSoon.length > 0 ? expiringSoon.slice(0, 15).map((i: any) => `  • ${i.name}: ${i.stock_quantity} units, Expires: ${i.expiry_date}, Branch: ${getBranchName(i.branch_id)}`).join("\n") : "  None"}

📅 EXPIRING WITHIN 30 DAYS: ${expiringMonth.length}
${expiringMonth.length > 0 ? expiringMonth.slice(0, 15).map((i: any) => `  • ${i.name}: ${i.stock_quantity} units, Expires: ${i.expiry_date}, Branch: ${getBranchName(i.branch_id)}`).join("\n") : "  None"}
` : ""}

🏢 SUPPLIERS: ${suppliers.length} registered
${suppliers.slice(0, 15).map((s: any) => `  • ${s.name}${s.contact_person ? ` (Contact: ${s.contact_person})` : ""} | Phone: ${s.phone || "N/A"} | Branch: ${getBranchName(s.branch_id)}`).join("\n")}

💸 SUPPLIER DEBTS: Total: ${totalSupplierDebt.toFixed(2)}
${supplierDebts.length > 0 ? supplierDebts.map((d: any) => `  • ${supplierMap[d.supplier_id] || d.supplier_id}: ${Number(d.total_debt).toFixed(2)}`).join("\n") : "  None"}

📦 RECENT SUPPLIER PURCHASES (last 90 days): ${supplierPurchases.length}
${supplierPurchases.slice(0, 10).map((p: any) => `  • ${p.item_name} from ${supplierMap[p.supplier_id] || p.supplier_id}: ${p.quantity} × ${p.unit_cost} = ${p.total_cost} (${p.payment_type}) on ${p.created_at?.split("T")[0]}`).join("\n")}

👥 CUSTOMERS: ${customers.length} total
${customers.slice(0, 15).map((c: any) => `  • ${c.name} | Phone: ${c.phone || "N/A"} | Credit Score: ${c.credit_score}/100 | Branch: ${getBranchName(c.branch_id)}`).join("\n")}

💳 CUSTOMER DEBTS: Total Outstanding: ${totalCustomerDebt.toFixed(2)}, Debtors: ${customerCredits.length}
${customerCredits.slice(0, 15).map((c: any) => `  • ${customerMap[c.customer_id] || c.customer_id}: ${Number(c.total_debt).toFixed(2)} | Branch: ${getBranchName(c.branch_id)}`).join("\n")}

💵 RECENT CUSTOMER PAYMENTS (last 30 days): ${customerPayments.length}
${customerPayments.slice(0, 10).map((p: any) => `  • ${customerMap[p.customer_id] || p.customer_id}: ${Number(p.amount).toFixed(2)} via ${p.payment_method} on ${p.created_at?.split("T")[0]}`).join("\n")}

🧾 EXPENSES (last 30 days): ${expenses.length} entries, Total: ${totalExpenses.toFixed(2)}
${expenses.slice(0, 10).map((e: any) => `  • ${e.description}: ${Number(e.amount).toFixed(2)} (${e.category || "uncategorized"}) on ${e.created_at?.split("T")[0]} | Branch: ${getBranchName(e.branch_id)}`).join("\n")}

🔄 STOCK ADJUSTMENTS (last 30 days): ${stockAdjustments.length}
${stockAdjustments.slice(0, 10).map((a: any) => `  • ${medicineMap[a.medicine_id] || a.medicine_id}: ${a.adjustment_type} ${a.quantity} units - ${a.reason}`).join("\n")}

🚚 MEDICINE TRANSFERS (last 30 days): ${transfers.length}
${transfers.slice(0, 10).map((t: any) => `  • ${medicineMap[t.medicine_id] || t.medicine_id}: ${t.quantity} units from ${getBranchName(t.from_branch_id)} → ${getBranchName(t.to_branch_id)}`).join("\n")}

📍 LOCATIONS: ${locations.length}
${locations.map((l: any) => `  • ${l.name} (${l.type}) | Branch: ${getBranchName(l.branch_id)}`).join("\n")}

INSTRUCTIONS:
- Answer concisely with formatted markdown.
- Use bullet points and bold for key data.
- Always mention the branch name when showing item-level data.
- Add an "💡 AI Insight" section with actionable recommendations when relevant.
- If the user asks about something not in the data, say so clearly.
- Respect the user's role permissions.
- Use "${ItemLabel}" terminology (not "medicine" in general mode, not "item" in pharmacy mode).
- When reporting low stock, compare stock_quantity against minimum_stock_level, NOT a hardcoded number.
`;

    // Convert to Gemini format
    const geminiContents = [];
    const userMessages = messages || [];
    for (const msg of userMessages) {
      geminiContents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${geminiApiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemContext }] },
        contents: geminiContents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return new Response(JSON.stringify({ error: `Gemini API error: ${response.status}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Transform Gemini SSE to OpenAI-compatible SSE
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (content) {
              const openAiChunk = {
                choices: [{ delta: { content } }],
              };
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(openAiChunk)}\n\n`)
              );
            }
          } catch {
            // skip malformed chunks
          }
        }
      },
      flush(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      },
    });

    const transformedStream = response.body!.pipeThrough(transformStream);

    return new Response(transformedStream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("smart-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
