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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      bulk_deals: {
        Row: {
          avg_price: number | null
          buy_sell: string | null
          client_name: string
          created_at: string
          deal_date: string
          deal_type: string
          exchange: string | null
          id: string
          quantity: number | null
          remarks: string | null
          stock_id: string
          trade_value: number | null
        }
        Insert: {
          avg_price?: number | null
          buy_sell?: string | null
          client_name: string
          created_at?: string
          deal_date: string
          deal_type?: string
          exchange?: string | null
          id?: string
          quantity?: number | null
          remarks?: string | null
          stock_id: string
          trade_value?: number | null
        }
        Update: {
          avg_price?: number | null
          buy_sell?: string | null
          client_name?: string
          created_at?: string
          deal_date?: string
          deal_type?: string
          exchange?: string | null
          id?: string
          quantity?: number | null
          remarks?: string | null
          stock_id?: string
          trade_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_deals_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_metrics: {
        Row: {
          created_at: string
          debt_equity: number | null
          eps: number | null
          free_cash_flow: number | null
          id: string
          net_profit: number | null
          opm: number | null
          profit_growth: number | null
          promoter_holding: number | null
          revenue: number | null
          revenue_growth: number | null
          roce: number | null
          roe: number | null
          stock_id: string
          year: number
        }
        Insert: {
          created_at?: string
          debt_equity?: number | null
          eps?: number | null
          free_cash_flow?: number | null
          id?: string
          net_profit?: number | null
          opm?: number | null
          profit_growth?: number | null
          promoter_holding?: number | null
          revenue?: number | null
          revenue_growth?: number | null
          roce?: number | null
          roe?: number | null
          stock_id: string
          year: number
        }
        Update: {
          created_at?: string
          debt_equity?: number | null
          eps?: number | null
          free_cash_flow?: number | null
          id?: string
          net_profit?: number | null
          opm?: number | null
          profit_growth?: number | null
          promoter_holding?: number | null
          revenue?: number | null
          revenue_growth?: number | null
          roce?: number | null
          roe?: number | null
          stock_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_metrics_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_results: {
        Row: {
          capex: number | null
          created_at: string
          debt: number | null
          ebitda_margin: number | null
          id: string
          quarter: string
          revenue: number | null
          stock_id: string
        }
        Insert: {
          capex?: number | null
          created_at?: string
          debt?: number | null
          ebitda_margin?: number | null
          id?: string
          quarter: string
          revenue?: number | null
          stock_id: string
        }
        Update: {
          capex?: number | null
          created_at?: string
          debt?: number | null
          ebitda_margin?: number | null
          id?: string
          quarter?: string
          revenue?: number | null
          stock_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_results_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      insider_trades: {
        Row: {
          avg_price: number | null
          created_at: string
          exchange: string | null
          id: string
          mode_of_acquisition: string | null
          num_securities: number | null
          person_category: string | null
          person_name: string
          securities_type: string | null
          stock_id: string
          trade_date: string
          trade_type: string
          trade_value: number | null
        }
        Insert: {
          avg_price?: number | null
          created_at?: string
          exchange?: string | null
          id?: string
          mode_of_acquisition?: string | null
          num_securities?: number | null
          person_category?: string | null
          person_name: string
          securities_type?: string | null
          stock_id: string
          trade_date: string
          trade_type?: string
          trade_value?: number | null
        }
        Update: {
          avg_price?: number | null
          created_at?: string
          exchange?: string | null
          id?: string
          mode_of_acquisition?: string | null
          num_securities?: number | null
          person_category?: string | null
          person_name?: string
          securities_type?: string | null
          stock_id?: string
          trade_date?: string
          trade_type?: string
          trade_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insider_trades_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      management_commitments: {
        Row: {
          created_at: string
          id: string
          metric: string | null
          quarter: string
          statement: string
          status: string
          stock_id: string
          target_value: string | null
          timeline: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          metric?: string | null
          quarter: string
          statement: string
          status?: string
          stock_id: string
          target_value?: string | null
          timeline?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          metric?: string | null
          quarter?: string
          statement?: string
          status?: string
          stock_id?: string
          target_value?: string | null
          timeline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "management_commitments_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      management_promises: {
        Row: {
          created_at: string
          id: string
          made_in_quarter: string
          promise_text: string
          resolved_in_quarter: string | null
          status: string
          stock_id: string
          target_deadline: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          made_in_quarter: string
          promise_text: string
          resolved_in_quarter?: string | null
          status?: string
          stock_id: string
          target_deadline?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          made_in_quarter?: string
          promise_text?: string
          resolved_in_quarter?: string | null
          status?: string
          stock_id?: string
          target_deadline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "management_promises_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      peer_comparison: {
        Row: {
          cmp: number | null
          created_at: string
          div_yield: number | null
          id: string
          market_cap: number | null
          np_qtr: number | null
          pe: number | null
          peer_name: string
          peer_slug: string | null
          qtr_profit_var: number | null
          qtr_sales_var: number | null
          roce: number | null
          sales_qtr: number | null
          stock_id: string
        }
        Insert: {
          cmp?: number | null
          created_at?: string
          div_yield?: number | null
          id?: string
          market_cap?: number | null
          np_qtr?: number | null
          pe?: number | null
          peer_name: string
          peer_slug?: string | null
          qtr_profit_var?: number | null
          qtr_sales_var?: number | null
          roce?: number | null
          sales_qtr?: number | null
          stock_id: string
        }
        Update: {
          cmp?: number | null
          created_at?: string
          div_yield?: number | null
          id?: string
          market_cap?: number | null
          np_qtr?: number | null
          pe?: number | null
          peer_name?: string
          peer_slug?: string | null
          qtr_profit_var?: number | null
          qtr_sales_var?: number | null
          roce?: number | null
          sales_qtr?: number | null
          stock_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "peer_comparison_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      prices: {
        Row: {
          change_percent: number | null
          created_at: string
          date: string
          id: string
          price: number
          stock_id: string
          volume: number | null
        }
        Insert: {
          change_percent?: number | null
          created_at?: string
          date: string
          id?: string
          price: number
          stock_id: string
          volume?: number | null
        }
        Update: {
          change_percent?: number | null
          created_at?: string
          date?: string
          id?: string
          price?: number
          stock_id?: string
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "prices_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      quarterly_snapshots: {
        Row: {
          confidence_score: number | null
          created_at: string
          dodged_questions: Json | null
          id: string
          metrics: Json | null
          portfolio_cohort_size: number | null
          portfolio_rank: number | null
          portfolio_rank_score: number | null
          quarter: string
          raw_ai_output: Json | null
          red_flags: Json | null
          stock_id: string
          summary: string | null
          thesis_drift_status: string | null
          thesis_momentum: string | null
          thesis_status: string | null
          thesis_status_reason: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          dodged_questions?: Json | null
          id?: string
          metrics?: Json | null
          portfolio_cohort_size?: number | null
          portfolio_rank?: number | null
          portfolio_rank_score?: number | null
          quarter: string
          raw_ai_output?: Json | null
          red_flags?: Json | null
          stock_id: string
          summary?: string | null
          thesis_drift_status?: string | null
          thesis_momentum?: string | null
          thesis_status?: string | null
          thesis_status_reason?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          dodged_questions?: Json | null
          id?: string
          metrics?: Json | null
          portfolio_cohort_size?: number | null
          portfolio_rank?: number | null
          portfolio_rank_score?: number | null
          quarter?: string
          raw_ai_output?: Json | null
          red_flags?: Json | null
          stock_id?: string
          summary?: string | null
          thesis_drift_status?: string | null
          thesis_momentum?: string | null
          thesis_status?: string | null
          thesis_status_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quarterly_snapshots_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      sector_indices: {
        Row: {
          created_at: string
          date: string
          id: string
          index_name: string
          index_symbol: string
          price: number
          sector: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          index_name: string
          index_symbol: string
          price: number
          sector: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          index_name?: string
          index_symbol?: string
          price?: number
          sector?: string
        }
        Relationships: []
      }
      shareholding: {
        Row: {
          created_at: string
          diis: number | null
          fiis: number | null
          id: string
          others: number | null
          promoters: number | null
          public_holding: number | null
          quarter: string
          stock_id: string
        }
        Insert: {
          created_at?: string
          diis?: number | null
          fiis?: number | null
          id?: string
          others?: number | null
          promoters?: number | null
          public_holding?: number | null
          quarter: string
          stock_id: string
        }
        Update: {
          created_at?: string
          diis?: number | null
          fiis?: number | null
          id?: string
          others?: number | null
          promoters?: number | null
          public_holding?: number | null
          quarter?: string
          stock_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shareholding_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_tracking_profiles: {
        Row: {
          stock_id: string
          config: Json
          created_at: string
        }
        Insert: {
          stock_id: string
          config: Json
          created_at?: string
        }
        Update: {
          stock_id?: string
          config?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_tracking_profiles_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: true
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      stocks: {
        Row: {
          buy_price: number | null
          category: string
          company_name: string
          created_at: string
          id: string
          investment_thesis: string | null
          metric_keys: Json | null
          next_results_date: string | null
          portfolio_consolidated_score: number | null
          portfolio_latest_quarter_sort_score: number | null
          portfolio_list_cohort_size: number | null
          portfolio_list_rank: number | null
          portfolio_scores_updated_at: string | null
          portfolio_trajectory_bonus: number | null
          screener_slug: string | null
          sector: string | null
          ticker: string
          tracking_directives: string | null
        }
        Insert: {
          buy_price?: number | null
          category?: string
          company_name: string
          created_at?: string
          id?: string
          investment_thesis?: string | null
          metric_keys?: Json | null
          next_results_date?: string | null
          portfolio_consolidated_score?: number | null
          portfolio_latest_quarter_sort_score?: number | null
          portfolio_list_cohort_size?: number | null
          portfolio_list_rank?: number | null
          portfolio_scores_updated_at?: string | null
          portfolio_trajectory_bonus?: number | null
          screener_slug?: string | null
          sector?: string | null
          ticker: string
          tracking_directives?: string | null
        }
        Update: {
          buy_price?: number | null
          category?: string
          company_name?: string
          created_at?: string
          id?: string
          investment_thesis?: string | null
          metric_keys?: Json | null
          next_results_date?: string | null
          portfolio_consolidated_score?: number | null
          portfolio_latest_quarter_sort_score?: number | null
          portfolio_list_cohort_size?: number | null
          portfolio_list_rank?: number | null
          portfolio_scores_updated_at?: string | null
          portfolio_trajectory_bonus?: number | null
          screener_slug?: string | null
          sector?: string | null
          ticker?: string
          tracking_directives?: string | null
        }
        Relationships: []
      }
      transcript_analysis: {
        Row: {
          analysis_summary: string | null
          capacity_expansion: string | null
          created_at: string
          demand_outlook: string | null
          growth_drivers: Json | null
          guidance: string | null
          hidden_signals: Json | null
          id: string
          important_quotes: Json | null
          industry_tailwinds: Json | null
          management_tone: string | null
          margin_drivers: Json | null
          quarter: string
          risks: Json | null
          sentiment_score: number | null
          stock_id: string
          year: number | null
        }
        Insert: {
          analysis_summary?: string | null
          capacity_expansion?: string | null
          created_at?: string
          demand_outlook?: string | null
          growth_drivers?: Json | null
          guidance?: string | null
          hidden_signals?: Json | null
          id?: string
          important_quotes?: Json | null
          industry_tailwinds?: Json | null
          management_tone?: string | null
          margin_drivers?: Json | null
          quarter: string
          risks?: Json | null
          sentiment_score?: number | null
          stock_id: string
          year?: number | null
        }
        Update: {
          analysis_summary?: string | null
          capacity_expansion?: string | null
          created_at?: string
          demand_outlook?: string | null
          growth_drivers?: Json | null
          guidance?: string | null
          hidden_signals?: Json | null
          id?: string
          important_quotes?: Json | null
          industry_tailwinds?: Json | null
          management_tone?: string | null
          margin_drivers?: Json | null
          quarter?: string
          risks?: Json | null
          sentiment_score?: number | null
          stock_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transcript_analysis_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
      transcripts: {
        Row: {
          id: string
          quarter: string
          stock_id: string
          transcript_text: string
          uploaded_at: string
          year: number
        }
        Insert: {
          id?: string
          quarter: string
          stock_id: string
          transcript_text: string
          uploaded_at?: string
          year: number
        }
        Update: {
          id?: string
          quarter?: string
          stock_id?: string
          transcript_text?: string
          uploaded_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stocks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
