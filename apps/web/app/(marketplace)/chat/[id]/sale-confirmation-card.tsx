// Legacy sale snapshot type used by deferred recovery. Interactive operations use ChatOperationCard.
export type ConfirmationStatus = "pendiente" | "esperando" | "completado" | "rechazado";

export interface SaleConfirmationProduct {
  id?: string;
  titulo: string;
  slug?: string | null;
  categoria?: string | null;
  categoria_slug?: string | null;
  imagen_principal?: string | null;
}

export interface SaleConfirmation {
  id: string;
  product_id: string;
  buyer_id: string;
  seller_id: string;
  precio_acordado: number;
  cantidad: number;
  metodo_pago: string | null;
  tipo_entrega: string | null;
  notas?: string | null;
  status: string;
  initiated_by: string;
  buyer_confirmed: boolean | null;
  seller_confirmed: boolean | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  created_at: string | null;
  purchase_intent_message_id?: string | null;
  products_services: SaleConfirmationProduct | SaleConfirmationProduct[] | null;
}
