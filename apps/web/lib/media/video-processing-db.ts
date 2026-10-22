/** Narrow schema contract for the migration shipped with MEDIA-OPT-01. */
export type VideoJob = {
  id: string; user_id: string; input_path: string; input_size: number; mime: string;
  idempotency_key: string; status: string; output_path: string | null;
  output_size: number | null; duration: number | null; error_code: string | null;
  lease_id: string | null; lease_until: string | null; attempts: number;
  created_at: string; updated_at: string;
};
export type VideoProcessingDatabase = {
  public: {
    Tables: { media_processing_jobs: { Row: VideoJob; Insert: never; Update: never; Relationships: [] } };
    Views: Record<string, never>;
    Functions: {
      reserve_product_video_job: { Args: { p_key: string; p_size: number; p_mime: string }; Returns: VideoJob };
      mark_product_video_uploaded: { Args: { p_job_id: string }; Returns: VideoJob };
      cancel_product_video_job: { Args: { p_job_id: string }; Returns: VideoJob };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
