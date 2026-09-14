import type { TrustLevel } from "@vicino/shared";

export interface ProductDetailProduct {
  id: string;
  slug: string;
  titulo: string;
  descripcion: string | null;
  precio: number | string | null;
  modo_precio: string | null;
  precio_negociable: boolean | null;
  categoria: string;
  tipo: string | null;
  estado: string | null;
  color: string | null;
  estatus: string | null;
  ubicacion: string | null;
  tipo_entrega: string | null;
  imagen_principal: string | null;
  galeria_imagenes: string[] | null;
  gallery_sizes: Array<{ colSpan: number; rowSpan: number }> | null;
  creador_id: string;
  vistas_count: number | null;
  allow_appointments: boolean | null;
  appointment_start_time: string | null;
  appointment_end_time: string | null;
  appointment_duration_minutes: number | null;
  created_at: string;
}

export interface ProductDetailSeller {
  id: string;
  nombre: string | null;
  foto: string | null;
  trust_level: TrustLevel | string | null;
  metodos_pago_aceptados: string | null;
  average_rating: number | string | null;
  reviews_count: number | string | null;
  total_sales: number | string | null;
  ubicacion_lat?: number | null;
  ubicacion_lng?: number | null;
  is_verified?: boolean | null;
}

export interface ProductDetailReviewerProfile {
  nombre: string | null;
  foto: string | null;
  trust_level?: string | null;
}

export interface ProductDetailReviewedProduct {
  id: string;
  titulo: string;
  categoria: string;
  slug: string;
  imagen_principal: string | null;
}

export interface ProductDetailReview {
  id: string;
  rating: number;
  comentario: string | null;
  created_at: string;
  review_type: string | null;
  respuesta: string | null;
  respuesta_fecha: string | null;
  reviewer_id: string;
  profiles: ProductDetailReviewerProfile | ProductDetailReviewerProfile[] | null;
  products_services:
    | ProductDetailReviewedProduct
    | ProductDetailReviewedProduct[]
    | null;
}

export interface ProductDetailCoupon {
  codigo: string;
  tipo_descuento: string;
  valor: number;
}

export interface ProductDetailUser {
  id: string;
}

export interface ProductDetailData {
  /**
   * Clave de idempotencia de la intencion de compra (contrato
   * iniciar_conversacion, 20260912300000). La genera el Server Component de la
   * ficha UNA vez por render y la reciben LOS DOS detalles —movil y
   * escritorio— porque ambos estan en el DOM a la vez (page.tsx los oculta con
   * CSS, no con una rama). Si cada componente generara la suya, una misma
   * ficha tendria dos claves y el aviso se duplicaria segun que boton se
   * pulsara: exactamente el bug que el contrato viene a cerrar.
   *
   * Una clave por VISTA de la ficha, no por sesion: F5 en /chat, el boton
   * atras o un doble toque reusan la misma y no duplican; recargar la ficha
   * produce una clave nueva, que es una intencion nueva en el mismo chat.
   */
  purchaseIntentKey: string;
  product: ProductDetailProduct;
  seller: ProductDetailSeller;
  reviews: ProductDetailReview[];
  coupons: ProductDetailCoupon[];
  extras?: Promise<ProductDetailExtras>;
  isFavorite: boolean;
  user: ProductDetailUser | null;
  isOwner: boolean;
  deliveryLabel: string;
  // MP#08 #4 Fase 1A: nombre display de la primary derivado en el page
  // parent (via primaryCategoryFull del pivote). Null si no hay primary
  // (edge pivote vacio, ya logueado a Sentry en el page). Pasa por
  // ProductDetailMobile/Desktop a MetaRow que renderea con fallback al
  // pretty-print de categoria TEXT cuando esto es null.
  categoryName: string | null;
}

export interface ProductDetailExtras {
  reviews: ProductDetailReview[];
  coupons: ProductDetailCoupon[];
  reviewsError?: string;
  couponsError?: string;
}
