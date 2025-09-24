import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Database {
  public: {
    Tables: {
      pharmacy_subscriptions: {
        Row: {
          id: string;
          pharmacy_owner_id: string;
          subscription_credit: number;
          status: 'active' | 'expiring_soon' | 'expired';
          deposit_amount: number;
          last_credit_deduction: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          pharmacy_owner_id: string;
          subscription_credit?: number;
          status?: 'active' | 'expiring_soon' | 'expired';
          deposit_amount?: number;
          last_credit_deduction?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          pharmacy_owner_id?: string;
          subscription_credit?: number;
          status?: 'active' | 'expiring_soon' | 'expired';
          deposit_amount?: number;
          last_credit_deduction?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role key for admin operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    console.log('Starting daily credit deduction process...');

    // Get current date in YYYY-MM-DD format
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Find all subscriptions that need credit deduction
    const { data: subscriptions, error: fetchError } = await supabase
      .from('pharmacy_subscriptions')
      .select('*')
      .or(`last_credit_deduction.is.null,last_credit_deduction.lt.${currentDate}`)
      .gt('subscription_credit', 0);

    if (fetchError) {
      console.error('Error fetching subscriptions:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${subscriptions?.length || 0} subscriptions to process`);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No subscriptions need credit deduction today',
          processed: 0 
        }),
        { 
          status: 200, 
          headers: { 'Content-Type': 'application/json', ...corsHeaders } 
        }
      );
    }

    let processedCount = 0;
    const errors: any[] = [];

    // Process each subscription
    for (const subscription of subscriptions) {
      try {
        const newCredit = Math.max(0, subscription.subscription_credit - 1);
        let newStatus: 'active' | 'expiring_soon' | 'expired' = 'active';
        
        if (newCredit <= 0) {
          newStatus = 'expired';
        } else if (newCredit <= 7) {
          newStatus = 'expiring_soon';
        }

        // Update the subscription
        const { error: updateError } = await supabase
          .from('pharmacy_subscriptions')
          .update({
            subscription_credit: newCredit,
            status: newStatus,
            last_credit_deduction: currentDate,
            updated_at: new Date().toISOString()
          })
          .eq('id', subscription.id);

        if (updateError) {
          console.error(`Error updating subscription ${subscription.id}:`, updateError);
          errors.push({
            subscription_id: subscription.id,
            pharmacy_owner_id: subscription.pharmacy_owner_id,
            error: updateError.message
          });
        } else {
          console.log(`Successfully updated subscription ${subscription.id}: ${subscription.subscription_credit} -> ${newCredit} (${newStatus})`);
          processedCount++;
        }
      } catch (error) {
        console.error(`Error processing subscription ${subscription.id}:`, error);
        errors.push({
          subscription_id: subscription.id,
          pharmacy_owner_id: subscription.pharmacy_owner_id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log(`Credit deduction complete. Processed: ${processedCount}, Errors: ${errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Daily credit deduction completed`,
        processed: processedCount,
        total: subscriptions.length,
        errors: errors.length > 0 ? errors : undefined,
        date: currentDate
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );

  } catch (error: any) {
    console.error('Fatal error in daily credit deduction:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );
  }
};

serve(handler);