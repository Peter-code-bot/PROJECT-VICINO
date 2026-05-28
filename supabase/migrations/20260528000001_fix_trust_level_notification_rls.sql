-- Fix RLS issue when one user's action causes another user to level up
-- The trigger function needs SECURITY DEFINER to insert notifications for other users
CREATE OR REPLACE FUNCTION update_trust_level_from_points()
RETURNS TRIGGER AS $$
DECLARE
  new_level trust_level;
  old_level trust_level;
BEGIN
  old_level := OLD.trust_level;

  new_level := CASE
    WHEN NEW.trust_points >= 1000 THEN 'elite'::trust_level
    WHEN NEW.trust_points >= 500 THEN 'estrella'::trust_level
    WHEN NEW.trust_points >= 200 THEN 'confiable'::trust_level
    WHEN NEW.trust_points >= 50 THEN 'verificado'::trust_level
    ELSE 'nuevo'::trust_level
  END;

  IF new_level != old_level THEN
    NEW.trust_level := new_level;

    -- Create notification on level up (only when going up)
    IF new_level > old_level THEN
      INSERT INTO notifications (user_id, tipo, titulo, mensaje, data)
      VALUES (
        NEW.id,
        'trust_upgrade',
        '¡Subiste de nivel!',
        'Ahora eres ' || CASE new_level
          WHEN 'verificado' THEN 'Verificado 🔵'
          WHEN 'confiable' THEN 'Confiable 🟢'
          WHEN 'estrella' THEN 'Estrella ⭐'
          WHEN 'elite' THEN 'Élite 🏆'
          ELSE ''
        END,
        jsonb_build_object('old_level', old_level::TEXT, 'new_level', new_level::TEXT)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
