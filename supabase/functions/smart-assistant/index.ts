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

    const branchFilter = branchIds?.length
      ? (query: any) => query.in("branch_id", branchIds)
      : (query: any) => query;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const today = now.toISOString().split("T")[0];

    const [
      inventoryRes,
      todaySalesRes,
      recentSalesRes,
      suppliersRes,
      customersRes,
      expiringSoonRes,
    ] = await Promise.all([
      branchFilter(db.from("medicines").select("id, name, quantity, category, selling_price, purchase_price, expiry_date, branch_id, strips_per_pack, tablets_per_strip"))
        .order("quantity", { ascending: true })
        .limit(200),

      branchFilter(db.from("sales").select("id, total_amount, payment_method, created_at, branch_id"))
        .gte("created_at", `${today}T00:00:00`)
        .lte("created_at", `${today}T23:59:59`),

      branchFilter(db.from("sales").select("id, total_amount, created_at, branch_id"))
        .gte("created_at", thirtyDaysAgo.toISOString()),

      db.from("suppliers").select("id, name, phone, email, status").limit(50),

      branchFilter(db.from("customers").select("id, name, phone, total_debt, credit_limit, branch_id"))
        .gt("total_debt", 0)
        .order("total_debt", { ascending: false })
        .limit(50),

      branchType === "pharmacy"
        ? branchFilter(db.from("medicines").select("id, name, quantity, expiry_date, branch_id"))
            .lte("expiry_date", sevenDaysFromNow.toISOString().split("T")[0])
            .gte("expiry_date", today)
            .gt("quantity", 0)
            .limit(50)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const inventory = inventoryRes.data || [];
    const lowStock = inventory.filter((i: any) => i.quantity <= 10 && i.quantity > 0);
    const outOfStock = inventory.filter((i: any) => i.quantity <= 0);
    const todaySales = todaySalesRes.data || [];
    const recentSales = recentSalesRes.data || [];
    const suppliers = suppliersRes.data || [];
    const debtors = customersRes.data || [];
    const expiringSoon = expiringSoonRes.data || [];

    const todayRevenue = todaySales.reduce((s: number, sale: any) => s + Number(sale.total_amount || 0), 0);
    const monthlyRevenue = recentSales.reduce((s: number, sale: any) => s + Number(sale.total_amount || 0), 0);
    const totalDebt = debtors.reduce((s: number, c: any) => s + Number(c.total_amount || 0), 0);

    const ItemLabel = branchType === "pharmacy" ? "Medicine" : "Item";

    const systemContext = `
You are a Smart Assistant for ${branchType === "pharmacy" ? "PharmaXpert (Pharmacy Management)" : "StockXpert (Inventory Management)"}.
User: ${profile.full_name} (Role: ${profile.role})
${profile.role === "staff" ? "Note: This user is staff with limited access. Do not reveal owner-only financial details like profit margins or purchase prices." : ""}

CURRENT SYSTEM DATA:
═══════════════════

📦 INVENTORY SUMMARY:
- Total ${ItemLabel}s: ${inventory.length}
- Low Stock (≤10 units): ${lowStock.length}
${lowStock.slice(0, 10).map((i: any) => `  • ${i.name}: ${i.quantity} units (Price: ${i.selling_price})`).join("\n")}
- Out of Stock: ${outOfStock.length}
${outOfStock.slice(0, 5).map((i: any) => `  • ${i.name}`).join("\n")}

💰 SALES:
- Today's Sales: ${todaySales.length} transactions, Revenue: ${todayRevenue.toFixed(2)}
- Last 30 Days: ${recentSales.length} transactions, Revenue: ${monthlyRevenue.toFixed(2)}

${branchType === "pharmacy" ? `
⏰ EXPIRING SOON (within 7 days):
${expiringSoon.length > 0 ? expiringSoon.slice(0, 10).map((i: any) => `  • ${i.name}: ${i.quantity} units, Expires: ${i.expiry_date}`).join("\n") : "  None"}
` : ""}

🏢 SUPPLIERS: ${suppliers.length} registered
${suppliers.slice(0, 10).map((s: any) => `  • ${s.name} (${s.status || "active"})`).join("\n")}

💳 CUSTOMER DEBTS:
- Total Outstanding: ${totalDebt.toFixed(2)}
- Debtors: ${debtors.length}
${debtors.slice(0, 10).map((c: any) => `  • ${c.name}: ${Number(c.total_debt).toFixed(2)}`).join("\n")}

INSTRUCTIONS:
- Answer concisely with formatted markdown.
- Use bullet points and bold for key data.
- Add an "💡 AI Insight" section with actionable recommendations when relevant.
- If the user asks about something not in the data, say so clearly.
- Respect the user's role permissions.
- Use "${ItemLabel}" terminology (not "medicine" in general mode, not "item" in pharmacy mode).
`;

    // Build Gemini API request
    // Convert OpenAI-style messages to Gemini format
    const geminiContents = [];

    // System instruction is passed separately in Gemini API
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
          maxOutputTokens: 2048,
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

    // Transform Gemini SSE stream to OpenAI-compatible SSE stream
    // so the frontend parser works without changes
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
              // Re-emit as OpenAI-compatible SSE
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
