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
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_deletion_log: {
        Row: {
          deleted_at: string
          deleted_user_id: string
          expires_at: string
          id: string
          summary: Json | null
        }
        Insert: {
          deleted_at?: string
          deleted_user_id: string
          expires_at?: string
          id?: string
          summary?: Json | null
        }
        Update: {
          deleted_at?: string
          deleted_user_id?: string
          expires_at?: string
          id?: string
          summary?: Json | null
        }
        Relationships: []
      }
      appointments: {
        Row: {
          appointment_date: string
          appointment_end: string
          appointment_start: string
          buyer_id: string
          created_at: string | null
          id: string
          notes: string | null
          product_id: string
          reminder_1d_sent: boolean
          reminder_1h_sent: boolean
          seller_id: string
          status: string | null
        }
        Insert: {
          appointment_date: string
          appointment_end: string
          appointment_start: string
          buyer_id: string
          created_at?: string | null
          id?: string
          notes?: string | null
          product_id: string
          reminder_1d_sent?: boolean
          reminder_1h_sent?: boolean
          seller_id: string
          status?: string | null
        }
        Update: {
          appointment_date?: string
          appointment_end?: string
          appointment_start?: string
          buyer_id?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          reminder_1d_sent?: boolean
          reminder_1h_sent?: boolean
          seller_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          comprador_id: string
          created_at: string | null
          duracion: number | null
          estatus: Database["public"]["Enums"]["booking_status"] | null
          fecha: string
          hora_fin: string | null
          hora_inicio: string
          id: string
          notas: string | null
          servicio_id: string
          updated_at: string | null
          vendedor_id: string
        }
        Insert: {
          comprador_id: string
          created_at?: string | null
          duracion?: number | null
          estatus?: Database["public"]["Enums"]["booking_status"] | null
          fecha: string
          hora_fin?: string | null
          hora_inicio: string
          id?: string
          notas?: string | null
          servicio_id: string
          updated_at?: string | null
          vendedor_id: string
        }
        Update: {
          comprador_id?: string
          created_at?: string | null
          duracion?: number | null
          estatus?: Database["public"]["Enums"]["booking_status"] | null
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string
          id?: string
          notas?: string | null
          servicio_id?: string
          updated_at?: string | null
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          activo: boolean | null
          created_at: string | null
          icono: string
          id: string
          nombre: string
          orden: number | null
          parent_id: string | null
          slug: string
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          icono: string
          id?: string
          nombre: string
          orden?: number | null
          parent_id?: string | null
          slug: string
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          icono?: string
          id?: string
          nombre?: string
          orden?: number | null
          parent_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          comprador_id: string
          created_at: string | null
          deleted_at_comprador: string | null
          deleted_at_vendedor: string | null
          id: string
          no_leidos_comprador: number | null
          no_leidos_vendedor: number | null
          oculto_para_comprador: boolean | null
          oculto_para_vendedor: boolean | null
          ultimo_producto_id: string | null
          updated_at: string | null
          vendedor_id: string
        }
        Insert: {
          comprador_id: string
          created_at?: string | null
          deleted_at_comprador?: string | null
          deleted_at_vendedor?: string | null
          id?: string
          no_leidos_comprador?: number | null
          no_leidos_vendedor?: number | null
          oculto_para_comprador?: boolean | null
          oculto_para_vendedor?: boolean | null
          ultimo_producto_id?: string | null
          updated_at?: string | null
          vendedor_id: string
        }
        Update: {
          comprador_id?: string
          created_at?: string | null
          deleted_at_comprador?: string | null
          deleted_at_vendedor?: string | null
          id?: string
          no_leidos_comprador?: number | null
          no_leidos_vendedor?: number | null
          oculto_para_comprador?: boolean | null
          oculto_para_vendedor?: boolean | null
          ultimo_producto_id?: string | null
          updated_at?: string | null
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_comprador_id_fkey"
            columns: ["comprador_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_ultimo_producto_id_fkey"
            columns: ["ultimo_producto_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          activo: boolean | null
          codigo: string
          created_at: string | null
          fecha_expiracion: string | null
          fecha_inicio: string | null
          id: string
          tipo_descuento: Database["public"]["Enums"]["coupon_type"]
          updated_at: string | null
          usos_actuales: number | null
          usos_maximos: number | null
          valor: number
          vendedor_id: string
        }
        Insert: {
          activo?: boolean | null
          codigo: string
          created_at?: string | null
          fecha_expiracion?: string | null
          fecha_inicio?: string | null
          id?: string
          tipo_descuento: Database["public"]["Enums"]["coupon_type"]
          updated_at?: string | null
          usos_actuales?: number | null
          usos_maximos?: number | null
          valor: number
          vendedor_id: string
        }
        Update: {
          activo?: boolean | null
          codigo?: string
          created_at?: string | null
          fecha_expiracion?: string | null
          fecha_inicio?: string | null
          id?: string
          tipo_descuento?: Database["public"]["Enums"]["coupon_type"]
          updated_at?: string | null
          usos_actuales?: number | null
          usos_maximos?: number | null
          valor?: number
          vendedor_id?: string
        }
        Relationships: []
      }
      critical_reports: {
        Row: {
          authority_notification_reference: string | null
          authority_notified_at: string | null
          created_at: string
          id: string
          notes: string | null
          report_id: string
          updated_at: string
        }
        Insert: {
          authority_notification_reference?: string | null
          authority_notified_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          report_id: string
          updated_at?: string
        }
        Update: {
          authority_notification_reference?: string | null
          authority_notified_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          report_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "critical_reports_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          admin_id: string | null
          created_at: string | null
          descripcion: string | null
          evidencia: string[] | null
          id: string
          motivo: string
          reported_id: string
          reporter_id: string
          resolucion: string | null
          resolved_at: string | null
          sale_confirmation_id: string
          status: Database["public"]["Enums"]["dispute_status"] | null
          updated_at: string | null
        }
        Insert: {
          admin_id?: string | null
          created_at?: string | null
          descripcion?: string | null
          evidencia?: string[] | null
          id?: string
          motivo: string
          reported_id: string
          reporter_id: string
          resolucion?: string | null
          resolved_at?: string | null
          sale_confirmation_id: string
          status?: Database["public"]["Enums"]["dispute_status"] | null
          updated_at?: string | null
        }
        Update: {
          admin_id?: string | null
          created_at?: string | null
          descripcion?: string | null
          evidencia?: string[] | null
          id?: string
          motivo?: string
          reported_id?: string
          reporter_id?: string
          resolucion?: string | null
          resolved_at?: string | null
          sale_confirmation_id?: string
          status?: Database["public"]["Enums"]["dispute_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disputes_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_reported_id_fkey"
            columns: ["reported_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_sale_confirmation_id_fkey"
            columns: ["sale_confirmation_id"]
            isOneToOne: false
            referencedRelation: "sale_confirmations"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string | null
          id: string
          producto_id: string
          usuario_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          producto_id: string
          usuario_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          producto_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_acceptances: {
        Row: {
          aceptado_en: string
          documento: string
          id: string
          ip: unknown
          modo: string
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          aceptado_en?: string
          documento: string
          id?: string
          ip?: unknown
          modo: string
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          aceptado_en?: string
          documento?: string
          id?: string
          ip?: unknown
          modo?: string
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_documento_version_fkey"
            columns: ["documento", "version"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["documento", "version"]
          },
          {
            foreignKeyName: "legal_acceptances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          documento: string
          publicado_en: string
          resumen: string
          sustancial: boolean | null
          version: string
          vigente_desde: string
        }
        Insert: {
          documento: string
          publicado_en?: string
          resumen: string
          sustancial?: boolean | null
          version: string
          vigente_desde: string
        }
        Update: {
          documento?: string
          publicado_en?: string
          resumen?: string
          sustancial?: boolean | null
          version?: string
          vigente_desde?: string
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          created_at: string | null
          duration_sec: number | null
          height: number | null
          id: string
          order_index: number | null
          owner_id: string
          owner_type: string
          size_kb: number | null
          type: string
          updated_at: string | null
          url_optimized: string | null
          url_original: string
          url_thumbnail: string | null
          width: number | null
        }
        Insert: {
          created_at?: string | null
          duration_sec?: number | null
          height?: number | null
          id?: string
          order_index?: number | null
          owner_id: string
          owner_type: string
          size_kb?: number | null
          type: string
          updated_at?: string | null
          url_optimized?: string | null
          url_original: string
          url_thumbnail?: string | null
          width?: number | null
        }
        Update: {
          created_at?: string | null
          duration_sec?: number | null
          height?: number | null
          id?: string
          order_index?: number | null
          owner_id?: string
          owner_type?: string
          size_kb?: number | null
          type?: string
          updated_at?: string | null
          url_optimized?: string | null
          url_original?: string
          url_thumbnail?: string | null
          width?: number | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          attachments: Json | null
          autor_id: string
          chat_id: string
          created_at: string | null
          id: string
          is_hidden: boolean
          leido_por_comprador: boolean | null
          leido_por_vendedor: boolean | null
          message_type: string
          publicacion_id: string | null
          sale_confirmation_id: string | null
          texto: string
        }
        Insert: {
          attachments?: Json | null
          autor_id: string
          chat_id: string
          created_at?: string | null
          id?: string
          is_hidden?: boolean
          leido_por_comprador?: boolean | null
          leido_por_vendedor?: boolean | null
          message_type?: string
          publicacion_id?: string | null
          sale_confirmation_id?: string | null
          texto: string
        }
        Update: {
          attachments?: Json | null
          autor_id?: string
          chat_id?: string
          created_at?: string | null
          id?: string
          is_hidden?: boolean
          leido_por_comprador?: boolean | null
          leido_por_vendedor?: boolean | null
          message_type?: string
          publicacion_id?: string | null
          sale_confirmation_id?: string | null
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_publicacion_id_fkey"
            columns: ["publicacion_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sale_confirmation_id_fkey"
            columns: ["sale_confirmation_id"]
            isOneToOne: false
            referencedRelation: "sale_confirmations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          leida: boolean | null
          mensaje: string
          push_sent: boolean | null
          tipo: string
          titulo: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id?: string
          leida?: boolean | null
          mensaje: string
          push_sent?: boolean | null
          tipo: string
          titulo: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          leida?: boolean | null
          mensaje?: string
          push_sent?: boolean | null
          tipo?: string
          titulo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          categoria_id: string
          created_at: string | null
          is_primary: boolean
          product_id: string
        }
        Insert: {
          categoria_id: string
          created_at?: string | null
          is_primary?: boolean
          product_id: string
        }
        Update: {
          categoria_id?: string
          created_at?: string | null
          is_primary?: boolean
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          alto: number | null
          ancho: number | null
          color: string | null
          created_at: string | null
          id: string
          largo: number | null
          peso: number | null
          precio_override: number | null
          producto_id: string
          sku: string | null
          stock: number | null
          talla: string | null
          updated_at: string | null
        }
        Insert: {
          alto?: number | null
          ancho?: number | null
          color?: string | null
          created_at?: string | null
          id?: string
          largo?: number | null
          peso?: number | null
          precio_override?: number | null
          producto_id: string
          sku?: string | null
          stock?: number | null
          talla?: string | null
          updated_at?: string | null
        }
        Update: {
          alto?: number | null
          ancho?: number | null
          color?: string | null
          created_at?: string | null
          id?: string
          largo?: number | null
          peso?: number | null
          precio_override?: number | null
          producto_id?: string
          sku?: string | null
          stock?: number | null
          talla?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
        ]
      }
      products_services: {
        Row: {
          allow_appointments: boolean | null
          appointment_duration_minutes: number | null
          appointment_end_time: string | null
          appointment_start_time: string | null
          categoria: string
          categoria_id: string | null
          color: string | null
          creador_id: string
          created_at: string | null
          delivery_radius_km: number | null
          descripcion: string
          descripcion_en: string | null
          estado: string | null
          estatus: Database["public"]["Enums"]["listing_status"] | null
          favoritos_count: number | null
          galeria_imagenes: string[] | null
          gallery_layout: string | null
          gallery_sizes: Json | null
          id: string
          imagen_principal: string | null
          is_hidden: boolean
          modo_precio: string
          precio: number | null
          precio_negociable: boolean
          search_vector: unknown
          slug: string | null
          sort_order: number
          tipo: Database["public"]["Enums"]["listing_type"]
          tipo_entrega: string | null
          titulo: string
          titulo_en: string | null
          ubicacion: string | null
          ubicacion_geo: unknown
          updated_at: string | null
          ventas_count: number | null
          vistas_count: number | null
        }
        Insert: {
          allow_appointments?: boolean | null
          appointment_duration_minutes?: number | null
          appointment_end_time?: string | null
          appointment_start_time?: string | null
          categoria: string
          categoria_id?: string | null
          color?: string | null
          creador_id: string
          created_at?: string | null
          delivery_radius_km?: number | null
          descripcion: string
          descripcion_en?: string | null
          estado?: string | null
          estatus?: Database["public"]["Enums"]["listing_status"] | null
          favoritos_count?: number | null
          galeria_imagenes?: string[] | null
          gallery_layout?: string | null
          gallery_sizes?: Json | null
          id?: string
          imagen_principal?: string | null
          is_hidden?: boolean
          modo_precio?: string
          precio?: number | null
          precio_negociable?: boolean
          search_vector?: unknown
          slug?: string | null
          sort_order?: number
          tipo?: Database["public"]["Enums"]["listing_type"]
          tipo_entrega?: string | null
          titulo: string
          titulo_en?: string | null
          ubicacion?: string | null
          ubicacion_geo?: unknown
          updated_at?: string | null
          ventas_count?: number | null
          vistas_count?: number | null
        }
        Update: {
          allow_appointments?: boolean | null
          appointment_duration_minutes?: number | null
          appointment_end_time?: string | null
          appointment_start_time?: string | null
          categoria?: string
          categoria_id?: string | null
          color?: string | null
          creador_id?: string
          created_at?: string | null
          delivery_radius_km?: number | null
          descripcion?: string
          descripcion_en?: string | null
          estado?: string | null
          estatus?: Database["public"]["Enums"]["listing_status"] | null
          favoritos_count?: number | null
          galeria_imagenes?: string[] | null
          gallery_layout?: string | null
          gallery_sizes?: Json | null
          id?: string
          imagen_principal?: string | null
          is_hidden?: boolean
          modo_precio?: string
          precio?: number | null
          precio_negociable?: boolean
          search_vector?: unknown
          slug?: string | null
          sort_order?: number
          tipo?: Database["public"]["Enums"]["listing_type"]
          tipo_entrega?: string | null
          titulo?: string
          titulo_en?: string | null
          ubicacion?: string | null
          ubicacion_geo?: unknown
          updated_at?: string | null
          ventas_count?: number | null
          vistas_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_services_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_services_creador_id_fkey"
            columns: ["creador_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          alta_vendedor_paso: string | null
          average_rating: number | null
          average_rating_as_buyer: number | null
          average_rating_as_seller: number | null
          bio: string | null
          categoria_negocio: string | null
          created_at: string | null
          descripcion_negocio: string | null
          display_name: string | null
          email: string
          es_vendedor: boolean | null
          fcm_token: string | null
          foto: string | null
          has_seen_onboarding: boolean
          id: string
          is_hidden: boolean
          is_verified: boolean | null
          last_seen_at: string | null
          metodos_pago_aceptados: string | null
          nombre: string
          nombre_negocio: string | null
          reviews_count: number | null
          reviews_count_as_buyer: number | null
          reviews_count_as_seller: number | null
          rfc: string | null
          seller_type: string | null
          telefono: string | null
          total_sales: number | null
          trust_level: Database["public"]["Enums"]["trust_level"] | null
          trust_points: number | null
          ubicacion: string | null
          ubicacion_lat: number | null
          ubicacion_lng: number | null
          updated_at: string | null
          user_id: string | null
          username: string
          verified_at: string | null
        }
        Insert: {
          alta_vendedor_paso?: string | null
          average_rating?: number | null
          average_rating_as_buyer?: number | null
          average_rating_as_seller?: number | null
          bio?: string | null
          categoria_negocio?: string | null
          created_at?: string | null
          descripcion_negocio?: string | null
          display_name?: string | null
          email: string
          es_vendedor?: boolean | null
          fcm_token?: string | null
          foto?: string | null
          has_seen_onboarding?: boolean
          id: string
          is_hidden?: boolean
          is_verified?: boolean | null
          last_seen_at?: string | null
          metodos_pago_aceptados?: string | null
          nombre?: string
          nombre_negocio?: string | null
          reviews_count?: number | null
          reviews_count_as_buyer?: number | null
          reviews_count_as_seller?: number | null
          rfc?: string | null
          seller_type?: string | null
          telefono?: string | null
          total_sales?: number | null
          trust_level?: Database["public"]["Enums"]["trust_level"] | null
          trust_points?: number | null
          ubicacion?: string | null
          ubicacion_lat?: number | null
          ubicacion_lng?: number | null
          updated_at?: string | null
          user_id?: string | null
          username: string
          verified_at?: string | null
        }
        Update: {
          alta_vendedor_paso?: string | null
          average_rating?: number | null
          average_rating_as_buyer?: number | null
          average_rating_as_seller?: number | null
          bio?: string | null
          categoria_negocio?: string | null
          created_at?: string | null
          descripcion_negocio?: string | null
          display_name?: string | null
          email?: string
          es_vendedor?: boolean | null
          fcm_token?: string | null
          foto?: string | null
          has_seen_onboarding?: boolean
          id?: string
          is_hidden?: boolean
          is_verified?: boolean | null
          last_seen_at?: string | null
          metodos_pago_aceptados?: string | null
          nombre?: string
          nombre_negocio?: string | null
          reviews_count?: number | null
          reviews_count_as_buyer?: number | null
          reviews_count_as_seller?: number | null
          rfc?: string | null
          seller_type?: string | null
          telefono?: string | null
          total_sales?: number | null
          trust_level?: Database["public"]["Enums"]["trust_level"] | null
          trust_points?: number | null
          ubicacion?: string | null
          ubicacion_lat?: number | null
          ubicacion_lng?: number | null
          updated_at?: string | null
          user_id?: string | null
          username?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      purchase_request_categories: {
        Row: {
          categoria_id: string
          created_at: string | null
          request_id: string
        }
        Insert: {
          categoria_id: string
          created_at?: string | null
          request_id: string
        }
        Update: {
          categoria_id?: string
          created_at?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_categories_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_categories_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_requests: {
        Row: {
          budget_estimated: number | null
          buyer_id: string
          created_at: string | null
          description: string | null
          expires_at: string
          id: string
          image_url: string | null
          status: Database["public"]["Enums"]["request_status"]
          title: string
          ubicacion_geo: unknown
          updated_at: string | null
        }
        Insert: {
          budget_estimated?: number | null
          buyer_id: string
          created_at?: string | null
          description?: string | null
          expires_at: string
          id?: string
          image_url?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          title: string
          ubicacion_geo?: unknown
          updated_at?: string | null
        }
        Update: {
          budget_estimated?: number | null
          buyer_id?: string
          created_at?: string | null
          description?: string | null
          expires_at?: string
          id?: string
          image_url?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          title?: string
          ubicacion_geo?: unknown
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          description: string | null
          id: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolution_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolution_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string
          resolution_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["report_target_type"]
          updated_at?: string
        }
        Relationships: []
      }
      request_responses: {
        Row: {
          created_at: string | null
          id: string
          linked_product_id: string | null
          message_offer: string
          price_offer: number | null
          request_id: string
          seller_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          linked_product_id?: string | null
          message_offer: string
          price_offer?: number | null
          request_id: string
          seller_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          linked_product_id?: string | null
          message_offer?: string
          price_offer?: number | null
          request_id?: string
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_responses_linked_product_id_fkey"
            columns: ["linked_product_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_responses_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_responses_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          anonymized_at: string | null
          comentario: string | null
          created_at: string | null
          fotos: string[] | null
          id: string
          is_hidden: boolean
          motivo_reporte: string | null
          product_id: string
          rating: number
          reportada: boolean | null
          respuesta: string | null
          respuesta_fecha: string | null
          review_type: Database["public"]["Enums"]["review_type"]
          reviewed_id: string | null
          reviewer_id: string
          sale_confirmation_id: string
          updated_at: string | null
          visible: boolean | null
        }
        Insert: {
          anonymized_at?: string | null
          comentario?: string | null
          created_at?: string | null
          fotos?: string[] | null
          id?: string
          is_hidden?: boolean
          motivo_reporte?: string | null
          product_id: string
          rating: number
          reportada?: boolean | null
          respuesta?: string | null
          respuesta_fecha?: string | null
          review_type: Database["public"]["Enums"]["review_type"]
          reviewed_id?: string | null
          reviewer_id: string
          sale_confirmation_id: string
          updated_at?: string | null
          visible?: boolean | null
        }
        Update: {
          anonymized_at?: string | null
          comentario?: string | null
          created_at?: string | null
          fotos?: string[] | null
          id?: string
          is_hidden?: boolean
          motivo_reporte?: string | null
          product_id?: string
          rating?: number
          reportada?: boolean | null
          respuesta?: string | null
          respuesta_fecha?: string | null
          review_type?: Database["public"]["Enums"]["review_type"]
          reviewed_id?: string | null
          reviewer_id?: string
          sale_confirmation_id?: string
          updated_at?: string | null
          visible?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewed_id_fkey"
            columns: ["reviewed_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_sale_confirmation_id_fkey"
            columns: ["sale_confirmation_id"]
            isOneToOne: false
            referencedRelation: "sale_confirmations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_confirmations: {
        Row: {
          buyer_confirmed: boolean | null
          buyer_confirmed_at: string | null
          buyer_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cantidad: number
          chat_id: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          initiated_by: string
          metodo_pago: string | null
          notas: string | null
          precio_acordado: number
          product_id: string
          seller_confirmed: boolean | null
          seller_confirmed_at: string | null
          seller_id: string
          status: Database["public"]["Enums"]["sale_status"]
          tipo_entrega: string | null
          updated_at: string | null
        }
        Insert: {
          buyer_confirmed?: boolean | null
          buyer_confirmed_at?: string | null
          buyer_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cantidad?: number
          chat_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          initiated_by: string
          metodo_pago?: string | null
          notas?: string | null
          precio_acordado: number
          product_id: string
          seller_confirmed?: boolean | null
          seller_confirmed_at?: string | null
          seller_id: string
          status?: Database["public"]["Enums"]["sale_status"]
          tipo_entrega?: string | null
          updated_at?: string | null
        }
        Update: {
          buyer_confirmed?: boolean | null
          buyer_confirmed_at?: string | null
          buyer_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cantidad?: number
          chat_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          initiated_by?: string
          metodo_pago?: string | null
          notas?: string | null
          precio_acordado?: number
          product_id?: string
          seller_confirmed?: boolean | null
          seller_confirmed_at?: string | null
          seller_id?: string
          status?: Database["public"]["Enums"]["sale_status"]
          tipo_entrega?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sale_chat"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_confirmations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_confirmations_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_confirmations_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_confirmations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_confirmations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_rankings: {
        Row: {
          category_id: string
          composite_score: number
          computed_at: string
          id: string
          ingresos: number
          is_frozen: boolean
          period: string
          rating_avg: number | null
          response_avg_minutes: number | null
          seller_id: string
          trust_points_snapshot: number
          ventas_count: number
        }
        Insert: {
          category_id: string
          composite_score?: number
          computed_at?: string
          id?: string
          ingresos?: number
          is_frozen?: boolean
          period: string
          rating_avg?: number | null
          response_avg_minutes?: number | null
          seller_id: string
          trust_points_snapshot?: number
          ventas_count?: number
        }
        Update: {
          category_id?: string
          composite_score?: number
          computed_at?: string
          id?: string
          ingresos?: number
          is_frozen?: boolean
          period?: string
          rating_avg?: number | null
          response_avg_minutes?: number | null
          seller_id?: string
          trust_points_snapshot?: number
          ventas_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "seller_rankings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_rankings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_verification: {
        Row: {
          ai_analysis_raw: Json | null
          ai_confidence_score: number | null
          created_at: string | null
          document_type: string | null
          id: string
          ine_back_url: string | null
          ine_front_url: string | null
          reviewed_at: string | null
          reviewer_note: string | null
          selfie_url: string | null
          status: Database["public"]["Enums"]["verification_status"] | null
          submitted_at: string | null
          university_name: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_analysis_raw?: Json | null
          ai_confidence_score?: number | null
          created_at?: string | null
          document_type?: string | null
          id?: string
          ine_back_url?: string | null
          ine_front_url?: string | null
          reviewed_at?: string | null
          reviewer_note?: string | null
          selfie_url?: string | null
          status?: Database["public"]["Enums"]["verification_status"] | null
          submitted_at?: string | null
          university_name?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ai_analysis_raw?: Json | null
          ai_confidence_score?: number | null
          created_at?: string | null
          document_type?: string | null
          id?: string
          ine_back_url?: string | null
          ine_front_url?: string | null
          reviewed_at?: string | null
          reviewer_note?: string | null
          selfie_url?: string | null
          status?: Database["public"]["Enums"]["verification_status"] | null
          submitted_at?: string | null
          university_name?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_verification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_availability: {
        Row: {
          activo: boolean | null
          created_at: string | null
          cupo: number | null
          dia_semana: number
          duracion: number | null
          hora_fin: string
          hora_inicio: string
          id: string
          servicio_id: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          cupo?: number | null
          dia_semana: number
          duracion?: number | null
          hora_fin: string
          hora_inicio: string
          id?: string
          servicio_id: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          cupo?: number | null
          dia_semana?: number
          duracion?: number | null
          hora_fin?: string
          hora_inicio?: string
          id?: string
          servicio_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_availability_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "products_services"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      storage_cleanup_pending: {
        Row: {
          bucket: string
          created_at: string
          former_user_id: string | null
          id: string
          motivo: string | null
          path: string
          resolved_at: string | null
        }
        Insert: {
          bucket: string
          created_at?: string
          former_user_id?: string | null
          id?: string
          motivo?: string | null
          path: string
          resolved_at?: string | null
        }
        Update: {
          bucket?: string
          created_at?: string
          former_user_id?: string | null
          id?: string
          motivo?: string | null
          path?: string
          resolved_at?: string | null
        }
        Relationships: []
      }
      store_follows: {
        Row: {
          created_at: string | null
          follower_id: string
          id: string
          store_id: string
        }
        Insert: {
          created_at?: string | null
          follower_id: string
          id?: string
          store_id: string
        }
        Update: {
          created_at?: string | null
          follower_id?: string
          id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_follows_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_level_verification: {
        Row: {
          address_proof_url: string | null
          address_verified: boolean | null
          created_at: string | null
          current_level: Database["public"]["Enums"]["trust_level"] | null
          id: string
          id_back_url: string | null
          id_front_url: string | null
          id_verified: boolean | null
          level_1_completed_at: string | null
          level_2_completed_at: string | null
          phone_number: string | null
          phone_verified: boolean | null
          phone_verified_at: string | null
          reviewer_notes: string | null
          selfie_match_verified: boolean | null
          selfie_url: string | null
          selfie_verified: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address_proof_url?: string | null
          address_verified?: boolean | null
          created_at?: string | null
          current_level?: Database["public"]["Enums"]["trust_level"] | null
          id?: string
          id_back_url?: string | null
          id_front_url?: string | null
          id_verified?: boolean | null
          level_1_completed_at?: string | null
          level_2_completed_at?: string | null
          phone_number?: string | null
          phone_verified?: boolean | null
          phone_verified_at?: string | null
          reviewer_notes?: string | null
          selfie_match_verified?: boolean | null
          selfie_url?: string | null
          selfie_verified?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address_proof_url?: string | null
          address_verified?: boolean | null
          created_at?: string | null
          current_level?: Database["public"]["Enums"]["trust_level"] | null
          id?: string
          id_back_url?: string | null
          id_front_url?: string | null
          id_verified?: boolean | null
          level_1_completed_at?: string | null
          level_2_completed_at?: string | null
          phone_number?: string | null
          phone_verified?: boolean | null
          phone_verified_at?: string | null
          reviewer_notes?: string | null
          selfie_match_verified?: boolean | null
          selfie_url?: string | null
          selfie_verified?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verification_consent: {
        Row: {
          aceptado_at: string
          aviso_version: string
          id: string
          ip: unknown
          tipo: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          aceptado_at?: string
          aviso_version: string
          id?: string
          ip?: unknown
          tipo: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          aceptado_at?: string
          aviso_version?: string
          id?: string
          ip?: unknown
          tipo?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_consent_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_document_purge_log: {
        Row: {
          created_at: string
          deleted_count: number
          deleted_paths: string[]
          error: string | null
          id: number
          phase: string
          run_at: string
          storage_prefix: string
          user_id: string | null
          verification_status: string | null
        }
        Insert: {
          created_at?: string
          deleted_count?: number
          deleted_paths?: string[]
          error?: string | null
          id?: never
          phase: string
          run_at: string
          storage_prefix: string
          user_id?: string | null
          verification_status?: string | null
        }
        Update: {
          created_at?: string
          deleted_count?: number
          deleted_paths?: string[]
          error?: string | null
          id?: never
          phase?: string
          run_at?: string
          storage_prefix?: string
          user_id?: string | null
          verification_status?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      v_active_reports_count: {
        Row: {
          report_count: number | null
          target_id: string | null
          target_type: Database["public"]["Enums"]["report_target_type"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      activar_modo_vendedor: {
        Args: { p_categoria_negocio?: string; p_seller_type?: string }
        Returns: Json
      }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      admin_get_user: {
        Args: { p_user_id: string }
        Returns: {
          alta_vendedor_paso: string | null
          average_rating: number | null
          average_rating_as_buyer: number | null
          average_rating_as_seller: number | null
          bio: string | null
          categoria_negocio: string | null
          created_at: string | null
          descripcion_negocio: string | null
          display_name: string | null
          email: string
          es_vendedor: boolean | null
          fcm_token: string | null
          foto: string | null
          has_seen_onboarding: boolean
          id: string
          is_hidden: boolean
          is_verified: boolean | null
          last_seen_at: string | null
          metodos_pago_aceptados: string | null
          nombre: string
          nombre_negocio: string | null
          reviews_count: number | null
          reviews_count_as_buyer: number | null
          reviews_count_as_seller: number | null
          rfc: string | null
          seller_type: string | null
          telefono: string | null
          total_sales: number | null
          trust_level: Database["public"]["Enums"]["trust_level"] | null
          trust_points: number | null
          ubicacion: string | null
          ubicacion_lat: number | null
          ubicacion_lng: number | null
          updated_at: string | null
          user_id: string | null
          username: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_list_users: {
        Args: never
        Returns: {
          alta_vendedor_paso: string | null
          average_rating: number | null
          average_rating_as_buyer: number | null
          average_rating_as_seller: number | null
          bio: string | null
          categoria_negocio: string | null
          created_at: string | null
          descripcion_negocio: string | null
          display_name: string | null
          email: string
          es_vendedor: boolean | null
          fcm_token: string | null
          foto: string | null
          has_seen_onboarding: boolean
          id: string
          is_hidden: boolean
          is_verified: boolean | null
          last_seen_at: string | null
          metodos_pago_aceptados: string | null
          nombre: string
          nombre_negocio: string | null
          reviews_count: number | null
          reviews_count_as_buyer: number | null
          reviews_count_as_seller: number | null
          rfc: string | null
          seller_type: string | null
          telefono: string | null
          total_sales: number | null
          trust_level: Database["public"]["Enums"]["trust_level"] | null
          trust_points: number | null
          ubicacion: string | null
          ubicacion_lat: number | null
          ubicacion_lng: number | null
          updated_at: string | null
          user_id: string | null
          username: string
          verified_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_set_user_role: {
        Args: {
          p_grant: boolean
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      approve_verification_atomic: {
        Args: { p_user_id: string; p_verification_id: string }
        Returns: Json
      }
      avanzar_alta_vendedor: { Args: { p_paso?: string }; Returns: string }
      avisos_legales_pendientes: {
        Args: never
        Returns: {
          documento: string
          resumen: string
          version: string
          vigente_desde: string
        }[]
      }
      cancel_sale: {
        Args: { p_reason?: string; p_sale_id: string }
        Returns: undefined
      }
      chat_attachments_validos: {
        Args: { p_attachments: Json; p_autor_id: string; p_chat_id: string }
        Returns: boolean
      }
      cleanup_old_deletion_logs: { Args: never; Returns: number }
      complete_user_onboarding: { Args: never; Returns: undefined }
      confirm_sale: { Args: { p_sale_id: string }; Returns: undefined }
      count_nearby_vendors: {
        Args: { radius_meters?: number; user_lat: number; user_lng: number }
        Returns: number
      }
      create_notification: {
        Args: {
          p_data?: Json
          p_mensaje: string
          p_tipo: string
          p_titulo: string
          p_user_id: string
        }
        Returns: undefined
      }
      delete_user_data: { Args: { target_user_id: string }; Returns: Json }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      expire_stale_confirmations: { Args: never; Returns: number }
      feed_nearby_requests: {
        Args: {
          cat_slug?: string
          cursor_time?: string
          radius_meters?: number
          result_limit?: number
          user_lat: number
          user_lng: number
        }
        Returns: {
          budget_estimated: number
          buyer_id: string
          buyer_profile: Json
          categories: Json
          created_at: string
          description: string
          distance_meters: number
          expires_at: string
          id: string
          image_url: string
          response_count: number
          status: Database["public"]["Enums"]["request_status"]
          title: string
        }[]
      }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_available_ranking_periods: {
        Args: never
        Returns: {
          is_frozen: boolean
          period: string
        }[]
      }
      get_booked_slots: {
        Args: { p_date: string; p_product_id: string }
        Returns: {
          appointment_start: string
        }[]
      }
      get_my_profile: {
        Args: never
        Returns: {
          alta_vendedor_paso: string | null
          average_rating: number | null
          average_rating_as_buyer: number | null
          average_rating_as_seller: number | null
          bio: string | null
          categoria_negocio: string | null
          created_at: string | null
          descripcion_negocio: string | null
          display_name: string | null
          email: string
          es_vendedor: boolean | null
          fcm_token: string | null
          foto: string | null
          has_seen_onboarding: boolean
          id: string
          is_hidden: boolean
          is_verified: boolean | null
          last_seen_at: string | null
          metodos_pago_aceptados: string | null
          nombre: string
          nombre_negocio: string | null
          reviews_count: number | null
          reviews_count_as_buyer: number | null
          reviews_count_as_seller: number | null
          rfc: string | null
          seller_type: string | null
          telefono: string | null
          total_sales: number | null
          trust_level: Database["public"]["Enums"]["trust_level"] | null
          trust_points: number | null
          ubicacion: string | null
          ubicacion_lat: number | null
          ubicacion_lng: number | null
          updated_at: string | null
          user_id: string | null
          username: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_or_create_chat: {
        Args: {
          p_comprador_id: string
          p_producto_id?: string
          p_vendedor_id: string
        }
        Returns: string
      }
      get_product_location: {
        Args: { p_product_id: string }
        Returns: {
          lat: number
          lng: number
        }[]
      }
      get_ranking_hiperlocal: {
        Args: {
          p_category_id: string
          p_limit?: number
          p_period: string
          p_radius_meters?: number
          p_user_lat: number
          p_user_lng: number
        }
        Returns: {
          composite_score: number
          display_name: string
          distancia_aprox: number
          foto: string
          is_confiable: boolean
          rank: number
          seller_id: string
          trust_points: number
        }[]
      }
      gettransactionid: { Args: never; Returns: unknown }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_product_view: { Args: { p_id: string }; Returns: undefined }
      longtransactionsenabled: { Args: never; Returns: boolean }
      make_admin: { Args: { p_email: string }; Returns: undefined }
      manage_user_role: {
        Args: {
          p_action: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      mark_messages_as_read: {
        Args: { p_chat_id: string; p_user_id: string }
        Returns: undefined
      }
      moderate_review: {
        Args: {
          p_clear_reported?: boolean
          p_review_id: string
          p_visible: boolean
        }
        Returns: undefined
      }
      moderate_set_content_hidden: {
        Args: { p_hidden: boolean; p_target_id: string; p_target_type: string }
        Returns: undefined
      }
      nearby_products: {
        Args: {
          category_filter?: string
          radius_meters?: number
          result_limit?: number
          user_lat: number
          user_lng: number
        }
        Returns: {
          categoria: string
          distance_meters: number
          id: string
          imagen_principal: string
          precio: number
          slug: string
          tipo_entrega: string
          titulo: string
          vendedor_nombre: string
          vendedor_rating: number
          vendedor_reviews: number
          vendedor_trust: string
        }[]
      }
      notify_user_as_staff: {
        Args: {
          p_data?: Json
          p_mensaje: string
          p_tipo: string
          p_titulo: string
          p_user_id: string
        }
        Returns: undefined
      }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      recompute_seller_rankings: { Args: { p_period: string }; Returns: number }
      recompute_seller_rankings_for_category: {
        Args: { p_category_id: string; p_period: string }
        Returns: undefined
      }
      registrar_aceptacion_legal: {
        Args: { p_ip?: string; p_modo?: string; p_user_agent?: string }
        Returns: {
          documento: string
          version: string
        }[]
      }
      registrar_consentimiento_biometrico: {
        Args: { p_aviso_version: string; p_ip?: string; p_user_agent?: string }
        Returns: string
      }
      resolve_dispute_admin: {
        Args: {
          p_decision: Database["public"]["Enums"]["dispute_status"]
          p_dispute_id: string
          p_nota: string
        }
        Returns: string
      }
      ruta_de_chat_referenciada: { Args: { p_ruta: string }; Returns: boolean }
      search_nearby_products: {
        Args: {
          radius_meters?: number
          search_term?: string
          seller_ids?: string[]
          user_lat: number
          user_lng: number
        }
        Returns: {
          categoria: string
          created_at: string
          id: string
          imagen_principal: string
          precio: number
          precio_negociable: boolean
          product_categories: Json
          profiles: Json
          slug: string
          tipo: string
          titulo: string
          ventas_count: number
        }[]
      }
      search_nearby_products_v4: {
        Args: {
          cursor_id?: string
          cursor_time?: string
          radius_meters?: number
          restrict_seller_mode?: boolean
          result_limit?: number
          search_term?: string
          seller_ids?: string[]
          sin_limite?: boolean
          sort_by_distance?: boolean
          user_lat: number
          user_lng: number
        }
        Returns: {
          categoria: string
          created_at: string
          distance_meters: number
          id: string
          imagen_principal: string
          modo_precio: string
          precio: number
          precio_negociable: boolean
          product_categories: Json
          profiles: Json
          slug: string
          tipo: string
          tipo_entrega: string
          titulo: string
          ventas_count: number
        }[]
      }
      set_username: { Args: { p_username: string }; Returns: string }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      tiene_consentimiento_biometrico: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      unlockrows: { Args: { "": string }; Returns: number }
      update_profile_and_pause_products: {
        Args: {
          p_bio?: string
          p_descripcion_negocio?: string
          p_es_vendedor?: boolean
          p_foto?: string
          p_metodos_pago_aceptados?: string
          p_nombre: string
          p_nombre_negocio?: string
          p_seller_type?: string
          p_ubicacion?: string
          p_user_id: string
        }
        Returns: Json
      }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      booking_status: "pendiente" | "confirmado" | "completado" | "cancelado"
      coupon_type: "porcentaje" | "monto_fijo"
      dispute_status:
        | "open"
        | "under_review"
        | "resolved_buyer"
        | "resolved_seller"
        | "closed"
      listing_status:
        | "borrador"
        | "disponible"
        | "pausado"
        | "agotado"
        | "eliminado"
      listing_type: "producto" | "servicio"
      report_reason:
        | "spam"
        | "inappropriate_content"
        | "fraud_or_scam"
        | "harassment"
        | "fake_profile"
        | "illegal_product"
        | "copyright_violation"
        | "child_safety"
        | "other"
      report_status: "pending" | "reviewed" | "resolved" | "dismissed"
      report_target_type: "listing" | "user" | "message" | "review"
      request_status: "open" | "closed" | "expired"
      review_type: "buyer_to_seller" | "seller_to_buyer"
      sale_status:
        | "pending_confirmation"
        | "completed"
        | "cancelled"
        | "expired"
      trust_level: "nuevo" | "verificado" | "confiable" | "estrella" | "elite"
      verification_status: "pending" | "approved" | "rejected"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      booking_status: ["pendiente", "confirmado", "completado", "cancelado"],
      coupon_type: ["porcentaje", "monto_fijo"],
      dispute_status: [
        "open",
        "under_review",
        "resolved_buyer",
        "resolved_seller",
        "closed",
      ],
      listing_status: [
        "borrador",
        "disponible",
        "pausado",
        "agotado",
        "eliminado",
      ],
      listing_type: ["producto", "servicio"],
      report_reason: [
        "spam",
        "inappropriate_content",
        "fraud_or_scam",
        "harassment",
        "fake_profile",
        "illegal_product",
        "copyright_violation",
        "child_safety",
        "other",
      ],
      report_status: ["pending", "reviewed", "resolved", "dismissed"],
      report_target_type: ["listing", "user", "message", "review"],
      request_status: ["open", "closed", "expired"],
      review_type: ["buyer_to_seller", "seller_to_buyer"],
      sale_status: [
        "pending_confirmation",
        "completed",
        "cancelled",
        "expired",
      ],
      trust_level: ["nuevo", "verificado", "confiable", "estrella", "elite"],
      verification_status: ["pending", "approved", "rejected"],
    },
  },
} as const
