-- Una duracion de cita en 0 congela el navegador del comprador.
--
-- Item 96 de Notion. appointment_duration_minutes es un integer sin ninguna
-- restriccion, y getSlots() en appointment-scheduler.tsx hace:
--
--   while (cur + dur <= end) { ...; cur += dur; }
--
-- Con dur = 0, `cur` nunca avanza, la condicion sigue siendo cierta, y el bucle
-- empuja al array hasta agotar la memoria de la pestaña. El `?? 60` que habia no
-- protegia: cubre null y undefined, no el cero.
--
-- El arreglo del cliente ya esta puesto (guarda que exige > 0), pero la guarda
-- correcta va aqui: si el valor no puede existir en la base, ningun consumidor
-- —la web, el APK, un script, una integracion futura— tiene que acordarse de
-- defenderse.
--
-- Hoy no hay ninguna fila que viole el CHECK (comprobado: 0 con duracion <= 0),
-- asi que añadirlo no falla ni requiere limpiar nada antes.
--
-- El techo de 1440 es un dia entero. Una cita mas larga que eso no cabe en una
-- ventana diaria, que es como la modela el resto del sistema.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products_services'::regclass
      AND conname  = 'products_services_appointment_duration_check'
  ) THEN
    ALTER TABLE public.products_services
      ADD CONSTRAINT products_services_appointment_duration_check
      CHECK (appointment_duration_minutes IS NULL
             OR (appointment_duration_minutes > 0 AND appointment_duration_minutes <= 1440));
  END IF;
END $$;

COMMENT ON COLUMN public.products_services.appointment_duration_minutes IS
  'Duracion de cada franja, en minutos. Debe ser > 0: un 0 hacia bucle infinito en el generador de horarios del cliente.';

-- NOTA sobre el horario, que NO se restringe aqui a proposito:
--   appointment_start_time > appointment_end_time es LEGITIMO — es una ventana
--   que cruza medianoche, el caso natural de un antro, y el cliente ya la
--   soporta desde este mismo cambio.
--   Lo que si es ambiguo es start == end: puede significar "24 horas" o "sin
--   configurar". Hoy existe un servicio en produccion con 00:00 -> 00:00
--   ("Reservaciones para Dorothy"), que casi seguro es un formulario enviado
--   vacio. Prohibirlo con un CHECK invalidaria esa fila y romperia la edicion de
--   esa publicacion; el cliente la trata como "sin horarios" y lo dice en la
--   interfaz. Corregir ese dato es decision del vendedor, no de una migracion.

-- VERIFY:
--   INSERT ... appointment_duration_minutes = 0   -> debe violar el CHECK
--   SELECT titulo, appointment_start_time, appointment_end_time
--   FROM products_services WHERE appointment_end_time <= appointment_start_time;
--   -- hoy: 1 fila, "Reservaciones para Dorothy" con 00:00 -> 00:00
