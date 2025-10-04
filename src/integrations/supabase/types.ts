export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      credit_plans: {
        Row: {
          created_at: string
          days: number
          id: string
          pharmacy_owner_id: string
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          days: number
          id?: string
          pharmacy_owner_id: string
          price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          days?: number
          id?: string
          pharmacy_owner_id?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          branch_id: string | null
          category: string | null
          created_at: string | null
          created_by: string | null
          description: string
          id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description: string
          id?: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          batch_number: string | null
          branch_id: string | null
          category: Database["public"]["Enums"]["medicine_category"]
          created_at: string | null
          expiry_alert_enabled: boolean | null
          expiry_date: string | null
          generic_name: string | null
          id: string
          manufacturer: string | null
          minimum_stock_level: number
          name: string
          purchase_price: number
          selling_price: number
          stock_quantity: number
          supplier_id: string | null
          updated_at: string | null
        }
        Insert: {
          batch_number?: string | null
          branch_id?: string | null
          category: Database["public"]["Enums"]["medicine_category"]
          created_at?: string | null
          expiry_alert_enabled?: boolean | null
          expiry_date?: string | null
          generic_name?: string | null
          id?: string
          manufacturer?: string | null
          minimum_stock_level?: number
          name: string
          purchase_price: number
          selling_price: number
          stock_quantity?: number
          supplier_id?: string | null
          updated_at?: string | null
        }
        Update: {
          batch_number?: string | null
          branch_id?: string | null
          category?: Database["public"]["Enums"]["medicine_category"]
          created_at?: string | null
          expiry_alert_enabled?: boolean | null
          expiry_date?: string | null
          generic_name?: string | null
          id?: string
          manufacturer?: string | null
          minimum_stock_level?: number
          name?: string
          purchase_price?: number
          selling_price?: number
          stock_quantity?: number
          supplier_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          amount: number
          approved_by: string | null
          created_at: string
          id: string
          months_requested: number
          payment_method: string
          pharmacy_owner_id: string
          status: Database["public"]["Enums"]["payment_status"]
          transaction_reference: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          approved_by?: string | null
          created_at?: string
          id?: string
          months_requested: number
          payment_method: string
          pharmacy_owner_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          transaction_reference?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_by?: string | null
          created_at?: string
          id?: string
          months_requested?: number
          payment_method?: string
          pharmacy_owner_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          transaction_reference?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pharmacy_branches: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_main_branch: boolean | null
          manager_staff_id: string | null
          name: string
          pharmacy_owner_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_main_branch?: boolean | null
          manager_staff_id?: string | null
          name: string
          pharmacy_owner_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_main_branch?: boolean | null
          manager_staff_id?: string | null
          name?: string
          pharmacy_owner_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_branches_manager_staff_id_fkey"
            columns: ["manager_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacy_subscriptions: {
        Row: {
          created_at: string
          deposit_amount: number | null
          id: string
          last_credit_deduction: string | null
          pharmacy_owner_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          subscription_credit: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deposit_amount?: number | null
          id?: string
          last_credit_deduction?: string | null
          pharmacy_owner_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          subscription_credit?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deposit_amount?: number | null
          id?: string
          last_credit_deduction?: string | null
          pharmacy_owner_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          subscription_credit?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean | null
          branch_id: string | null
          created_at: string | null
          full_name: string
          id: string
          manually_deactivated: boolean | null
          pharmacy_address: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          security_answer_hash: string | null
          security_question: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          branch_id?: string | null
          created_at?: string | null
          full_name: string
          id: string
          manually_deactivated?: boolean | null
          pharmacy_address?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          security_answer_hash?: string | null
          security_question?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          branch_id?: string | null
          created_at?: string | null
          full_name?: string
          id?: string
          manually_deactivated?: boolean | null
          pharmacy_address?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          security_answer_hash?: string | null
          security_question?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_branches"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          id: string
          medicine_id: string | null
          quantity: number
          sale_id: string | null
          total_price: number
          unit_price: number
        }
        Insert: {
          id?: string
          medicine_id?: string | null
          quantity: number
          sale_id?: string | null
          total_price: number
          unit_price: number
        }
        Update: {
          id?: string
          medicine_id?: string | null
          quantity?: number
          sale_id?: string | null
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "low_stock_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          branch_id: string | null
          created_at: string | null
          discount_amount: number | null
          id: string
          payment_method: string | null
          sold_by: string | null
          total_amount: number
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          payment_method?: string | null
          sold_by?: string | null
          total_amount: number
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          payment_method?: string | null
          sold_by?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_sold_by_fkey"
            columns: ["sold_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          branch_id: string | null
          contact_person: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          branch_id?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          branch_id?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_collected: number
          created_at: string
          credit_days_added: number
          id: string
          notes: string | null
          pharmacy_owner_id: string
          processed_by: string
          transaction_type: string
        }
        Insert: {
          amount_collected: number
          created_at?: string
          credit_days_added: number
          id?: string
          notes?: string | null
          pharmacy_owner_id: string
          processed_by: string
          transaction_type?: string
        }
        Update: {
          amount_collected?: number
          created_at?: string
          credit_days_added?: number
          id?: string
          notes?: string | null
          pharmacy_owner_id?: string
          processed_by?: string
          transaction_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      low_stock_medicines: {
        Row: {
          batch_number: string | null
          category: Database["public"]["Enums"]["medicine_category"] | null
          created_at: string | null
          expiry_alert_enabled: boolean | null
          expiry_date: string | null
          generic_name: string | null
          id: string | null
          manufacturer: string | null
          minimum_stock_level: number | null
          name: string | null
          purchase_price: number | null
          selling_price: number | null
          stock_quantity: number | null
          supplier_id: string | null
          updated_at: string | null
        }
        Insert: {
          batch_number?: string | null
          category?: Database["public"]["Enums"]["medicine_category"] | null
          created_at?: string | null
          expiry_alert_enabled?: boolean | null
          expiry_date?: string | null
          generic_name?: string | null
          id?: string | null
          manufacturer?: string | null
          minimum_stock_level?: number | null
          name?: string | null
          purchase_price?: number | null
          selling_price?: number | null
          stock_quantity?: number | null
          supplier_id?: string | null
          updated_at?: string | null
        }
        Update: {
          batch_number?: string | null
          category?: Database["public"]["Enums"]["medicine_category"] | null
          created_at?: string | null
          expiry_alert_enabled?: boolean | null
          expiry_date?: string | null
          generic_name?: string | null
          id?: string | null
          manufacturer?: string | null
          minimum_stock_level?: number | null
          name?: string | null
          purchase_price?: number | null
          selling_price?: number | null
          stock_quantity?: number | null
          supplier_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      deduct_daily_credit: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      get_owners_with_email: {
        Args: Record<PropertyKey, never>
        Returns: {
          active: boolean
          email: string
          full_name: string
          id: string
          manually_deactivated: boolean
          pharmacy_address: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      get_pharmacy_owner_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_profile_by_email: {
        Args: { user_email: string }
        Returns: {
          created_at: string
          full_name: string
          id: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
          security_answer_hash: string
          security_question: string
          updated_at: string
        }[]
      }
      get_subscription_status: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Enums"]["subscription_status"]
      }
      get_user_branch: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      is_developer: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_owner: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_staff: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      user_owns_branch: {
        Args: { branch_id_param: string }
        Returns: boolean
      }
    }
    Enums: {
      medicine_category:
        | "tablet"
        | "capsule"
        | "syrup"
        | "injection"
        | "cream"
        | "ointment"
        | "drops"
        | "inhaler"
        | "other"
      payment_status: "pending" | "approved" | "declined"
      subscription_status: "active" | "expiring_soon" | "expired" | "inactive"
      user_role: "owner" | "staff" | "developer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      medicine_category: [
        "tablet",
        "capsule",
        "syrup",
        "injection",
        "cream",
        "ointment",
        "drops",
        "inhaler",
        "other",
      ],
      payment_status: ["pending", "approved", "declined"],
      subscription_status: ["active", "expiring_soon", "expired", "inactive"],
      user_role: ["owner", "staff", "developer"],
    },
  },
} as const
